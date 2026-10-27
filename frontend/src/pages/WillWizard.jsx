import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Coins, FileText, Gem, Image as ImageIcon, PartyPopper, Plus, Trash2, Upload } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../lib/api.js";
import { formatBytes, humanDuration, sameAddress, shortAddress } from "../lib/format.js";
import { buildWillPlan, isPositiveAmount, remainingPercent, sumPercent, toBaseUnits, validateBeneficiaries } from "../lib/willMath.js";
import { useDirectory } from "../hooks/useDirectory.js";
import { usePlan } from "../hooks/usePlan.js";
import { BeneficiarySelect, NFT_KINDS, SplitPreview } from "../components/AssetModals.jsx";
import { PartyPicker } from "../components/PartyPicker.jsx";
import { PlanProgress } from "../components/PlanProgress.jsx";
import { ScheduleFields, scheduleErrors } from "../components/ScheduleFields.jsx";
import { AddressBadge, Button, Card, ErrorNote, Field, Loading, PageHeader, ProgressBar } from "../components/ui.jsx";

const STEPS = ["Basic info", "Executor", "Beneficiaries", "Assets", "Review & submit"];
let nextKey = 1;
const key = () => nextKey++;

const emptyDraft = () => ({
  title: "",
  note: "",
  interval: 120,
  grace: 60,
  executor: "",
  executorName: null,
  beneficiaries: [{ key: key(), address: "", name: null, pct: "" }],
  ethAmount: "",
  tokenAmount: "",
  nfts: [],
  documents: [],
});

