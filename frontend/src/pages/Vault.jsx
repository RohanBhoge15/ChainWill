import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Download, FileCheck2, FileText, FileWarning, FolderLock, Lock, ShieldCheck, Trash2, Unlock, Upload } from "lucide-react";
import { useToast } from "../context/ToastContext.jsx";
import { api } from "../lib/api.js";
import { formatBytes, partyLabel, timeAgo } from "../lib/format.js";
import { usePolling } from "../hooks/usePolling.js";
import { useTx } from "../hooks/useTx.js";
import { BeneficiarySelect } from "../components/AssetModals.jsx";
import { Button, Card, ConfirmButton, CopyButton, Empty, ErrorNote, Field, Loading, Modal, PageHeader, Tag } from "../components/ui.jsx";

/** Green check / red "MODIFIED" panel with the expected vs. actual fingerprints. */
function Verdict({ verdict }) {
  const row = (label, expected, actual, match) => (
    <div className="rounded-lg border border-ink-700 bg-ink-900 p-3">
      <p className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400">
        {label}
        <span className={match ? "text-emerald-400" : "text-rose-400"}>{match ? "match" : "MISMATCH"}</span>
      </p>
      <p className="mono break-all text-xs text-slate-400">
        <span className="text-slate-600">expected </span>
        {expected}
      </p>
      <p className={`mono break-all text-xs ${match ? "text-slate-400" : "text-rose-300"}`}>
        <span className="text-slate-600">actual&nbsp;&nbsp; </span>
        {actual ?? "— could not be computed (file will not decrypt)"}
      </p>
    </div>
  );
  return (
    <div role="alert" className={`mt-3 rounded-xl border p-4 ${verdict.ok ? "border-emerald-500/40 bg-emerald-500/10" : "border-rose-500/60 bg-rose-500/10"}`}>
      <p className={`flex items-center gap-2 font-semibold ${verdict.ok ? "text-emerald-300" : "text-rose-300"}`}>
        {verdict.ok ? <FileCheck2 className="h-5 w-5" /> : <FileWarning className="h-5 w-5" />}
        {verdict.ok ? "Integrity verified — the file is exactly what was recorded" : "MODIFIED! " + verdict.problem}
      </p>
      <p className="mt-1 text-xs text-slate-400">
        Fingerprints re-computed from the stored file just now and compared with the <span className="text-slate-200">{verdict.expected.source}</span>.
      </p>
      <div className="mt-3 space-y-2">
        {row("Content ID of the encrypted file", verdict.expected.cid, verdict.actual.cid, verdict.checks.cid)}
        {row("SHA-256 of the decrypted document", verdict.expected.sha256, verdict.actual.sha256, verdict.checks.sha256)}
      </div>
    </div>
  );
}

