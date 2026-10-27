# ChainWill — Teacher Demo Guide

Prepared on **26 October 2026** for the project in `C:\Users\rohan\OneDrive\Desktop\BlockChainProject`.

This machine is already set up and tested. The app is running at **http://localhost:4000**, contracts are
deployed on your Ganache GUI chain, and Alice / Bob / Carol / Dave already exist.

---

## 0. The box to read first

| Item | Value |
|---|---|
| App URL | **http://localhost:4000** |
| Admin login | **admin@chainwill.local** / the generated `ADMIN_PASSWORD` in `backend/.env` |
| Alice (owner) | **alice@chainwill.demo** / **ChainWill123** |
| Bob (executor) | **bob@chainwill.demo** / **ChainWill123** |
| Carol (beneficiary 60%) | **carol@chainwill.demo** / **ChainWill123** |
| Dave (beneficiary 40%) | **dave@chainwill.demo** / **ChainWill123** |
| Demo document | **`C:\Users\rohan\OneDrive\Desktop\property_papers.pdf`** |
| Reset before a second run | Stop the app (`Ctrl+C`), then `npm run demo:reset`, then `npm start` |

> The four users are **already registered and funded**. You do **not** need to register them again.
> If you want to show registration to the teacher, register a fifth user live and then delete the DB
> afterwards, or use the reset command.

---

## 0.1 Fastest option — one-command automatic demo

If you want the frontend to drive itself while you talk, use the Playwright runner:

```powershell
npm run demo:auto
```

It opens a Chrome window and performs the same real UI flow as the manual script below:

1. Alice's Settings address and the Admin **Ganache accounts** table.
2. Alice creates the will (10 ETH, 1000 CWT, the NFT, the PDF).
3. The Explorer, a check-in, and the admin fast-forward to **Check-in missed** and **Eligible**.
4. Carol's unauthorized attempt, Bob's activation, Carol's and Dave's claims.
5. The Security Lab reverts and the tamper/restore check.
6. The final Admin dashboard.

It stops at every **GANACHE GUI MOMENT** and counts down in the terminal, so you can switch to the
Ganache GUI and point at the same addresses, balances and transactions. The app continues by itself
after the countdown. Do not click in the automated Chrome window while it is running.

Before the first run, the state must be clean. If a rehearsal already created a will:

```powershell
# stop the app with Ctrl+C first
npm run demo:reset
npm start
npm run demo:auto
```

The runner refuses to start if a will already exists. At the end the browser is left open on the
final dashboard; press `Ctrl+C` in the terminal to close it. Screenshots are saved in
`demo/screenshots/`, and Dave's downloaded PDF is `demo/downloaded_property_papers.pdf`.

Optional knobs:

```powershell
$env:DEMO_SPEED='1.4'     # slower, easier to narrate
$env:GANACHE_PAUSE='25'   # longer Ganache pauses
$env:DEMO_CLOSE='1'       # close the browser automatically at the end
```

The automatic runner uses the real frontend and real Ganache transactions. If it stops early, the
terminal prints the step and leaves the browser open; reset and run it again.

---

## 1. What is already prepared

- **Ganache GUI** is running with its `Quickstart` workspace:
  - RPC: `http://127.0.0.1:7545`
  - EVM chain ID: **1337**
  - 10 accounts × 100 ETH
  - The project's `backend/.env` is set to **this exact Ganache mnemonic**, so the app's demo wallets
    are the same addresses you see in the GUI.
- **Contracts are deployed** (you will see blocks 1–3 in Ganache):

  | Contract | Address |
  |---|---|
  | WillManager | `0xEe3bf8b1C10320b56e99B0E98e521c28C3aFDd83` |
  | DemoToken (CWT) | `0xfc1Cd5387c893fc0c3Aa62735c74CfC81309FE32` |
  | DemoNFT | `0xB95F5E8E85A2C6A934f9DEf186Ba079708Ac3626` |

- **No wills exist on-chain** right now. The four demo users have 100 ETH each.
- The frontend is built and served by the backend at port 4000.
- Test results on this machine: **46 contract tests + 14 backend tests + 46 frontend tests + 55
  end-to-end API checks — all passing.**

