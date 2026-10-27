import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeftRight, CalendarClock, FilePlus2, HeartPulse, Plus, ScrollText, Trash2, UserCog, UserPlus } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../lib/api.js";
import { useNow } from "../lib/clock.js";
import { PHASES, humanDuration, partyLabel } from "../lib/format.js";
import { livePhase } from "../lib/willMath.js";
import { usePolling } from "../hooks/usePolling.js";
import { useDirectory } from "../hooks/useDirectory.js";
import { useTx } from "../hooks/useTx.js";
import { AddAssetModal, AddBeneficiaryModal, ReassignModal } from "../components/AssetModals.jsx";
import { PartyPicker } from "../components/PartyPicker.jsx";
import { ScheduleFields, scheduleErrors } from "../components/ScheduleFields.jsx";
import { TxDetailModal } from "../components/TxDetailModal.jsx";
import { AddressBadge, Button, Card, ConfirmButton, Empty, ErrorNote, Field, Loading, Modal, PageHeader } from "../components/ui.jsx";
import { AssetList, BeneficiaryList, EscrowSummary, EventList, LifecycleSteps, LifecycleTimer, LiveStatusChip } from "../components/will.jsx";

function NoWill({ revoked = false }) {
  const { user, wallet } = useAuth();
  return (
    <Card>
      <Empty
        icon={ScrollText}
        title={revoked ? "Your previous will was revoked" : "You have not created a will yet"}
        action={
          <Link to="/app/will/new" className="btn btn-primary btn-lg">
            <FilePlus2 className="h-5 w-5" /> {revoked ? "Create a new will" : "Create my will"}
          </Link>
        }
      >
        A will names an executor and beneficiaries, escrows your assets in the smart contract and starts your check-in timer. It takes about a minute.
      </Empty>
      <div className="mx-auto mt-2 flex max-w-md items-center justify-between gap-4 rounded-xl border border-ink-700 bg-ink-850 px-4 py-3">
        <AddressBadge address={user.walletAddress} name="Your wallet" />
        <span className="text-right text-sm">
          <span className="block font-semibold text-white">{wallet ? `${wallet.ethFormatted} ETH` : "…"}</span>
          <span className="text-xs text-slate-500">{wallet ? `${wallet.token.balanceFormatted} ${wallet.token.symbol}` : ""}</span>
        </span>
      </div>
    </Card>
  );
}

