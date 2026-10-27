/**
 * Restores the clean demo state captured before the presentation:
 *   - reverts the Ganache chain to the saved snapshot (contracts stay deployed, no wills)
 *   - immediately takes a new snapshot, so the reset can be repeated
 *   - restores backend/data from demo/clean-state/chainwill.db (Alice, Bob, Carol, Dave)
 *   - clears uploaded documents
 *
 * Stop the app first (Ctrl+C), then run:
 *   npm run demo:reset
 * Start it again with:
 *   npm start
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, "backend", ".env");
const env = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
const setting = (key, fallback) => {
  const match = new RegExp(`^${key}=(.*)$`, "m").exec(env);
  return match ? match[1].replace(/^"|"$/g, "") : fallback;
};

const apiPort = Number(setting("PORT", "4000"));
const rpcUrl = setting("GANACHE_RPC_URL", "http://127.0.0.1:7545");
const snapshotFile = path.join(root, "deployments", "demo-snapshot.json");
const dbBackup = path.join(root, "demo", "clean-state", "chainwill.db");
const dataDir = path.join(root, "backend", "data");
const storageDir = path.join(root, "backend", "secure-storage");

const listening = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
  });

async function rpc(method, params = []) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message || JSON.stringify(body.error));
  return body.result;
}

if (await listening(apiPort)) {
  console.error(`The ChainWill API is still running on port ${apiPort}. Stop it (Ctrl+C in its terminal) first.`);
  process.exit(1);
}
if (!fs.existsSync(snapshotFile)) {
  console.error(`No saved snapshot at ${snapshotFile}. Cannot reset the chain.`);
  process.exit(1);
}
if (!fs.existsSync(dbBackup)) {
  console.error(`No clean database at ${dbBackup}. Cannot reset the users.`);
  process.exit(1);
}

const saved = JSON.parse(fs.readFileSync(snapshotFile, "utf8"));

try {
  const reverted = await rpc("evm_revert", [saved.snapshot]);
  if (reverted !== true) throw new Error("Ganache refused to revert to the saved snapshot.");

  const snapshot = await rpc("evm_snapshot");
  const blockNumber = Number(await rpc("eth_blockNumber"));

  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(storageDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.copyFileSync(dbBackup, path.join(dataDir, "chainwill.db"));

  fs.writeFileSync(
    snapshotFile,
    JSON.stringify(
      {
        ...saved,
        snapshot,
        blockNumber,
        resetAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  console.log(`
Clean demo state restored.

  chain      block ${blockNumber} (contracts still deployed, no wills)
  database   Alice, Bob, Carol, Dave + admin
  documents  storage cleared

Start the app with:  npm start
Then open:           http://localhost:4000
`);
} catch (err) {
  console.error(`\nCould not reset: ${err.message}`);
  console.error(`
If Ganache was restarted, its snapshot is gone. Reset the Ganache workspace
(or use a fresh workspace with the same mnemonic), delete backend/data and
backend/secure-storage, run "npm run deploy", then register the demo users again.
`);
  process.exit(1);
}
