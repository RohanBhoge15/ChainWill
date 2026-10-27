import { useEffect, useId, useRef, useState } from "react";
import { Check, Copy, Loader2, QrCode, X } from "lucide-react";
import QRCode from "qrcode";
import { PHASES, TONES, shortAddress, shortHash } from "../lib/format.js";

export function Spinner({ className = "h-4 w-4" }) {
  return <Loader2 className={`animate-spin ${className}`} aria-hidden="true" />;
}

export function Button({ variant = "secondary", size, loading = false, disabled, icon: Icon, children, className = "", ...rest }) {
  const sizeClass = size === "sm" ? "btn-sm" : size === "lg" ? "btn-lg" : "";
  return (
    <button
      type="button"
      className={`btn btn-${variant} ${sizeClass} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function Card({ title, action, children, className = "", pad = true }) {
  return (
    <section className={`card ${pad ? "card-pad" : ""} ${className}`}>
      {(title || action) && (
        <header className={`flex items-center justify-between gap-3 ${pad ? "mb-4" : "px-5 pt-5 sm:px-6"}`}>
          {title && <h2 className="card-title">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-slate-400">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Empty({ icon: Icon, title, children, action }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      {Icon && (
        <div className="mb-4 rounded-2xl border border-ink-700 bg-ink-850 p-4">
          <Icon className="h-7 w-7 text-slate-500" aria-hidden="true" />
        </div>
      )}
      <p className="font-semibold text-slate-200">{title}</p>
      {children && <p className="mt-1 max-w-md text-sm text-slate-400">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Loading({ label = "Loading…" }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-slate-400" role="status">
      <Spinner className="h-5 w-5" /> {label}
    </div>
  );
}

export function ErrorNote({ error, children }) {
  const message = children || error?.message;
  if (!message) return null;
  return (
    <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
      {message}
    </div>
  );
}

export function Field({ label, hint, error, children, className = "" }) {
  const id = useId();
  return (
    <div className={className}>
      {label && (
        <label className="label" htmlFor={id}>
          {label}
        </label>
      )}
      {typeof children === "function" ? children(id) : children}
      {error ? <p className="field-error">{error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide = false }) {
  const panel = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const previous = document.activeElement;
    panel.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`card relative max-h-[92vh] w-full overflow-y-auto rounded-b-none bg-ink-900 p-6 outline-none sm:rounded-2xl ${wide ? "sm:max-w-2xl" : "sm:max-w-md"}`}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button className="rounded-lg p-1 text-slate-400 hover:bg-ink-800 hover:text-white" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function StatusChip({ phase, className = "" }) {
  const meta = PHASES[phase] || { label: phase, tone: "slate" };
  const tone = TONES[meta.tone];
  return (
    <span className={`chip ${tone.chip} ${className}`} title={meta.blurb}>
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot} ${phase === "ACTIVE" || phase === "MISSED" ? "animate-pulse" : ""}`} />
      {meta.label}
    </span>
  );
}

export function Tag({ tone = "slate", children }) {
  return <span className={`chip ${TONES[tone].chip}`}>{children}</span>;
}

