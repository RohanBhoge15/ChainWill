import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });

export const db = new Database(config.dbFile);
try {
  db.pragma("journal_mode = WAL"); // concurrent reads while writing
} catch {
  // some network / synced folders cannot back WAL's shared memory; the default journal still works
  db.pragma("journal_mode = DELETE");
}
db.pragma("foreign_keys = ON");

// Idempotent DDL, run on every boot — no migration tool needed for a demo.
// Addresses are stored lowercase everywhere so plain equality works.
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT    NOT NULL,
  email              TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash      TEXT    NOT NULL,              -- bcrypt
  role               TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  wallet_address     TEXT    UNIQUE,                -- active on-chain identity (0x…, lowercase)
  wallet_mode        TEXT    NOT NULL DEFAULT 'demo'
                             CHECK (wallet_mode IN ('metamask','demo')),
  demo_address       TEXT    UNIQUE,                -- backend-managed wallet, kept while MetaMask is linked
  encrypted_privkey  TEXT,                          -- AES-256-GCM, only for demo wallets
  privkey_iv         TEXT,
  privkey_tag        TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Ganache account slot (0-9) held by a user, so a pre-funded account is never handed out twice
CREATE TABLE IF NOT EXISTS demo_wallet_slots (
  slot     INTEGER PRIMARY KEY CHECK (slot BETWEEN 0 AND 9),
  user_id  INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  address  TEXT    NOT NULL UNIQUE
);

-- Pure cache/mirror of the chain for fast reverse lookups ("which wills name me?")
CREATE TABLE IF NOT EXISTS wills_cache (
  will_id              TEXT PRIMARY KEY,             -- owner address (one will per owner)
  owner_address        TEXT NOT NULL UNIQUE,
  executor_address     TEXT NOT NULL,
  contract_address     TEXT,
  checkin_interval     INTEGER NOT NULL,
  grace_period         INTEGER NOT NULL,
  last_checkin_at      INTEGER,
  created_at_chain     INTEGER,
  activated_at_chain   INTEGER,
  total_percentage     INTEGER NOT NULL DEFAULT 0,
  eth_escrow           TEXT NOT NULL DEFAULT '0',
  last_synced_status   TEXT,                         -- ACTIVE | ELIGIBLE | ACTIVATED | REVOKED
  last_synced_phase    TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wills_executor ON wills_cache(executor_address);

CREATE TABLE IF NOT EXISTS beneficiaries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  will_id        TEXT NOT NULL REFERENCES wills_cache(will_id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  percentage     INTEGER NOT NULL CHECK (percentage BETWEEN 1 AND 100),
  has_claimed    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (will_id, wallet_address)
);
CREATE INDEX IF NOT EXISTS idx_benef_wallet ON beneficiaries(wallet_address);

CREATE TABLE IF NOT EXISTS assets_cache (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  will_id        TEXT NOT NULL REFERENCES wills_cache(will_id) ON DELETE CASCADE,
  asset_index    INTEGER NOT NULL,
  asset_type     TEXT NOT NULL CHECK (asset_type IN ('ETH','ERC20','ERC721','DOCUMENT')),
  token_address  TEXT,
  amount_or_id   TEXT,
  doc_hash       TEXT,                               -- sha256 (hex) committed on-chain
  storage_cid    TEXT,
  assigned_to    TEXT,                               -- ERC721/DOCUMENT only: the ONE inheriting beneficiary
  is_claimed     INTEGER NOT NULL DEFAULT 0,
  removed        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (will_id, asset_index)
);
-- fungible assets (ETH/ERC20) have NULL assigned_to: they are split by percentage.
-- whole assets (ERC721/DOCUMENT) MUST have assigned_to set to a beneficiary of the will.
CREATE TRIGGER IF NOT EXISTS assets_whole_assigned
BEFORE INSERT ON assets_cache
WHEN NEW.asset_type IN ('ERC721','DOCUMENT') AND NEW.assigned_to IS NULL
BEGIN
  SELECT RAISE(ABORT, 'ERC721/DOCUMENT assets require assigned_to');
END;

-- Off-chain, human-friendly labels for a will (never trusted for anything)
CREATE TABLE IF NOT EXISTS will_meta (
  owner_address TEXT PRIMARY KEY,
  title         TEXT,
  note          TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  owner_address  TEXT NOT NULL,                      -- will owner the document belongs to
  asset_index    INTEGER,                            -- set once AssetRegistered is seen on-chain
  original_name  TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,
  encrypted_path TEXT NOT NULL,                      -- storage locator of the AES-256-GCM blob
  sha256_hash    TEXT NOT NULL,                      -- hash of the PLAINTEXT file
  cid            TEXT NOT NULL,                      -- content id of the ENCRYPTED blob
  key_enc        TEXT NOT NULL,                      -- per-document key, wrapped with the server key
  key_iv         TEXT NOT NULL,
  key_tag        TEXT NOT NULL,
  uploaded_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_docs_owner ON documents(owner_address);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,   -- CHECKIN_WARN | GRACE_START | GRACE_WARN | ELIGIBLE | ACTIVATED | CLAIMED | DOC_UNLOCKED | ...
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  link       TEXT,
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read, created_at DESC);

-- Guarantees each timed alert fires once per check-in cycle
CREATE TABLE IF NOT EXISTS notification_log (
  dedupe_key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS push_subscriptions (   -- one row per browser/device
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every contract event, indexed for the Explorer page
CREATE TABLE IF NOT EXISTS chain_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  block_number  INTEGER NOT NULL,
  tx_hash       TEXT NOT NULL,
  log_index     INTEGER NOT NULL,
  contract      TEXT NOT NULL,                       -- WillManager | DemoToken | DemoNFT
  event_name    TEXT NOT NULL,
  will_owner    TEXT,                                -- the will this event belongs to (WillManager events)
  tx_from       TEXT,
  args_json     TEXT NOT NULL,
  addresses     TEXT NOT NULL,                       -- space-separated lowercase addresses, for filtering
  gas_used      TEXT,
  timestamp     INTEGER NOT NULL,
  UNIQUE (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_events_block ON chain_events(block_number DESC, log_index DESC);
CREATE INDEX IF NOT EXISTS idx_events_owner ON chain_events(will_owner);
CREATE INDEX IF NOT EXISTS idx_events_name  ON chain_events(event_name);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

export const meta = {
  get(key, fallback = null) {
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
    return row ? row.value : fallback;
  },
  set(key, value) {
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
      key,
      String(value)
    );
  },
};

/** Drop everything mirrored from the chain (used when the local chain was reset). */
export function wipeChainDerivedData() {
  db.transaction(() => {
    db.exec(`
      DELETE FROM chain_events;
      DELETE FROM assets_cache;
      DELETE FROM beneficiaries;
      DELETE FROM wills_cache;
      DELETE FROM will_meta;
      DELETE FROM notification_log;
      DELETE FROM notifications;
      UPDATE documents SET asset_index = NULL;
      DELETE FROM meta WHERE key IN ('indexer_cursor');
    `);
  })();
}
