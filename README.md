# 🔐 ChainWill — Decentralized Digital Will & Inheritance DApp

A dead-man's-switch will on a local Ethereum chain. The owner keeps "checking in". If they stop, and a grace
period passes, the executor they named can activate inheritance, and beneficiaries claim the escrowed ETH,
tokens, NFTs and documents.

It is a hybrid app on purpose:

| Layer | What it does | Why it lives there |
|---|---|---|
| **Web3** — Solidity on Ganache | Holds the assets in escrow, decides who may activate and who may claim what | Trust: none of it can be faked by the server |
| **Web2** — Express + SQLite | Login, demo wallets, encrypted document storage, notifications, fast lookups | Convenience: nothing here can move an asset |

The design rationale, security model and a list of deliberate deviations from the original brief
([idea.MD](idea.MD)) are in **[docs/DESIGN.md](docs/DESIGN.md)** — written to be lifted into a project report.

---

## Quick start

Needs **Node.js 18.17+** (20 or 22 recommended). Nothing else to install.

```bash
npm run setup     # installs the 3 packages, generates backend/.env, compiles the contracts
npm start         # Ganache + contracts + API + UI  →  http://localhost:4000
```

`npm run setup` prints the **admin login** (`admin@chainwill.local` + a generated password, also stored as
`ADMIN_PASSWORD` in `backend/.env`).

`npm start` does everything in one terminal: starts Ganache on `127.0.0.1:7545` (chain ID 1337, 10 accounts × 100
ETH), deploys the contracts if they are not already on that chain, builds the UI and serves it with the API.
Ctrl+C stops it all. Chain state, database and documents persist between runs; `npm run reset` wipes them.

For development use `npm run dev` instead — same stack with a hot-reloading UI on http://localhost:5173.

### Using the Ganache desktop app instead

Start it yourself **before** `npm start`, listening on `http://127.0.0.1:7545`, chain ID `1337`, with the mnemonic

```
myth like bonus scare over problem client lizard pioneer submit female collect
```

`npm start` notices a node is already answering on that URL and uses it instead of starting its own.
(The mnemonic matters: Demo Wallet mode derives the 10 account keys from it.)

### MetaMask mode (optional)

Demo Wallet mode needs no extension. To sign transactions yourself:

1. In MetaMask add a network: RPC `http://127.0.0.1:7545`, chain ID `1337`, currency `ETH`
   (or use **Settings → Add Ganache network to MetaMask** inside the app).
2. Import a Ganache private key (printed by `npm run chain` / shown in the Ganache app) so the account has test ETH.
3. Register with **MetaMask** selected, or link it later under **Settings**.

Pick an account that is not already assigned as someone's demo wallet — the Admin dashboard shows which are free.
After `npm run reset`, clear MetaMask's activity data (Settings → Advanced) so its nonce matches the new chain.

---

## The 5-minute demo

