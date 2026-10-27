import { api, ApiError } from "./api.js";
import { ensureChain, sendTransaction, metamaskMessage } from "./metamask.js";

let chainConfig = null;
export async function getChainConfig() {
  if (!chainConfig) chainConfig = await api.get("/chain/config");
  return chainConfig;
}

/**
 * Run one on-chain action for the signed-in user and resolve with its receipt
 * ({ txHash, blockNumber, gasUsed, events }).
 *
 *   Demo Wallet mode → the backend signs with the user's server-held key.
 *   MetaMask mode    → the backend prepares + dry-runs the transaction, the
 *                      extension signs it, the backend confirms the receipt.
 *
 * Rejections from the smart contract surface as ApiError with `.reverted = true`
 * and the contract's own reason as the message.
 */
export async function execute(user, action, params = {}) {
  try {
    if (user.walletMode === "demo") {
      return await api.post("/tx/send", { action, params });
    }
    const [{ tx }, chain] = await Promise.all([api.post("/tx/prepare", { action, params }), getChainConfig()]);
    await ensureChain(chain);
    let txHash;
    try {
      txHash = await sendTransaction(tx, user.walletAddress);
    } catch (err) {
      throw new ApiError(metamaskMessage(err), { reverted: /revert/i.test(err?.message || "") });
    }
    return await api.post("/tx/confirm", { txHash, action });
  } catch (err) {
    if (err instanceof ApiError && err.reverted) {
      // Surface the raw revert reason for the security demo.
      console.error(`[ChainWill] contract reverted on ${action}:`, err.message);
    }
    throw err;
  }
}
