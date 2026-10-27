import { CheckCircle2, Circle, XCircle } from "lucide-react";
import { Spinner, TxHash } from "./ui.jsx";

const ICON = {
  pending: <Circle className="h-5 w-5 text-slate-600" aria-label="pending" />,
  running: <Spinner className="h-5 w-5 text-emerald-400" />,
  done: <CheckCircle2 className="h-5 w-5 text-emerald-400" aria-label="done" />,
  failed: <XCircle className="h-5 w-5 text-rose-400" aria-label="failed" />,
};

/** Checklist of the transactions in a plan, with live status and tx hashes. */
export function PlanProgress({ steps, error, metamask = false }) {
  if (steps.length === 0) return null;
  const done = steps.filter((s) => s.status === "done").length;
  return (
    <div>
      <p className="mb-2 text-xs text-slate-500" aria-live="polite">
        {done} of {steps.length} transaction{steps.length === 1 ? "" : "s"} confirmed
        {metamask && " · approve each one in MetaMask"}
      </p>
      <ol className="space-y-1.5">
        {steps.map((step, i) => (
          <li key={step.id} className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-850 px-3 py-2.5">
            {ICON[step.status]}
            <span className={`flex-1 text-sm ${step.status === "pending" ? "text-slate-500" : "text-slate-200"}`}>
              <span className="mr-2 text-xs text-slate-600">{i + 1}.</span>
              {step.label}
            </span>
            <TxHash hash={step.txHash} />
          </li>
        ))}
      </ol>
      {error && (
        <div role="alert" className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <p className="font-semibold">{error.reverted ? "The smart contract rejected this step" : "This step failed"}</p>
          <p className="mt-0.5">{error.message}</p>
          <p className="mt-1 text-xs text-rose-200/70">Nothing was lost — the completed steps are final. Fix the cause and retry to continue from here.</p>
        </div>
      )}
    </div>
  );
}