> **Prepared teacher demo:** the exact click-by-click script, Ganache GUI address mapping and reset
> instructions for this machine are in **[docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md)**.
>
> **Fastest option — one command:** `npm run demo:auto` opens Chrome and drives the real frontend
> through the whole lifecycle, pausing at each **GANACHE GUI MOMENT** so you can show the same
> addresses, balances and transactions in Ganache. See
> **[docs/DEMO_GUIDE.md §0.1](docs/DEMO_GUIDE.md#01-fastest-option--one-command-automatic-demo)**.

Open four browser profiles (or one normal + private windows) so four people can be logged in at once.

| # | Who | Do this | You should see |
|---|---|---|---|
| 1 | everyone | Register **Alice**, **Bob**, **Carol**, **Dave** (Demo wallet) | Each gets a distinct funded address (top-right badge, Settings) |
| 2 | Alice | **Create my will** → *Live demo* schedule (2 min / 1 min) → executor **Bob** → **Carol 60%**, **Dave 40%** → 10 ETH, 1000 demo tokens, NFT "Property Deed" → Carol, upload a PDF → Dave → **Sign & submit** | A checklist of ~11 transactions turning green, each with its tx hash |
| 3 | anyone | **Explorer** | `WillCreated`, `BeneficiaryAdded`, `AssetRegistered` … with block, time and tx hash; filter by any address |
| 4 | Alice | **I'm alive — check in** | Timer jumps back to 02:00; "Check-in confirmed" notification |
| 5 | Alice | Do nothing | "⏰ Please check in" at 30 s left → status **Check-in missed**, grace countdown, Bob is notified |
| 6 | Bob | **Executor** → wait for the grace period → **Activate inheritance** | Button unlocks only when eligible; Carol and Dave are notified |
| 7 | Carol | **Beneficiary** → **Claim my 60%** → **Claim this item** | +6 ETH, +600 CWT, the NFT in her wallet; receipts with tx hashes |
| 8 | Dave | **Claim my 40%**, then **Claim this item** on the PDF → **Download** | The document unlocks only after *that* on-chain claim — not after the ETH claim |
| 9 | Carol / anyone | **Security lab** → pick Alice's will → **Try it** | `"Already claimed"`, `"Not authorized executor"`, `"Not the assigned beneficiary"` — straight from the contract (also in the browser console) |
| 10 | terminal + Alice | `npm run demo:tamper`, then **Document vault → Verify integrity** | Red **MODIFIED! Hash mismatch** with expected vs. actual fingerprints. `npm run demo:restore` undoes it |
| 11 | Alice (earlier) | In the wizard enter 90% for Carol, see the validator go red, fix it to 60% | "30% over the limit" → "Fully allocated" |

**No time to wait?** Log in as the admin and use **Demo tools — fast-forward the chain** (+30 s, +1 min, +2 min …).
It moves only the chain's clock; countdowns and notifications follow. Turn it off with `ENABLE_DEMO_TOOLS=false`.

**Push notifications:** open **Notifications → Enable push notifications** in each browser and allow the prompt.
They need `localhost` (or HTTPS). If permission is denied, every alert still shows in the bell and as an in-app toast.

---

## Project layout

```
blockchain/   Hardhat project
  contracts/WillManager.sol      the will + escrow contract
  contracts/DemoToken.sol        open-faucet ERC-20 for the demo
  contracts/DemoNFT.sol          open-mint ERC-721 "deeds"
  test/WillManager.test.js       46 contract tests
  scripts/ganache.js, deploy.js  local chain + idempotent deployment
backend/      Express API (ESM)
  src/chain.js      provider, chain clock, tx simulation/sending, revert decoding
  src/actions.js    whitelist of on-chain actions → one unsigned transaction each
  src/wills.js      live will reads, cache sync, reverse lookups
  src/indexer.js    contract events → SQLite + notifications
  src/scheduler.js  node-cron deadline watcher
  src/documents.js  AES-256-GCM vault, integrity verification
  src/storage/      local filesystem driver / IPFS (Kubo) driver
  src/routes/       auth, wallet, wills, tx, documents, notifications, explorer, admin
  test/unit/        lifecycle + crypto unit tests
  test/e2e.mjs      the whole demo script through the HTTP API
frontend/     React + Vite + Tailwind PWA
  src/pages/        Landing, OwnerDashboard, WillWizard, Executor, Beneficiary, Vault,
                    Explorer, Notifications, Settings, SecurityLab, Admin
  src/sw.js         service worker: Workbox precache + Web Push
scripts/      setup / run / reset helpers (plain Node, cross-platform)
deployments/  ganache.json — addresses + ABIs, written by the deploy script (git-ignored)
```

## Commands

| Command | What it does |
|---|---|
| `npm run setup` | Install everything, generate `backend/.env`, compile contracts |
| `npm start` | Whole stack, built UI, one URL (http://localhost:4000) |
| `npm run dev` | Whole stack with Vite hot reload (http://localhost:5173) and `node --watch` |
| `npm run chain` / `npm run deploy` | Only Ganache / only the deployment |
| `npm test` | Contract (46), backend unit (14) and frontend (46) tests |
| `npm run test:e2e` | 55 end-to-end checks against the **running** stack (needs `ENABLE_DEMO_TOOLS=true`) |
| `npm run demo:auto` | One-command Playwright demo: real frontend lifecycle, Ganache pauses, screenshots |
| `npm run demo:reset` | Restore the saved clean chain snapshot + demo users (app must be stopped) |
| `npm run demo:tamper` / `demo:restore` | Flip a byte in the newest stored document / put it back |
| `npm run reset` | Delete chain state, database, stored documents and the deployment manifest |

## Configuration (`backend/.env`)

Generated by `npm run setup`; see [backend/.env.example](backend/.env.example) for every key.

| Key | Default | Notes |
|---|---|---|
| `PORT` | `4000` | API + built UI |
| `GANACHE_RPC_URL` | `http://127.0.0.1:7545` | The orchestrator starts Ganache on this port if nothing answers |
| `GANACHE_MNEMONIC` | the `myth like bonus…` phrase | Must match the node's accounts |
| `JWT_SECRET`, `SERVER_ENCRYPTION_KEY` | generated | The encryption key protects demo-wallet keys and document keys. **Losing it makes stored documents undecryptable** |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | generated | Web Push |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | generated | Read-only admin account, created at boot |
| `STORAGE_DRIVER` | `local` | `ipfs` stores the encrypted blobs in a local Kubo node (`IPFS_API_URL`, default `http://127.0.0.1:5001`) |
| `ENABLE_DEMO_TOOLS` | `true` | Admin fast-forward of the chain clock |
| `SMTP_HOST` … | empty | Optional e-mail copy of every notification |

## Troubleshooting

- **"Cannot reach the blockchain node"** — Ganache is not running on `GANACHE_RPC_URL`. `npm start` starts one; if
  you use the desktop app, start it first.
- **"…is not deployed at … on this chain"** — the chain was restarted without its state. Run `npm run deploy` (or
  just `npm start`). The backend notices the new chain and clears its cached wills and events by itself.
- **Demo wallets show 0 ETH** — the node was started with a different mnemonic than `GANACHE_MNEMONIC`.
- **MetaMask: "nonce too high" / stuck transactions** after a reset — clear activity data in MetaMask.
- **Port already in use** — change `PORT` / `GANACHE_RPC_URL` in `backend/.env` (and `VITE_PORT` for dev).
- **Project inside OneDrive / Dropbox** — the sync client can lock the live database and chain files. Pause syncing
  while the app runs, or point `DB_FILE`, `STORAGE_DIR` and `GANACHE_DB_PATH` somewhere outside the synced folder.
- **Fast-forward + restarting Ganache** — a restarted node forgets the skipped time, so its clock drops back to
  real time. Existing deadlines simply end up later than expected; use `npm run reset` for a clean slate.

## What was verified, and what was not

Verified on Linux (WSL2), Node 22: all three test suites; the 55-check API scenario; the full demo script driven
through the real UI in headless Chromium (four users + admin + mobile viewport); MetaMask mode through the UI with a
stand-in wallet provider that signs via Ganache; the cron scheduler in real time (no fast-forward); Web Push from
the server to a stand-in push service (payload decrypted and checked); the IPFS driver against a real Kubo daemon.

Not verified, because it needs hardware or software this environment does not have: the real MetaMask extension,
an actual system notification appearing in a desktop browser, native Windows (the scripts avoid shell-specific
syntax, but have only been run on Linux), and the Ganache desktop app.