function DocumentRow({ doc, will, onChanged }) {
  const toast = useToast();
  const { run, busy } = useTx();
  const [verdict, setVerdict] = useState(null);
  const [working, setWorking] = useState(null);
  const [registering, setRegistering] = useState(false);
  const [assignee, setAssignee] = useState("");
  const canRegister = doc.role === "owner" && !doc.onChain.registered && will && !will.activated && will.phase !== "REVOKED";

  const verify = async () => {
    setWorking("verify");
    try {
      setVerdict(await api.post(`/documents/${doc.id}/verify`));
    } catch (err) {
      toast.error("Could not verify", { detail: err.message });
    } finally {
      setWorking(null);
    }
  };

  const download = async () => {
    setWorking("download");
    try {
      await api.download(`/documents/${doc.id}/download`);
    } catch (err) {
      toast.error("Download refused", { detail: err.message });
      if (err.data?.verdict) setVerdict(err.data.verdict);
    } finally {
      setWorking(null);
    }
  };

  const remove = async () => {
    try {
      await api.del(`/documents/${doc.id}`);
      toast.success("Document deleted");
      onChanged();
    } catch (err) {
      toast.error("Cannot delete", { detail: err.message });
    }
  };

  const register = async (event) => {
    event.preventDefault();
    const receipt = await run("registerDocument", { documentId: doc.id, assignedTo: assignee }, { success: "Fingerprint recorded on-chain" });
    if (receipt) {
      setRegistering(false);
      onChanged();
    }
  };

  const claim = async () => {
    const receipt = await run("claimAsset", { owner: doc.owner.address, assetIndex: doc.onChain.assetIndex }, { success: "Document unlocked" });
    if (receipt) onChanged();
  };

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <span className="rounded-xl border border-ink-700 bg-ink-850 p-2.5">
          <FileText className="h-5 w-5 text-slate-300" />
        </span>
        <div className="min-w-0 flex-1 basis-64">
          <p className="truncate font-semibold text-slate-100">{doc.originalName}</p>
          <p className="text-xs text-slate-500">
            {formatBytes(doc.sizeBytes)} · uploaded {timeAgo(doc.uploadedAt)}
            {doc.role === "beneficiary" && ` · from ${partyLabel(doc.owner)}`}
          </p>
          <p className="mono mt-1 flex items-center gap-1 text-xs text-slate-500">
            <span className="truncate">sha256 {doc.sha256}</span>
            <CopyButton value={doc.sha256} label="Copy SHA-256" />
          </p>
          <p className="mono flex items-center gap-1 text-xs text-slate-600">
            <span className="truncate">cid {doc.cid}</span>
            <CopyButton value={doc.cid} label="Copy CID" />
          </p>
        </div>

        <div className="flex flex-col items-start gap-1.5 text-sm sm:items-end">
          {doc.onChain.registered ? (
            <>
              <Tag tone={doc.onChain.removed ? "slate" : "sky"}>{doc.onChain.removed ? "Withdrawn from will" : `On-chain · asset #${doc.onChain.assetIndex}`}</Tag>
              <span className="text-xs text-slate-400">
                Assigned to <span className="font-medium text-slate-200">{partyLabel(doc.onChain.assignedTo)}</span>
              </span>
              {doc.onChain.isClaimed ? (
                <Tag tone="emerald">
                  <Unlock className="h-3 w-3" /> Claimed by heir
                </Tag>
              ) : (
                <Tag tone="slate">
                  <Lock className="h-3 w-3" /> Locked for heir
                </Tag>
              )}
            </>
          ) : (
            <Tag tone="amber">Not on-chain yet</Tag>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 pl-0 sm:pl-14">
        <Button size="sm" icon={ShieldCheck} loading={working === "verify"} onClick={verify}>
          Verify integrity
        </Button>
        <Button size="sm" icon={Download} loading={working === "download"} disabled={!doc.canDownload} onClick={download} title={doc.accessReason}>
          Download
        </Button>
        {doc.role === "beneficiary" && !doc.onChain.isClaimed && (
          <Button size="sm" variant="primary" loading={busy} disabled={!doc.onChain.willActivated} onClick={claim}>
            Claim this document
          </Button>
        )}
        {canRegister && (
          <Button size="sm" variant="primary" onClick={() => setRegistering(true)}>
            Register on-chain
          </Button>
        )}
        {doc.role === "owner" && (!doc.onChain.registered || doc.onChain.removed) && (
          <ConfirmButton size="sm" variant="ghost" icon={Trash2} confirmLabel="Delete file" onConfirm={remove}>
            Delete
          </ConfirmButton>
        )}
        {!doc.canDownload && <span className="text-xs text-slate-500">{doc.accessReason}</span>}
      </div>

      {verdict && (
        <div className="sm:pl-14">
          <Verdict verdict={verdict} />
        </div>
      )}

      <Modal open={registering} onClose={() => setRegistering(false)} title={`Register “${doc.originalName}”`}>
        <form onSubmit={register} className="space-y-4">
          <p className="text-sm text-slate-400">Writes this file's SHA-256 and content ID into your will, assigned to one beneficiary. The file itself never leaves the server.</p>
          {will?.beneficiaries.length ? (
            <Field label="Inherited by">{(id) => <BeneficiarySelect id={id} beneficiaries={will.beneficiaries} value={assignee} onChange={setAssignee} />}</Field>
          ) : (
            <p className="text-sm text-amber-300">Your will has no beneficiaries yet. Add one first.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRegistering(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!assignee}>
              Register
            </Button>
          </div>
        </form>
      </Modal>
    </li>
  );
}

export default function Vault() {
  const toast = useToast();
  const fileInput = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const { data, error, loading, refresh } = usePolling(async () => {
    const [docs, mine, config] = await Promise.all([api.get("/documents"), api.get("/wills/mine"), api.get("/documents/config")]);
    return { ...docs, will: mine.will, config };
  }, 5000);

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const { document } = await api.upload("/documents", file);
      toast.success(`${document.originalName} encrypted and stored`, { detail: "Register it on-chain to make it part of your will." });
      refresh();
    } catch (err) {
      toast.error("Upload rejected", { detail: err.message });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <>
      <PageHeader
        title="Document vault"
        subtitle="Files are encrypted with AES-256 before they are stored. Only their fingerprints go on-chain — which is what makes any later modification detectable."
      />

      {loading ? (
        <Loading />
      ) : !data ? (
        <ErrorNote error={error} />
      ) : (
        <div className="space-y-6">
          <Card title="Upload">
            <label
              className={`flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${dragging ? "border-emerald-400 bg-emerald-500/5" : "border-ink-600 hover:border-ink-500"}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                upload(e.dataTransfer.files[0]);
              }}
            >
              <Upload className="h-7 w-7 text-slate-400" />
              <span className="font-semibold text-slate-200">{uploading ? "Encrypting & uploading…" : "Drop a file here, or click to choose"}</span>
              <span className="text-xs text-slate-500">
                {data.config.extensions.join(", ")} · up to {formatBytes(data.config.maxBytes)} · storage: {data.config.storage === "ipfs" ? "local IPFS node" : "encrypted local filesystem"}
              </span>
              <input ref={fileInput} type="file" className="sr-only" accept={data.config.extensions.join(",")} disabled={uploading} onChange={(e) => upload(e.target.files[0])} />
            </label>
            {!data.will && (
              <p className="mt-3 text-sm text-slate-400">
                You can upload now and attach documents to your will later.{" "}
                <Link to="/app/will/new" className="link">
                  Create a will
                </Link>
              </p>
            )}
          </Card>

          <Card title={`My documents (${data.owned.length})`}>
            {data.owned.length === 0 ? (
              <Empty icon={FolderLock} title="No documents yet">
                Upload property papers, certificates or letters and assign each one to a beneficiary.
              </Empty>
            ) : (
              <ul className="divide-y divide-ink-800">
                {data.owned.map((doc) => (
                  <DocumentRow key={doc.id} doc={doc} will={data.will} onChanged={refresh} />
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Documents left to me (${data.inherited.length})`}>
            {data.inherited.length === 0 ? (
              <p className="py-2 text-sm text-slate-500">No document in anyone's will is assigned to you.</p>
            ) : (
              <ul className="divide-y divide-ink-800">
                {data.inherited.map((doc) => (
                  <DocumentRow key={doc.id} doc={doc} will={null} onChanged={refresh} />
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
