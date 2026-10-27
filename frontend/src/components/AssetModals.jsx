import { useEffect, useMemo, useState } from "react";
import { Coins, FileText, Gem, Image as ImageIcon, Upload } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { api } from "../lib/api.js";
import { formatBytes, partyLabel } from "../lib/format.js";
import { fromBaseUnits, isPositiveAmount, splitPreview, toBaseUnits } from "../lib/willMath.js";
import { usePlan } from "../hooks/usePlan.js";
import { useTx } from "../hooks/useTx.js";
import { PlanProgress } from "./PlanProgress.jsx";
import { PartyPicker } from "./PartyPicker.jsx";
import { Button, ErrorNote, Field, Modal } from "./ui.jsx";

export const NFT_KINDS = [
  { value: "PROPERTY", label: "Property deed" },
  { value: "VEHICLE", label: "Vehicle title" },
  { value: "JEWELLERY", label: "Jewellery" },
  { value: "OTHER", label: "Other" },
];

/** "Who inherits this whole item?" */
export function BeneficiarySelect({ id, beneficiaries, value, onChange }) {
  return (
    <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>
        Who inherits this whole item?
      </option>
      {beneficiaries.map((b) => (
        <option key={b.address} value={b.address}>
          {partyLabel(b)}
          {b.percentage !== undefined || b.pct !== undefined ? ` (${b.percentage ?? b.pct}% of ETH/tokens)` : ""}
        </option>
      ))}
    </select>
  );
}

export function SplitPreview({ amount, unit, beneficiaries, totalPercentage }) {
  const rows = splitPreview(
    amount,
    beneficiaries.map((b) => ({ address: b.address, name: b.name, pct: b.percentage ?? b.pct }))
  );
  if (rows.length === 0) return null;
  const unallocated = 100 - totalPercentage;
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-850 px-4 py-3 text-sm">
      <p className="mb-1.5 text-xs uppercase tracking-wider text-slate-500">Split by percentage</p>
      <ul className="space-y-0.5 text-slate-300">
        {rows.map((row) => (
          <li key={row.address} className="flex justify-between">
            <span>
              {row.name || `${row.address.slice(0, 8)}…`} · {row.pct}%
            </span>
            <span className="font-semibold">
              {row.amount} {unit}
            </span>
          </li>
        ))}
      </ul>
      <p className={`mt-1.5 text-xs ${unallocated > 0 ? "text-amber-300" : "text-slate-500"}`}>Remaining unallocated: {unallocated}%</p>
    </div>
  );
}

const TABS = [
  { key: "ETH", label: "ETH", icon: Gem },
  { key: "ERC20", label: "Demo tokens", icon: Coins },
  { key: "ERC721", label: "NFT", icon: ImageIcon },
  { key: "DOCUMENT", label: "Document", icon: FileText },
];

