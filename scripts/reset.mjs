/**
 * Wipes all local demo state so the next start is a clean slate:
 *   .chain/                   Ganache's persisted blockchain
 *   deployments/ganache.json  contract addresses of that chain
 *   backend/data/             SQLite database (users, caches, notifications)
 *   backend/secure-storage/   encrypted documents
 * Secrets in backend/.env are kept. Stop the app before running this.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targets = [".chain", "deployments/ganache.json", "backend/data", "backend/secure-storage"];

const listening = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
  });

const envFile = path.join(root, "backend", ".env");
const env = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
const apiPort = Number(/^PORT=(\d+)/m.exec(env)?.[1] ?? 4000);

if ((await listening(apiPort)) && !process.argv.includes("--force")) {
  console.error(`The ChainWill API is still running on port ${apiPort}. Stop it (Ctrl+C) first, or pass --force.`);
  process.exit(1);
}

for (const target of targets) {
  const full = path.join(root, target);
  if (fs.existsSync(full)) {
    fs.rmSync(full, { recursive: true, force: true });
    console.log(`removed ${target}`);
  }
}
console.log(
  "\nDemo state cleared. If you run your own Ganache (desktop app), restart or reset it too.\n" +
    "MetaMask users: Settings → Advanced → Clear activity tab data, so its nonce matches the new chain."
);
