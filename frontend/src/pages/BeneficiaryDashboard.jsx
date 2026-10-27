import { useState } from "react";
import { Link } from "react-router-dom";
import { Download, FileText, Gift, HandCoins, Image as ImageIcon, Lock, PackageCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { api } from "../lib/api.js";
import { formatDateTime, sameAddress } from "../lib/format.js";
import { fromBaseUnits } from "../lib/willMath.js";
import { usePolling } from "../hooks/usePolling.js";
import { useTx } from "../hooks/useTx.js";
import { TxDetailModal } from "../components/TxDetailModal.jsx";
import { AddressBadge, Button, Card, Empty, ErrorNote, Loading, PageHeader, Tag, TxHash } from "../components/ui.jsx";
import { LifecycleSteps, LiveStatusChip } from "../components/will.jsx";

const TYPES = ["ETH", "ERC20", "ERC721", "DOCUMENT"];

/** Base units → at most 6 decimals, for display. */
function trimUnits(value, decimals = 18) {
  const [whole, fraction = ""] = fromBaseUnits(value, decimals).split(".");
  const short = fraction.slice(0, 6).replace(/0+$/, "");
  return short ? `${whole}.${short}` : whole;
}

function shareText(share) {
  const parts = [];
  if (share.eth !== "0") parts.push(`${share.ethFormatted} ETH`);
  for (const t of share.tokens) if (t.amount !== "0") parts.push(`${t.amountFormatted} ${t.symbol}`);
  return parts.join(" + ");
}

function BeneficiaryWill({ will, onChanged, onOpenTx }) {
  const { user } = useAuth();
  const toast = useToast();
  const { run, pending } = useTx();
  const me = will.viewer.beneficiary;
  const myItems = will.assets.filter((a) => !a.removed && a.assignedTo && sameAddress(a.assignedTo.address, user.walletAddress));
  const myReceipts = will.claims.filter((c) => sameAddress(c.args.beneficiary, user.walletAddress));
  const receiptFor = (assetIndex) => myReceipts.find((c) => c.args.assetIndex === String(assetIndex));
  const shareReceipt = myReceipts.find((c) => Number(c.args.t) <= 1); // ETH / token payout of claimInheritance
  const worth = shareText(me.share);

  const claimShare = async () => {
    const receipt = await run("claimInheritance", { owner: will.owner.address }, { success: `Claimed your ${me.percentage}% share` });
    if (receipt) onChanged();
  };
  const claimItem = async (asset) => {
    const receipt = await run(
      "claimAsset",
      { owner: will.owner.address, assetIndex: asset.index },
      { key: `item-${asset.index}`, success: asset.type === "DOCUMENT" ? "Document unlocked" : `${asset.label} is now in your wallet` }
    );
    if (receipt) onChanged();
  };
  const download = async (asset) => {
    try {
      const { filename } = await api.download(`/documents/${asset.document.id}/download`);
      toast.success(`Downloaded ${filename}`, { detail: "Decrypted after verifying your on-chain claim and the file's integrity." });
    } catch (err) {
      toast.error("Download refused", { detail: err.message });
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label">Inheritance from</p>
          <AddressBadge party={will.owner} />
          {will.title && <p className="mt-2 text-sm text-slate-400">“{will.title}”</p>}
        </div>
        <LiveStatusChip will={will} />
      </div>
      <div className="mt-5">
        <LifecycleSteps will={will} />
      </div>

      {!will.activated && will.phase !== "REVOKED" && (
        <p className="mt-5 flex items-start gap-2 rounded-xl border border-ink-700 bg-ink-850 px-4 py-3 text-sm text-slate-400">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          Nothing can be claimed yet. Claims open only after the owner stops checking in, the grace period passes, and the executor (
          {will.executor.name || "the executor"}) activates inheritance.
        </p>
      )}
      {will.phase === "REVOKED" && (
        <p className="mt-5 rounded-xl border border-ink-700 bg-ink-850 px-4 py-3 text-sm text-slate-400">The owner revoked this will. There is nothing to claim.</p>
      )}

      {will.phase !== "REVOKED" && (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {/* ── Percentage share (fungible) ── */}
          <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <HandCoins className="h-4 w-4 text-emerald-400" /> Your percentage share
            </p>
            <p className="mt-3 text-4xl font-bold tracking-tight text-white">{me.percentage}%</p>
            <p className="mt-1 text-sm text-slate-400">
              {worth ? (
                <>
                  {me.hasClaimed ? "You received" : will.activated ? "Worth" : "Currently worth"} <span className="font-semibold text-slate-200">{worth}</span>
                </>
              ) : (
                "of the will's ETH and tokens — none are escrowed"
              )}
            </p>
            <div className="mt-4">
              {me.hasClaimed ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Tag tone="emerald">
                    <PackageCheck className="h-3 w-3" /> Claimed
                  </Tag>
                  {shareReceipt && <TxHash hash={shareReceipt.txHash} onOpen={onOpenTx} />}
                </div>
              ) : (
                <Button variant="primary" className="w-full" icon={HandCoins} disabled={!will.activated || !will.hasFungible} loading={pending === "claimInheritance"} onClick={claimShare}>
                  Claim my {me.percentage}% (ETH + tokens)
                </Button>
              )}
            </div>
          </div>

          {/* ── Whole items (NFTs / documents) ── */}
          <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <Gift className="h-4 w-4 text-emerald-400" /> Items assigned to you
            </p>
            {myItems.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No NFT or document in this will is assigned to you.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {myItems.map((asset) => {
                  const receipt = receiptFor(asset.index);
                  const Icon = asset.type === "ERC721" ? ImageIcon : FileText;
                  return (
                    <li key={asset.index} className="rounded-lg border border-ink-700 bg-ink-900 p-3">
                      <p className="flex items-center gap-2 font-medium text-slate-100">
                        <Icon className="h-4 w-4 text-slate-400" /> {asset.label}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">{asset.type === "ERC721" ? "NFT — transferred whole to your wallet" : "Document — decrypted for you after your on-chain claim"}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {asset.isClaimed ? (
                          <>
                            <Tag tone="emerald">
                              <PackageCheck className="h-3 w-3" /> Claimed
                            </Tag>
                            {receipt && <TxHash hash={receipt.txHash} onOpen={onOpenTx} />}
                            {asset.type === "DOCUMENT" && asset.document && (
                              <Button size="sm" icon={Download} onClick={() => download(asset)}>
                                Download
                              </Button>
                            )}
                          </>
                        ) : (
                          <Button variant="primary" size="sm" disabled={!will.activated} loading={pending === `item-${asset.index}`} onClick={() => claimItem(asset)}>
                            Claim this item
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {myReceipts.length > 0 && (
        <div className="mt-5">
          <h3 className="card-title mb-2">Your claim receipts</h3>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>What</th>
                  <th>When</th>
                  <th>Block</th>
                  <th>Transaction</th>
                </tr>
              </thead>
              <tbody>
                {myReceipts.map((c) => {
                  const type = TYPES[Number(c.args.t)];
                  const asset = type === "ERC721" || type === "DOCUMENT" ? will.assets[Number(c.args.assetIndex)] : null;
                  const token = type === "ERC20" ? will.tokens.find((t) => sameAddress(t.address, c.args.token)) : null;
                  const what =
                    type === "ETH"
                      ? `${trimUnits(c.args.amount)} ETH`
                      : type === "ERC20"
                        ? `${trimUnits(c.args.amount, token?.decimals)} ${token?.symbol || "tokens"}`
                        : asset?.label || type;
                  return (
                    <tr key={c.id}>
                      <td className="text-slate-200">{what}</td>
                      <td className="text-slate-400">{formatDateTime(c.timestamp)}</td>
                      <td className="text-slate-400">{c.blockNumber}</td>
                      <td>
                        <TxHash hash={c.txHash} onOpen={onOpenTx} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function BeneficiaryDashboard() {
  const [openTx, setOpenTx] = useState(null);
  const { data, error, loading, refresh } = usePolling(() => api.get("/wills/as-beneficiary"), 4000);

  return (
    <>
      <PageHeader title="Beneficiary" subtitle="Wills that name you. Your percentage covers ETH and tokens; NFTs and documents assigned to you are claimed one by one.">
        <Link to="/app/vault" className="btn btn-secondary">
          <FileText className="h-4 w-4" /> Document vault
        </Link>
      </PageHeader>
      {loading ? (
        <Loading />
      ) : !data ? (
        <ErrorNote error={error} />
      ) : data.wills.length === 0 ? (
        <Card>
          <Empty icon={Gift} title="You are not a beneficiary of any will">
            When someone adds your wallet as a beneficiary, their will shows up here with your share and anything assigned to you.
          </Empty>
        </Card>
      ) : (
        <div className="space-y-6">
          {data.wills.map((will) => (
            <BeneficiaryWill key={will.owner.address} will={will} onChanged={refresh} onOpenTx={setOpenTx} />
          ))}
        </div>
      )}
      <TxDetailModal hash={openTx} onClose={() => setOpenTx(null)} />
    </>
  );
}
