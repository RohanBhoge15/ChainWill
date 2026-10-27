import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_ROOT = path.resolve(__dirname, "..");
export const REPO_ROOT = path.resolve(BACKEND_ROOT, "..");

dotenv.config({ path: path.join(BACKEND_ROOT, ".env"), quiet: true });

const env = process.env;
const fromBackend = (p) => (path.isAbsolute(p) ? p : path.resolve(BACKEND_ROOT, p));
const bool = (v, fallback) => (v === undefined || v === "" ? fallback : /^(1|true|yes|on)$/i.test(v));
const int = (v, fallback) => (Number.isFinite(Number(v)) && v !== "" && v !== undefined ? Number(v) : fallback);
const list = (v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

function required(name) {
  const value = env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Run "npm run setup" in the project root to generate backend/.env (or copy backend/.env.example).`
    );
  }
  return value;
}

const serverEncryptionKey = Buffer.from(required("SERVER_ENCRYPTION_KEY"), "hex");
if (serverEncryptionKey.length !== 32) {
  throw new Error("SERVER_ENCRYPTION_KEY must be 32 bytes (64 hex characters).");
}

const port = int(env.PORT, 4000);

export const config = {
  port,
  host: env.HOST || "127.0.0.1",
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: env.JWT_EXPIRES_IN || "12h",
  serverEncryptionKey,

  rpcUrl: env.GANACHE_RPC_URL || "http://127.0.0.1:7545",
  chainId: int(env.CHAIN_ID, 1337),
  mnemonic: env.GANACHE_MNEMONIC || "myth like bonus scare over problem client lizard pioneer submit female collect",
  deploymentFile: fromBackend(env.DEPLOYMENT_FILE || "../deployments/ganache.json"),
  contractAddressOverride: env.CHAINWILL_CONTRACT_ADDRESS || "",

  dbFile: fromBackend(env.DB_FILE || "data/chainwill.db"),
  storageDriver: (env.STORAGE_DRIVER || "local").toLowerCase(), // local | ipfs
  storageDir: fromBackend(env.STORAGE_DIR || "secure-storage"),
  ipfsApiUrl: env.IPFS_API_URL || "http://127.0.0.1:5001",
  maxUploadBytes: int(env.MAX_UPLOAD_MB, 10) * 1024 * 1024,

  vapidPublicKey: env.VAPID_PUBLIC_KEY || "",
  vapidPrivateKey: env.VAPID_PRIVATE_KEY || "",
  webPushContact: env.WEB_PUSH_CONTACT || "mailto:admin@chainwill.local",
  pushExtraHosts: list(env.PUSH_EXTRA_HOSTS), // additional allowed push-service hostnames

  smtp: {
    host: env.SMTP_HOST || "",
    port: int(env.SMTP_PORT, 587),
    user: env.SMTP_USER || "",
    pass: env.SMTP_PASS || "",
    from: env.SMTP_FROM || "ChainWill <no-reply@chainwill.local>",
  },

  adminEmail: env.ADMIN_EMAIL || "",
  adminPassword: env.ADMIN_PASSWORD || "",

  corsOrigins: list(env.CORS_ORIGINS).length
    ? list(env.CORS_ORIGINS)
    : [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        `http://localhost:${port}`,
        `http://127.0.0.1:${port}`,
      ],

  // Fast-forwarding the local chain clock. A demo convenience, never for a real network.
  demoTools: bool(env.ENABLE_DEMO_TOOLS, true),
  schedulerSeconds: Math.min(Math.max(int(env.SCHEDULER_SECONDS, 2), 1), 59),
  indexerPollMs: int(env.INDEXER_POLL_MS, 2000),
  authRateLimitMax: int(env.AUTH_RATE_LIMIT_MAX, 20),
  apiRateLimitMax: int(env.API_RATE_LIMIT_MAX, 3000),

  frontendDist: fromBackend(env.FRONTEND_DIST || "../frontend/dist"),
};
