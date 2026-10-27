import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BellOff, BellRing, CheckCheck, Send, Trash2 } from "lucide-react";
import { useToast } from "../context/ToastContext.jsx";
import { api } from "../lib/api.js";
import { disablePush, enablePush, pushStatus } from "../lib/push.js";
import { timeAgo } from "../lib/format.js";
import { usePolling } from "../hooks/usePolling.js";
import { Button, Card, ConfirmButton, Empty, ErrorNote, Loading, PageHeader, Tag } from "../components/ui.jsx";

const PERMISSION_TEXT = {
  granted: ["emerald", "Allowed"],
  denied: ["rose", "Blocked in browser"],
  default: ["amber", "Not asked yet"],
  unsupported: ["slate", "Not supported"],
};

function PushSettings() {
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null);
  const load = () => pushStatus().then(setStatus).catch(() => setStatus({ supported: false, permission: "unsupported" }));
  useEffect(() => {
    load();
  }, []);

  const act = async (name, fn, okMessage) => {
    setBusy(name);
    try {
      await fn();
      if (okMessage) toast.success(okMessage);
    } catch (err) {
      toast.error("Push notifications", { detail: err.message });
    } finally {
      setBusy(null);
      load();
    }
  };

  if (!status) return <Loading />;
  const [tone, text] = PERMISSION_TEXT[status.permission] || PERMISSION_TEXT.unsupported;

  return (
    <div className="space-y-4">
      <dl className="space-y-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-slate-400">Browser permission</dt>
          <dd>
            <Tag tone={tone}>{text}</Tag>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-slate-400">This device</dt>
          <dd>
            <Tag tone={status.subscribed ? "emerald" : "slate"}>{status.subscribed ? "Subscribed" : "Not subscribed"}</Tag>
          </dd>
        </div>
        {status.supported && (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-slate-400">Devices on your account</dt>
            <dd className="font-semibold text-slate-200">{status.devices ?? 0}</dd>
          </div>
        )}
      </dl>

      {!status.supported ? (
        <p className="text-sm text-slate-400">This browser cannot receive push notifications. The bell above still shows everything.</p>
      ) : !status.serverEnabled ? (
        <p className="text-sm text-amber-300">Push is not configured on the server (no VAPID keys). Run `npm run setup` and restart the backend.</p>
      ) : status.subscribed ? (
        <Button icon={BellOff} loading={busy === "off"} onClick={() => act("off", disablePush, "Push turned off on this device")}>
          Turn off on this device
        </Button>
      ) : (
        <Button variant="primary" icon={BellRing} loading={busy === "on"} onClick={() => act("on", enablePush, "Push notifications enabled")}>
          Enable push notifications
        </Button>
      )}

      <Button variant="ghost" icon={Send} loading={busy === "test"} onClick={() => act("test", () => api.post("/notifications/test"), "Test notification sent")}>
        Send a test notification
      </Button>
      <p className="hint">
        Push delivers real system notifications even when this tab is closed. It needs <span className="text-slate-300">localhost</span> or HTTPS. If you
        deny permission, alerts still arrive in the bell and on this page.
      </p>
    </div>
  );
}

export default function Notifications() {
  const { data, error, loading, refresh } = usePolling(() => api.get("/notifications?limit=100"), 4000);

  const markAll = () => api.post("/notifications/read-all").then(refresh);
  const clear = () => api.del("/notifications").then(refresh);
  const open = (n) => !n.read && api.post(`/notifications/${n.id}/read`).then(refresh);

  return (
    <>
      <PageHeader title="Notification centre" subtitle="Deadline warnings, grace-period alerts, activation and claim confirmations — the full history, whether or not push is enabled.">
        {data?.unread > 0 && (
          <Button icon={CheckCheck} onClick={markAll}>
            Mark all read
          </Button>
        )}
        {data?.notifications.length > 0 && (
          <ConfirmButton variant="ghost" icon={Trash2} confirmLabel="Clear all" onConfirm={clear}>
            Clear
          </ConfirmButton>
        )}
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card title={data ? `History (${data.unread} unread)` : "History"} pad={false}>
          {loading ? (
            <Loading />
          ) : !data ? (
            <div className="p-5">
              <ErrorNote error={error} />
            </div>
          ) : data.notifications.length === 0 ? (
            <Empty icon={BellRing} title="No notifications yet">
              You will be told here when a check-in is due, when a grace period starts, and when an inheritance can be claimed.
            </Empty>
          ) : (
            <ul className="mt-3">
              {data.notifications.map((n) => (
                <li key={n.id}>
                  <Link to={n.link || "/app/notifications"} onClick={() => open(n)} className={`flex gap-3 border-t border-ink-800 px-5 py-4 hover:bg-ink-850 sm:px-6 ${n.read ? "" : "bg-emerald-500/5"}`}>
                    <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-ink-600" : "bg-emerald-400"}`} aria-label={n.read ? "read" : "unread"} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="font-semibold text-slate-100">{n.title}</span>
                        <span className="text-xs text-slate-500">{timeAgo(n.createdAt)}</span>
                      </span>
                      <span className="mt-0.5 block text-sm text-slate-400">{n.message}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Push settings" className="h-fit">
          <PushSettings />
        </Card>
      </div>
    </>
  );
}