---

## 2. Ten minutes before the demo

1. **Leave Ganache GUI open.** Do not create a new workspace. Use the same `Quickstart` workspace
   that is open now. (If you close it, reopen `Quickstart`; the mnemonic and chain state are
   persisted. Check that account 0 is still `0x1EEB51183Fe60f4Faa748b4da1133e2dCFC68ac5`.)
2. **Start the app** if it is not already running. Open a terminal in the project folder:
   ```powershell
   cd C:\Users\rohan\OneDrive\Desktop\BlockChainProject
   npm start
   ```
   Wait until you see:
   ```
   [run] ChainWill is ready → http://localhost:4000
   [api] [chainwill] API listening on http://127.0.0.1:4000
   ```
   Keep this terminal open. `Ctrl+C` stops everything.
3. **Pause OneDrive syncing** for 2 hours (right-click the OneDrive cloud icon → Pause syncing).
   The project lives inside OneDrive and the sync client can lock the SQLite database.
4. **Stop the screen from sleeping** (Settings → System → Power → Screen and sleep → Never).
5. **Open five separate browser sessions.** They must be separate profiles/windows; incognito
   windows of the same browser share login, so one incognito window = one user only.

   | Session | Who | Login |
   |---|---|---|
   | Chrome profile 1 | Alice | alice@chainwill.demo / ChainWill123 |
   | Chrome profile 2 | Bob | bob@chainwill.demo / ChainWill123 |
   | Chrome profile 3 | Carol | carol@chainwill.demo / ChainWill123 |
   | Chrome profile 4 | Dave | dave@chainwill.demo / ChainWill123 |
   | Chrome profile 5 / Edge | Admin | admin@chainwill.local / `ADMIN_PASSWORD` from `backend/.env` |

   Chrome: click the profile icon → **Add** → **Continue without an account**, then open
   `http://localhost:4000` in each profile and sign in.
6. **Log in to all five now**, so the demo starts instantly. Leave each dashboard open.
7. **Open the demo PDF location** in File Explorer so the upload picker starts there:
   `C:\Users\rohan\OneDrive\Desktop\property_papers.pdf`.

> Push notifications are optional. The in-app bell and toast work without permission. If you want
> OS-level notifications, open **Notifications → Enable push notifications** in Alice's and Bob's
> profiles and click Allow. Do not spend demo time on this.

---

## 3. The address map — how to show Ganache GUI

This is the part your teacher asked to see. The app and Ganache show the **same addresses**.

| Ganache account | Address | Who in the app |
|---|---|---|
| #0 | `0x1EEB51183Fe60f4Faa748b4da1133e2dCFC68ac5` | **Deployer** — not assigned to a user |
| #1 | `0xC9fcd38E90D17c024c76034cC1954d56F808FDf4` | **Alice** (owner) |
| #2 | `0xC490D1c3F7e942A5049F851aBBC7e3DCAD84ae8a` | **Bob** (executor) |
| #3 | `0x73B6D91470dB8AA514eA19E9Fa8675fEC0a8b8AD` | **Carol** (60%) |
| #4 | `0xb51475F06D4d0d6BA4419e65c1856a5044c3eE3F` | **Dave** (40%) |
| #5–#9 | remaining Ganache accounts | unassigned (spare) |

### How to prove the mapping live

1. In **Ganache**, click the **ACCOUNTS** tab. Point at account #1 and read the address.
2. In **Alice's** browser, click the address badge in the top-right corner (or **Settings**).
   Point at **Wallet → Ganache account #1 of 10** and the same `0xC9fc…` address.
3. Repeat for Bob (`#2`), Carol (`#3`), Dave (`#4`).
4. In **Admin**, open **Admin dashboard** → scroll to **Ganache accounts**. This table is the
   clearest view for the teacher: it lists the slot, the full address, the user's name, and the
   live balance together.

### What to say if the teacher notices “NETWORK ID 5777”

> “Ganache's *network ID* is just a peer-network label. The EVM **chain ID** that the application
> checks is **1337**; you can see it in Admin → Chain & services. Both are local to this demo.”

Do not change the Ganache settings during the demo.

