import { Router } from "express";
import { db } from "../db.js";
import { walletBalances, checksum, lower, ganacheAddresses } from "../chain.js";
import { HttpError, asAddress } from "../http.js";
import { requireAuth, requireWallet } from "../middleware.js";
import { publicUser, findUserById, assignDemoWallet, verifyChallenge, assertAddressFree } from "../users.js";

const router = Router();
router.use(requireAuth);

/** Live balances of the caller's active wallet. */
router.get("/", requireWallet, async (req, res) => {
  const address = checksum(req.user.wallet_address);
  res.json({
    address,
    mode: req.user.wallet_mode,
    isGanacheAccount: ganacheAddresses.includes(lower(address)),
    ...(await walletBalances(address)),
  });
});

/** Switch the account's on-chain identity to a MetaMask address the user controls. */
router.post("/link-metamask", async (req, res) => {
  if (req.user.role === "admin") throw new HttpError(403, "The admin account is read-only and has no wallet");
  const address = verifyChallenge(asAddress(req.body.address, "address"), String(req.body.signature || ""));
  assertAddressFree(address, req.user.id);
  db.prepare("UPDATE users SET wallet_address = ?, wallet_mode = 'metamask' WHERE id = ?").run(address, req.user.id);
  res.json({ user: publicUser(findUserById(req.user.id)) });
});

/** Go back to the backend-managed demo wallet (assigning one if needed). */
router.post("/unlink-metamask", async (req, res) => {
  if (req.user.wallet_mode !== "metamask") throw new HttpError(409, "No MetaMask wallet is linked");
  let demoAddress = req.user.demo_address;
  if (!demoAddress) demoAddress = (await assignDemoWallet(req.user.id)).address;
  db.prepare("UPDATE users SET wallet_address = ?, wallet_mode = 'demo' WHERE id = ?").run(demoAddress, req.user.id);
  res.json({ user: publicUser(findUserById(req.user.id)) });
});

/** Name → address book, so executors/beneficiaries can be picked by name. */
router.get("/directory", (req, res) => {
  const rows = db
    .prepare("SELECT id, name, wallet_address, wallet_mode FROM users WHERE wallet_address IS NOT NULL ORDER BY name COLLATE NOCASE")
    .all();
  res.json({
    users: rows.map((r) => ({
      id: r.id,
      name: r.name,
      address: checksum(r.wallet_address),
      walletMode: r.wallet_mode,
      isYou: r.id === req.user.id,
    })),
  });
});

export default router;
