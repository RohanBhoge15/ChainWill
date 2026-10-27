import { Router } from "express";
import { config } from "../config.js";
import { db } from "../db.js";
import { asInt, bad } from "../http.js";
import { requireAuth } from "../middleware.js";
import { notifyUser, pushEnabled } from "../notify.js";

const router = Router();
router.use(requireAuth);

const shape = (n) => ({
  id: n.id,
  type: n.type,
  title: n.title,
  message: n.message,
  link: n.link,
  read: Boolean(n.read),
  createdAt: n.created_at.replace(" ", "T") + "Z",
});

router.get("/", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = db
    .prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?")
    .all(req.user.id, limit);
  const { unread } = db
    .prepare("SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read = 0")
    .get(req.user.id);
  res.json({ notifications: rows.map(shape), unread });
});

router.post("/read-all", (req, res) => {
  db.prepare("UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0").run(req.user.id);
  res.json({ unread: 0 });
});

router.post("/:id/read", (req, res) => {
  const id = asInt(req.params.id, "id", { min: 1 });
  db.prepare("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?").run(id, req.user.id);
  res.json({ ok: true });
});

router.delete("/", (req, res) => {
  db.prepare("DELETE FROM notifications WHERE user_id = ?").run(req.user.id);
  res.json({ ok: true });
});

// ── Web Push ─────────────────────────────────────────────────────────────────────

router.get("/push/config", (req, res) => {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM push_subscriptions WHERE user_id = ?").get(req.user.id);
  res.json({ enabled: pushEnabled, publicKey: pushEnabled ? config.vapidPublicKey : null, subscriptions: count });
});

// The server POSTs to whatever endpoint is stored, so only real browser push
// services are accepted — otherwise this would be a request-forgery primitive.
const PUSH_HOSTS = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "updates.push.services.mozilla.com",
  "notify.windows.com",
  "push.apple.com",
  ...config.pushExtraHosts,
];

function isPushService(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === "https:" && PUSH_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

router.post("/push/subscribe", (req, res) => {
  const { endpoint, keys } = req.body?.subscription || {};
  if (typeof endpoint !== "string" || typeof keys?.p256dh !== "string" || typeof keys?.auth !== "string") {
    throw bad("Invalid push subscription");
  }
  if (!isPushService(endpoint)) throw bad("Push endpoint is not a recognised browser push service");
  db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`
  ).run(req.user.id, endpoint, String(keys.p256dh), String(keys.auth));
  res.status(201).json({ ok: true });
});

router.post("/push/unsubscribe", (req, res) => {
  const endpoint = String(req.body?.endpoint || "");
  db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").run(endpoint, req.user.id);
  res.json({ ok: true });
});

/** Fires a real notification through every channel, to check that push works. */
router.post("/test", (req, res) => {
  const id = notifyUser(req.user.id, {
    type: "TEST",
    title: "🔔 Test notification",
    message: "If you can read this as a system notification, push is working on this device.",
    link: "/app/notifications",
  });
  res.status(201).json({ id });
});

export default router;