### Where the transactions appear in Ganache

- **ACCOUNTS** tab: balances and TX counts change after each action.
- **TRANSACTIONS** tab: every transaction, with from/to, value, gas, block. Use the search box at
  the top right to paste a transaction hash copied from the app.
- **BLOCKS** tab: block numbers. The app's Explorer shows the same block numbers and timestamps.
- The **EVENTS** tab will not decode ChainWill events unless you add the contract ABI. Do not do
  that live — use the app's own **Explorer** page, which is a purpose-built block explorer.

---

## 4. The demo script (about 12–15 minutes)

You can run the whole thing in 5 minutes if you use the **speedrun** at the end of this section.

### 0:00–1:30 — Opening (no clicks)

Say this in your own words:

> “ChainWill is a decentralized digital will with a dead-man's switch. ETH, ERC-20 tokens, NFTs and
> documents are escrowed in a Solidity contract. The owner keeps checking in. If they stop, and a
> grace period passes, the executor they named can activate inheritance, and the beneficiaries
> claim what was assigned to them.
>
> It is deliberately hybrid: **Web3 holds the trust logic** — who owns what, who can activate,
> who can claim. **Web2 gives the UX** — login, names, encrypted document storage, notifications
> and fast dashboards. The backend can prepare a transaction, but it cannot move an asset by
> itself.”

Then point at Ganache:

> “This is Ganache, our local Ethereum chain. Ten funded accounts, chain ID 1337, instant blocks.”

### 1:30–2:30 — Show identities and addresses

1. Ganache → **ACCOUNTS**. “Ten accounts, 100 ETH each.”
2. Alice → **Settings**. Point at the address and **Ganache account #1 of 10**.
3. Show Bob, Carol, Dave briefly (sidebar → Settings).
4. Admin → **Admin dashboard** → **Ganache accounts** table.
   > “The app maps each human login to exactly one Ganache address. Account #0 deployed the
   > contracts, so it is intentionally not assigned to a user.”

This is the answer to “show me the addresses in Ganache too”.

### 2:30–6:00 — Alice creates the will

In Alice's browser: **My will → Create my will**.

Use these exact values:

| Wizard step | What to enter |
|---|---|
| **1. Basic info** | Title: `Alice's Last Will` |
|  | Click the **Live demo** preset (2 min check-in, 1 min grace) |
| **2. Executor** | Choose **Bob** |
| **3. Beneficiaries** | Carol: **60%**, then **Add beneficiary** → Dave: **40%** |
| **4. Assets** | Deposit ETH: **10** |
|  | Mint & deposit demo tokens: **1000** |
|  | NFT name: **Property Deed**, Kind: **Property deed**, Inherited by: **Carol** → **Add NFT** |
|  | Document: Inherited by **Dave**, then choose `property_papers.pdf` from the Desktop |
| **5. Review** | Confirm it says about **11 transactions** → **Sign & submit** |

Optional 20-second proof on the beneficiaries step: type Carol **90**, show the red
**“30% over the limit”**, then change Carol to **60**. Add Dave at 40 and show **“Fully allocated”**.
Say:

> “The wizard mirrors the contract's `require(totalPercentage <= 100)`. A typo is caught before any
> transaction, and `removeBeneficiary` can free a percentage later — so a will can never be
> permanently bricked by a wrong number.”

During the assets step, say:

> “ETH and tokens are split by percentage. An NFT or a document cannot be split 60/40, so each one
> is assigned **whole** to one beneficiary. Carol gets the whole deed; Dave gets the whole document.”

When you click **Sign & submit**, the checklist runs through every transaction. Let it finish. You
will see **“Your will is live on-chain”**. Click **Open my dashboard**.

#### Ganache GUI moment (do this right after the wizard)

1. Ganache → **ACCOUNTS**:
   - Alice's balance drops from 100 to about **89.99 ETH** (10 ETH escrow + gas).
   - Alice's TX count increases. Bob/Carol/Dave are still at 100.
2. **TRANSACTIONS**: show the newest transactions. Click one and show:
   - **From**: Alice's address
   - **To**: `0xEe3bf8b1C10320b56e99B0E98e521c28C3aFDd83` (the WillManager contract)
   - **Value**: 10 ETH for the deposit transaction
   - **Block**: the block number
