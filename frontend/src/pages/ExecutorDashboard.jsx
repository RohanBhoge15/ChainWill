import { useState } from "react";
import { ChevronDown, Gavel } from "lucide-react";
import { api } from "../lib/api.js";
import { useNow } from "../lib/clock.js";
import { humanDuration, partyLabel } from "../lib/format.js";
import { livePhase } from "../lib/willMath.js";
import { usePolling } from "../hooks/usePolling.js";
import { useTx } from "../hooks/useTx.js";
import { TxDetailModal } from "../components/TxDetailModal.jsx";
import { AddressBadge, Button, Card, Empty, ErrorNote, Loading, PageHeader, ProgressBar } from "../components/ui.jsx";
import { AssetList, BeneficiaryList, EscrowSummary, EventList, LifecycleSteps, LifecycleTimer, LiveStatusChip } from "../components/will.jsx";

const EXECUTOR_MESSAGE = {
  ACTIVE: "The owner is checking in on time. There is nothing for you to do.",
  MISSED: "The owner missed a check-in and the grace period is running. You cannot act until it ends.",
  ELIGIBLE: "The grace period is over and the owner has not checked in. You may now activate inheritance.",
  ACTIVATED: "You activated this will. Beneficiaries can claim.",
  PARTIALLY_CLAIMED: "You activated this will. Beneficiaries are claiming.",
  FULLY_CLAIMED: "Everything in this will has been claimed. Your job is done.",
  REVOKED: "The owner revoked this will.",
};

function ExecutorWill({ will, onChanged, onOpenTx }) {
  const now = useNow();
  const { run, pending } = useTx();
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState(null);
  const phase = livePhase(will, now);
  const eligible = phase === "ELIGIBLE";
  const noBeneficiaries = will.totalPercentage === 0;

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next) setHistory((await api.get(`/wills/${will.owner.address}/history`)).events);
  };

  const activate = async () => {
    const receipt = await run("activateInheritance", { owner: will.owner.address }, { success: `Inheritance activated for ${partyLabel(will.owner)}` });
    if (receipt) {
      onChanged();
      if (expanded) setHistory((await api.get(`/wills/${will.owner.address}/history`)).events);
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label">Will owner</p>
          <AddressBadge party={will.owner} />
          {will.title && <p className="mt-2 text-sm text-slate-400">“{will.title}”</p>}
        </div>
        <LiveStatusChip will={will} />
      </div>

      <div className="mt-5">
        <LifecycleSteps will={will} />
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <LifecycleTimer will={will} compact />
          <p className="mt-2 text-sm text-slate-400">{EXECUTOR_MESSAGE[phase]}</p>
        </div>
        {!will.activated && will.phase !== "REVOKED" && (
          <div className="lg:text-right">
            <Button variant={eligible ? "warn" : "secondary"} size="lg" icon={Gavel} disabled={!eligible || noBeneficiaries} loading={pending === "activateInheritance"} onClick={activate}>
              Activate inheritance
            </Button>
            <p className="mt-2 text-xs text-slate-500">
              {eligible
                ? noBeneficiaries
                  ? "This will has no beneficiaries, so the contract will not activate it."
                  : "Irreversible. Freezes the escrow and lets beneficiaries claim."
                : `Unlocks ${humanDuration(Math.max(0, will.graceDeadline - now))} from now — only if the owner stays silent.`}
            </p>
          </div>
        )}
      </div>

      {will.activated && will.claimProgress.total > 0 && (
        <div className="mt-5">
          <div className="mb-1.5 flex justify-between text-xs text-slate-400">
            <span>Claims completed</span>
            <span>
              {will.claimProgress.claimed} of {will.claimProgress.total}
            </span>
          </div>
          <ProgressBar value={will.claimProgress.claimed / will.claimProgress.total} tone="violet" />
        </div>
      )}

      <button className="mt-5 flex w-full items-center justify-between border-t border-ink-800 pt-4 text-sm font-medium text-slate-300 hover:text-white" onClick={toggle} aria-expanded={expanded}>
        <span>Beneficiaries, assets and full history</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="mt-4 space-y-6">
          <div>
            <h3 className="card-title mb-2">Beneficiaries</h3>
            <BeneficiaryList will={will} />
          </div>
          <div>
            <h3 className="card-title mb-3">Escrow</h3>
            <EscrowSummary will={will} />
            <div className="mt-3">
              <AssetList will={will} />
            </div>
          </div>
          <div>
            <h3 className="card-title mb-2">History log</h3>
            {history ? <EventList events={history} onOpenTx={onOpenTx} /> : <Loading />}
          </div>
        </div>
      )}
    </Card>
  );
}

export default function ExecutorDashboard() {
  const [openTx, setOpenTx] = useState(null);
  const { data, error, loading, refresh } = usePolling(() => api.get("/wills/as-executor"), 4000);

  return (
    <>
      <PageHeader
        title="Executor"
        subtitle="Wills that named you executor. You can activate inheritance only after the owner misses a check-in and the whole grace period passes."
      />
      {loading ? (
        <Loading />
      ) : !data ? (
        <ErrorNote error={error} />
      ) : data.wills.length === 0 ? (
        <Card>
          <Empty icon={Gavel} title="Nobody has named you executor yet">
            When someone picks you as the executor of their will, it appears here with a live countdown.
          </Empty>
        </Card>
      ) : (
        <div className="space-y-6">
          {data.wills.map((will) => (
            <ExecutorWill key={will.owner.address} will={will} onChanged={refresh} onOpenTx={setOpenTx} />
          ))}
        </div>
      )}
      <TxDetailModal hash={openTx} onClose={() => setOpenTx(null)} />
    </>
  );
}
