import { useState } from "react";
import { FastForward, RefreshCw } from "lucide-react";
import { useToast } from "../context/ToastContext.jsx";
import { api } from "../lib/api.js";
import { PHASES, TONES, formatBytes, formatDateTime, formatNumber, humanDuration, partyLabel, timeAgo } from "../lib/format.js";
import { usePolling } from "../hooks/usePolling.js";
import { TxDetailModal } from "../components/TxDetailModal.jsx";
import { AddressBadge, Button, Card, CopyButton, ErrorNote, Loading, PageHeader, Stat, StatusChip, Tag } from "../components/ui.jsx";
import { EventList } from "../components/will.jsx";

/** Horizontal bar list: [{ label, value, tone }] */
function Bars({ rows, empty = "Nothing yet." }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.every((r) => r.value === 0)) return <p className="text-sm text-slate-500">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.label} className="grid grid-cols-[9.5rem_1fr_2.5rem] items-center gap-3 text-sm">
          <span className="truncate text-slate-400" title={row.label}>
            {row.label}
          </span>
          <span className="h-2.5 overflow-hidden rounded-full bg-ink-700">
            <span className={`block h-full rounded-full ${TONES[row.tone || "sky"].bar}`} style={{ width: `${(row.value / max) * 100}%` }} />
          </span>
          <span className="text-right font-semibold text-slate-200">{row.value}</span>
        </li>
      ))}
    </ul>
  );
}

function TimeTravel({ onDone }) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [custom, setCustom] = useState("");

  const jump = async (seconds) => {
    setBusy(seconds);
    try {
      const result = await api.post("/admin/time-travel", { seconds });
      toast.success(`Chain clock advanced by ${humanDuration(seconds)}`, { detail: `The chain is now ${humanDuration(result.clockOffsetSeconds)} ahead of real time.` });
      onDone();
    } catch (err) {
      toast.error("Could not fast-forward", { detail: err.message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title="Demo tools — fast-forward the chain">
      <p className="text-sm text-slate-400">
        Skips the local Ganache clock ahead instead of waiting for a check-in interval to pass. Deadlines, countdowns and notifications all follow the
        chain's clock. This changes time only — it cannot check in, activate or claim on anyone's behalf.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {[30, 60, 120, 3600, 86400].map((seconds) => (
          <Button key={seconds} size="sm" icon={FastForward} loading={busy === seconds} onClick={() => jump(seconds)}>
            +{humanDuration(seconds)}
          </Button>
        ))}
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            jump(Number(custom));
          }}
        >
          <input className="input w-28 py-1.5" type="number" min="1" placeholder="seconds" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Custom seconds" />
          <Button type="submit" size="sm" disabled={!(Number(custom) >= 1)}>
            Jump
          </Button>
        </form>
      </div>
    </Card>
  );
}