3. **BLOCKS**: show the block numbers advancing.
4. In the app, open **Explorer**, click a transaction hash, and copy it. Paste it into Ganache's
   search box to show the same transaction from the GUI side.

Say:

> “The will, the executor, the beneficiaries, the percentages, the asset fingerprints and the
> 10 ETH are now in the contract. The names, emails and the PDF bytes are off-chain.”

### 6:00–7:00 — Explorer

In Alice's browser: **Explorer**.

- Show the summary cards (latest block, wills on-chain, ETH in escrow, transactions).
- Point at the three contract addresses.
- In **Filter by address**, paste Alice's address and click **Apply**.
- Show events: `WillCreated`, `BeneficiaryAdded`, `AssetRegistered`, `AssetAssigned`.
- Click a **Tx hash** → the modal shows block, gas, from/to and the decoded events.

Optional: open `http://localhost:4000/explorer` in a fresh tab. It works without login:
“Anyone can audit this; no account needed.”

### 7:00–7:30 — Alice checks in

In Alice's browser: **My will** → big button **“I'm alive — check in”**.

Expected:
- Toast “Checked in — timer reset”.
- Countdown jumps back to **02:00**.
- Ganache gets a new transaction (from Alice to WillManager) and a new block.

### 7:30–9:30 — Missed deadline, grace period, activation

You have two choices:

**Option A — let real time pass (most honest).** Talk through the architecture for 2 minutes.
The countdown reaches 00:00, Alice's status becomes **Check-in missed**, and a 1-minute grace
countdown starts.

**Option B — fast-forward (recommended if the teacher is impatient).**
In **Admin → Demo tools — fast-forward the chain**:
1. Click **+2 minutes**. Wait 3–5 seconds.
2. Alice's dashboard shows **Check-in missed** and the grace countdown (~01:00 or less).
3. The notification bell shows **“⏰ Please check in”** for Alice and **“⚠️ Grace period started”**
   for Bob.
4. Click **+1 minute** in Admin. Wait 3–5 seconds.
5. Alice's status becomes **Eligible for inheritance**; Bob's **Executor** page unlocks the
   **Activate inheritance** button.

Say:

> “The contract never decides that Alice is dead. It only measures time since her last check-in.
> Only the named executor can pull the trigger, and only after interval + grace. The backend cannot
> fake this; `activateInheritance` checks the contract's own `getStatus()` at mining time.”

#### Optional 30-second security check before activation

In Carol's browser: **Security lab → pick Alice's will → “Activate inheritance” → Try it**.
Expected: **“Not authorized executor”** in red. Say: “Carol is a beneficiary, not the executor.”

Then in Bob's browser: **Executor → Activate inheritance**. Wait for the success toast and status
**Activated**. Ganache shows a new transaction from Bob's address.

### 9:30–12:00 — Claims

#### Carol

1. Carol → **Beneficiary**. The card from Alice appears.
2. Click **“Claim my 60% (ETH + tokens)”**.
   - Expected: **Claimed** tag, about **+6 ETH** and **+600 CWT**, and a transaction receipt.
3. Click **“Claim this item”** on the **Property Deed** NFT.
   - Expected: **Claimed**; the NFT is now in Carol's wallet (Settings → NFTs in wallet).
4. Ganache → **ACCOUNTS**: Carol's balance is now about **106 ETH**; her TX count increased by 2.

Say:

> “`claimInheritance` uses a `hasClaimed` flag and `claimAsset` uses an `isClaimed` flag. Both are
> checks-effects-interactions and `nonReentrant`. A second claim is impossible.”

#### Dave

1. Dave → **Beneficiary** → **“Claim my 40%”**.
   - Expected: about **+4 ETH** and **+400 CWT**.
2. Dave → **Beneficiary → Items assigned to you**, or **Document vault**.
   - **Before claiming the document**, point out that the PDF is still locked: the Download button
     is unavailable and the row says it is locked for the heir.
   - Click **“Claim this item”** on `property_papers.pdf`.
   - Only now does **Download** become available. Click it and open the PDF.
