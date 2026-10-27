import { config } from "../config.js";
import { localStorage } from "./local.js";
import { ipfsStorage } from "./ipfs.js";

const drivers = { local: localStorage, ipfs: ipfsStorage };

export const storage = drivers[config.storageDriver];
if (!storage) {
  throw new Error(`Unknown STORAGE_DRIVER "${config.storageDriver}" (expected "local" or "ipfs")`);
}
