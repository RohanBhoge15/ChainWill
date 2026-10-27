import { Router } from "express";
import { config } from "../config.js";
import { db } from "../db.js";
import {
  provider,
  manager,
  demoToken,
  demoNft,
  addresses,
  manifest,
  clock,
  ganacheAddresses,
  checksum,
  formatUnits,
  tokenMeta,
} from "../chain.js";
import { HttpError, asInt } from "../http.js";
import { requireAuth, requireAdmin } from "../middleware.js";
import { readWill, eventRow } from "../wills.js";
import { pushStats, pushEnabled } from "../notify.js";
import { syncNow } from "../indexer.js";
import { runSchedulerOnce } from "../scheduler.js";
import { storage } from "../storage/index.js";

/**
 * Read-only transparency dashboard. Every number is computed on request from
 * the live chain and the database — nothing here is hard-coded.
 */
const router = Router();
router.use(requireAuth, requireAdmin);

const count = (sql, ...params) => db.prepare(sql).get(...params).n;

async function allWills() {
  const owners = await manager.getWillOwners();
  const wills = await Promise.all(owners.map((owner) => readWill(owner, null, { isAdmin: true })));
  return wills.filter(Boolean);
}

router.get("/metrics", async (_req, res) => {
  const [blockNumber, escrowWei, tokenEscrow, nftEscrow, token, wills, gasPrice] = await Promise.all([
    provider.getBlockNumber(),
    provider.getBalance(addresses.WillManager),
    demoToken.balanceOf(addresses.WillManager),
    demoNft.balanceOf(addresses.WillManager),
    tokenMeta(addresses.DemoToken),
    allWills(),
    provider.getFeeData().then((f) => f.gasPrice ?? 0n),
  ]);

  const phases = { ACTIVE: 0, MISSED: 0, ELIGIBLE: 0, ACTIVATED: 0, PARTIALLY_CLAIMED: 0, FULLY_CLAIMED: 0, REVOKED: 0 };
  const assetTypes = { ETH: 0, ERC20: 0, ERC721: 0, DOCUMENT: 0 };
  let beneficiaryCount = 0;
  let claimsDone = 0;
  let claimsTotal = 0;
  for (const will of wills) {
    phases[will.phase]++;
    beneficiaryCount += will.beneficiaries.length;
    for (const asset of will.assets) if (!asset.removed) assetTypes[asset.type]++;
    if (will.activated) {
      claimsDone += will.claimProgress.claimed;
      claimsTotal += will.claimProgress.total;
    }
  }

  // Sums over indexed AssetClaimed events (amounts are base units as strings).
  let ethClaimed = 0n;
  let tokensClaimed = 0n;
  let nftsClaimed = 0;
  let documentsClaimed = 0;
  for (const row of db.prepare("SELECT args_json FROM chain_events WHERE event_name = 'AssetClaimed'").all()) {
    const args = JSON.parse(row.args_json);
    const type = Number(args.t);
    if (type === 0) ethClaimed += BigInt(args.amount);
    else if (type === 1) tokensClaimed += BigInt(args.amount);
    else if (type === 2) nftsClaimed++;
    else documentsClaimed++;
  }

  let gasUsed = 0n;
  for (const row of db.prepare("SELECT gas_used FROM chain_events GROUP BY tx_hash").all()) gasUsed += BigInt(row.gas_used || 0);

  const users = {
    total: count("SELECT COUNT(*) AS n FROM users"),
    demoWallets: count("SELECT COUNT(*) AS n FROM users WHERE wallet_mode = 'demo' AND wallet_address IS NOT NULL"),
    metamask: count("SELECT COUNT(*) AS n FROM users WHERE wallet_mode = 'metamask'"),
    admins: count("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'"),
  };

  const slotOwners = new Map(
    db
      .prepare("SELECT u.wallet_address AS address, u.name, u.wallet_mode FROM users u WHERE u.wallet_address IS NOT NULL")
      .all()
      .map((r) => [r.address, r])
  );
  const accounts = await Promise.all(
    ganacheAddresses.map(async (address, slot) => {
      const balance = await provider.getBalance(address);
      const holder = slotOwners.get(address);
      return {
        slot,
        address: checksum(address),
        balance: formatUnits(balance, 18, 4),
        user: holder ? holder.name : null,
        walletMode: holder ? holder.wallet_mode : null,
        isDeployer: checksum(address) === checksum(manifest.deployer),
      };
    })
  );

  const docs = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes), 0) AS bytes, COUNT(asset_index) AS registered FROM documents").get();

  res.json({
    generatedAt: new Date().toISOString(),
    chain: {
      rpcUrl: config.rpcUrl,
      chainId: manifest.chainId,
      blockNumber,
      chainNow: clock.now(),
      clockOffsetSeconds: clock.offset,
      gasPriceGwei: formatUnits(gasPrice, 9, 2),
      contracts: addresses,
      deployBlock: manifest.deployBlock,
      deployedAt: manifest.deployedAt,
      indexedUpToBlock: Number(db.prepare("SELECT value FROM meta WHERE key = 'indexer_cursor'").get()?.value ?? 0),
    },
    users,
    wills: { total: wills.length, phases },
    beneficiaries: beneficiaryCount,
    assets: assetTypes,
    escrow: {
      eth: formatUnits(escrowWei),
      tokens: formatUnits(tokenEscrow, token.decimals),
      tokenSymbol: token.symbol,
      nfts: Number(nftEscrow),
    },
    claims: {
      done: claimsDone,
      total: claimsTotal,
      ethClaimed: formatUnits(ethClaimed),
      tokensClaimed: formatUnits(tokensClaimed, token.decimals),
      nftsClaimed,
      documentsClaimed,
    },
    activity: {
      events: count("SELECT COUNT(*) AS n FROM chain_events"),
      transactions: count("SELECT COUNT(DISTINCT tx_hash) AS n FROM chain_events"),
      gasUsed: gasUsed.toString(),
      checkIns: count("SELECT COUNT(*) AS n FROM chain_events WHERE event_name = 'CheckInPerformed'"),
      activations: count("SELECT COUNT(*) AS n FROM chain_events WHERE event_name = 'InheritanceActivated'"),
      revocations: count("SELECT COUNT(*) AS n FROM chain_events WHERE event_name = 'WillRevoked'"),
      byEvent: db
        .prepare("SELECT event_name AS name, COUNT(*) AS count FROM chain_events GROUP BY event_name ORDER BY count DESC")
        .all(),
      recent: db
        .prepare("SELECT * FROM chain_events WHERE contract = 'WillManager' ORDER BY block_number DESC, log_index DESC LIMIT 8")
        .all()
        .map(eventRow),
    },
    documents: { total: docs.n, bytes: docs.bytes, registeredOnChain: docs.registered, storage: storage.name },
    notifications: {
      total: count("SELECT COUNT(*) AS n FROM notifications"),
      unread: count("SELECT COUNT(*) AS n FROM notifications WHERE read = 0"),
      pushEnabled,
      pushSubscriptions: count("SELECT COUNT(*) AS n FROM push_subscriptions"),
      pushSent: pushStats.sent,
      pushFailed: pushStats.failed,
    },
    accounts,
    demoTools: config.demoTools,
  });
});