3. Ganache → **ACCOUNTS**: Dave is about **104 ETH**.
4. Admin → **Admin dashboard**: ETH in escrow is now **0**, ETH inherited is **10**.

Say the key sentence:

> “Claiming the ETH share did **not** unlock the document. The backend releases a document only
> after the beneficiary has claimed **that specific asset** on-chain, and after re-checking the
> contract's `isClaimed` flag and the file's hash.”

### 12:00–13:30 — Security lab (the contract says no)

In the app: **Security lab**, pick Alice's will.

| Who | Attempt | Expected result |
|---|---|---|
| Carol | Activate inheritance | `Not authorized executor` |
| Carol | Claim a percentage share again | `Already claimed` |
| Dave | Select the **Property Deed** (Carol's NFT) and try to claim it | `Not the assigned beneficiary` |

Say:

> “These are real dry-runs against the deployed contract, not mock messages. The revert reason comes
> straight from Solidity. Modifiers enforce the owner/executor/beneficiary rules; the flags stop
> double claims; `nonReentrant` stops a re-entrancy attack; checks-effects-interactions means state
> is updated before ETH or tokens leave.”

If the teacher wants proof in the browser: press **F12 → Console**; the revert reasons are also
printed there.

### 13:30–14:30 — Tamper detection

Keep the app running. In a **second terminal**:

```powershell
cd C:\Users\rohan\OneDrive\Desktop\BlockChainProject
npm run demo:tamper
```

It flips one byte in the newest stored document. Then in Alice's (or Dave's) browser:
**Document vault → `property_papers.pdf` → Verify integrity**.

Expected: red **“MODIFIED!”** with **expected vs actual** SHA-256 and CID fingerprints. Try
**Download** — it is refused.

Restore it:

```powershell
npm run demo:restore
```

Click **Verify integrity** again → green **“Integrity verified”**.

Say:

> “The file itself is AES-256-GCM encrypted off-chain. The contract stores the SHA-256 of the
> plaintext and the CID of the encrypted blob. Verification re-hashes the file and compares it with
> the on-chain fingerprint; AES-GCM also refuses to decrypt altered bytes.”

### 14:30–15:30 — Admin dashboard and close

Admin → **Admin dashboard**.

Point out:
- **Registered users**: 5 (4 demo + 1 admin; the admin has no wallet and cannot transact).
- **Wills on-chain**: 1.
- **ETH in escrow**: 0 after the claims; **ETH inherited**: 10.
- **Latest block**, **Transactions**, **Gas used**, **Check-ins / activations**.
- **Events by type**: `WillCreated`, `BeneficiaryAdded`, `AssetRegistered`, `InheritanceActivated`,
  `AssetClaimed`, etc.
- **Ganache accounts**: names, addresses and balances side by side.
- **Chain & services**: chain ID 1337, RPC, contract addresses, deployed block.
- If you used time travel: **Chain time (+2m vs real time)** — explain that this is a local demo
  convenience, not a production feature.

Close with:

> “Web2 gives the product its login, storage and notifications. Web3 gives it the part that must
> not be fakeable: escrow, authorization, deadlines and claims. The backend prepares transactions;
> the contract has the final word.”

---

## 5. Five-minute speedrun

If the teacher gives you only 5 minutes:

1. Show Ganache accounts + Alice's Settings address (30 s).
2. Alice creates the will using the values above, but skip the 90% validation and the Explorer deep
   dive (3 min).
3. Admin → **+2 minutes**, wait, **+1 minute**, Bob activates (30 s).
4. Carol claims 60% + NFT; Dave claims the document and downloads it (1 min).
5. One Security Lab revert + one tamper check (30 s).
6. Admin dashboard final numbers (30 s).

---

## 6. If something goes wrong

