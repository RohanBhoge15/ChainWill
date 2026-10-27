import { db } from "./db.js";
import {
  manager,
  addresses,
  clock,
  lower,
  checksum,
  tokenMeta,
  deedMeta,
  formatUnits,
  STATUS,
  ASSET_TYPES,
} from "./chain.js";
import { derivePhase, deriveStatus, claimProgress } from "./lifecycle.js";

const userByWalletStmt = db.prepare("SELECT id, name, email, wallet_mode FROM users WHERE wallet_address = ?");

export function userByWallet(address) {
  return address ? userByWalletStmt.get(lower(address)) : undefined;
}

/** { address, name } — name is null when nobody has registered that wallet. */
export function party(address) {
  const user = userByWallet(address);
  return { address: checksum(address), name: user ? user.name : null };
}

export const shortAddress = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;
export const displayName = (address) => userByWallet(address)?.name || shortAddress(checksum(address));

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * Read one will LIVE from the contract and shape it for the API. Returns null
 * when the address has no will. `viewer` (an address) only controls which
 * off-chain document names are attached — everything else is public chain data.
 */
export async function readWill(ownerAddress, viewer = null, { isAdmin = false } = {}) {
  const owner = checksum(ownerAddress);
  if (!(await manager.hasWill(owner))) return null;

  const [view, rawBeneficiaries, rawAssets, [tokenAddrs, tokenEscrowed, tokenSnapshots]] = await Promise.all([
    manager.getWill(owner),
    manager.getBeneficiaries(owner),
    manager.getAssets(owner),
    manager.getTokens(owner),
  ]);

  const now = clock.now();
  const activated = view.activated;
  const storedStatus = STATUS[Number(view.status)];
  const revoked = storedStatus === "REVOKED";

  const tokens = await Promise.all(
    tokenAddrs.map(async (address, i) => {
      const meta = await tokenMeta(address);
      return {
        address: meta.address,
        symbol: meta.symbol,
        decimals: meta.decimals,
        escrowed: tokenEscrowed[i].toString(),
        escrowedFormatted: formatUnits(tokenEscrowed[i], meta.decimals),
        snapshot: tokenSnapshots[i].toString(),
        snapshotFormatted: formatUnits(tokenSnapshots[i], meta.decimals),
      };
    })
  );

  const ethBasis = activated ? view.ethSnapshot : view.ethEscrow;
  const beneficiaries = rawBeneficiaries.map((b) => {
    const pct = BigInt(b.percentage);
    const ethShare = (ethBasis * pct) / 100n;
    return {
      ...party(b.wallet),
      percentage: Number(b.percentage),
      hasClaimed: b.hasClaimed,
      // what claimInheritance pays (or paid) this beneficiary
      share: {
        eth: ethShare.toString(),
        ethFormatted: formatUnits(ethShare),
        tokens: tokens.map((t) => {
          const amount = (BigInt(activated ? t.snapshot : t.escrowed) * pct) / 100n;
          return { address: t.address, symbol: t.symbol, amount: amount.toString(), amountFormatted: formatUnits(amount, t.decimals) };
        }),
      },
    };
  });

  const viewerLower = viewer ? lower(viewer) : null;
  const viewerIsOwner = viewerLower === lower(owner);
  const documentRows = db
    .prepare("SELECT id, asset_index, original_name, mime_type, size_bytes FROM documents WHERE owner_address = ? AND asset_index IS NOT NULL")
    .all(lower(owner));

  const assets = await Promise.all(
    rawAssets.map(async (a, index) => {
      const type = ASSET_TYPES[Number(a.assetType)];
      const asset = {
        index,
        type,
        tokenAddress: a.tokenAddress === ZERO ? null : a.tokenAddress,
        amountOrId: a.amountOrId.toString(),
        docHash: a.docHash || null,
        storageCID: a.storageCID || null,
        assignedTo: a.assignedTo === ZERO ? null : party(a.assignedTo),
        isClaimed: a.isClaimed,
        removed: a.removed,
        label: "",
        document: null,
      };
      if (type === "ETH") {
        asset.amountFormatted = formatUnits(a.amountOrId);
        asset.label = `${asset.amountFormatted} ETH`;
      } else if (type === "ERC20") {
        const meta = await tokenMeta(a.tokenAddress);
        asset.symbol = meta.symbol;
        asset.amountFormatted = formatUnits(a.amountOrId, meta.decimals);
        asset.label = `${asset.amountFormatted} ${meta.symbol}`;
      } else if (type === "ERC721") {
        const deed = await deedMeta(a.tokenAddress, a.amountOrId);
        asset.nft = { tokenId: a.amountOrId.toString(), ...deed };
        asset.label = `${deed.name} (#${a.amountOrId})`;
      } else {
        const doc = documentRows.find((d) => d.asset_index === index);
        const mayKnowName = isAdmin || viewerIsOwner || (viewerLower && viewerLower === lower(a.assignedTo));
        if (doc && mayKnowName) {
          asset.document = { id: doc.id, originalName: doc.original_name, mimeType: doc.mime_type, sizeBytes: doc.size_bytes };
          asset.label = doc.original_name;
        } else {
          asset.label = `Document ${a.docHash.slice(0, 10)}…`;
        }
      }
      return asset;
    })
  );

  const hasFungible = activated
    ? view.ethSnapshot > 0n || tokens.some((t) => BigInt(t.snapshot) > 0n)
    : view.ethEscrow > 0n || tokens.some((t) => BigInt(t.escrowed) > 0n);

  const shape = {
    revoked,
    activated,
    checkInDeadline: Number(view.checkInDeadline),
    graceDeadline: Number(view.graceDeadline),
    beneficiaries,
    assets,
    hasFungible,
  };
  const metaRow = db.prepare("SELECT title, note FROM will_meta WHERE owner_address = ?").get(lower(owner));
  const viewerBeneficiary = viewerLower ? beneficiaries.find((b) => lower(b.address) === viewerLower) : null;

  return {
    owner: party(owner),
    executor: party(view.executor),
    title: metaRow?.title || null,
    note: viewerIsOwner || isAdmin ? metaRow?.note || null : null,

    // projected to the block that would be mined right now
    status: deriveStatus(shape, now),
    phase: derivePhase(shape, now),
    // what the contract's views answer as of the last mined block
    onChain: {
      status: storedStatus,
      blockTime: Number(view.chainTime),
    },
    chainNow: now,

    lastCheckIn: Number(view.lastCheckIn),
    checkInInterval: Number(view.checkInInterval),
    gracePeriod: Number(view.gracePeriod),
    checkInDeadline: shape.checkInDeadline,
    graceDeadline: shape.graceDeadline,
    createdAt: Number(view.createdAt),
    activatedAt: Number(view.activatedAt),
    activated,

    totalPercentage: Number(view.totalPercentage),
    ethEscrow: view.ethEscrow.toString(),
    ethEscrowFormatted: formatUnits(view.ethEscrow),
    ethSnapshot: view.ethSnapshot.toString(),
    ethSnapshotFormatted: formatUnits(view.ethSnapshot),
    tokens,
    hasFungible,
    beneficiaries,
    assets,
    claimProgress: claimProgress(shape),

    viewer: viewer
      ? {
          isOwner: viewerIsOwner,
          isExecutor: viewerLower === lower(view.executor),
          beneficiary: viewerBeneficiary
            ? { percentage: viewerBeneficiary.percentage, hasClaimed: viewerBeneficiary.hasClaimed, share: viewerBeneficiary.share }
            : null,
        }
      : null,
  };
}