export default function Admin() {
  const [openTx, setOpenTx] = useState(null);
  const metrics = usePolling(() => api.get("/admin/metrics"), 5000);
  const users = usePolling(() => api.get("/admin/users"), 8000);
  const wills = usePolling(() => api.get("/admin/wills"), 6000);

  if (metrics.loading) return <Loading label="Computing metrics from the chain…" />;
  if (!metrics.data) return <ErrorNote error={metrics.error} />;
  const m = metrics.data;
  const refreshAll = () => {
    metrics.refresh();
    users.refresh();
    wills.refresh();
  };

  return (
    <>
      <PageHeader title="Admin dashboard" subtitle="Read-only transparency view. Every figure is computed live from the Ganache chain and the database on each refresh.">
        <span className="text-xs text-slate-500">updated {timeAgo(m.generatedAt)}</span>
        <Button icon={RefreshCw} onClick={refreshAll}>
          Refresh
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Registered users" value={m.users.total} sub={`${m.users.demoWallets} demo · ${m.users.metamask} MetaMask · ${m.users.admins} admin`} />
        <Stat label="Wills on-chain" value={m.wills.total} sub={`${m.beneficiaries} beneficiaries named`} />
        <Stat label="ETH in escrow" value={m.escrow.eth} sub={`+ ${m.escrow.tokens} ${m.escrow.tokenSymbol} · NFTs: ${m.escrow.nfts}`} tone="emerald" />
        <Stat label="ETH inherited" value={m.claims.ethClaimed} sub={`+ ${m.claims.tokensClaimed} ${m.escrow.tokenSymbol} · NFTs: ${m.claims.nftsClaimed} · documents: ${m.claims.documentsClaimed}`} tone="violet" />
        <Stat label="Latest block" value={formatNumber(m.chain.blockNumber)} sub={`indexed to ${m.chain.indexedUpToBlock}`} />
        <Stat label="Transactions" value={formatNumber(m.activity.transactions)} sub={`${formatNumber(m.activity.events)} events`} />
        <Stat label="Gas used" value={formatNumber(m.activity.gasUsed)} sub={`gas price ${m.chain.gasPriceGwei} gwei`} />
        <Stat label="Check-ins" value={m.activity.checkIns} sub={`${m.activity.activations} activations · ${m.activity.revocations} revocations`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Wills by lifecycle phase">
          <Bars rows={Object.entries(m.wills.phases).map(([phase, value]) => ({ label: PHASES[phase].label, value, tone: PHASES[phase].tone }))} empty="No wills yet." />
        </Card>
        <Card title="Events by type">
          <Bars rows={m.activity.byEvent.map((e) => ({ label: e.name, value: e.count, tone: "sky" }))} empty="No events yet." />
        </Card>

        <Card title="Assets under management">
          <Bars
            rows={[
              { label: "ETH deposits", value: m.assets.ETH, tone: "emerald" },
              { label: "Token deposits", value: m.assets.ERC20, tone: "emerald" },
              { label: "NFTs", value: m.assets.ERC721, tone: "violet" },
              { label: "Documents", value: m.assets.DOCUMENT, tone: "amber" },
            ]}
            empty="No assets registered."
          />
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl border border-ink-700 bg-ink-850 px-3 py-2">
              <dt className="text-xs uppercase tracking-wider text-slate-500">Claims completed</dt>
              <dd className="font-semibold text-slate-100">
                {m.claims.done} of {m.claims.total}
              </dd>
            </div>
            <div className="rounded-xl border border-ink-700 bg-ink-850 px-3 py-2">
              <dt className="text-xs uppercase tracking-wider text-slate-500">Vault</dt>
              <dd className="font-semibold text-slate-100">
                {m.documents.total} file{m.documents.total === 1 ? "" : "s"} · {formatBytes(m.documents.bytes)}
              </dd>
              <dd className="text-xs text-slate-500">
                {m.documents.registeredOnChain} on-chain · {m.documents.storage}
              </dd>
            </div>
          </dl>
        </Card>

        <Card title="Chain & services">
          <dl className="space-y-2 text-sm">
            {[
              ["RPC", m.chain.rpcUrl],
              ["Chain ID", m.chain.chainId],
              ["Chain time", `${formatDateTime(m.chain.chainNow)}${m.chain.clockOffsetSeconds ? ` (+${humanDuration(m.chain.clockOffsetSeconds)} vs. real time)` : ""}`],
              ["Contracts deployed", `block ${m.chain.deployBlock} · ${new Date(m.chain.deployedAt).toLocaleString()}`],
              ["Notifications", `${m.notifications.total} sent · ${m.notifications.unread} unread`],
              ["Web Push", m.notifications.pushEnabled ? `${m.notifications.pushSubscriptions} devices · ${m.notifications.pushSent} delivered · ${m.notifications.pushFailed} failed` : "not configured"],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-wrap justify-between gap-2 border-b border-ink-800 pb-2 last:border-b-0">
                <dt className="text-slate-500">{label}</dt>
                <dd className="text-right text-slate-200">{value}</dd>
              </div>
            ))}
            {Object.entries(m.chain.contracts).map(([name, address]) => (
              <div key={name} className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-800 pb-2 last:border-b-0">
                <dt className="text-slate-500">{name}</dt>
                <dd className="mono flex items-center gap-1 text-slate-300">
                  {address} <CopyButton value={address} />
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <Card title="All wills" className="mt-6" pad={false}>
        {!wills.data ? (
          <Loading />
        ) : wills.data.wills.length === 0 ? (
          <p className="px-6 py-8 text-sm text-slate-500">No wills have been created yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Executor</th>
                  <th>Beneficiaries</th>
                  <th>Escrow</th>
                  <th>Schedule</th>
                  <th>Last check-in</th>
                  <th>Claims</th>
                </tr>
              </thead>
              <tbody>
                {wills.data.wills.map((will) => (
                  <tr key={will.owner.address}>
                    <td>
                      <AddressBadge party={will.owner} size="sm" qr={false} />
                    </td>
                    <td>
                      <StatusChip phase={will.phase} />
                    </td>
                    <td>
                      <AddressBadge party={will.executor} size="sm" qr={false} />
                    </td>
                    <td className="text-slate-300">
                      {will.beneficiaries.map((b) => (
                        <span key={b.address} className="block whitespace-nowrap">
                          {partyLabel(b)} · {b.percentage}%{b.hasClaimed ? " ✓" : ""}
                        </span>
                      ))}
                      {will.beneficiaries.length === 0 && "—"}
                    </td>
                    <td className="whitespace-nowrap text-slate-200">
                      {will.ethEscrowFormatted} ETH
                      {will.tokens.map((t) => (
                        <span key={t.address} className="block text-xs text-slate-500">
                          {t.escrowedFormatted} {t.symbol}
                        </span>
                      ))}
                    </td>
                    <td className="whitespace-nowrap text-slate-400">
                      {humanDuration(will.checkInInterval)}
                      <span className="block text-xs text-slate-500">+ {humanDuration(will.gracePeriod)} grace</span>
                    </td>
                    <td className="whitespace-nowrap text-slate-400">{formatDateTime(will.lastCheckIn)}</td>
                    <td className="text-slate-400">{will.activated ? `${will.claimProgress.claimed}/${will.claimProgress.total}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Ganache accounts" pad={false}>
          <div className="mt-3 overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Address</th>
                  <th>Assigned to</th>
                  <th className="text-right">Balance (ETH)</th>
                </tr>
              </thead>
              <tbody>
                {m.accounts.map((account) => (
                  <tr key={account.address}>
                    <td className="text-slate-500">{account.slot}</td>
                    <td>
                      <AddressBadge address={account.address} size="sm" qr={false} />
                    </td>
                    <td>
                      {account.user ? (
                        <span className="text-slate-200">
                          {account.user} <span className="text-xs text-slate-500">({account.walletMode})</span>
                        </span>
                      ) : (
                        <span className="text-slate-600">unassigned</span>
                      )}
                      {account.isDeployer && <span className="ml-2 text-xs text-slate-500">deployer</span>}
                    </td>
                    <td className="text-right font-semibold text-slate-200">{account.balance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Users" pad={false}>
          {!users.data ? (
            <Loading />
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Wallet</th>
                    <th>Own will</th>
                    <th>Roles</th>
                  </tr>
                </thead>
                <tbody>
                  {users.data.users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <span className="block font-medium text-slate-100">{u.name}</span>
                        <span className="text-xs text-slate-500">{u.email}</span>
                      </td>
                      <td>
                        {u.walletAddress ? (
                          <>
                            <AddressBadge address={u.walletAddress} size="sm" qr={false} />
                            <span className="block text-xs text-slate-500">
                              {u.walletMode} · {u.ethBalance} ETH
                            </span>
                          </>
                        ) : (
                          <Tag tone="sky">admin · no wallet</Tag>
                        )}
                      </td>
                      <td>{u.ownWillPhase ? <StatusChip phase={u.ownWillPhase} /> : <span className="text-slate-600">—</span>}</td>
                      <td className="text-xs whitespace-nowrap text-slate-400">
                        {u.executorOf > 0 && <span className="block">executor × {u.executorOf}</span>}
                        {u.beneficiaryOf > 0 && <span className="block">beneficiary × {u.beneficiaryOf}</span>}
                        {u.executorOf + u.beneficiaryOf === 0 && "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Latest contract events">
          <EventList events={m.activity.recent} onOpenTx={setOpenTx} />
        </Card>
        {m.demoTools && <TimeTravel onDone={refreshAll} />}
      </div>

      <TxDetailModal hash={openTx} onClose={() => setOpenTx(null)} />
    </>
  );
}