| Symptom | Fix |
|---|---|
| Browser says “Cannot reach API” / page does not load | The app terminal was closed. Run `npm start` again. Wait for “ready”. |
| “Cannot reach the blockchain node” | Ganache GUI was closed. Reopen the **same Quickstart workspace**. Do not create a new one. |
| “Will is not deployed on this chain” | Ganache was reset. Run `npm start` again; it redeploys automatically. Then run `npm run demo:reset` if the users are missing. |
| Demo wallets show 0 ETH | Ganache is using a different mnemonic. Check that account #1 is `0xC9fcd38E90D17c024c76034cC1954d56F808FDf4`. If not, do not continue — restore the correct workspace/mnemonic first. |
| A user is in the wrong browser | Sign out (bottom of sidebar) and sign in with the right email. Each profile keeps its own session. |
| A step failed mid-demo | Stay calm. Stop the app, run `npm run demo:reset`, then `npm start`. The four users come back, the chain is clean, and you can restart the demo. |
| Port 4000 already in use | The app is probably already running. Just open http://localhost:4000. |
| OneDrive locks the database | Pause OneDrive syncing and retry. |
| Time travel buttons missing | You are not logged in as admin, or `ENABLE_DEMO_TOOLS=false`. Use the admin profile. |

**Do not run `npm run reset`** before the demo. That is the full wipe (it removes the deployment
manifest and requires a fresh deploy + re-register). Use **`npm run demo:reset`** instead.

---

## 7. Rehearsing without spoiling tomorrow

The `demo:reset` command is designed for this:

1. Stop the app in its terminal (`Ctrl+C`).
2. Run:
   ```powershell
   cd C:\Users\rohan\OneDrive\Desktop\BlockChainProject
   npm run demo:reset
   ```
3. Start again:
   ```powershell
   npm start
   ```

It:
- reverts the Ganache chain to the saved clean snapshot (contracts stay deployed, no wills),
- restores the database containing Alice, Bob, Carol, Dave and the admin,
- clears uploaded documents,
- takes a fresh snapshot so it can be used again.

The snapshot only survives while the **same Ganache process** is running. If you restart Ganache,
the snapshot is gone. In that case, reset the Ganache workspace, run `npm start` (it redeploys), and
register the four users again with the same emails/passwords; they will get slots 1–4 again. The
`demo/clean-state/chainwill.db` backup can also be copied back to `backend/data/` after deleting
`backend/data` and `backend/secure-storage`.

---

## 8. Likely viva questions (short answers)

**Why hybrid Web2 + Web3?**
> Web3 provides trust: escrow, authorization, deadlines and claims cannot be faked by the server.
> Web2 provides convenience: email login, names, encrypted files, notifications, fast reads. The
> backend can prepare transactions but cannot move assets.

**What exactly is on-chain?**
> The will owner and executor, the check-in interval and grace period, beneficiaries and
> percentages, asset records (ETH/ERC-20 amounts, NFT token IDs, document SHA-256/CID), claim flags,
> escrowed ETH/tokens/NFTs, and every event.

**What is off-chain?**
> Login credentials, names/emails, the encrypted document bytes, notification history, and a SQLite
> cache of chain data. The cache is only for speed; every critical action is re-validated against the
> live contract.

**How does the dead-man's switch work?**
> `lastCheckIn + interval` is the deadline. If the owner stops checking in, the UI shows `MISSED`
> during the grace period. After `interval + grace`, `getStatus()` returns `ELIGIBLE`. Only the
> executor can then call `activateInheritance()`. The contract never decides someone is dead; it
> only measures time.

**Why percentages for ETH/tokens but whole items for NFTs/documents?**
> Fungible assets are divisible; an NFT or a PDF is not. So ETH/ERC-20 use beneficiary percentages,
> while each NFT/document has exactly one `assignedTo` heir and is claimed with `claimAsset(i)`.

**What stops a random person from activating?**
> The `onlyExecutor(owner)` modifier. The contract also requires `getStatus(owner) == ELIGIBLE` and
> at least one beneficiary.

**What stops double claims?**
> `Beneficiary.hasClaimed` for the fungible share, `Asset.isClaimed` for each whole item, plus
> `nonReentrant` on both claim functions. State is updated before external transfers
> (checks-effects-interactions).

**What happens to unallocated percentages?**
> They stay in escrow. If beneficiaries sum to less than 100%, the remainder is not paid out. This is
> a deliberate, honest limitation; the wizard warns about it.

