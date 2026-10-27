import { config } from "./config.js";
import { db, meta } from "./db.js";
import { provider, manifest, addresses, decodeLogs, clock, lower, formatUnits, tokenMeta, deedMeta, FUNGIBLE_SHARE } from "./chain.js";
import { syncWillCache, displayName } from "./wills.js";
import { notifyAddress } from "./notify.js";
import { humanDuration } from "./lifecycle.js";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const ZERO = "0x0000000000000000000000000000000000000000";
// Events older than this are history being back-filled, not news.
const NOTIFY_WINDOW_SECONDS = 300;

const insertEvent = db.prepare(
  `INSERT OR IGNORE INTO chain_events
     (block_number, tx_hash, log_index, contract, event_name, will_owner, tx_from, args_json, addresses, gas_used, timestamp)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

// ── Event → notifications ────────────────────────────────────────────────────────

async function describeClaim(args) {
  const type = Number(args.t);
  if (type === 0) return `${formatUnits(args.amount)} ETH`;
  if (type === 1) {
    const token = await tokenMeta(args.token);
    return `${formatUnits(args.amount, token.decimals)} ${token.symbol}`;
  }
  if (type === 2) return `the NFT "${(await deedMeta(args.token, args.amount)).name}"`;
  return "a document";
}

async function notifyForEvent(event, will, txEventNames) {
  const a = event.args;
  const ownerName = a.owner ? displayName(a.owner) : "";
  const willLink = "/app";

  switch (event.name) {
    case "WillCreated":
      notifyAddress(a.owner, {
        type: "WILL_CREATED",
        title: "📜 Will created",
        message: `Your will is live on-chain. Check in every ${humanDuration(Number(a.checkInInterval))} to keep it active.`,
        link: willLink,
      });
      notifyAddress(a.executor, {
        type: "EXECUTOR_NAMED",
        title: "🧑‍⚖️ You were named executor",
        message: `${ownerName} named you executor of their will. You can activate inheritance if they stop checking in.`,
        link: "/app/executor",
      });
      break;

    case "ExecutorChanged":
      notifyAddress(a.newExecutor, {
        type: "EXECUTOR_NAMED",
        title: "🧑‍⚖️ You were named executor",
        message: `${ownerName} named you executor of their will.`,
        link: "/app/executor",
      });
      notifyAddress(a.previousExecutor, {
        type: "EXECUTOR_REMOVED",
        title: "Executor role removed",
        message: `${ownerName} chose a different executor for their will.`,
        link: "/app/executor",
      });
      break;

    case "BeneficiaryAdded":
      notifyAddress(a.beneficiary, {
        type: "BENEFICIARY_ADDED",
        title: "🎁 You were added to a will",
        message: `${ownerName} named you a beneficiary with a ${a.pct}% share of their ETH and tokens.`,
        link: "/app/beneficiary",
      });
      break;

    case "BeneficiaryRemoved":
      notifyAddress(a.beneficiary, {
        type: "BENEFICIARY_REMOVED",
        title: "Removed from a will",
        message: `${ownerName} removed you as a beneficiary of their will.`,
        link: "/app/beneficiary",
      });
      break;

    case "AssetAssigned": {
      const asset = will?.assets[Number(a.assetIndex)];
      const what = asset?.type === "ERC721" ? `the NFT "${asset.nft?.name}"` : "a document";
      notifyAddress(a.beneficiary, {
        type: "ASSET_ASSIGNED",
        title: "📦 An item was assigned to you",
        message: `${ownerName} assigned ${what} to you in their will. It is inherited whole, not by percentage.`,
        link: "/app/beneficiary",
      });
      break;
    }

    case "CheckInPerformed":
      // createWill / updateSchedule emit this too; those already have their own notice
      if (txEventNames.has("WillCreated")) break;
      notifyAddress(a.owner, {
        type: "CHECKIN",
        title: "✅ Check-in confirmed",
        message: will
          ? `Timer reset. Your next check-in is due within ${humanDuration(will.checkInInterval)}.`
          : "Timer reset.",
        link: willLink,
      });
      break;

    case "InheritanceActivated":
      if (will) {
        for (const b of will.beneficiaries) {
          notifyAddress(b.address, {
            type: "ACTIVATED",
            title: "💰 You can now claim your inheritance",
            message: `The executor activated ${ownerName}'s will. Your ${b.percentage}% share and any items assigned to you are ready to claim.`,
            link: "/app/beneficiary",
          });
        }
      }
      // the executor's own action: a separate type so the UI does not toast it twice
      notifyAddress(a.executor, {
        type: "ACTIVATED_BY_YOU",
        title: "Inheritance activated",
        message: `You activated ${ownerName}'s will. Beneficiaries have been notified.`,
        link: "/app/executor",
      });
      notifyAddress(a.owner, {
        type: "ACTIVATED",
        title: "🚨 Your will was activated",
        message: `${displayName(a.executor)} activated your will. Beneficiaries can now claim the escrowed assets.`,
        link: willLink,
      });
      break;

    case "AssetClaimed": {
      const isDocument = Number(a.t) === 3;
      // one claimInheritance tx pays ETH and each token as separate events:
      // `event.payout` (set by the caller) folds them into a single notice
      if (event.payout === null) break;
      const what = event.payout ?? (await describeClaim(a));
      notifyAddress(a.beneficiary, {
        type: isDocument ? "DOC_UNLOCKED" : "CLAIMED",
        title: isDocument ? "🔓 Document unlocked" : "✅ Claim successful",
        message: isDocument
          ? `Your claim is recorded on-chain. You can now download the document from ${ownerName}'s will in the Document Vault.`
          : `You received ${what} from ${ownerName}'s will.`,
        link: isDocument ? "/app/vault" : "/app/beneficiary",
      });
      if (will) {
        notifyAddress(will.executor.address, {
          type: "CLAIM_OBSERVED",
          title: "Inheritance claimed",
          message: `${displayName(a.beneficiary)} claimed ${what} from ${ownerName}'s will.`,
          link: "/app/executor",
        });
      }
      break;
    }

    case "WillRevoked":
      if (will) {
        notifyAddress(will.executor.address, {
          type: "REVOKED",
          title: "Will revoked",
          message: `${ownerName} revoked their will. You are no longer its executor.`,
          link: "/app/executor",
        });
        for (const b of will.beneficiaries) {
          notifyAddress(b.address, {
            type: "REVOKED",
            title: "Will revoked",
            message: `${ownerName} revoked the will that named you as a beneficiary.`,
            link: "/app/beneficiary",
          });
        }
      }
      notifyAddress(a.owner, {
        type: "REVOKED_BY_YOU",
        title: "Will revoked",
        message: `Your will was revoked and ${formatUnits(a.ethRefunded)} ETH plus all escrowed assets were returned to you.`,
        link: willLink,
      });
      break;

    default:
      break;
  }
}

