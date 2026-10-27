/**
 * Starts the local Ganache chain ChainWill runs against.
 *
 *   RPC      http://127.0.0.1:7545
 *   chainId  1337
 *   accounts 10 deterministic accounts, 100 ETH each
 *
 * Chain state is persisted under ../.chain so wills survive a restart of the
 * node. Wipe it (together with the backend DB) with `npm run reset`.
 */
const path = require("path");
const fs = require("fs");

// Ganache 7 ships a native websocket addon built for older Node versions. On
// newer Node it falls back to pure JS (which is fine for a local demo) but
// prints a scary multi-line warning first — swallow just that message.
const realWarn = console.warn;
console.warn = (...args) => {
  if (!/µWS|uws_|Falling back to a NodeJS implementation/.test(args.map(String).join(" "))) realWarn(...args);
};
const ganache = require("ganache");
console.warn = realWarn;

const HOST = process.env.GANACHE_HOST || "127.0.0.1";
const PORT = Number(process.env.GANACHE_PORT || 7545);
const MNEMONIC =
  process.env.GANACHE_MNEMONIC || "myth like bonus scare over problem client lizard pioneer submit female collect";
const DB_PATH = process.env.GANACHE_DB_PATH || path.resolve(__dirname, "..", "..", ".chain");
const EPHEMERAL = process.argv.includes("--ephemeral");
const VERBOSE = process.argv.includes("--verbose");

if (!EPHEMERAL) fs.mkdirSync(DB_PATH, { recursive: true });

const server = ganache.server({
  wallet: { mnemonic: MNEMONIC, totalAccounts: 10, defaultBalance: 100 },
  chain: { chainId: 1337, networkId: 1337, hardfork: "shanghai" },
  miner: { blockGasLimit: 30_000_000 },
  database: EPHEMERAL ? {} : { dbPath: DB_PATH },
  logging: { quiet: !VERBOSE },
});

server.listen(PORT, HOST, async (err) => {
  if (err) {
    console.error(`[ganache] failed to start on ${HOST}:${PORT} — ${err.message}`);
    process.exit(1);
  }
  const accounts = server.provider.getInitialAccounts();
  console.log(`[ganache] RPC listening on http://${HOST}:${PORT}  (chainId 1337)`);
  console.log(`[ganache] state: ${EPHEMERAL ? "in-memory (ephemeral)" : DB_PATH}`);
  console.log("[ganache] accounts (import a private key into MetaMask for MetaMask Mode):");
  Object.entries(accounts).forEach(([address, { secretKey }], i) => {
    console.log(`  (${i}) ${address}  ${secretKey}`);
  });
});

async function shutdown() {
  try {
    await server.close();
  } finally {
    process.exit(0);
  }
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