**How are documents protected?**
> AES-256-GCM encryption at rest with a per-file key; the key is wrapped with a server master key.
> The contract stores the plaintext SHA-256 and the encrypted blob's CID. Download is released only
> after the on-chain `isClaimed` flag is true for that specific asset and the requester is the
> `assignedTo` heir. Verification re-hashes the file and compares it with the on-chain value.

**How are demo wallets secured?**
> The backend derives Ganache account keys from the configured mnemonic, encrypts each private key
> with AES-256-GCM and a server secret, and never sends key material to the browser. MetaMask mode is
> also supported: there the server holds no key and the user signs every transaction.

**Why Ganache?**
> It gives deterministic funded accounts, instant mining, and `evm_increaseTime` for the demo. In
> production you would use a real testnet/mainnet, a wallet, audited contracts and decentralized
> storage.

**What did you test?**
> 46 contract tests, 14 backend unit tests, 46 frontend tests and a 55-check end-to-end scenario
> through the real HTTP API, including the full lifecycle, reverts, document tamper detection and the
> admin dashboard. All passed on this machine.

**What is the `MISSED` state?**
> It is a soft/derived state. The contract stores only `ACTIVE`, `ELIGIBLE`, `ACTIVATED`, `REVOKED`.
> `getPhase()` derives `MISSED` from `block.timestamp`; the UI uses it for the countdown. This is a
> deliberate design distinction worth mentioning.

---

## 9. If the teacher asks to see the code

| What to show | File | Why |
|---|---|---|
| The will state machine and storage | `blockchain/contracts/WillManager.sol` (lines ~30–110) | Structs, enums, events |
| Access control | same file, lines ~157–177 | `onlyOwnerOfWill`, `onlyExecutor`, `onlyBeneficiary` |
| Create / beneficiaries / assets | same file, lines ~179–380 | Percentage cap, whole-item assignment, NFT ownership check |
| Check-in and status | same file, lines ~388–430, 547–567 | Timestamps, `getStatus`, soft `MISSED` |
| Activation | same file, lines ~461–477 | Executor-only, eligibility, escrow snapshot |
| Claims | same file, lines ~482–542 | Percentage math, flags, CEI, `nonReentrant` |
| Backend action whitelist | `backend/src/actions.js` | Only known actions can be relayed |
| Document encryption / verification | `backend/src/documents.js` (~27–120), `backend/src/crypto.js` | AES-256-GCM, SHA-256, CID |
| Scheduler / notifications | `backend/src/scheduler.js` | Deadline watcher, in-app + Web Push |
| Frontend wizard | `frontend/src/pages/WillWizard.jsx` | Multi-step form, plan, live validation |
| Frontend dashboards | `frontend/src/pages/OwnerDashboard.jsx`, `ExecutorDashboard.jsx`, `BeneficiaryDashboard.jsx` | Role-specific views |
| Explorer | `frontend/src/pages/Explorer.jsx` | Event table and filters |

---

## 10. Under the hood (do not change during the demo)

- Ganache mnemonic: the `GANACHE_MNEMONIC` value in `backend/.env` (keep it private).
- Ganache workspace: `Quickstart`, `randomizeMnemonicOnStart: false`, chain data in
  `C:\Users\rohan\AppData\Roaming\Ganache\ui\default\chaindata`.
- `.env` also contains the generated `JWT_SECRET`, `SERVER_ENCRYPTION_KEY`, VAPID keys and admin
  password. Keep it private; it is git-ignored.
- The admin account is read-only and has no wallet.
- The deployment manifest is `deployments/ganache.json` (addresses + ABIs).
- The clean database backup is `demo/clean-state/chainwill.db`; the clean-chain snapshot is
  `deployments/demo-snapshot.json`.

If the Ganache mnemonic ever changes, the app's demo wallet addresses will no longer match the GUI
accounts. Recover by creating a Ganache workspace with the same mnemonic from `backend/.env`
(port 7545, chain ID 1337), then restart the app. The four user accounts derive deterministically
from that phrase.

---

Good luck. The important thing to remember: **you are not demonstrating a mock UI — every click in
the app is a real transaction on the Ganache chain, and the Ganache Accounts/Transactions tabs show
the same addresses and hashes.**