function Stepper({ step }) {
  return (
    <ol className="mb-6 flex items-center gap-2" aria-label="Wizard progress">
      {STEPS.map((label, i) => (
        <li key={label} className="flex flex-1 items-center gap-2 last:flex-none" aria-current={i === step ? "step" : undefined}>
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold ${
              i < step ? "border-emerald-400 bg-emerald-400 text-ink-950" : i === step ? "border-emerald-400 text-emerald-300" : "border-ink-600 text-slate-500"
            }`}
          >
            {i < step ? <Check className="h-4 w-4" /> : i + 1}
          </span>
          <span className={`hidden text-sm font-medium whitespace-nowrap md:block ${i === step ? "text-white" : "text-slate-500"}`}>{label}</span>
          {i < STEPS.length - 1 && <span className={`h-px flex-1 ${i < step ? "bg-emerald-400" : "bg-ink-700"}`} />}
        </li>
      ))}
    </ol>
  );
}

// ── Step 3: beneficiaries ────────────────────────────────────────────────────────

function BeneficiariesStep({ draft, update, directory, ownerAddress }) {
  const rows = draft.beneficiaries;
  const validation = validateBeneficiaries(rows, ownerAddress);
  const total = sumPercent(rows);
  const remaining = remainingPercent(rows);
  const setRow = (rowKey, change) => update({ beneficiaries: rows.map((r) => (r.key === rowKey ? { ...r, ...change } : r)) });

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-400">
        Percentages divide your <span className="text-slate-200">ETH and tokens</span>. NFTs and documents are assigned to one person in the next step.
        The total may be at most 100%.
      </p>

      <ul className="space-y-3">
        {rows.map((row, i) => (
          <li key={row.key} className="rounded-xl border border-ink-700 bg-ink-850 p-3.5">
            <div className="grid items-start gap-3 sm:grid-cols-[1fr_7rem_auto]">
              <Field label={`Beneficiary ${i + 1}`}>
                {(id) => (
                  <PartyPicker
                    id={id}
                    value={row.address}
                    onChange={(address, name) => setRow(row.key, { address, name })}
                    directory={directory}
                    exclude={[ownerAddress, ...rows.filter((r) => r.key !== row.key).map((r) => r.address)]}
                  />
                )}
              </Field>
              <Field label="Share %">
                {(id) => (
                  <input
                    id={id}
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    inputMode="numeric"
                    className="input"
                    value={row.pct}
                    onChange={(e) => setRow(row.key, { pct: e.target.value })}
                  />
                )}
              </Field>
              <Button
                variant="ghost"
                size="sm"
                icon={Trash2}
                className="sm:mt-7"
                onClick={() => update({ beneficiaries: rows.filter((r) => r.key !== row.key) })}
                aria-label={`Remove beneficiary ${i + 1}`}
              >
                Remove
              </Button>
            </div>
            {(row.address || row.pct !== "") && validation.rows[i] && <p className="field-error">{validation.rows[i]}</p>}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <Button icon={Plus} onClick={() => update({ beneficiaries: [...rows, { key: key(), address: "", name: null, pct: remaining > 0 ? String(remaining) : "" }] })} disabled={rows.length >= 20}>
          Add beneficiary
        </Button>
        {rows.length > 1 && (
          <Button
            variant="ghost"
            onClick={() => {
              const even = Math.floor(100 / rows.length);
              update({ beneficiaries: rows.map((r, i) => ({ ...r, pct: String(i === 0 ? 100 - even * (rows.length - 1) : even) })) });
            }}
          >
            Split evenly
          </Button>
        )}
      </div>

      {/* live % sum validator */}
      <div className={`rounded-xl border px-4 py-3 ${total > 100 ? "border-rose-500/50 bg-rose-500/10" : total === 100 ? "border-emerald-500/40 bg-emerald-500/10" : "border-amber-500/40 bg-amber-500/10"}`} role="status">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-sm font-semibold text-white">Total allocated: {total}%</span>
          <span className={`text-sm ${total > 100 ? "text-rose-300" : total === 100 ? "text-emerald-300" : "text-amber-300"}`}>
            {total > 100 ? `${total - 100}% over the limit` : total === 100 ? "Fully allocated" : `Remaining unallocated: ${remaining}%`}
          </span>
        </div>
        <ProgressBar value={Math.min(total, 100) / 100} tone={total > 100 ? "rose" : total === 100 ? "emerald" : "amber"} />
        {total < 100 && total > 0 && (
          <p className="mt-2 text-xs text-amber-200/80">
            Allowed, but the unallocated {remaining}% of your ETH and tokens would stay locked in the contract after inheritance.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Step 4: assets ───────────────────────────────────────────────────────────────

function AssetsStep({ draft, update, wallet }) {
  const people = draft.beneficiaries.filter((b) => b.address);
  const total = sumPercent(draft.beneficiaries);
  const [nft, setNft] = useState({ name: "", kind: "PROPERTY", assignedTo: "" });
  const [docAssignee, setDocAssignee] = useState("");
  const [upload, setUpload] = useState({ busy: false, error: null });
  const fileInput = useRef(null);
  const symbol = wallet?.token.symbol ?? "CWT";

  const addNft = () => {
    update({ nfts: [...draft.nfts, { key: key(), ...nft, name: nft.name.trim() }] });
    setNft({ name: "", kind: nft.kind, assignedTo: "" });
  };

  const addDocument = async (file) => {
    if (!file) return;
    setUpload({ busy: true, error: null });
    try {
      // Encrypt + store now so the fingerprint can be shown; it goes on-chain at submit.
      const { document } = await api.upload("/documents", file);
      update({
        documents: [...draft.documents, { id: document.id, name: document.originalName, size: document.sizeBytes, sha256: document.sha256, assignedTo: docAssignee }],
      });
      setDocAssignee("");
      setUpload({ busy: false, error: null });
    } catch (error) {
      setUpload({ busy: false, error });
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const removeDocument = (doc) => {
    update({ documents: draft.documents.filter((d) => d.id !== doc.id) });
    api.del(`/documents/${doc.id}`).catch(() => {}); // never registered on-chain → safe to drop
  };

  const ethError = draft.ethAmount !== "" && !isPositiveAmount(draft.ethAmount) ? "Enter a positive number" : wallet && isPositiveAmount(draft.ethAmount) && toBaseUnits(draft.ethAmount) >= BigInt(wallet.eth) ? "More than this wallet holds (leave some for gas)" : null;
  const tokenError = draft.tokenAmount !== "" && !isPositiveAmount(draft.tokenAmount) ? "Enter a positive number" : null;

  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-1 flex items-center gap-2 font-semibold text-white">
          <Gem className="h-4 w-4 text-emerald-400" /> Fungible assets <span className="text-xs font-normal text-slate-500">— split by percentage</span>
        </h3>
        <p className="mb-4 text-sm text-slate-400">Escrowed in the contract and divided between your beneficiaries by their share.</p>
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-3">
            <Field label="Deposit ETH" hint={`Wallet balance: ${wallet?.ethFormatted ?? "…"} ETH. Leave empty to skip.`} error={ethError}>
              {(id) => <input id={id} className="input" inputMode="decimal" placeholder="e.g. 10" value={draft.ethAmount} onChange={(e) => update({ ethAmount: e.target.value.trim() })} />}
            </Field>
            <SplitPreview amount={draft.ethAmount} unit="ETH" beneficiaries={people} totalPercentage={total} />
          </div>
          <div className="space-y-3">
            <Field label={`Mint & deposit demo tokens (${symbol})`} hint="Freshly minted from the demo faucet, then escrowed. Leave empty to skip." error={tokenError}>
              {(id) => <input id={id} className="input" inputMode="decimal" placeholder="e.g. 1000" value={draft.tokenAmount} onChange={(e) => update({ tokenAmount: e.target.value.trim() })} />}
            </Field>
            <SplitPreview amount={draft.tokenAmount} unit={symbol} beneficiaries={people} totalPercentage={total} />
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-1 flex items-center gap-2 font-semibold text-white">
          <ImageIcon className="h-4 w-4 text-emerald-400" /> Whole items <span className="text-xs font-normal text-slate-500">— one heir each</span>
        </h3>
        <p className="mb-4 text-sm text-slate-400">
          You cannot give someone 60% of a property deed. Each NFT and document goes, whole, to the one beneficiary you pick.
        </p>

        {people.length === 0 ? (
          <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">Add a beneficiary in the previous step to assign NFTs or documents.</p>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {/* NFT */}
            <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
              <p className="mb-3 text-sm font-semibold text-slate-200">Mint a demo NFT</p>
              <div className="space-y-3">
                <Field label="Name">
                  {(id) => <input id={id} className="input" maxLength={64} placeholder="Property Deed" value={nft.name} onChange={(e) => setNft({ ...nft, name: e.target.value })} />}
                </Field>
                <Field label="Kind">
                  {(id) => (
                    <select id={id} className="input" value={nft.kind} onChange={(e) => setNft({ ...nft, kind: e.target.value })}>
                      {NFT_KINDS.map((k) => (
                        <option key={k.value} value={k.value}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="Inherited by">{(id) => <BeneficiarySelect id={id} beneficiaries={people} value={nft.assignedTo} onChange={(assignedTo) => setNft({ ...nft, assignedTo })} />}</Field>
                <Button icon={Plus} onClick={addNft} disabled={!nft.name.trim() || !nft.assignedTo}>
                  Add NFT
                </Button>
              </div>
            </div>

            {/* Document */}
            <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
              <p className="mb-3 text-sm font-semibold text-slate-200">Upload a document</p>
              <div className="space-y-3">
                <Field label="Inherited by">{(id) => <BeneficiarySelect id={id} beneficiaries={people} value={docAssignee} onChange={setDocAssignee} />}</Field>
                <Field hint="PDF, PNG, JPG, TXT, DOC or DOCX, up to 10 MB. Encrypted with AES-256 on the server; only the SHA-256 fingerprint is written on-chain.">
                  {(id) => (
                    <label
                      htmlFor={id}
                      className={`flex items-center gap-3 rounded-xl border border-dashed px-4 py-4 ${docAssignee ? "cursor-pointer border-ink-500 hover:border-emerald-400" : "cursor-not-allowed border-ink-700 opacity-60"}`}
                    >
                      <Upload className="h-5 w-5 text-slate-400" />
                      <span className="text-sm text-slate-300">{upload.busy ? "Encrypting & uploading…" : docAssignee ? "Choose a file…" : "Pick the heir first"}</span>
                      <input
                        id={id}
                        ref={fileInput}
                        type="file"
                        className="sr-only"
                        accept=".pdf,.png,.jpg,.jpeg,.txt,.doc,.docx"
                        disabled={!docAssignee || upload.busy}
                        onChange={(e) => addDocument(e.target.files[0])}
                      />
                    </label>
                  )}
                </Field>
                <ErrorNote error={upload.error} />
              </div>
            </div>
          </div>
        )}

        {(draft.nfts.length > 0 || draft.documents.length > 0) && (
          <ul className="mt-4 divide-y divide-ink-800 rounded-xl border border-ink-700">
            {draft.nfts.map((item) => (
              <li key={item.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <ImageIcon className="h-5 w-5 text-slate-400" />
                <span className="flex-1 text-sm text-slate-200">
                  {item.name} <span className="text-slate-500">· NFT · {item.kind.toLowerCase()}</span>
                </span>
                <span className="w-56">
                  <BeneficiarySelect beneficiaries={people} value={item.assignedTo} onChange={(assignedTo) => update({ nfts: draft.nfts.map((n) => (n.key === item.key ? { ...n, assignedTo } : n)) })} />
                </span>
                <Button variant="ghost" size="sm" icon={Trash2} onClick={() => update({ nfts: draft.nfts.filter((n) => n.key !== item.key) })} aria-label={`Remove ${item.name}`} />
              </li>
            ))}
            {draft.documents.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <FileText className="h-5 w-5 text-slate-400" />
                <span className="min-w-0 flex-1 text-sm text-slate-200">
                  <span className="block truncate">
                    {doc.name} <span className="text-slate-500">· {formatBytes(doc.size)}</span>
                  </span>
                  <span className="mono block truncate text-xs text-slate-500">sha256 {doc.sha256}</span>
                </span>
                <span className="w-56">
                  <BeneficiarySelect beneficiaries={people} value={doc.assignedTo} onChange={(assignedTo) => update({ documents: draft.documents.map((d) => (d.id === doc.id ? { ...d, assignedTo } : d)) })} />
                </span>
                <Button variant="ghost" size="sm" icon={Trash2} onClick={() => removeDocument(doc)} aria-label={`Remove ${doc.name}`} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── Step 5: review ───────────────────────────────────────────────────────────────

function Review({ draft, steps, user }) {
  const nameOf = (address) => draft.beneficiaries.find((b) => sameAddress(b.address, address))?.name || shortAddress(address);
  const row = (label, value) => (
    <div className="flex flex-wrap justify-between gap-2 border-b border-ink-800 py-2.5 last:border-b-0">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="text-right text-sm text-slate-200">{value}</dd>
    </div>
  );
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <dl>
        {row("Title", draft.title || "—")}
        {row("Check-in", `every ${humanDuration(draft.interval)}, ${humanDuration(draft.grace)} grace`)}
        {row("Executor", draft.executorName ? `${draft.executorName} (${shortAddress(draft.executor)})` : shortAddress(draft.executor))}
        {row(
          "Beneficiaries",
          <ul>
            {draft.beneficiaries.map((b) => (
              <li key={b.key}>
                {b.name || shortAddress(b.address)} — <span className="font-semibold">{b.pct}%</span>
              </li>
            ))}
          </ul>
        )}
        {row("ETH to escrow", isPositiveAmount(draft.ethAmount) ? `${draft.ethAmount} ETH` : "none")}
        {row("Demo tokens", isPositiveAmount(draft.tokenAmount) ? `${draft.tokenAmount} CWT` : "none")}
        {row(
          "Whole items",
          draft.nfts.length + draft.documents.length === 0 ? (
            "none"
          ) : (
            <ul>
              {draft.nfts.map((n) => (
                <li key={n.key}>
                  NFT “{n.name}” → {nameOf(n.assignedTo)}
                </li>
              ))}
              {draft.documents.map((d) => (
                <li key={d.id}>
                  {d.name} → {nameOf(d.assignedTo)}
                </li>
              ))}
            </ul>
          )
        )}
      </dl>
      <div>
        <p className="mb-2 text-sm text-slate-400">
          Submitting sends <span className="font-semibold text-slate-200">{steps.length} transactions</span>, in this order
          {user.walletMode === "metamask" ? " — MetaMask will ask you to confirm each one." : ", signed by your demo wallet."}
        </p>
        <ol className="max-h-80 space-y-1 overflow-y-auto text-sm text-slate-300">
          {steps.map((s, i) => (
            <li key={s.id} className="flex gap-2">
              <span className="w-5 shrink-0 text-right text-slate-600">{i + 1}.</span> {s.label}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// ── Wizard ───────────────────────────────────────────────────────────────────────

export default function WillWizard() {
  const { user, wallet } = useAuth();
  const navigate = useNavigate();
  const directory = useDirectory();
  const plan = usePlan();
  const [existing, setExisting] = useState(undefined); // undefined = loading
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(emptyDraft);
  const update = (change) => setDraft((d) => ({ ...d, ...change }));

  useEffect(() => {
    api
      .get("/wills/mine")
      .then(({ will }) => setExisting(will && will.phase !== "REVOKED" ? will : null))
      .catch(() => setExisting(null));
  }, []);

  const beneficiaryCheck = validateBeneficiaries(draft.beneficiaries, user.walletAddress);
  const validAddresses = new Set(draft.beneficiaries.map((b) => b.address.toLowerCase()));
  const wholeItems = [...draft.nfts, ...draft.documents];
  const unassigned = wholeItems.filter((item) => !validAddresses.has(String(item.assignedTo).toLowerCase())).length;

  // Why the current step cannot be left yet (null = fine).
  const blocker = useMemo(() => {
    const schedule = scheduleErrors(draft);
    if (step === 0) return schedule.interval || schedule.grace;
    if (step === 1) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(draft.executor)) return "Choose who will be your executor";
      if (sameAddress(draft.executor, user.walletAddress)) return "You cannot be your own executor";
      return null;
    }
    if (step === 2) return beneficiaryCheck.total || beneficiaryCheck.rows.find(Boolean) || null;
    if (step === 3) {
      if (draft.ethAmount !== "" && !isPositiveAmount(draft.ethAmount)) return "The ETH amount is not valid";
      if (wallet && isPositiveAmount(draft.ethAmount) && toBaseUnits(draft.ethAmount) >= BigInt(wallet.eth)) return "The ETH amount is more than your wallet holds";
      if (draft.tokenAmount !== "" && !isPositiveAmount(draft.tokenAmount)) return "The token amount is not valid";
      if (unassigned > 0) return `${unassigned} item${unassigned === 1 ? " has" : "s have"} no valid heir — pick one for each`;
      return null;
    }
    return null;
  }, [step, draft, user.walletAddress, wallet, beneficiaryCheck, unassigned]);

  const steps = useMemo(() => {
    const nameOf = (address) => draft.beneficiaries.find((b) => sameAddress(b.address, address))?.name;
    return buildWillPlan({
      ...draft,
      nfts: draft.nfts.map((n) => ({ ...n, assignedName: nameOf(n.assignedTo) })),
      documents: draft.documents.map((d) => ({ ...d, assignedName: nameOf(d.assignedTo) })),
    });
  }, [draft]);

  const submit = async () => {
    const results = await plan.run(plan.steps.length ? undefined : steps);
    // always written, so a re-created will does not inherit the old one's label
    if (results) await api.put("/wills/mine/meta", { title: draft.title, note: draft.note }).catch(() => {});
  };

  if (existing === undefined) return <Loading />;
  if (existing && plan.status === "idle") {
    return (
      <>
        <PageHeader title="Create will" />
        <Card>
          <p className="text-slate-300">You already have a will on-chain. One wallet holds one will — manage it from your dashboard, or revoke it to start over.</p>
          <Link to="/app" className="btn btn-primary mt-4">
            Go to my will
          </Link>
        </Card>
      </>
    );
  }

  const submitting = plan.status !== "idle";

  return (
    <>
      <PageHeader title="Create your will" subtitle="Five short steps. Nothing touches the blockchain until you submit at the end." />
      <Stepper step={plan.status === "done" ? STEPS.length : step} />

      <Card>
        {plan.status === "done" ? (
          <div className="flex flex-col items-center py-6 text-center">
            <PartyPopper className="mb-3 h-10 w-10 text-emerald-400" />
            <h2 className="text-xl font-bold text-white">Your will is live on-chain</h2>
            <p className="mt-1 max-w-md text-sm text-slate-400">
              All {plan.steps.length} transactions were confirmed. Your check-in timer has started — your executor and beneficiaries have been notified.
            </p>
            <Button variant="primary" size="lg" className="mt-6" onClick={() => navigate("/app")}>
              Open my dashboard
            </Button>
            <div className="mt-8 w-full max-w-xl text-left">
              <PlanProgress steps={plan.steps} />
            </div>
          </div>
        ) : submitting ? (
          <div>
            <h2 className="mb-4 text-lg font-semibold text-white">{plan.running ? "Writing your will to the blockchain…" : "Submission paused"}</h2>
            <PlanProgress steps={plan.steps} error={plan.error} metamask={user.walletMode === "metamask"} />
            {plan.status === "failed" && (
              <div className="mt-5 flex flex-wrap gap-2">
                <Button variant="primary" onClick={submit}>
                  Retry from failed step
                </Button>
                <Link to="/app" className="btn btn-secondary">
                  Finish later from my dashboard
                </Link>
              </div>
            )}
          </div>
        ) : (
          <>
            <h2 className="mb-5 text-lg font-semibold text-white">
              {step + 1}. {STEPS[step]}
            </h2>

            {step === 0 && (
              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Will title (optional)" hint="A label for your own reference. Stored off-chain.">
                    {(id) => <input id={id} className="input" maxLength={80} placeholder="Alice's Last Will" value={draft.title} onChange={(e) => update({ title: e.target.value })} />}
                  </Field>
                  <Field label="Private note (optional)" hint="Only you can read this.">
                    {(id) => <input id={id} className="input" maxLength={500} placeholder="e.g. lawyer's contact" value={draft.note} onChange={(e) => update({ note: e.target.value })} />}
                  </Field>
                </div>
                <ScheduleFields value={{ interval: draft.interval, grace: draft.grace }} onChange={update} />
              </div>
            )}

            {step === 1 && (
              <div className="max-w-xl space-y-5">
                <p className="text-sm text-slate-400">
                  The executor is the person you trust to <span className="text-slate-200">activate inheritance</span> if you stop checking in. They
                  cannot touch your assets, cannot act early, and cannot be you.
                </p>
                <Field label="Executor">
                  {(id) => (
                    <PartyPicker
                      id={id}
                      value={draft.executor}
                      onChange={(executor, executorName) => update({ executor, executorName })}
                      directory={directory}
                      exclude={[user.walletAddress]}
                      placeholder="Choose your executor…"
                    />
                  )}
                </Field>
                {/^0x[0-9a-fA-F]{40}$/.test(draft.executor) && (
                  <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
                    <AddressBadge address={draft.executor} name={draft.executorName || "Executor"} />
                  </div>
                )}
              </div>
            )}

            {step === 2 && <BeneficiariesStep draft={draft} update={update} directory={directory} ownerAddress={user.walletAddress} />}
            {step === 3 && <AssetsStep draft={draft} update={update} wallet={wallet} />}
            {step === 4 && <Review draft={draft} steps={steps} user={user} />}

            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-ink-800 pt-5">
              <Button variant="ghost" icon={ArrowLeft} onClick={() => (step === 0 ? navigate("/app") : setStep(step - 1))}>
                {step === 0 ? "Cancel" : "Back"}
              </Button>
              <div className="flex items-center gap-4">
                {blocker && <p className="max-w-xs text-right text-xs text-amber-300/90">{blocker}</p>}
                {step < STEPS.length - 1 ? (
                  <Button variant="primary" onClick={() => setStep(step + 1)} disabled={Boolean(blocker)}>
                    Next <ArrowRight className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button variant="primary" icon={Coins} onClick={submit}>
                    Sign & submit {steps.length} transactions
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
