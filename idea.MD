# 🔐 ChainWill — Decentralized Digital Will & Inheritance DApp (Ganache Edition)

Here's a complete, demo-ready design tailored for **2 developers**, **local Ganache**, and a **college blockchain subject** — while still looking and feeling like a real product (proper auth, dashboards, notifications, PWA).

---

## 1. Core Concept

A hybrid Web2 + Web3 system:
- **Web2 layer** (Express + DB) → handles login/registration, notifications, file storage, UX convenience.
- **Web3 layer** (Solidity + Ganache) → handles the *actual trust logic*: who owns what, who inherits what, check-ins, claims. Nothing important can be faked here even though the backend is centralized.

This combo is exactly what examiners like — you can explain *why* each layer exists.

---

## 2. Wallet Strategy (your flexibility point)

Since it's local-only, support **two login paths** so you can demo both "real" and "simplified" UX:

| Mode | How it works |
|---|---|
| **MetaMask Mode** | User connects MetaMask pointed to Ganache RPC (`http://127.0.0.1:7545`, chainId 1337). Good for showing real wallet signing. |
| **Demo Wallet Mode** | On registration, backend auto-assigns one of Ganache's 10 pre-funded accounts to the user (private key encrypted & stored server-side, signing done via `ethers.Wallet`). Good for fast demos without asking everyone to install MetaMask. |

Both produce an **Ethereum address**, which is the real identity on-chain. Your login system (email/password + JWT) is the **off-chain human identity**, mapped 1-to-1 to that address. This satisfies "proper registration/login" while keeping blockchain as source of truth for assets.

---

## 3. Roles

- **Owner (Testator)** – creates the will
- **Executor** – triggers inheritance activation after deadline+grace expires
- **Beneficiary** – claims assets after activation
- **Admin (you, for demo)** – read-only transparency dashboard

