import { config } from "../config.js";

const api = (route, query = "") => `${config.ipfsApiUrl.replace(/\/$/, "")}/api/v0/${route}${query}`;

async function rpc(route, query, init) {
  const res = await fetch(api(route, query), { method: "POST", ...init });
  if (!res.ok) throw new Error(`IPFS ${route} failed: ${res.status} ${await res.text()}`);
  return res;
}

/**
 * Option B: a local IPFS (Kubo) daemon, via its HTTP RPC API. Same interface as
 * the local driver — only the storage layer changes. The blob is already
 * encrypted before it gets here, so nothing readable is ever published.
 */
export const ipfsStorage = {
  name: "ipfs",
  async init() {
    const res = await rpc("id", "");
    const { ID } = await res.json();
    console.log(`[storage] connected to IPFS node ${ID}`);
  },
  async put(_localCid, blob) {
    const form = new FormData();
    form.append("file", new Blob([blob]), "blob.enc");
    const res = await rpc("add", "?cid-version=1&raw-leaves=true&pin=true", { body: form });
    const { Hash } = await res.json();
    return { cid: Hash, locator: `ipfs://${Hash}` };
  },
  async get(cid) {
    const res = await rpc("cat", `?arg=${encodeURIComponent(cid)}`);
    return Buffer.from(await res.arrayBuffer());
  },
  async remove(cid) {
    await rpc("pin/rm", `?arg=${encodeURIComponent(cid)}`).catch(() => {});
  },
  async cidOf(blob) {
    const form = new FormData();
    form.append("file", new Blob([blob]), "blob.enc");
    const res = await rpc("add", "?cid-version=1&raw-leaves=true&only-hash=true", { body: form });
    return (await res.json()).Hash;
  },
};
