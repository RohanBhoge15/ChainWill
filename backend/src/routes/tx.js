import { Router } from "express";
import { ethers } from "ethers";
import { buildTx, ACTION_NAMES } from "../actions.js";
import { simulate, sendFromWallet, waitForReceipt, describeReceipt, lower, checksum, provider, ChainRevert, revertReason, clock } from "../chain.js";
import { HttpError, bad } from "../http.js";
import { requireAuth, requireWallet } from "../middleware.js";
import { demoSigner } from "../users.js";
import { syncNow } from "../indexer.js";

const router = Router();
router.use(requireAuth, requireWallet);

router.get("/actions", (_req, res) => res.json({ actions: ACTION_NAMES }));

/**
 * Demo Wallet Mode: build → simulate → sign with the user's backend-held key →
 * wait for the receipt → index its events. A revert comes back as HTTP 400 with
 * the contract's own reason.
 */
router.post("/send", async (req, res) => {
  if (req.user.wallet_mode !== "demo") {
    throw new HttpError(409, "This account signs with MetaMask. Use /api/tx/prepare instead.");
  }
  const tx = buildTx(req.body.action, req.body.params, req.user);
  const receipt = await sendFromWallet(demoSigner(req.user), tx);
  await syncNow();
  res.json({ action: tx.action, summary: tx.summary, ...receipt });
});

/**
 * MetaMask Mode, step 1: build the same transaction, dry-run it for the user's
 * address (so a doomed call is rejected with a clear reason before MetaMask even
 * opens) and return it unsigned.
 */
router.post("/prepare", async (req, res) => {
  const tx = buildTx(req.body.action, req.body.params, req.user);
  const from = checksum(req.user.wallet_address);
  await simulate(from, tx);
  // Suggest a gas limit (estimate + 20%) so the wallet does not have to guess.
  const estimate = await provider.estimateGas({ from, to: tx.to, data: tx.data, value: tx.value ?? 0n });
  res.json({
    action: tx.action,
    summary: tx.summary,
    tx: {
      from,
      to: tx.to,
      data: tx.data,
      value: ethers.toQuantity(tx.value ?? 0n),
      gas: ethers.toQuantity((estimate * 120n) / 100n),
    },
  });
});

/**
 * Dry-run only (eth_call against the live contract; nothing is signed or mined).
 * Powers the Security Lab: "what would the contract say if I tried this?"
 */
router.post("/simulate", async (req, res) => {
  const tx = buildTx(req.body.action, req.body.params, req.user);
  try {
    await simulate(checksum(req.user.wallet_address), tx);
    res.json({ action: tx.action, summary: tx.summary, wouldSucceed: true, reason: null });
  } catch (err) {
    if (!(err instanceof ChainRevert)) throw err;
    console.log(`[chain] simulated revert for ${req.user.email} on ${tx.action}: ${err.reason}`);
    res.json({ action: tx.action, summary: tx.summary, wouldSucceed: false, reason: err.reason });
  }
});

/** MetaMask Mode, step 2: the browser reports the hash; we wait, verify and index it. */
router.post("/confirm", async (req, res) => {
  const txHash = String(req.body.txHash || "");
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw bad("txHash is not a transaction hash");
  const receipt = await waitForReceipt(txHash);
  if (lower(receipt.from) !== lower(req.user.wallet_address)) {
    throw new HttpError(403, "That transaction was not sent from your wallet");
  }
  await syncNow();
  if (receipt.status !== 1) {
    // Replay the failed call at its block to recover the revert reason. If the
    // replay passes, the contract was happy and the transaction simply ran dry.
    let reason = "Transaction failed on-chain without a revert reason — most likely it ran out of gas";
    try {
      const sent = await provider.getTransaction(txHash);
      await provider.call({ from: sent.from, to: sent.to, data: sent.data, value: sent.value, blockTag: receipt.blockNumber });
    } catch (err) {
      reason = revertReason(err);
    }
    throw new ChainRevert(reason);
  }
  res.json({ action: req.body.action || null, ...describeReceipt(receipt) });
});

/** Projected chain time — lets the UI run its countdowns on the contract's clock. */
router.get("/clock", (_req, res) => res.json({ chainNow: clock.now() }));

export default router;
