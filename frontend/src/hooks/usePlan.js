import { useCallback, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { execute } from "../lib/tx.js";

/**
 * Runs an ordered list of on-chain actions one after another, tracking each
 * step's status. If one fails, the rest stay pending and `run()` can be called
 * again to continue from the failed step — completed transactions are never
 * re-sent.
 *
 *   step = { id, label, action, params | (results) => params }
 */
export function usePlan() {
  const { user, refreshWallet } = useAuth();
  const [steps, setSteps] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | running | failed | done
  const [error, setError] = useState(null);
  const results = useRef({});
  const plan = useRef([]);

  const load = useCallback((list) => {
    plan.current = list;
    results.current = {};
    setSteps(list.map((s) => ({ id: s.id, label: s.label, status: "pending", txHash: null })));
    setStatus("idle");
    setError(null);
  }, []);

  const run = useCallback(
    async (list) => {
      if (list) load(list);
      const todo = plan.current;
      setStatus("running");
      setError(null);
      const patch = (id, change) => setSteps((current) => current.map((s) => (s.id === id ? { ...s, ...change } : s)));

      for (const step of todo) {
        if (results.current[step.id]) continue; // already mined on a previous attempt
        patch(step.id, { status: "running" });
        try {
          const params = typeof step.params === "function" ? step.params(results.current) : step.params;
          const receipt = await execute(user, step.action, params);
          results.current[step.id] = receipt;
          patch(step.id, { status: "done", txHash: receipt.txHash });
        } catch (err) {
          patch(step.id, { status: "failed" });
          setError(err);
          setStatus("failed");
          refreshWallet();
          return null;
        }
      }
      setStatus("done");
      refreshWallet();
      return results.current;
    },
    [user, load, refreshWallet]
  );

  const reset = useCallback(() => load([]), [load]);
  return { steps, status, error, run, load, reset, running: status === "running" };
}