/** Mirror one will into the SQLite cache (called by the indexer after its events). */
export async function syncWillCache(ownerAddress) {
  const will = await readWill(ownerAddress);
  const id = lower(ownerAddress);
  if (!will) {
    db.prepare("DELETE FROM wills_cache WHERE will_id = ?").run(id);
    return null;
  }

  db.transaction(() => {
    db.prepare(
      `INSERT INTO wills_cache
         (will_id, owner_address, executor_address, contract_address, checkin_interval, grace_period,
          last_checkin_at, created_at_chain, activated_at_chain, total_percentage, eth_escrow,
          last_synced_status, last_synced_phase, synced_at)
       VALUES (@id, @id, @executor, @contract, @interval, @grace, @lastCheckIn, @createdAt, @activatedAt,
               @totalPercentage, @ethEscrow, @status, @phase, datetime('now'))
       ON CONFLICT(will_id) DO UPDATE SET
         executor_address = excluded.executor_address,
         contract_address = excluded.contract_address,
         checkin_interval = excluded.checkin_interval,
         grace_period = excluded.grace_period,
         last_checkin_at = excluded.last_checkin_at,
         created_at_chain = excluded.created_at_chain,
         activated_at_chain = excluded.activated_at_chain,
         total_percentage = excluded.total_percentage,
         eth_escrow = excluded.eth_escrow,
         last_synced_status = excluded.last_synced_status,
         last_synced_phase = excluded.last_synced_phase,
         synced_at = excluded.synced_at`
    ).run({
      id,
      executor: lower(will.executor.address),
      contract: lower(addresses.WillManager),
      interval: will.checkInInterval,
      grace: will.gracePeriod,
      lastCheckIn: will.lastCheckIn,
      createdAt: will.createdAt,
      activatedAt: will.activatedAt,
      totalPercentage: will.totalPercentage,
      ethEscrow: will.ethEscrow,
      status: will.status,
      phase: will.phase,
    });

    db.prepare("DELETE FROM beneficiaries WHERE will_id = ?").run(id);
    const insertBeneficiary = db.prepare(
      "INSERT INTO beneficiaries (will_id, wallet_address, percentage, has_claimed) VALUES (?, ?, ?, ?)"
    );
    for (const b of will.beneficiaries) insertBeneficiary.run(id, lower(b.address), b.percentage, b.hasClaimed ? 1 : 0);

    db.prepare("DELETE FROM assets_cache WHERE will_id = ?").run(id);
    const insertAsset = db.prepare(
      `INSERT INTO assets_cache (will_id, asset_index, asset_type, token_address, amount_or_id, doc_hash, storage_cid, assigned_to, is_claimed, removed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const a of will.assets) {
      insertAsset.run(
        id,
        a.index,
        a.type,
        a.tokenAddress ? lower(a.tokenAddress) : null,
        a.amountOrId,
        a.docHash,
        a.storageCID,
        a.assignedTo ? lower(a.assignedTo.address) : null,
        a.isClaimed ? 1 : 0,
        a.removed ? 1 : 0
      );
    }

    // Link uploaded files to the on-chain document asset that carries their fingerprint.
    const documents = db.prepare("SELECT id, sha256_hash, cid FROM documents WHERE owner_address = ?").all(id);
    const link = db.prepare("UPDATE documents SET asset_index = ? WHERE id = ?");
    for (const doc of documents) {
      const match = will.assets.find(
        (a) => a.type === "DOCUMENT" && !a.removed && a.docHash === doc.sha256_hash && a.storageCID === doc.cid
      );
      link.run(match ? match.index : null, doc.id);
    }
  })();

  return will;
}

// ── Reverse lookups (cache finds candidates, the chain confirms them) ────────────

export async function willsWhereExecutor(address) {
  const rows = db.prepare("SELECT owner_address FROM wills_cache WHERE executor_address = ?").all(lower(address));
  const wills = await Promise.all(rows.map((r) => readWill(r.owner_address, address)));
  return wills.filter((w) => w && w.viewer.isExecutor);
}

export async function willsWhereBeneficiary(address) {
  const rows = db.prepare("SELECT will_id FROM beneficiaries WHERE wallet_address = ?").all(lower(address));
  const wills = await Promise.all(rows.map((r) => readWill(r.will_id, address)));
  return wills.filter((w) => w && w.viewer.beneficiary);
}

/** lowercase address → display name, for every registered wallet an event mentions */
function namesIn(addressList) {
  const names = {};
  for (const address of addressList.split(" ")) {
    const user = userByWallet(address);
    if (user) names[address] = user.name;
  }
  return names;
}

const eventRow = (row) => ({
  id: row.id,
  blockNumber: row.block_number,
  txHash: row.tx_hash,
  logIndex: row.log_index,
  contract: row.contract,
  event: row.event_name,
  willOwner: row.will_owner ? party(row.will_owner) : null,
  from: row.tx_from ? party(row.tx_from) : null,
  args: JSON.parse(row.args_json),
  names: namesIn(row.addresses),
  gasUsed: row.gas_used,
  timestamp: row.timestamp,
});

export function willHistory(ownerAddress, limit = 200) {
  return db
    .prepare("SELECT * FROM chain_events WHERE will_owner = ? ORDER BY block_number DESC, log_index DESC LIMIT ?")
    .all(lower(ownerAddress), limit)
    .map(eventRow);
}

export { eventRow };
