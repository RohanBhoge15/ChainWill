import { Router } from "express";
import { db } from "../db.js";
import { lower } from "../chain.js";
import { asAddress, HttpError } from "../http.js";
import { requireAuth, requireWallet } from "../middleware.js";
import { readWill, willsWhereExecutor, willsWhereBeneficiary, willHistory, eventRow } from "../wills.js";

const router = Router();
router.use(requireAuth);

/** On-chain receipts of every claim made against a will (tx hash, block, amount). */
function claimReceipts(ownerAddress) {
  return db
    .prepare("SELECT * FROM chain_events WHERE will_owner = ? AND event_name = 'AssetClaimed' ORDER BY block_number, log_index")
    .all(lower(ownerAddress))
    .map(eventRow);
}

const withReceipts = (will) => ({ ...will, claims: claimReceipts(will.owner.address) });
const isAdmin = (req) => ({ isAdmin: req.user.role === "admin" });

router.get("/mine", requireWallet, async (req, res) => {
  const will = await readWill(req.user.wallet_address, req.user.wallet_address);
  res.json({ will: will ? withReceipts(will) : null });
});

router.get("/as-executor", requireWallet, async (req, res) => {
  const wills = await willsWhereExecutor(req.user.wallet_address);
  res.json({ wills: wills.map(withReceipts) });
});

router.get("/as-beneficiary", requireWallet, async (req, res) => {
  const wills = await willsWhereBeneficiary(req.user.wallet_address);
  res.json({ wills: wills.map(withReceipts) });
});

/** Off-chain label for the caller's own will. Cosmetic only — never trusted. */
router.put("/mine/meta", requireWallet, (req, res) => {
  const title = typeof req.body.title === "string" ? req.body.title.trim().slice(0, 80) : "";
  const note = typeof req.body.note === "string" ? req.body.note.trim().slice(0, 500) : "";
  db.prepare(
    `INSERT INTO will_meta (owner_address, title, note, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(owner_address) DO UPDATE SET title = excluded.title, note = excluded.note, updated_at = excluded.updated_at`
  ).run(lower(req.user.wallet_address), title || null, note || null);
  res.json({ title: title || null, note: note || null });
});

router.get("/:owner", async (req, res) => {
  const owner = asAddress(req.params.owner, "owner");
  const will = await readWill(owner, req.user.wallet_address, isAdmin(req));
  if (!will) throw new HttpError(404, "This address has no will");
  res.json({ will: { ...withReceipts(will), history: willHistory(owner) } });
});

router.get("/:owner/history", (req, res) => {
  res.json({ events: willHistory(asAddress(req.params.owner, "owner")) });
});

export default router;
