import webpush from "web-push";
import nodemailer from "nodemailer";
import { config } from "./config.js";
import { db } from "./db.js";
import { lower } from "./chain.js";

export const pushEnabled = Boolean(config.vapidPublicKey && config.vapidPrivateKey);
if (pushEnabled) {
  webpush.setVapidDetails(config.webPushContact, config.vapidPublicKey, config.vapidPrivateKey);
}

const mailer = config.smtp.host
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : null;

const insertNotification = db.prepare(
  "INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, ?, ?, ?, ?)"
);

/** Counters for the admin dashboard. */
export const pushStats = { sent: 0, failed: 0 };

async function deliverPush(userId, payload) {
  if (!pushEnabled) return;
  const subscriptions = db.prepare("SELECT * FROM push_subscriptions WHERE user_id = ?").all(userId);
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          { TTL: 300 }
        );
        pushStats.sent++;
      } catch (err) {
        pushStats.failed++;
        // 404/410: the browser dropped this subscription — forget it
        if (err.statusCode === 404 || err.statusCode === 410) {
          db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(sub.id);
        } else {
          console.warn(`[push] delivery failed (${err.statusCode || err.code || err.message})`);
        }
      }
    })
  );
}

async function deliverEmail(userId, { title, message }) {
  if (!mailer) return;
  const user = db.prepare("SELECT email FROM users WHERE id = ?").get(userId);
  if (!user) return;
  try {
    await mailer.sendMail({ from: config.smtp.from, to: user.email, subject: `ChainWill — ${title}`, text: message });
  } catch (err) {
    console.warn(`[mail] delivery failed: ${err.message}`);
  }
}

/**
 * Record an in-app notification (the bell always works, even with push denied)
 * and fan it out to Web Push and, if SMTP is configured, e-mail.
 */
export function notifyUser(userId, { type, title, message, link = null }) {
  const { lastInsertRowid } = insertNotification.run(userId, type, title, message, link);
  const payload = { id: Number(lastInsertRowid), type, title, body: message, url: link || "/app" };
  deliverPush(userId, payload).catch(() => {});
  deliverEmail(userId, { title, message }).catch(() => {});
  return Number(lastInsertRowid);
}

/** Notify whoever has registered this wallet; silently skipped for unknown addresses. */
export function notifyAddress(address, notification) {
  if (!address) return null;
  const user = db.prepare("SELECT id FROM users WHERE wallet_address = ?").get(lower(address));
  return user ? notifyUser(user.id, notification) : null;
}

/** True the first time a key is seen — makes timed alerts fire exactly once. */
export function firstTime(dedupeKey) {
  return db.prepare("INSERT OR IGNORE INTO notification_log (dedupe_key) VALUES (?)").run(dedupeKey).changes === 1;
}
