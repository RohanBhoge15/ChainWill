import bcrypt from "bcryptjs";
import { config } from "./config.js";
import { db, meta, wipeChainDerivedData } from "./db.js";
import { provider, manifest, addresses, clock, ganacheAddresses } from "./chain.js";
import { storage } from "./storage/index.js";
import { createApp } from "./app.js";
import { syncNow, startIndexer, stopIndexer } from "./indexer.js";
import { startScheduler, stopScheduler } from "./scheduler.js";
import { pushEnabled } from "./notify.js";

function fail(message) {
  console.error(`\n[chainwill] ${message}\n`);
  process.exit(1);
}

async function checkChain() {
  let network;
  try {
    network = await provider.send("eth_chainId", []);
  } catch {
    fail(`Cannot reach the blockchain node at ${config.rpcUrl}. Start Ganache first (npm run chain).`);
  }
  if (Number(network) !== manifest.chainId) {
    fail(`Node at ${config.rpcUrl} is chain ${Number(network)}, but the contracts were deployed to chain ${manifest.chainId}.`);
  }
  for (const [name, address] of Object.entries(addresses)) {
    if ((await provider.getCode(address)) === "0x") {
      fail(`${name} is not deployed at ${address} on this chain. Run "npm run deploy" in the project root.`);
    }
  }

  // The same addresses reappear after a chain reset, so identify the chain by
  // the hash of the block the contracts were deployed in.
  const fingerprint = (await provider.getBlock(manifest.deployBlock)).hash;
  const known = meta.get("chain_fingerprint");
  if (known && known !== fingerprint) {
    console.warn("[chainwill] the local chain was reset — clearing cached wills, events and notifications");
    wipeChainDerivedData();
  }
  meta.set("chain_fingerprint", fingerprint);

  const nodeAccounts = (await provider.send("eth_accounts", []).catch(() => [])).map((a) => a.toLowerCase());
  if (nodeAccounts.length && !nodeAccounts.includes(ganacheAddresses[1])) {
    console.warn(
      "[chainwill] WARNING: GANACHE_MNEMONIC does not match the node's accounts — demo wallets will be unfunded. " +
        "Start Ganache with the mnemonic from backend/.env."
    );
  }
}

/** The admin account comes from .env; it has no wallet and can only read. */
function seedAdmin() {
  if (!config.adminEmail || !config.adminPassword) return;
  const existing = db.prepare("SELECT id, role FROM users WHERE email = ?").get(config.adminEmail);
  if (existing) {
    if (existing.role !== "admin") db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(existing.id);
    return;
  }
  db.prepare("INSERT INTO users (name, email, password_hash, role, wallet_mode) VALUES (?, ?, ?, 'admin', 'demo')").run(
    "Administrator",
    config.adminEmail,
    bcrypt.hashSync(config.adminPassword, 10)
  );
  console.log(`[chainwill] admin account ready: ${config.adminEmail} (password: ADMIN_PASSWORD in backend/.env)`);
}

async function main() {
  await checkChain();
  await clock.sync();
  await storage.init();
  seedAdmin();

  const indexed = await syncNow();
  startIndexer();
  startScheduler();

  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    console.log(`[chainwill] API listening on http://${config.host}:${config.port}`);
    console.log(`[chainwill] chain ${manifest.chainId} @ ${config.rpcUrl} — WillManager ${addresses.WillManager}`);
    console.log(
      `[chainwill] indexed ${indexed} new event(s); storage=${storage.name}; push=${pushEnabled ? "on" : "off (no VAPID keys)"}` +
        (clock.offset ? `; chain clock is ${clock.offset}s ahead of wall time` : "")
    );
  });
  server.on("error", (err) => fail(err.code === "EADDRINUSE" ? `Port ${config.port} is already in use.` : err.message));

  const shutdown = () => {
    stopIndexer();
    stopScheduler();
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => fail(err.stack || err.message));
