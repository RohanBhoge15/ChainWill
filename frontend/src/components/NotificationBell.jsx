import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { api } from "../lib/api.js";
import { timeAgo } from "../lib/format.js";
import { usePolling } from "../hooks/usePolling.js";
import { useToast } from "../context/ToastContext.jsx";

// Confirmations of something the user just did themselves: the action already
// showed its own toast, so these only go to the bell (and to push).
const QUIET = new Set(["CHECKIN", "CLAIMED", "DOC_UNLOCKED", "WILL_CREATED", "ACTIVATED_BY_YOU", "REVOKED_BY_YOU", "TEST"]);

/** Bell with unread badge, a dropdown of recent items, and a live toast for new ones. */
export function NotificationBell() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const newestSeen = useRef(null);
  const { data, refresh } = usePolling(() => api.get("/notifications?limit=8"), 4000);

  // In-app alert for anything that arrived since the last poll — works even
  // when the browser's push permission is denied.
  useEffect(() => {
    if (!data) return;
    const newest = data.notifications[0]?.id ?? 0;
    if (newestSeen.current !== null) {
      data.notifications
        .filter((n) => n.id > newestSeen.current && !n.read && !QUIET.has(n.type))
        .reverse()
        .forEach((n) => toast.info(n.title, { detail: n.message, duration: 8000 }));
    }
    newestSeen.current = Math.max(newest, newestSeen.current ?? 0);
  }, [data, toast]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !root.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const unread = data?.unread ?? 0;
  const markAll = async () => {
    await api.post("/notifications/read-all");
    refresh();
  };

  return (
    <div className="relative" ref={root}>
      <button
        className="relative rounded-xl border border-ink-700 bg-ink-850 p-2.5 text-slate-300 hover:border-ink-500 hover:text-white"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="card absolute right-0 z-40 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden bg-ink-900 shadow-2xl shadow-black/50">
          <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
            <p className="font-semibold text-white">Notifications</p>
            {unread > 0 && (
              <button className="text-xs link" onClick={markAll}>
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {(data?.notifications ?? []).length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-500">Nothing yet.</li>}
            {(data?.notifications ?? []).map((n) => (
              <li key={n.id}>
                <Link
                  to={n.link || "/app/notifications"}
                  className={`block border-b border-ink-800 px-4 py-3 hover:bg-ink-850 ${n.read ? "" : "bg-emerald-500/5"}`}
                  onClick={() => {
                    setOpen(false);
                    if (!n.read) api.post(`/notifications/${n.id}/read`).then(refresh);
                  }}
                >
                  <p className="flex items-start justify-between gap-3 text-sm font-semibold text-slate-100">
                    <span>{n.title}</span>
                    {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-400" aria-label="unread" />}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-sm text-slate-400">{n.message}</p>
                  <p className="mt-1 text-xs text-slate-600">{timeAgo(n.createdAt)}</p>
                </Link>
              </li>
            ))}
          </ul>
          <Link to="/app/notifications" className="block px-4 py-3 text-center text-sm link" onClick={() => setOpen(false)}>
            Open notification centre
          </Link>
        </div>
      )}
    </div>
  );
}