function ScheduleModal({ will, open, onClose, onDone }) {
  const { run, busy } = useTx();
  const [value, setValue] = useState({ interval: will.checkInInterval, grace: will.gracePeriod });
  const errors = scheduleErrors(value);
  const unchanged = value.interval === will.checkInInterval && value.grace === will.gracePeriod;

  const submit = async (event) => {
    event.preventDefault();
    const receipt = await run("updateSchedule", value, { success: "Schedule updated — timer restarted" });
    if (receipt) {
      onDone();
      onClose();
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Change check-in schedule" wide>
      <form onSubmit={submit} className="space-y-5">
        <ScheduleFields value={value} onChange={setValue} />
        <p className="text-xs text-slate-500">Signing this change counts as a check-in: the timer restarts under the new schedule.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={unchanged || Boolean(errors.interval || errors.grace)}>
            Save schedule
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ExecutorModal({ will, open, onClose, onDone, directory }) {
  const { user } = useAuth();
  const { run, busy } = useTx();
  const [executor, setExecutor] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    const receipt = await run("updateExecutor", { executor }, { success: "Executor changed" });
    if (receipt) {
      onDone();
      onClose();
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Change executor">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-400">
          Current executor: <span className="font-semibold text-slate-200">{partyLabel(will.executor)}</span>. The executor is the only person who can
          activate inheritance.
        </p>
        <Field label="New executor">
          {(id) => <PartyPicker id={id} value={executor} onChange={setExecutor} directory={directory} exclude={[user.walletAddress, will.executor.address]} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!/^0x[0-9a-fA-F]{40}$/.test(executor)}>
            Change executor
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const OWNER_MESSAGE = {
  ACTIVE: "You're on schedule. Check in before the timer runs out to keep your will dormant.",
  MISSED: "You missed your check-in. Check in now — once the grace period ends your executor can activate inheritance.",
  ELIGIBLE: "The grace period is over. Your executor can activate inheritance at any moment. If you are here, check in now to stop it.",
  ACTIVATED: "Your executor activated this will. Beneficiaries are claiming the escrowed assets; it can no longer be changed.",
  PARTIALLY_CLAIMED: "Your executor activated this will. Beneficiaries are claiming the escrowed assets; it can no longer be changed.",
  FULLY_CLAIMED: "Every share and item of this will has been claimed.",
};

export default function OwnerDashboard() {
  const { user } = useAuth();
  const directory = useDirectory();
  const now = useNow();
  const { run, pending } = useTx();
  const [modal, setModal] = useState(null); // 'asset' | 'beneficiary' | 'schedule' | 'executor'
  const [reassign, setReassign] = useState(null);
  const [openTx, setOpenTx] = useState(null);

  const { data, error, loading, refresh } = usePolling(async () => {
    const { will } = await api.get("/wills/mine");
    const history = will ? (await api.get(`/wills/${will.owner.address}/history`)).events : [];
    return { will, history };
  }, 4000);

  if (loading) return <Loading label="Reading your will from the chain…" />;
  if (!data) return <ErrorNote error={error} />;

  const { will, history } = data;
  if (!will) {
    return (
      <>
        <PageHeader title="My will" subtitle="Create your will, fund it, and keep it dormant by checking in." />
        <NoWill />
      </>
    );
  }

  const phase = livePhase(will, now);
  const editable = !will.activated && will.phase !== "REVOKED";
  const act = (action, params, options) => run(action, params, options).then((receipt) => receipt && refresh());

  return (
    <>
      <PageHeader title={will.title || "My will"} subtitle={PHASES[phase].blurb}>
        <LiveStatusChip will={will} />
      </PageHeader>

      {will.phase === "REVOKED" && (
        <div className="mb-6">
          <NoWill revoked />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Timer + check-in ── */}
        <Card className="lg:col-span-2">
          <div className="mb-5">
            <LifecycleSteps will={will} />
          </div>
          <LifecycleTimer will={will} />
          {will.phase !== "REVOKED" && <p className="mt-4 text-sm text-slate-400">{OWNER_MESSAGE[phase]}</p>}
          {editable && (
            <Button
              variant={phase === "ACTIVE" ? "primary" : "warn"}
              size="lg"
              className="mt-5 w-full"
              icon={HeartPulse}
              loading={pending === "checkIn"}
              onClick={() => act("checkIn", {}, { success: "Checked in — timer reset" })}
            >
              I'm alive — check in
            </Button>
          )}
        </Card>

        {/* ── Parties ── */}
        <Card title="People">
          <dl className="space-y-4">
            <div>
              <dt className="label">Owner (you)</dt>
              <dd>
                <AddressBadge party={will.owner} />
              </dd>
            </div>
            <div>
              <dt className="label">Executor</dt>
              <dd className="flex items-center justify-between gap-2">
                <AddressBadge party={will.executor} />
                {editable && (
                  <Button variant="ghost" size="sm" icon={UserCog} onClick={() => setModal("executor")}>
                    Change
                  </Button>
                )}
              </dd>
            </div>
            <div>
              <dt className="label">Schedule</dt>
              <dd className="flex items-center justify-between gap-2 text-sm text-slate-300">
                <span>
                  Every {humanDuration(will.checkInInterval)}
                  <span className="text-slate-500"> + {humanDuration(will.gracePeriod)} grace</span>
                </span>
                {editable && (
                  <Button variant="ghost" size="sm" icon={CalendarClock} onClick={() => setModal("schedule")}>
                    Edit
                  </Button>
                )}
              </dd>
            </div>
          </dl>
        </Card>

        {/* ── Beneficiaries ── */}
        <Card
          title="Beneficiaries"
          className="lg:col-span-3"
          action={
            editable && (
              <Button size="sm" icon={UserPlus} onClick={() => setModal("beneficiary")} disabled={will.totalPercentage >= 100}>
                Add beneficiary
              </Button>
            )
          }
        >
          <BeneficiaryList
            will={will}
            viewerAddress={user.walletAddress}
            renderAction={(b) =>
              editable && (
                <ConfirmButton
                  variant="ghost"
                  size="sm"
                  icon={Trash2}
                  confirmLabel="Remove"
                  loading={pending === `remove-${b.address}`}
                  onConfirm={() => act("removeBeneficiary", { wallet: b.address }, { key: `remove-${b.address}`, success: `${partyLabel(b)} removed — ${b.percentage}% freed` })}
                >
                  Remove
                </ConfirmButton>
              )
            }
          />
        </Card>

        {/* ── Assets ── */}
        <Card
          title="Assets in this will"
          className="lg:col-span-3"
          action={
            editable && (
              <Button size="sm" icon={Plus} onClick={() => setModal("asset")}>
                Add asset
              </Button>
            )
          }
        >
          <EscrowSummary will={will} />
          <div className="mt-4">
            <AssetList
              will={will}
              renderAction={(asset) =>
                editable &&
                !asset.removed && (
                  <span className="flex items-center gap-1">
                    {(asset.type === "ERC721" || asset.type === "DOCUMENT") && (
                      <Button variant="ghost" size="sm" icon={ArrowLeftRight} onClick={() => setReassign(asset)} aria-label={`Reassign ${asset.label}`}>
                        Reassign
                      </Button>
                    )}
                    <ConfirmButton
                      variant="ghost"
                      size="sm"
                      icon={Trash2}
                      confirmLabel="Withdraw"
                      loading={pending === `asset-${asset.index}`}
                      onConfirm={() => act("removeAsset", { assetIndex: asset.index }, { key: `asset-${asset.index}`, success: `${asset.label} withdrawn from the will` })}
                    >
                      Withdraw
                    </ConfirmButton>
                  </span>
                )
              }
            />
          </div>
        </Card>

        {/* ── History ── */}
        <Card title="On-chain history" className={editable ? "lg:col-span-2" : "lg:col-span-3"}>
          <EventList events={history} onOpenTx={setOpenTx} />
        </Card>

        {/* ── Danger zone ── */}
        {editable && (
          <Card title="Revoke will">
            <p className="text-sm text-slate-400">
              Cancels the will and returns all escrowed ETH, tokens and NFTs to your wallet in one transaction. Your executor and beneficiaries are
              notified. You can create a new will afterwards.
            </p>
            <ConfirmButton
              variant="danger"
              className="mt-4"
              confirmLabel="Yes, revoke my will"
              loading={pending === "revokeWill"}
              onConfirm={() => act("revokeWill", {}, { success: "Will revoked — assets returned" })}
            >
              Revoke will
            </ConfirmButton>
          </Card>
        )}
      </div>

      {editable && (
        <>
          <AddAssetModal will={will} open={modal === "asset"} onClose={() => setModal(null)} onDone={refresh} />
          <AddBeneficiaryModal will={will} open={modal === "beneficiary"} onClose={() => setModal(null)} onDone={refresh} directory={directory} />
          {modal === "schedule" && <ScheduleModal will={will} open onClose={() => setModal(null)} onDone={refresh} />}
          {modal === "executor" && <ExecutorModal will={will} open onClose={() => setModal(null)} onDone={refresh} directory={directory} />}
          <ReassignModal will={will} asset={reassign} onClose={() => setReassign(null)} onDone={refresh} />
        </>
      )}
      <TxDetailModal hash={openTx} onClose={() => setOpenTx(null)} />
    </>
  );
}
