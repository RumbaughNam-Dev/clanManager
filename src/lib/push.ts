import { postJSON } from "@/lib/http";

type PushSubscriptionJson = {
  endpoint: string;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
};

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
  return output;
}

export async function ensurePushSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!publicKey) {
    console.warn("[push] VITE_VAPID_PUBLIC_KEY not set");
    return;
  }

  const reg = await navigator.serviceWorker.register("/sw.js");
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const payload = sub.toJSON() as PushSubscriptionJson;
  await postJSON("/v1/push/subscribe", {
    subscription: payload,
    platform: "mobile-web",
  });
}

export async function unsubscribePush() {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const payload = sub.toJSON();
  await postJSON("/v1/push/unsubscribe", { subscription: payload });
  await sub.unsubscribe();
}