export function ProgressBar({ value, tone = "emerald", className = "" }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className={`h-2 overflow-hidden rounded-full bg-ink-700 ${className}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-[width] duration-700 ${TONES[tone].bar}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Stat({ label, value, sub, tone }) {
  return (
    <div className="card px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tracking-tight ${tone ? TONES[tone].text : "text-white"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

// ── Addresses ────────────────────────────────────────────────────────────────────

/** Deterministic 5×5 mirrored blockie drawn from the address itself. */
export function Identicon({ address, size = 36, className = "" }) {
  const hex = (address || "0x").slice(2).toLowerCase().padEnd(40, "0");
  const hue = parseInt(hex.slice(0, 4), 16) % 360;
  const cells = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      if (parseInt(hex[6 + row * 3 + col], 16) % 2 === 0) {
        cells.push([col, row]);
        if (col < 2) cells.push([4 - col, row]);
      }
    }
  }
  return (
    <svg width={size} height={size} viewBox="0 0 5 5" className={`shrink-0 rounded-lg ${className}`} style={{ background: `hsl(${hue} 45% 16%)` }} aria-hidden="true">
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1.02" height="1.02" fill={`hsl(${(hue + 40) % 360} 75% 62%)`} />
      ))}
    </svg>
  );
}

export function CopyButton({ value, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (insecure context) — nothing to do */
    }
  };
  return (
    <button className="rounded-md p-1 text-slate-500 hover:bg-ink-800 hover:text-slate-200" onClick={copy} aria-label={copied ? "Copied" : label} title={copied ? "Copied" : label}>
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function QrModal({ address, name, onClose }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    QRCode.toDataURL(address, { margin: 1, width: 240, color: { dark: "#0b1220", light: "#ffffff" } }).then(setSrc);
  }, [address]);
  return (
    <Modal open onClose={onClose} title={name ? `${name}'s wallet` : "Wallet address"}>
      <div className="flex flex-col items-center gap-4">
        {src ? <img src={src} alt={`QR code for ${address}`} className="h-60 w-60 rounded-xl" /> : <div className="h-60 w-60 animate-pulse rounded-xl bg-ink-800" />}
        <p className="mono break-all text-center text-slate-300">{address}</p>
        <p className="text-center text-xs text-slate-500">Scan to copy this address — it is the on-chain identity of this account.</p>
      </div>
    </Modal>
  );
}

/** Identicon + name + short address, with copy and a QR code. */
export function AddressBadge({ party, address, name, size = "md", qr = true, you = false }) {
  const [showQr, setShowQr] = useState(false);
  const addr = party?.address || address;
  const label = party?.name ?? name;
  if (!addr) return <span className="text-slate-500">—</span>;
  const small = size === "sm";
  return (
    <span className="inline-flex min-w-0 items-center gap-2.5 align-middle">
      <Identicon address={addr} size={small ? 24 : 36} />
      <span className="min-w-0">
        {label && (
          <span className={`block truncate font-semibold text-slate-100 ${small ? "text-sm" : ""}`}>
            {label}
            {you && <span className="ml-1.5 text-xs font-normal text-slate-500">(you)</span>}
          </span>
        )}
        <span className="flex items-center gap-0.5">
          <span className="mono whitespace-nowrap text-slate-400" title={addr}>
            {shortAddress(addr)}
          </span>
          <CopyButton value={addr} label="Copy address" />
          {qr && (
            <button className="rounded-md p-1 text-slate-500 hover:bg-ink-800 hover:text-slate-200" onClick={() => setShowQr(true)} aria-label="Show QR code" title="Show QR code">
              <QrCode className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </span>
      {showQr && <QrModal address={addr} name={label} onClose={() => setShowQr(false)} />}
    </span>
  );
}

export function TxHash({ hash, onOpen }) {
  if (!hash) return null;
  return (
    <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
      {onOpen ? (
        <button className="mono link" onClick={() => onOpen(hash)} title={hash}>
          {shortHash(hash)}
        </button>
      ) : (
        <span className="mono text-slate-400" title={hash}>
          {shortHash(hash)}
        </span>
      )}
      <CopyButton value={hash} label="Copy transaction hash" />
    </span>
  );
}

/** A button that asks "are you sure?" inline before running a destructive action. */
export function ConfirmButton({ onConfirm, confirmLabel = "Yes, do it", children, loading, ...rest }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(timer);
  }, [armed]);

  if (!armed) {
    return (
      <Button {...rest} loading={loading} onClick={() => setArmed(true)}>
        {children}
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        {...rest}
        icon={undefined}
        loading={loading}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button variant="ghost" size={rest.size} onClick={() => setArmed(false)}>
        Cancel
      </Button>
    </span>
  );
}