// ── Sync loop ────────────────────────────────────────────────────────────────────

async function syncOnce() {
  const latest = await provider.getBlockNumber();
  const cursor = Number(meta.get("indexer_cursor", String(manifest.deployBlock - 1)));
  if (latest <= cursor) return 0;

  const logs = await provider.getLogs({
    address: Object.values(addresses),
    fromBlock: cursor + 1,
    toBlock: latest,
  });
  if (logs.length === 0) {
    meta.set("indexer_cursor", latest);
    return 0;
  }

  const blockTimes = new Map();
  const receipts = new Map();
  await Promise.all([
    ...[...new Set(logs.map((l) => l.blockNumber))].map(async (n) => blockTimes.set(n, (await provider.getBlock(n)).timestamp)),
    ...[...new Set(logs.map((l) => l.transactionHash))].map(async (h) => receipts.set(h, await provider.getTransactionReceipt(h))),
  ]);

  const events = decodeLogs(logs).map((event) => ({ ...event, timestamp: blockTimes.get(event.blockNumber) }));

  const touchedOwners = new Set();
  db.transaction(() => {
    for (const event of events) {
      const receipt = receipts.get(event.txHash);
      const willOwner = event.contract === "WillManager" && event.args.owner ? lower(event.args.owner) : null;
      if (willOwner) touchedOwners.add(willOwner);
      const involved = new Set([lower(receipt.from)]);
      for (const value of Object.values(event.args)) {
        if (typeof value === "string" && ADDRESS_RE.test(value) && value !== ZERO) involved.add(lower(value));
      }
      insertEvent.run(
        event.blockNumber,
        event.txHash,
        event.logIndex,
        event.contract,
        event.name,
        willOwner,
        lower(receipt.from),
        JSON.stringify(event.args),
        [...involved].join(" "),
        receipt.gasUsed.toString(),
        event.timestamp
      );
    }
  })();

  // Refresh the mirror of every will that had activity, straight from the contract.
  const wills = new Map();
  for (const owner of touchedOwners) {
    try {
      wills.set(owner, await syncWillCache(owner));
    } catch (err) {
      console.warn(`[indexer] could not refresh will ${owner}: ${err.message}`);
    }
  }

  const freshAfter = clock.now() - NOTIFY_WINDOW_SECONDS;
  const namesByTx = new Map();
  for (const e of events) {
    if (!namesByTx.has(e.txHash)) namesByTx.set(e.txHash, new Set());
    namesByTx.get(e.txHash).add(e.name);
  }
  // Fold the per-asset AssetClaimed events of one percentage claim into one line.
  const payouts = new Map();
  for (const event of events) {
    if (event.name !== "AssetClaimed" || BigInt(event.args.assetIndex) !== FUNGIBLE_SHARE) continue;
    const key = `${event.txHash}:${lower(event.args.beneficiary)}`;
    const group = payouts.get(key) || { first: event, parts: [] };
    if (BigInt(event.args.amount) > 0n) group.parts.push(await describeClaim(event.args));
    payouts.set(key, group);
  }
  for (const event of events) {
    if (event.name !== "AssetClaimed" || BigInt(event.args.assetIndex) !== FUNGIBLE_SHARE) continue;
    const group = payouts.get(`${event.txHash}:${lower(event.args.beneficiary)}`);
    event.payout = group.first === event && group.parts.length ? group.parts.join(" + ") : null;
  }

  for (const event of events) {
    if (event.contract !== "WillManager" || event.timestamp < freshAfter) continue;
    try {
      await notifyForEvent(event, wills.get(lower(event.args.owner)), namesByTx.get(event.txHash));
    } catch (err) {
      console.warn(`[indexer] notification for ${event.name} failed: ${err.message}`);
    }
  }

  meta.set("indexer_cursor", latest);
  return events.length;
}

let chain = Promise.resolve();
/** Index everything up to the current head. Calls are queued, never concurrent. */
export function syncNow() {
  const run = chain.catch(() => {}).then(syncOnce);
  chain = run;
  return run;
}

let timer = null;
export function startIndexer() {
  if (timer) return;
  timer = setInterval(() => {
    syncNow().catch((err) => console.warn(`[indexer] sync failed: ${err.message}`));
  }, config.indexerPollMs);
  timer.unref?.();
}

export function stopIndexer() {
  clearInterval(timer);
  timer = null;
}