A single user can hold multiple roles across different wills (e.g., Bob is executor for Alice's will and owner of his own).

---

## 4. Will Lifecycle (State Machine)

```
CREATED ──checkIn()──► ACTIVE
ACTIVE ──(time > lastCheckIn+interval)──► MISSED (soft state, push notif sent)
MISSED ──(time > interval+grace)──► ELIGIBLE_FOR_INHERITANCE
ELIGIBLE ──executor calls activateInheritance()──► ACTIVATED
ACTIVATED ──beneficiary calls claimInheritance()──► PARTIALLY_CLAIMED → FULLY_CLAIMED   [fungible: ETH/ERC20]
ACTIVATED ──beneficiary calls claimAsset(i)──► each NFT/document claimed once, whole     [whole: ERC721/DOCUMENT]
(ACTIVE) ──owner calls checkIn() anytime──► resets timer back to ACTIVE
(ACTIVE) ──owner calls revokeWill()──► REVOKED
```

Important: the contract **never decides someone is "dead"** — it only tracks *time since last proof-of-life*. The executor is the human trust point who actually pulls the trigger. This is the honest framing to put in your report.

**Reading the diagram vs. the enum:** `MISSED` and `PARTIALLY_CLAIMED` are **soft/derived states** — they are never written to storage. The contract stores only the four `Status` enum values (`ACTIVE`, `ELIGIBLE`, `ACTIVATED`, `REVOKED`) plus the `activated` / `isClaimed` / `hasClaimed` booleans. `getStatus()` derives `MISSED` from `block.timestamp` and the UI derives `PARTIALLY_CLAIMED` from those booleans. `CREATED` is simply `ACTIVE` with `lastCheckIn == block.timestamp`. Keep this distinction in your report — it's a real design answer, not a hand-wave.

---

## 5. Smart Contract Design

Single manager contract (simplest for a 2-person team, cheap gas on local Ganache anyway):

```solidity
// WillManager.sol
enum Status { ACTIVE, ELIGIBLE, ACTIVATED, REVOKED }
enum AssetType { ETH, ERC20, ERC721, DOCUMENT }

struct Beneficiary {
    address wallet;
    uint8 percentage;     // share of FUNGIBLE assets only (ETH/ERC20); sum must be <=100
    bool hasClaimed;      // set when beneficiary claims their fungible share
}

struct Asset {
    AssetType assetType;
    address tokenAddress; // 0x0 for ETH/doc
    uint256 amountOrId;   // amount for ETH/ERC20, tokenId for NFT, 0 for doc
    string docHash;        // sha256 hash
    string storageCID;     // IPFS/local-storage pointer
    address assignedTo;    // ERC721/DOCUMENT: the ONE beneficiary who inherits it whole
    bool isClaimed;
}

struct Will {
    address owner;
    address executor;
    uint256 lastCheckIn;
    uint256 checkInInterval;  // e.g. 120 seconds for demo
    uint256 gracePeriod;      // e.g. 60 seconds for demo
    Status status;
    Beneficiary[] beneficiaries;
    Asset[] assets;
    uint16 totalPercentage;
    bool activated;
}

mapping(address => Will) public wills;         // ownerAddress => Will (one active will per owner)
mapping(address => uint256) public ethEscrow;  // ETH deposited for a will

event WillCreated(address owner, address executor);
event BeneficiaryAdded(address owner, address beneficiary, uint8 pct);
event BeneficiaryRemoved(address owner, address beneficiary, uint8 pct);
event AssetRegistered(address owner, AssetType t, string docHash, address assignedTo);
event CheckInPerformed(address owner, uint256 timestamp);
event InheritanceActivated(address owner, address executor, uint256 timestamp);
event AssetClaimed(address owner, address beneficiary, uint256 amount);
event AssetAssigned(address owner, address beneficiary, uint256 assetIndex);
event WillRevoked(address owner);

function createWill(address executor, uint interval, uint grace) external;
function addBeneficiary(address wallet, uint8 pct) external onlyOwnerOfWill;
function removeBeneficiary(address wallet) external onlyOwnerOfWill;   // frees up % so typos are fixable
function registerFungibleAsset(AssetType t, address token, uint256 amount) external payable onlyOwnerOfWill;
function registerWholeAsset(AssetType t, address token, uint256 amountOrId, string calldata hash, string calldata cid, address assignedTo) external onlyOwnerOfWill; // ERC721 + DOCUMENT
function checkIn() external onlyOwnerOfWill;
function getStatus(address owner) public view returns (Status); // computed from timestamps
function activateInheritance(address owner) external onlyExecutor(owner);
function claimInheritance(address owner) external nonReentrant onlyBeneficiary(owner);
function claimAsset(address owner, uint256 assetIndex) external nonReentrant;
function revokeWill() external onlyOwnerOfWill;
```

### 5.1 Two asset models — don't split NFTs by percentage

You cannot give Carol "60% of the property deed NFT", and "40% of `property_papers.pdf`" is meaningless. So the contract uses **two claim paths**, chosen by asset type:

| Asset type | Division | Claim function | What the beneficiary gets |
|---|---|---|---|
| `ETH` | **Percentage** | `claimInheritance()` | `ethEscrow[owner] * pct / 100` |
| `ERC20` | **Percentage** | `claimInheritance()` | `DemoToken.balanceOf * pct / 100` (whole tokens, dust stays in escrow) |
| `ERC721` | **Whole, pre-assigned** | `claimAsset(i)` | the single `transferFrom` — `assignedTo` must be a beneficiary |
| `DOCUMENT` | **Whole, pre-assigned** | `claimAsset(i)` | on-chain flag set → **backend** releases the decrypted file |

Practical consequences:
- The Create-Will wizard asks for a **percentage** only for ETH/ERC20, and a **dropdown of beneficiaries** for each NFT/document.
- `registerWholeAsset` must `require(IERC721(token).ownerOf(tokenId) == msg.sender)` so the owner can't assign an NFT they don't hold, and must `require(will.beneficiaries contains assignedTo)`.
- `claimAsset` transfers the NFT with `safeTransferFrom` and sets `isClaimed = true` **before** the transfer (checks-effects-interactions) → double-claim is impossible even on the NFT path.
- Documents have no on-chain bytes; the contract only flips a flag and emits `AssetClaimed`. The backend re-checks that flag before decrypting anything.
- Any ETH/ERC20 left unclaimed (sum < 100%) stays escrowed — state it explicitly in the report rather than pretending 100% is guaranteed.

Use **OpenZeppelin**: `ReentrancyGuard`, `AccessControl` (optional), plus your own `DemoToken.sol` (ERC20) and `DemoNFT.sol` (ERC721) to mint "fake inheritance assets" (test coins, property NFT, car NFT) for the demo.

Key rules enforced on-chain (great for your security demo section):
- `require(totalPercentage + pct <= 100)` on add — and `removeBeneficiary` decrements `totalPercentage`, so a wrong percentage is always correctable
- `require(totalPercentage > 0)` before activation (a will with no beneficiaries can't be activated)
- `require(!beneficiary.hasClaimed)` → blocks double-claim on the fungible path
- `require(!asset.isClaimed && asset.assignedTo == msg.sender)` → blocks double-claim on the NFT/document path
- `require(msg.sender == will.executor)` → blocks random activation
- `require(getStatus(owner) == Status.ELIGIBLE)` before activation
- `nonReentrant` on both claim functions
- `revokeWill` sets `Status.REVOKED` and returns escrow ETH to the owner (only allowed while `status == ACTIVE`)

---

## 6. Documents & "Decentralized" Storage

Since a full IPFS network is overkill for 2 people:

- **Option A (recommended, fast):** Backend encrypts uploaded file (AES-256), stores it in `/secure-storage/`, computes SHA-256 hash, and generates a mock CID. Hash + CID get written to the contract via `registerAsset(DOCUMENT, ...)`.
- **Option B (bonus points):** Run a **local IPFS daemon** (`ipfs init && ipfs daemon` or `kubo`), push encrypted file there, get a real CID, store CID on-chain. Same code either way — only the storage layer changes. Mention in the report you designed it to be swappable.

**Tamper-detection demo feature:** "Verify Document" button re-hashes the stored file and compares to on-chain hash → green check or red "MODIFIED!" warning. Great visual for examiners.

**Access control on documents:** a document is a **whole, pre-assigned** asset (see §5.1) — it does *not* split by percentage. The beneficiary must call `claimAsset(i)` on-chain, which sets that asset's `isClaimed` flag. The decryption key is released by the backend API only after it reads `isClaimed == true` for **that specific asset** and `assignedTo == requesting user` — a plain `claimInheritance()` on ETH does **not** unlock any document.

---

## 7. Notifications (PWA)

- Service worker + **Web Push API** (`web-push` npm package) for real OS-level push notifications even when the tab is closed.
- `node-cron` job runs every N seconds on the backend, checks each will's computed `getStatus()`:
  - **T-minus warning:** "⏰ Please check in, X minutes left"
  - **Missed deadline:** "⚠️ Grace period started" → to owner + executor
  - **Grace about to expire:** "🚨 Will becomes eligible for inheritance in X minutes"
  - **Activated:** "💰 You can now claim your inheritance" → to beneficiaries
  - **Claim success:** confirmation to claimant
- Add email fallback with Nodemailer (optional, nice extra).
- In-app **Notification Bell** showing history too, in case push permission is denied.

For demo purposes, set `checkInInterval = 2 minutes`, `gracePeriod = 1 minute` so the whole lifecycle can be shown live in under 5 minutes instead of waiting 30 real days.

---

## 8. Off-chain Database (SQLite — zero-setup, file-based)

**Decision: SQLite, no MongoDB.** SQLite is a single `.db` file (e.g. `backend/data/chainwill.db`), needs no server/service, no admin, no `mongod` daemon to keep alive, and the whole DB can be committed/deleted/wiped in one step between demo runs — ideal for a 2-person local demo. It also removes a whole class of "is my database running?" viva-day risk.

**Recommended driver: `better-sqlite3`** (synchronous API, fast, mature, ships prebuilt Windows binaries so no MSVC compile needed). Zero-install alternative: Node 22's built-in `node:sqlite` (needs `--experimental-sqlite` on Node 22.x) — same SQL, no npm dependency at all.

### Schema (SQLite / SQL DDL)

```sql
PRAGMA journal_mode = WAL;        -- concurrent reads while writing
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT    NOT NULL,
  email              TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash      TEXT    NOT NULL,              -- bcrypt
  wallet_address     TEXT    UNIQUE,                 -- 0x… (Ethereum address = real identity)
  wallet_mode        TEXT    NOT NULL DEFAULT 'demo'
                             CHECK (wallet_mode IN ('metamask','demo')),
  encrypted_privkey  TEXT,                           -- AES-256-GCM, only for demo wallets
  privkey_iv         TEXT,
  push_subscription  TEXT,                           -- JSON blob from Web Push API
  created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Ganache account slot assigned to a demo user (0-9), so we never reuse one
CREATE TABLE demo_wallet_slots (
  slot        INTEGER PRIMARY KEY CHECK (slot BETWEEN 0 AND 9),
  user_id     INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  privkey_enc TEXT    NOT NULL,
  iv          TEXT    NOT NULL,
  tag         TEXT    NOT NULL
);

-- Pure cache/mirror of the chain for fast UI rendering
CREATE TABLE wills_cache (
  will_id              TEXT PRIMARY KEY,             -- keccak256(owner) or sequential id
  owner_address        TEXT NOT NULL UNIQUE,
  owner_user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  executor_address     TEXT NOT NULL,
  contract_address     TEXT,
  checkin_interval     INTEGER NOT NULL,
  grace_period         INTEGER NOT NULL,
  last_checkin_at      INTEGER,
  last_synced_status   TEXT,                         -- ACTIVE | ELIGIBLE | ACTIVATED | REVOKED
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE beneficiaries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  will_id        TEXT NOT NULL REFERENCES wills_cache(will_id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  percentage     INTEGER NOT NULL CHECK (percentage BETWEEN 1 AND 100),
  has_claimed    INTEGER NOT NULL DEFAULT 0,
  claimed_at     TEXT,
  UNIQUE (will_id, wallet_address)
);

CREATE TABLE assets_cache (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  will_id        TEXT NOT NULL REFERENCES wills_cache(will_id) ON DELETE CASCADE,
  asset_type     TEXT NOT NULL CHECK (asset_type IN ('ETH','ERC20','ERC721','DOCUMENT')),
  token_address  TEXT,
  amount_or_id   TEXT,
  doc_hash       TEXT,                               -- sha256 (hex) committed on-chain
  storage_cid    TEXT,
  assigned_to    TEXT,                               -- ERC721/DOCUMENT only: the ONE inheriting beneficiary
  is_claimed     INTEGER NOT NULL DEFAULT 0,
  tx_hash        TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
-- fungible assets (ETH/ERC20) have NULL assigned_to: they're split by percentage.
-- whole assets (ERC721/DOCUMENT) MUST have assigned_to set to a beneficiary of the will.
CREATE TABLE trigger assets_whole_assigned
BEFORE INSERT ON assets_cache
WHEN NEW.asset_type IN ('ERC721','DOCUMENT') AND NEW.assigned_to IS NULL
BEGIN
  SELECT RAISE(ABORT, 'ERC721/DOCUMENT assets require assigned_to');
END;

CREATE TABLE documents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  will_id       TEXT NOT NULL REFERENCES wills_cache(will_id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  encrypted_path TEXT NOT NULL,                      -- AES-256 encrypted blob on disk
  sha256_hash   TEXT NOT NULL,                       -- hash of the PLAINTEXT file
  cid           TEXT,                                -- mock CID (or real IPFS CID, Option B)
  uploaded_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,                          -- CHECKIN_WARN | GRACE_START | ELIGIBLE | ACTIVATED | CLAIMED | DOC_UNLOCKED
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notif_user ON notifications(user_id, read, created_at DESC);
CREATE INDEX idx_docs_will  ON documents(will_id);

CREATE TABLE push_subscriptions (   -- one row per browser/device
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### How it's wired in the backend

- One `db.js` module opens `data/chainwill.db`, runs the DDL above on boot (idempotent `CREATE TABLE IF NOT EXISTS`) — no migration tool needed for a demo.
- `node-cron` job writes/refreshes `wills_cache` + reads chain `getStatus()`; the dashboards read SQLite for speed but **all claims and activations are re-validated against the live contract** before anything irreversible happens.
- Document release: backend calls `hasClaimed(owner, beneficiary)` on-chain; only if true does it read the AES key and stream the decrypted file.
- DB reset for a clean demo: stop the server, delete `backend/data/chainwill.db*` — one command.

This DB is just a **performance/UX cache + auth layer** — never trust it alone. Good talking point for "why hybrid" in your viva.

---

## 9. UI Pages (so everything is visible, as you asked)

1. **Landing Page** – Register / Login (email+password), choose wallet mode
2. **Owner Dashboard** – wallet address, QR-ish address badge, will status chip (color-coded), countdown to next check-in, big "✅ I'm Alive – Check In" button, beneficiary list with %, asset list (ETH/tokens/NFT/docs), "Create/Edit Will" wizard
3. **Create Will Wizard** – multi-step: Basic Info → Executor → Beneficiaries (live % sum validator, **add/remove/edit** rows) → Assets → Review & Submit (MetaMask/demo signs txn). The Assets step branches by type: **deposit ETH / mint demo token** ask for a **percentage** (live "remaining unallocated: X%"), while **mint demo NFT / upload document** ask for a **beneficiary dropdown** ("who inherits this whole item?").
4. **Executor Dashboard** – list of wills they manage, live countdown/eligibility state, "Activate Inheritance" button (disabled until eligible), full history log
5. **Beneficiary Dashboard** – wills where they're listed, % share, **two separate claim buttons**: "Claim my 60% (ETH + tokens)" and, per NFT/document assigned to them, "Claim this item". Claimed receipts show tx hash
6. **Transparency / Explorer Page** (public-style, satisfies your "all addresses & claims visible") – a mini block-explorer table pulling all contract events (`WillCreated`, `CheckInPerformed`, `InheritanceActivated`, `AssetClaimed`, etc.) with address, tx hash, block number, timestamp — filterable by address
7. **Document Vault** – upload, list with hash, "Verify Integrity" button, download (if authorized). Each document row shows **which beneficiary it is assigned to**
8. **Notification Center** – bell icon dropdown + settings to manage push permission
9. **Profile/Settings** – wallet info, Ganache balance display, link/unlink MetaMask, change check-in interval & grace period

---

## 10. Tech Stack

| Layer | Tech |
|---|---|
| Blockchain | Ganache (local), Hardhat (compile/test/deploy), Solidity 0.8.x, OpenZeppelin |
| Web3 bridge | ethers.js v6 |
| Wallet | MetaMask (pointed to Ganache) + backend-managed demo wallets |
| Frontend | React (Vite) + Tailwind CSS + Workbox (PWA) + Web Push API |
| Backend | Node.js + Express + JWT + bcrypt + multer + node-cron + web-push |
| DB | SQLite via `better-sqlite3` (single file `backend/data/chainwill.db`, zero-setup) — no MongoDB |
| Storage | Local encrypted filesystem (optionally real local IPFS node) |
| Testing | Hardhat + Chai/Mocha (contract), Jest/RTL (frontend) |

### 10.1 Local Setup Checklist (nothing else needs installing)

| Requirement | Notes |
|---|---|
| Node.js 18+ (20 LTS ideal) | Required — powers backend, Hardhat, Vite |
| Ganache | GUI app or `npx ganache` — must listen on `http://127.0.0.1:7545`, chainId **1337**, mnemonic `myth like bonus scare over problem client lizard pioneer submit female collect` (deterministic demo accounts) |
| MetaMask browser extension | Chrome/Edge/Firefox — only needed for *MetaMask Mode*; Demo Wallet Mode works without it |
| SQLite | **Nothing to install.** `better-sqlite3` comes from npm; no server, no service |
| MetaMask → Ganache | Add custom RPC: URL `http://127.0.0.1:7545`, Chain ID `1337`, currency ETH. Import Ganache accounts via "Private Key" tab |
| OpenZeppelin | `@openzeppelin/contracts` from npm (imported, not git-cloned) |
| Push notifications | Requires **HTTPS or `localhost`** — dev on `localhost` is fine. Generate VAPID keys once and store in `.env` |
| Optional | Local IPFS/Kubo (Option B), Docker (not required — everything runs natively) |

`.env` for the backend: `PORT`, `JWT_SECRET`, `SERVER_ENCRYPTION_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `WEB_PUSH_CONTACT`, `GANACHE_RPC_URL`, `CHAINWILL_CONTRACT_ADDRESS`, `DB_FILE`.

---

## 11. Security Checklist (good for your report's "Security Implementation" section)

**Smart contract:**
- Access-control modifiers (`onlyOwnerOfWill`, `onlyExecutor`, `onlyBeneficiary`)
- `ReentrancyGuard` on **both** claim functions (`claimInheritance` and `claimAsset`)
- Percentage sum ≤ 100 validated on add, **and freed on `removeBeneficiary`** so a typo can't permanently burn the will
- Fungible/whole asset split: percentages only ever apply to ETH/ERC20; NFTs and documents are `require`d to have a valid assigned beneficiary and are transferable exactly once
- `hasClaimed` flag (fungible) and `isClaimed` flag (whole assets) prevent double claims
- Checks-effects-interactions pattern for transfers
- `registerWholeAsset` verifies `ownerOf(tokenId) == msg.sender` so an owner can't assign an NFT they don't actually hold
- Status computed from `block.timestamp`, not manually settable (prevents owner/executor faking "deadline passed")

**App layer:**
- bcrypt password hashing, JWT auth, rate limiting, helmet.js, CORS lock to localhost
- File type/size validation on upload, AES-256 encryption at rest
- Private keys (for demo wallets) encrypted with a server secret, never sent to frontend
- Backend re-validates every claim/activation against live contract state before releasing documents

---

## 12. Demo Script (for your viva/presentation)

1. Register 4 users: Alice (Owner), Bob (Executor), Carol (60%), Dave (40%) — show auto-assigned Ganache addresses & balances.
2. Alice creates will: interval = 2 min, grace = 1 min. Beneficiaries Carol 60% / Dave 40%. Then:
   - **deposit 10 test ETH** → fungible, split 60/40
   - **mint a "Property Deed NFT"** → wizard forces a **beneficiary dropdown**: assign it to **Carol** (whole item, *not* 60% of it — say this out loud to the examiner)
   - **upload `property_papers.pdf`** → assigned to **Dave**, along with the car NFT assigned to Carol, so both beneficiaries have a document/NFT to receive
3. Show **Explorer page** — `WillCreated`, `AssetRegistered` events live with tx hashes.
4. Alice checks in once → timer resets → push notification confirms.
5. Let timer lapse → push notification "Please check in" → ignored → grace period starts → notification to Bob.
6. Grace expires → Bob's dashboard shows "Activate Inheritance" enabled → clicks it → event `InheritanceActivated` fires → push sent to Carol & Dave.
7. **Carol claims her 60%** → `claimInheritance()` → 6 ETH + 60% of demo tokens land in her wallet, tx hash shown. **Then Carol claims the Property Deed NFT** → `claimAsset(i)` → NFT moves to her MetaMask/Demo wallet and shows in her dashboard.
8. **Dave claims his 40%** → 4 ETH + tokens, then claims the car NFT and downloads `property_papers.pdf` (access unlocked because his `AssetClaimed` flag is set on-chain).
9. **Security demo:** Carol tries to claim again → contract reverts "Already claimed" (shown as UI error + console revert reason). Random user tries `activateInheritance()` → reverts "Not authorized executor". Dave tries `claimAsset()` on Carol's property NFT → reverts "Not the assigned beneficiary".
10. **Tamper demo:** manually edit the stored PDF bytes → click "Verify Integrity" → UI shows red "Hash mismatch – document was altered!".
11. **Optional bonus — the fix we built in:** during setup, add a beneficiary with a wrong percentage, then hit **Remove** and re-add the correct one, showing the sum validator returning to 100%. Proves the `require(totalPercentage <= 100)` rule can't deadlock a will.