router.get("/users", async (_req, res) => {
  const rows = db.prepare("SELECT id, name, email, role, wallet_address, wallet_mode, created_at FROM users ORDER BY id").all();
  const users = await Promise.all(
    rows.map(async (u) => {
      let balance = null;
      let phase = null;
      if (u.wallet_address) {
        const address = checksum(u.wallet_address);
        const [wei, phaseIndex] = await Promise.all([provider.getBalance(address), manager.getPhase(address)]);
        balance = formatUnits(wei, 18, 4);
        phase = Number(phaseIndex) === 0 ? null : (await readWill(address, null))?.phase ?? null;
      }
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        walletAddress: u.wallet_address ? checksum(u.wallet_address) : null,
        walletMode: u.wallet_address ? u.wallet_mode : null,
        ethBalance: balance,
        ownWillPhase: phase,
        executorOf: u.wallet_address ? count("SELECT COUNT(*) AS n FROM wills_cache WHERE executor_address = ?", u.wallet_address) : 0,
        beneficiaryOf: u.wallet_address ? count("SELECT COUNT(*) AS n FROM beneficiaries WHERE wallet_address = ?", u.wallet_address) : 0,
        createdAt: u.created_at.replace(" ", "T") + "Z",
      };
    })
  );
  res.json({ users });
});

router.get("/wills", async (_req, res) => {
  res.json({ wills: await allWills() });
});

/** DEMO TOOL — fast-forward the local chain's clock instead of waiting. */
router.post("/time-travel", async (req, res) => {
  if (!config.demoTools) throw new HttpError(403, "Demo tools are disabled (ENABLE_DEMO_TOOLS=false)");
  const seconds = asInt(req.body.seconds, "seconds", { min: 1, max: 366 * 86_400 });
  const offset = await clock.travel(seconds);
  await syncNow();
  await runSchedulerOnce();
  res.json({ advancedBy: seconds, clockOffsetSeconds: offset, chainNow: clock.now() });
});

export default router;
