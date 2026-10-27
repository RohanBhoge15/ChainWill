import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { describeEvent, formatDateTime, formatNumber } from "../lib/format.js";
import { AddressBadge, CopyButton, ErrorNote, Loading, Modal, Tag } from "./ui.jsx";

/** Transaction details fetched straight from the node (not from our index). */
export function TxDetailModal({ hash, onClose }) {
  const [tx, setTx] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!hash) return;
    setTx(null);
    setError(null);
    api.get(`/explorer/tx/${hash}`).then(setTx).catch(setError);
  }, [hash]);

  return (
    <Modal open={Boolean(hash)} onClose={onClose} title="Transaction" wide>
      {error ? (
        <ErrorNote error={error} />
      ) : !tx ? (
        <Loading label="Reading from the chain…" />
      ) : (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone={tx.succeeded ? "emerald" : "rose"}>{tx.succeeded ? "Success" : "Reverted"}</Tag>
            <span className="text-slate-400">
              Block {tx.blockNumber} · {formatDateTime(tx.timestamp)}
            </span>
          </div>
          <div>
            <p className="label">Transaction hash</p>
            <p className="mono flex items-start gap-1 break-all text-slate-300">
              {tx.txHash} <CopyButton value={tx.txHash} />
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="label">From</p>
              <AddressBadge party={tx.from} qr={false} />
            </div>
            <div>
              <p className="label">To (contract)</p>
              {tx.to ? <AddressBadge party={tx.to} qr={false} /> : "Contract creation"}
            </div>
          </div>
          <dl className="grid grid-cols-3 gap-3">
            {[
              ["Value", `${tx.valueFormatted} ETH`],
              ["Gas used", formatNumber(tx.gasUsed)],
              ["Nonce", tx.nonce],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-ink-700 bg-ink-850 px-3 py-2">
                <dt className="text-xs uppercase tracking-wider text-slate-500">{label}</dt>
                <dd className="mt-0.5 font-semibold text-slate-100">{value}</dd>
              </div>
            ))}
          </dl>
          <div>
            <p className="label">Events emitted ({tx.events.length})</p>
            {tx.events.length === 0 ? (
              <p className="text-slate-500">None.</p>
            ) : (
              <ul className="space-y-2">
                {tx.events.map((event) => (
                  <li key={event.logIndex} className="rounded-xl border border-ink-700 bg-ink-850 px-3 py-2">
                    <p className="font-semibold text-slate-100">
                      {event.contract}.{event.name}
                    </p>
                    <p className="text-slate-400">{describeEvent({ event: event.name, args: event.args, names: tx.names })}</p>
                    <pre className="mono mt-2 overflow-x-auto text-xs text-slate-500">{JSON.stringify(event.args, null, 2)}</pre>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
