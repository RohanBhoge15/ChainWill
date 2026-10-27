import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Search, X } from "lucide-react";
import { api } from "../lib/api.js";
import { TONES, describeEvent, eventTone, formatDateTime, formatNumber, partyLabel, shortAddress } from "../lib/format.js";
import { usePolling } from "../hooks/usePolling.js";
import { Logo } from "../components/Layout.jsx";
import { TxDetailModal } from "../components/TxDetailModal.jsx";
import { AddressBadge, Card, CopyButton, ErrorNote, Loading, PageHeader, Stat, StatusChip, TxHash } from "../components/ui.jsx";

const PAGE = 25;
const WILL_EVENTS = [
  "WillCreated",
  "CheckInPerformed",
  "BeneficiaryAdded",
  "BeneficiaryRemoved",
  "AssetRegistered",
  "AssetAssigned",
  "AssetRemoved",
  "ScheduleUpdated",
  "ExecutorChanged",
  "InheritanceActivated",
  "AssetClaimed",
  "WillRevoked",
];

/** Mini block explorer over every event the ChainWill contracts have emitted. */
export default function Explorer() {
  const [address, setAddress] = useState("");
  const [applied, setApplied] = useState("");
  const [event, setEvent] = useState("");
  const [contract, setContract] = useState("WillManager");
  const [page, setPage] = useState(0);
  const [openTx, setOpenTx] = useState(null);
  const [tab, setTab] = useState("events");

  const addressValid = applied === "" || /^0x[0-9a-fA-F]{40}$/.test(applied);
  const query = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE) });
  if (applied && addressValid) query.set("address", applied);
  if (event) query.set("event", event);
  if (contract) query.set("contract", contract);

  const summary = usePolling(() => api.get("/explorer/summary"), 5000);
  const events = usePolling(() => api.get(`/explorer/events?${query}`), 4000, [query.toString()]);
  const wills = usePolling(() => api.get("/explorer/wills"), 5000);

  const filterBy = (value) => {
    setAddress(value);
    setApplied(value);
    setPage(0);
    setTab("events");
  };
  const submit = (e) => {
    e.preventDefault();
    setApplied(address.trim());
    setPage(0);
  };
  const total = events.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <>
      <PageHeader title="Explorer" subtitle="Every will, check-in, activation and claim is a public contract event. This page reads them straight from the chain — no login needed." />

      {summary.data && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Latest block" value={formatNumber(summary.data.blockNumber)} sub={`chain ID ${summary.data.chainId}`} />
          <Stat label="Wills on-chain" value={summary.data.willCount} />
          <Stat label="ETH in escrow" value={summary.data.ethInEscrow} sub="held by WillManager" tone="emerald" />
          <Stat label="Transactions" value={formatNumber(summary.data.transactions)} sub="that emitted events" />
        </div>
      )}

      {summary.data && (
        <Card className="mb-6" title="Contracts">
          <dl className="grid gap-3 sm:grid-cols-3">
            {Object.entries(summary.data.contracts).map(([name, addr]) => (
              <div key={name}>
                <dt className="text-xs uppercase tracking-wider text-slate-500">{name}</dt>
                <dd className="mono flex items-center gap-1 text-slate-300">
                  <button className="link" onClick={() => filterBy(addr)} title="Show events involving this contract address">
                    {shortAddress(addr, 10, 8)}
                  </button>
                  <CopyButton value={addr} />
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      <div className="mb-4 inline-grid grid-cols-2 rounded-xl border border-ink-700 bg-ink-850 p-1" role="tablist">
        {[
          ["events", `Events${events.data ? ` (${formatNumber(total)})` : ""}`],
          ["wills", `Wills${wills.data ? ` (${wills.data.wills.length})` : ""}`],
        ].map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === key ? "bg-ink-700 text-white" : "text-slate-400 hover:text-slate-200"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "events" ? (
        <Card pad={false}>
          <form onSubmit={submit} className="flex flex-wrap items-end gap-3 border-b border-ink-800 p-4 sm:p-5">
            <div className="min-w-64 flex-1">
              <label className="label" htmlFor="explorer-address">
                Filter by address
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-3 left-3 h-4 w-4 text-slate-500" />
                <input id="explorer-address" className="input mono pr-9 pl-9" placeholder="0x… owner, executor, beneficiary or sender" value={address} onChange={(e) => setAddress(e.target.value)} spellCheck={false} />
                {address && (
                  <button type="button" className="absolute top-2.5 right-2.5 rounded p-0.5 text-slate-500 hover:text-white" onClick={() => filterBy("")} aria-label="Clear address filter">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="label" htmlFor="explorer-contract">
                Contract
              </label>
              <select
                id="explorer-contract"
                className="input"
                value={contract}
                onChange={(e) => {
                  setContract(e.target.value);
                  setEvent("");
                  setPage(0);
                }}
              >
                <option value="WillManager">WillManager</option>
                <option value="DemoToken">DemoToken</option>
                <option value="DemoNFT">DemoNFT</option>
                <option value="">All contracts</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="explorer-event">
                Event
              </label>
              <select
                id="explorer-event"
                className="input"
                value={event}
                onChange={(e) => {
                  setEvent(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">All events</option>
                {(contract === "WillManager" ? WILL_EVENTS : (summary.data?.eventCounts ?? []).map((c) => c.name)).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-secondary">
              Apply
            </button>
          </form>

          {!addressValid ? (
            <div className="p-5">
              <ErrorNote>That is not a valid Ethereum address (0x followed by 40 hex characters).</ErrorNote>
            </div>
          ) : events.loading ? (
            <Loading />
          ) : !events.data ? (
            <div className="p-5">
              <ErrorNote error={events.error} />
            </div>
          ) : events.data.events.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">No events match these filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Block</th>
                    <th>Time</th>
                    <th>Event</th>
                    <th>Details</th>
                    <th>Will owner</th>
                    <th>Sent by</th>
                    <th>Tx hash</th>
                  </tr>
                </thead>
                <tbody>
                  {events.data.events.map((row) => (
                    <tr key={row.id}>
                      <td className="mono text-slate-400">{row.blockNumber}</td>
                      <td className="whitespace-nowrap text-slate-400">{formatDateTime(row.timestamp)}</td>
                      <td>
                        <span className={`chip ${TONES[eventTone(row.event)].chip}`}>{row.event}</span>
                      </td>
                      <td className="min-w-64 text-slate-300">{describeEvent(row)}</td>
                      <td>
                        {row.willOwner ? (
                          <button className="link text-left" onClick={() => filterBy(row.willOwner.address)} title={row.willOwner.address}>
                            {partyLabel(row.willOwner)}
                          </button>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td>
                        {row.from && (
                          <button className="link text-left" onClick={() => filterBy(row.from.address)} title={row.from.address}>
                            {partyLabel(row.from)}
                          </button>
                        )}
                      </td>
                      <td className="whitespace-nowrap">
                        <TxHash hash={row.txHash} onOpen={setOpenTx} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {addressValid && total > PAGE && (
            <div className="flex items-center justify-between border-t border-ink-800 px-5 py-3 text-sm text-slate-400">
              <span>
                Page {page + 1} of {pages}
              </span>
              <span className="flex gap-2">
                <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  Newer
                </button>
                <button className="btn btn-secondary btn-sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
                  Older
                </button>
              </span>
            </div>
          )}
        </Card>
      ) : (
        <Card pad={false}>
          {wills.loading ? (
            <Loading />
          ) : !wills.data ? (
            <div className="p-5">
              <ErrorNote error={wills.error} />
            </div>
          ) : wills.data.wills.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">No wills have been created on this chain yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Owner</th>
                    <th>Status</th>
                    <th>Executor</th>
                    <th>Beneficiaries</th>
                    <th>ETH escrow</th>
                    <th>Assets</th>
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
                        {will.beneficiaries.length === 0
                          ? "—"
                          : will.beneficiaries.map((b) => (
                              <span key={b.address} className="block whitespace-nowrap">
                                {partyLabel(b)} · {b.percentage}%{b.hasClaimed ? " ✓" : ""}
                              </span>
                            ))}
                      </td>
                      <td className="font-semibold text-slate-200">{will.ethEscrowFormatted}</td>
                      <td className="text-slate-400">{will.assets.filter((a) => !a.removed).length}</td>
                      <td className="text-slate-400">{will.claimProgress.total ? `${will.claimProgress.claimed}/${will.claimProgress.total}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <TxDetailModal hash={openTx} onClose={() => setOpenTx(null)} />
    </>
  );
}

/** The same explorer for visitors who are not signed in. */
export function PublicExplorer() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6">
        <Link to="/">
          <Logo />
        </Link>
        <Link to="/" className="btn btn-ghost">
          <ArrowLeft className="h-4 w-4" /> Sign in
        </Link>
      </header>
      <main className="mx-auto max-w-6xl px-5 pb-16">
        <Explorer />
      </main>
    </div>
  );
}
