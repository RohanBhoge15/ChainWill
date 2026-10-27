import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { CheckCircle2, Info, ShieldAlert, X, XCircle } from "lucide-react";
import { shortHash } from "../lib/format.js";

const ToastContext = createContext(null);

const STYLE = {
  success: { icon: CheckCircle2, ring: "border-emerald-500/40", color: "text-emerald-400" },
  error: { icon: XCircle, ring: "border-rose-500/50", color: "text-rose-400" },
  revert: { icon: ShieldAlert, ring: "border-rose-500/50", color: "text-rose-400" },
  info: { icon: Info, ring: "border-sky-500/40", color: "text-sky-400" },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (kind, title, options = {}) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-2), { id, kind, title, ...options }]); // at most 3 on screen
      setTimeout(() => dismiss(id), options.duration ?? (kind === "success" || kind === "info" ? 5000 : 9000));
      return id;
    },
    [dismiss]
  );

  const value = useMemo(
    () => ({
      success: (title, options) => push("success", title, options),
      error: (title, options) => push("error", title, options),
      revert: (title, options) => push("revert", title, options),
      info: (title, options) => push("info", title, options),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-5 sm:items-end">
        {toasts.map((toast) => {
          const { icon: Icon, ring, color } = STYLE[toast.kind];
          return (
            <div
              key={toast.id}
              role={toast.kind === "success" || toast.kind === "info" ? "status" : "alert"}
              className={`animate-toast pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border ${ring} bg-ink-850 px-4 py-3 shadow-xl shadow-black/40`}
            >
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${color}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-100">{toast.title}</p>
                {toast.detail && <p className="mt-0.5 text-sm break-words text-slate-400">{toast.detail}</p>}
                {toast.txHash && <p className="mono mt-1 text-xs text-slate-500">tx {shortHash(toast.txHash)}</p>}
              </div>
              <button className="text-slate-500 hover:text-slate-200" onClick={() => dismiss(toast.id)} aria-label="Dismiss">
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
