/**
 * Starts the whole stack with one command.
 *
 *   node scripts/run.mjs start   Ganache → deploy → API serving the built UI   (http://localhost:4000)
 *   node scripts/run.mjs dev     Ganache → deploy → API (watch) + Vite dev UI  (http://localhost:5173)
 *
 * If something already answers on the RPC URL (e.g. the Ganache desktop app)
 * it is used as-is; otherwise a Ganache CLI node is started for you.
 * Ctrl+C stops everything this script started.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] === "dev" ? "dev" : "start";
const node = process.execPath;
const at = (...parts) => path.join(root, ...parts);

// ── configuration (backend/.env, overridable from the environment) ───────────────
const envFile = at("backend", ".env");
if (!fs.existsSync(envFile) || !fs.existsSync(at("backend", "node_modules")) || !fs.existsSync(at("blockchain", "node_modules"))) {
  console.error('ChainWill is not set up yet. Run "npm run setup" first.');
  process.exit(1);
}
const fileEnv = Object.fromEntries(
  fs
    .readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .map((line) => /^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line))
    .filter(Boolean)
    .map((m) => [m[1], m[2]])
);
const setting = (key, fallback) => process.env[key] || fileEnv[key] || fallback;
const rpcUrl = setting("GANACHE_RPC_URL", "http://127.0.0.1:7545");
const apiPort = setting("PORT", "4000");
const webPort = process.env.VITE_PORT || "5173";
const rpc = new URL(rpcUrl);

// ── child processes ──────────────────────────────────────────────────────────────
const children = [];
let stopping = false;
const COLORS = { chain: "\x1b[35m", api: "\x1b[36m", web: "\x1b[33m", run: "\x1b[32m" };
const say = (tag, text) => console.log(`${COLORS[tag]}[${tag}]\x1b[0m ${text}`);

function pipe(stream, tag) {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) if (line.trim()) say(tag, line);
  });
}

function start(tag, args, { cwd, env = {} }) {
  const child = spawn(node, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  pipe(child.stdout, tag);
  pipe(child.stderr, tag);
  child.on("exit", (code) => {
    if (stopping) return;
    say("run", `${tag} exited${code ? ` with code ${code}` : ""} — shutting down`);
    shutdown(code || 1);
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 1500).unref();
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// ── steps ────────────────────────────────────────────────────────────────────────
async function rpcAlive() {
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: AbortSignal.timeout(1500),
    });
    return Number((await res.json()).result);
  } catch {
    return null;
  }
}

async function ensureChain() {
  const existing = await rpcAlive();
  if (existing !== null) {
    say("run", `using the node already running at ${rpcUrl} (chain ${existing})`);
    if (existing !== 1337) throw new Error(`That node is chain ${existing}; ChainWill expects chain ID 1337.`);
    return;
  }
  if (!["127.0.0.1", "localhost"].includes(rpc.hostname)) throw new Error(`No node answers at ${rpcUrl}.`);
  say("run", `starting Ganache on ${rpcUrl}`);
  start("chain", [at("blockchain", "scripts", "ganache.js")], {
    cwd: at("blockchain"),
    env: {
      GANACHE_PORT: rpc.port || "7545",
      GANACHE_HOST: "127.0.0.1",
      GANACHE_MNEMONIC: setting("GANACHE_MNEMONIC", "") || undefined,
      GANACHE_DB_PATH: setting("GANACHE_DB_PATH", "") || undefined,
    },
  });
  for (let i = 0; i < 60; i++) {
    if ((await rpcAlive()) !== null) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Ganache did not come up within 30 seconds.");
}

function runToEnd(tag, args, cwd, env = {}) {
  const result = spawnSync(node, args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" });
  for (const line of `${result.stdout}${result.stderr}`.split(/\r?\n/)) if (line.trim()) say(tag, line);
  if (result.status !== 0) throw new Error(`${tag} step failed`);
}

try {
  await ensureChain();

  say("run", "deploying contracts (skipped if already live on this chain)");
  const deployEnv = { GANACHE_RPC_URL: rpcUrl };
  const deployMnemonic = setting("GANACHE_MNEMONIC", "");
  if (deployMnemonic) deployEnv.GANACHE_MNEMONIC = deployMnemonic;
  runToEnd("chain", [at("blockchain", "node_modules", "hardhat", "internal", "cli", "bootstrap.js"), "run", "scripts/deploy.js", "--network", "ganache"], at("blockchain"), deployEnv);

  const vite = at("frontend", "node_modules", "vite", "bin", "vite.js");
  if (mode === "start") {
    const built = fs.existsSync(at("frontend", "dist", "index.html"));
    if (!built || process.argv.includes("--build")) {
      say("run", "building the frontend");
      runToEnd("web", [vite, "build"], at("frontend"));
    }
    start("api", [at("backend", "src", "server.js")], { cwd: at("backend") });
    setTimeout(() => !stopping && say("run", `\x1b[1mChainWill is ready → http://localhost:${apiPort}\x1b[0m   (Ctrl+C to stop)`), 2500);
  } else {
    start("api", ["--watch", at("backend", "src", "server.js")], { cwd: at("backend") });
    start("web", [vite], { cwd: at("frontend"), env: { VITE_API_TARGET: `http://127.0.0.1:${apiPort}`, VITE_PORT: webPort } });
    setTimeout(() => !stopping && say("run", `\x1b[1mChainWill (dev) is ready → http://localhost:${webPort}\x1b[0m   (Ctrl+C to stop)`), 3500);
  }
} catch (err) {
  say("run", `\x1b[31m${err.message}\x1b[0m`);
  shutdown(1);
}