/** Add any of the four asset types to an existing will. */
export function AddAssetModal({ will, open, onClose, onDone, initialTab = "ETH" }) {
  const { user, wallet } = useAuth();
  const toast = useToast();
  const plan = usePlan();
  const [tab, setTab] = useState(initialTab);
  const [amount, setAmount] = useState("");
  const [nftChoice, setNftChoice] = useState("new");
  const [nftName, setNftName] = useState("");
  const [nftKind, setNftKind] = useState("PROPERTY");
  const [assignee, setAssignee] = useState("");
  const [docChoice, setDocChoice] = useState("new");
  const [file, setFile] = useState(null);
  const [pendingDocs, setPendingDocs] = useState([]);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setAmount("");
    setNftChoice("new");
    setNftName("");
    setAssignee("");
    setDocChoice("new");
    setFile(null);
    setError(null);
    plan.reset();
    api
      .get("/documents")
      .then(({ owned }) => setPendingDocs(owned.filter((d) => !d.onChain.registered)))
      .catch(() => setPendingDocs([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTab]);

  const tokenBalance = BigInt(wallet?.token.balance ?? 0);
  const symbol = wallet?.token.symbol ?? "CWT";
  const ownedNfts = wallet?.nfts ?? [];
  const noBeneficiaries = will.beneficiaries.length === 0;
  const whole = tab === "ERC721" || tab === "DOCUMENT";

  const problem = useMemo(() => {
    if (tab === "ETH" || tab === "ERC20") {
      if (!isPositiveAmount(amount)) return "Enter an amount greater than 0";
      if (tab === "ETH" && wallet && toBaseUnits(amount) >= BigInt(wallet.eth)) return "That is more ETH than this wallet holds (leave some for gas)";
      return null;
    }
    if (noBeneficiaries) return "Add a beneficiary first — whole items must be assigned to one";
    if (!assignee) return "Choose who inherits this item";
    if (tab === "ERC721" && nftChoice === "new" && nftName.trim().length < 1) return "Give the NFT a name";
    if (tab === "DOCUMENT" && docChoice === "new" && !file) return "Choose a file to upload";
    return null;
  }, [tab, amount, wallet, noBeneficiaries, assignee, nftChoice, nftName, docChoice, file]);

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    const steps = [];
    try {
      if (tab === "ETH") {
        steps.push({ id: "eth", action: "depositEth", label: `Deposit ${amount} ETH into escrow`, params: { amount } });
      } else if (tab === "ERC20") {
        const missing = toBaseUnits(amount) - tokenBalance;
        if (missing > 0n) {
          const mint = fromBaseUnits(missing);
          steps.push({ id: "mint", action: "mintToken", label: `Mint ${mint} ${symbol} (demo faucet)`, params: { amount: mint } });
        }
        steps.push({ id: "approve", action: "approveToken", label: `Approve the will contract for ${amount} ${symbol}`, params: { amount } });
        steps.push({ id: "deposit", action: "depositToken", label: `Deposit ${amount} ${symbol} into escrow`, params: { amount } });
      } else if (tab === "ERC721") {
        const tokenId = (results) => (nftChoice === "new" ? results.mint.events.find((e) => e.name === "DeedMinted").args.tokenId : nftChoice);
        const name = nftChoice === "new" ? nftName.trim() : ownedNfts.find((n) => n.tokenId === nftChoice)?.name;
        if (nftChoice === "new") steps.push({ id: "mint", action: "mintNft", label: `Mint NFT "${name}"`, params: { name, kind: nftKind } });
        steps.push({ id: "approve", action: "approveNft", label: `Approve the will contract for "${name}"`, params: (r) => ({ tokenId: tokenId(r) }) });
        steps.push({ id: "register", action: "registerNft", label: `Escrow "${name}" in the will`, params: (r) => ({ tokenId: tokenId(r), assignedTo: assignee }) });
      } else {
        let documentId = docChoice;
        let name = pendingDocs.find((d) => String(d.id) === String(docChoice))?.originalName;
        if (docChoice === "new") {
          setUploading(true);
          const { document } = await api.upload("/documents", file);
          documentId = document.id;
          name = document.originalName;
          setPendingDocs((docs) => [document, ...docs]);
          setDocChoice(String(document.id));
        }
        steps.push({
          id: "register",
          action: "registerDocument",
          label: `Record the fingerprint of "${name}" on-chain`,
          params: { documentId: Number(documentId), assignedTo: assignee },
        });
      }
    } catch (err) {
      setError(err);
      return;
    } finally {
      setUploading(false);
    }

    const results = await plan.run(steps);
    if (results) {
      toast.success("Asset added to your will");
      onDone?.();
      onClose();
    }
  };

  const working = plan.running || uploading;

  return (
    <Modal open={open} onClose={working ? () => {} : onClose} title="Add an asset to your will" wide>
      <div className="mb-5 grid grid-cols-4 gap-1 rounded-xl border border-ink-700 bg-ink-850 p-1" role="tablist">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            disabled={working}
            onClick={() => {
              setTab(key);
              plan.reset();
              setError(null);
            }}
            className={`flex flex-col items-center gap-1 rounded-lg py-2 text-xs font-semibold transition sm:flex-row sm:justify-center sm:gap-2 sm:text-sm ${
              tab === key ? "bg-ink-700 text-white" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-4">
        {(tab === "ETH" || tab === "ERC20") && (
          <>
            <Field
              label={tab === "ETH" ? "Amount of ETH to escrow" : `Amount of ${symbol} to escrow`}
              hint={
                tab === "ETH"
                  ? `Wallet balance: ${wallet?.ethFormatted ?? "…"} ETH. The ETH moves into the contract now and is returned if you revoke.`
                  : `Wallet balance: ${wallet?.token.balanceFormatted ?? "…"} ${symbol}. Anything you are short of is minted from the demo faucet first.`
              }
            >
              {(id) => <input id={id} className="input" inputMode="decimal" placeholder="e.g. 10" value={amount} onChange={(e) => setAmount(e.target.value.trim())} disabled={working} autoFocus />}
            </Field>
            <SplitPreview amount={amount} unit={tab === "ETH" ? "ETH" : symbol} beneficiaries={will.beneficiaries} totalPercentage={will.totalPercentage} />
          </>
        )}

        {tab === "ERC721" && (
          <>
            <Field label="NFT">
              {(id) => (
                <select id={id} className="input" value={nftChoice} onChange={(e) => setNftChoice(e.target.value)} disabled={working}>
                  <option value="new">Mint a new demo NFT…</option>
                  {ownedNfts.map((n) => (
                    <option key={n.tokenId} value={n.tokenId}>
                      {n.name} (#{n.tokenId}) — already in your wallet
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {nftChoice === "new" && (
              <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
                <Field label="Name">
                  {(id) => <input id={id} className="input" maxLength={64} placeholder="Property Deed — 12 Park Street" value={nftName} onChange={(e) => setNftName(e.target.value)} disabled={working} />}
                </Field>
                <Field label="Kind">
                  {(id) => (
                    <select id={id} className="input" value={nftKind} onChange={(e) => setNftKind(e.target.value)} disabled={working}>
                      {NFT_KINDS.map((k) => (
                        <option key={k.value} value={k.value}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              </div>
            )}
          </>
        )}

        {tab === "DOCUMENT" && (
          <>
            <Field label="Document">
              {(id) => (
                <select id={id} className="input" value={docChoice} onChange={(e) => setDocChoice(e.target.value)} disabled={working}>
                  <option value="new">Upload a new file…</option>
                  {pendingDocs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.originalName} ({formatBytes(d.sizeBytes)}) — already in your vault
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {docChoice === "new" && (
              <Field hint="PDF, PNG, JPG, TXT, DOC or DOCX, up to 10 MB. The file is AES-256 encrypted on the server; only its SHA-256 fingerprint goes on-chain.">
                {(id) => (
                  <label htmlFor={id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-ink-500 bg-ink-850 px-4 py-4 hover:border-emerald-400">
                    <Upload className="h-5 w-5 text-slate-400" />
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-300">{file ? `${file.name} (${formatBytes(file.size)})` : "Choose a file…"}</span>
                    <input id={id} type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg,.txt,.doc,.docx" onChange={(e) => setFile(e.target.files[0] || null)} disabled={working} />
                  </label>
                )}
              </Field>
            )}
          </>
        )}

        {whole && (
          <Field label="Inherited by" hint="NFTs and documents are not split by percentage — exactly one beneficiary receives the whole item.">
            {(id) => <BeneficiarySelect id={id} beneficiaries={will.beneficiaries} value={assignee} onChange={setAssignee} />}
          </Field>
        )}

        <ErrorNote error={error} />
        <PlanProgress steps={plan.steps} error={plan.error} metamask={user.walletMode === "metamask"} />

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-amber-300/90">{plan.steps.length === 0 && problem}</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={working}>
              Cancel
            </Button>
            {plan.status === "failed" ? (
              <Button variant="primary" onClick={() => plan.run()}>
                Retry from failed step
              </Button>
            ) : (
              <Button type="submit" variant="primary" loading={working} disabled={Boolean(problem)}>
                {uploading ? "Encrypting & uploading…" : "Add to will"}
              </Button>
            )}
          </div>
        </div>
      </form>
    </Modal>
  );
}

export function AddBeneficiaryModal({ will, open, onClose, onDone, directory }) {
  const { user } = useAuth();
  const { run, busy } = useTx();
  const [address, setAddress] = useState("");
  const [pct, setPct] = useState("");
  const remaining = 100 - will.totalPercentage;

  useEffect(() => {
    if (open) {
      setAddress("");
      setPct("");
    }
  }, [open]);

  const value = Number(pct);
  const problem = !/^0x[0-9a-fA-F]{40}$/.test(address)
    ? "Choose a beneficiary"
    : !Number.isInteger(value) || value < 1
      ? "Enter a whole percentage"
      : value > remaining
        ? `Only ${remaining}% is still unallocated`
        : null;

  const submit = async (event) => {
    event.preventDefault();
    const receipt = await run("addBeneficiary", { wallet: address, pct: value }, { success: `Beneficiary added with ${value}%` });
    if (receipt) {
      onDone?.();
      onClose();
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add a beneficiary">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Beneficiary">
          {(id) => (
            <PartyPicker
              id={id}
              value={address}
              onChange={(a) => setAddress(a)}
              directory={directory}
              exclude={[user.walletAddress, ...will.beneficiaries.map((b) => b.address)]}
            />
          )}
        </Field>
        <Field label="Share of ETH and tokens (%)" hint={`Unallocated: ${remaining}%`}>
          {(id) => <input id={id} type="number" min="1" max={remaining} step="1" className="input" value={pct} onChange={(e) => setPct(e.target.value)} />}
        </Field>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-amber-300/90">{(address || pct) && problem}</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={Boolean(problem)}>
              Add beneficiary
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export function ReassignModal({ will, asset, onClose, onDone }) {
  const { run, busy } = useTx();
  const [assignee, setAssignee] = useState("");
  useEffect(() => setAssignee(""), [asset]);
  if (!asset) return null;
  const others = will.beneficiaries.filter((b) => b.address !== asset.assignedTo?.address);

  const submit = async (event) => {
    event.preventDefault();
    const receipt = await run("reassignAsset", { assetIndex: asset.index, assignedTo: assignee }, { success: "Asset reassigned" });
    if (receipt) {
      onDone?.();
      onClose();
    }
  };

  return (
    <Modal open onClose={onClose} title={`Reassign “${asset.label}”`}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-400">
          Currently inherited by <span className="font-semibold text-slate-200">{partyLabel(asset.assignedTo)}</span>.
        </p>
        {others.length === 0 ? (
          <p className="text-sm text-amber-300">There is no other beneficiary to give it to. Add one first.</p>
        ) : (
          <Field label="New heir">{(id) => <BeneficiarySelect id={id} beneficiaries={others} value={assignee} onChange={setAssignee} />}</Field>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!assignee}>
            Reassign
          </Button>
        </div>
      </form>
    </Modal>
  );
}
