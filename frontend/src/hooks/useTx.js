import { useCallback, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { execute } from "../lib/tx.js";

/**
 * Sends on-chain actions with consistent feedback.
 *
 *   const { run, pending } = useTx();
 *   await run("checkIn", {}, { success: "Checked in" });
 *
 * `pending` is the key of the action in flight (or null) so buttons can show a
 * spinner. `run` resolves with the receipt, or `null` if it failed — the error
 * (including the contract's revert reason) has already been shown as a toast.
 */
export function useTx() {
  const { user, refreshWallet } = useAuth();
  const toast = useToast();
  const [pending, setPending] = useState(null);

  const run = useCallback(
    async (action, params = {}, { success, key, silent = false, rethrow = false } = {}) => {
      setPending(key ?? action);
      try {
        const receipt = await execute(user, action, params);
        if (!silent) toast.success(success || receipt.summary || "Transaction confirmed", { txHash: receipt.txHash });
        refreshWallet();
        return receipt;
      } catch (err) {
        if (rethrow) throw err;
        if (err.reverted) toast.revert("Rejected by the smart contract", { detail: err.message });
        else toast.error("Transaction failed", { detail: err.message });
        return null;
      } finally {
        setPending(null);
      }
    },
    [user, toast, refreshWallet]
  );

  return { run, pending, busy: pending !== null };
}
