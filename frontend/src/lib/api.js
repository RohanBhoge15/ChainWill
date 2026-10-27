import { setChainNow } from "./clock.js";

const TOKEN_KEY = "chainwill.token";

export const session = {
  get token() {
    return localStorage.getItem(TOKEN_KEY);
  },
  set(token) {
    localStorage.setItem(TOKEN_KEY, token);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
  },
};

export class ApiError extends Error {
  constructor(message, { status = 0, reverted = false, data = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.reverted = reverted; // true when the smart contract itself refused
    this.data = data;
  }
}

async function request(method, path, { body, form, blob = false } = {}) {
  const headers = {};
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  } catch {
    throw new ApiError("Cannot reach the ChainWill server. Is the backend running?");
  }

  if (res.ok && blob) return res;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && session.token && !path.startsWith("/auth/")) {
      session.clear();
      window.dispatchEvent(new Event("chainwill:signed-out"));
    }
    throw new ApiError(data?.error || `Request failed (${res.status})`, {
      status: res.status,
      reverted: Boolean(data?.reverted),
      data,
    });
  }

  const now = data?.chainNow ?? data?.will?.chainNow ?? data?.wills?.[0]?.chainNow;
  if (now) setChainNow(now);
  return data;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body = {}) => request("POST", path, { body }),
  put: (path, body = {}) => request("PUT", path, { body }),
  del: (path) => request("DELETE", path),
  upload(path, file) {
    const form = new FormData();
    form.append("file", file);
    return request("POST", path, { form });
  },
  /** Authenticated download → triggers the browser's save dialog. */
  async download(path) {
    const res = await request("GET", path, { blob: true });
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    const filename = match ? decodeURIComponent(match[1]) : "document";
    const url = URL.createObjectURL(await res.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { filename, sha256: res.headers.get("X-Document-SHA256") };
  },
};
