import { api } from "./api.js";

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const base64UrlToBytes = (value) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
};

/** { supported, permission, subscribed, serverEnabled } for this browser. */
export async function pushStatus() {
  if (!pushSupported()) return { supported: false, permission: "unsupported", subscribed: false, serverEnabled: false };
  const config = await api.get("/notifications/push/config");
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  return {
    supported: true,
    permission: Notification.permission,
    subscribed: Boolean(subscription),
    serverEnabled: config.enabled,
    devices: config.subscriptions,
  };
}

/** Ask for permission, subscribe this browser, and register it with the backend. */
export async function enablePush() {
  if (!pushSupported()) throw new Error("This browser does not support push notifications.");
  const config = await api.get("/notifications/push/config");
  if (!config.enabled) throw new Error("Push is not configured on the server (missing VAPID keys).");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked for this site. Allow them in the browser's site settings, then try again."
        : "Permission was dismissed."
    );
  }

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(config.publicKey),
    });
  }
  await api.post("/notifications/push/subscribe", { subscription: subscription.toJSON() });
}

export async function disablePush() {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  if (!subscription) return;
  await api.post("/notifications/push/unsubscribe", { endpoint: subscription.endpoint }).catch(() => {});
  await subscription.unsubscribe();
}
