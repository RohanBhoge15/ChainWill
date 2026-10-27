import { Router } from "express";
import { ethers } from "ethers";
import { db } from "../db.js";
import { provider, addresses, manifest, describeReceipt, lower, clock, manager, formatUnits } from "../chain.js";
import { bad, HttpError } from "../http.js";
import { eventRow, party, readWill } from "../wills.js";

/** Public, read-only: everything here is already visible on the chain itself. */
const router = Router();

router.get("/summary", async (_req, res) => {
  const [blockNumber, willCount, escrow] = await Promise.all([
    provider.getBlockNumber(),
    manager.willCount(),
    provider.getBalance(addresses.WillManager),
  ]);
  const counts = db.prepare("SELECT event_name AS name, COUNT(*) AS count FROM chain_events GROUP BY event_name ORDER BY count DESC").all();
  const { txs } = db.prepare("SELECT COUNT(DISTINCT tx_hash) AS txs FROM chain_events").get();
  res.json({
    chainId: manifest.chainId,
    blockNumber,
    chainNow: clock.now(),
    contracts: addresses,
    willCount: Number(willCount),
    ethInEscrow: formatUnits(escrow),
    transactions: txs,
    eventCounts: counts,
  });
});

/** Every will on the contract, as anyone could read it from the chain. */
router.get("/wills", async (_req, res) => {
  const owners = await manager.getWillOwners();
  const wills = (await Promise.all(owners.map((owner) => readWill(owner)))).filter(Boolean);
  res.json({
    chainNow: clock.now(),
    wills: wills.map((w) => ({
      owner: w.owner,
      executor: w.executor,
      title: w.title,
      phase: w.phase,
      status: w.status,
      totalPercentage: w.totalPercentage,
      beneficiaries: w.beneficiaries.map((b) => ({ address: b.address, name: b.name, percentage: b.percentage, hasClaimed: b.hasClaimed })),
      assets: w.assets.map((a) => ({ index: a.index, type: a.type, label: a.label, assignedTo: a.assignedTo, isClaimed: a.isClaimed, removed: a.removed })),
      ethEscrowFormatted: w.ethEscrowFormatted,
      checkInDeadline: w.checkInDeadline,
      graceDeadline: w.graceDeadline,
      lastCheckIn: w.lastCheckIn,
      claimProgress: w.claimProgress,
    })),
  });
});

router.get("/events", (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const where = [];
  const params = [];

  const address = String(req.query.address || "").trim();
  if (address) {
    if (!ethers.isAddress(address)) throw bad("address is not a valid Ethereum address");
    where.push("(' ' || addresses || ' ') LIKE ?");
    params.push(`% ${lower(address)} %`);
  }
  const event = String(req.query.event || "").trim();
  if (event) {
    where.push("event_name = ?");
    params.push(event);
  }
  const contract = String(req.query.contract || "").trim();
  if (contract) {
    where.push("contract = ?");
    params.push(contract);
  }
  const txHash = String(req.query.tx || "").trim();
  if (txHash) {
    where.push("tx_hash = ?");
    params.push(txHash.toLowerCase());
  }

  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM chain_events ${clause}`).get(...params);
  const rows = db
    .prepare(`SELECT * FROM chain_events ${clause} ORDER BY block_number DESC, log_index DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  res.json({ total, limit, offset, events: rows.map(eventRow) });
});

/** One transaction, fetched from the node itself (not from the index). */
router.get("/tx/:hash", async (req, res) => {
  const hash = String(req.params.hash);
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw bad("Not a transaction hash");
  const [tx, receipt] = await Promise.all([provider.getTransaction(hash), provider.getTransactionReceipt(hash)]);
  if (!tx || !receipt) throw new HttpError(404, "Transaction not found on this chain");
  const block = await provider.getBlock(receipt.blockNumber);
  const described = describeReceipt(receipt);
  const names = {};
  const remember = (address) => {
    const who = party(address);
    if (who.name) names[lower(address)] = who.name;
  };
  remember(tx.from);
  for (const event of described.events) {
    for (const value of Object.values(event.args)) {
      if (typeof value === "string" && ethers.isAddress(value)) remember(value);
    }
  }
  res.json({
    ...described,
    names,
    from: party(tx.from),
    to: tx.to ? party(tx.to) : null,
    value: tx.value.toString(),
    valueFormatted: formatUnits(tx.value),
    nonce: tx.nonce,
    gasPrice: tx.gasPrice?.toString() ?? null,
    timestamp: block.timestamp,
    blockHash: receipt.blockHash,
    succeeded: receipt.status === 1,
  });
});

export default router;
