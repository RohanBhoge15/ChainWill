import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { cidV1Raw } from "../crypto.js";

const CID_PATTERN = /^[a-z0-9]{20,120}$/;

function pathOf(cid) {
  if (!CID_PATTERN.test(cid)) throw new Error("Invalid storage id");
  return path.join(config.storageDir, `${cid}.enc`);
}

/** Option A: encrypted blobs on the local filesystem, addressed by their CID. */
export const localStorage = {
  name: "local",
  async init() {
    await fs.mkdir(config.storageDir, { recursive: true });
  },
  async put(cid, blob) {
    await fs.writeFile(pathOf(cid), blob, { flag: "w" });
    return { cid, locator: `${cid}.enc` };
  },
  async get(cid) {
    return fs.readFile(pathOf(cid));
  },
  async remove(cid) {
    await fs.rm(pathOf(cid), { force: true });
  },
  /** Content id of a blob — recomputed during integrity checks. */
  async cidOf(blob) {
    return cidV1Raw(blob);
  },
  pathOf,
};
