# ChainWill — Design Notes

Material for the project report and the viva: what each part does, why it is built that way, and where the
honest limits are.

## 1. Architecture

```
 Browser (React PWA)                         Backend (Express)                        Ganache
 ───────────────────                         ─────────────────                        ───────
 pages / wizard / dashboards ── REST ──────► auth (bcrypt + JWT)
 service worker ◄── Web Push ─────────────── notify.js ◄── scheduler.js (node-cron)
                                             indexer.js ◄──────── contract events ──── WillManager.sol
 Demo Wallet mode:  POST /tx/send ─────────► actions.js → sign with user's key ──────► (escrow + rules)
 MetaMask mode:     POST /tx/prepare ──────► actions.js → unsigned tx                  DemoToken.sol
                    MetaMask signs ────────────────────────────────────────────────►  DemoNFT.sol
                    POST /tx/confirm ──────► wait for receipt, index
                                             documents.js → AES-256-GCM → local disk | IPFS
                                             SQLite: users, caches, documents, notifications, events
```

**Why hybrid.** A person cannot be reached by a smart contract, and a smart contract cannot be trusted to a
server. So the chain owns everything that must not be forgeable — who the executor and beneficiaries are, what is
in escrow, when a will becomes eligible, who has claimed. The server owns everything that is only convenience —
names, login, reminders, file storage, quick lookups. The test of the split: if the server lied about everything,
no asset could move to the wrong person; the worst it could do is fail to remind someone or withhold a document.

**The database is a cache.** `wills_cache`, `beneficiaries` and `assets_cache` are rebuilt from the contract after
every event and are used only to answer "which wills mention this address?". Every page that shows a will reads it
live from the contract, and every irreversible step (activation, claim, document release) is checked against live
contract state.

## 2. Lifecycle

```
            checkIn() any time before activation
           ┌──────────────────────────────────────┐
           ▼                                      │
        ACTIVE ──time──► MISSED ──time──► ELIGIBLE ──executor: activateInheritance()──► ACTIVATED
           │                                 │                                              │
           └──────── owner: revokeWill() ────┘                                   claims ──► PARTIALLY_CLAIMED ──► FULLY_CLAIMED
                          ▼
                       REVOKED
```

Only three values are ever **stored**: `ACTIVE`, `ACTIVATED`, `REVOKED`.

- `ELIGIBLE` is computed inside `getStatus()` from `block.timestamp > lastCheckIn + interval + grace`. Nobody —
  owner, executor or server — can set it.
- `MISSED` is a soft state exposed by `getPhase()`; it changes nothing about what is allowed.
- `PARTIALLY_CLAIMED` / `FULLY_CLAIMED` are derived from the `hasClaimed` / `isClaimed` flags.

**The contract never decides someone is dead.** It measures time since the last proof-of-life. The executor is the
human trust point who decides to act on that silence. An owner who is merely late can still check in — even in the
`ELIGIBLE` state — right up until the executor's transaction is mined.

## 3. Two asset models

You cannot give Carol 60% of a property deed.

| Asset | How it is divided | Claimed with | Custody |
|---|---|---|---|
| ETH | by beneficiary percentage | `claimInheritance()` | held by the contract |
| ERC-20 | by beneficiary percentage (rounded down, dust stays) | `claimInheritance()` | held by the contract |
| ERC-721 | whole, to one pre-assigned beneficiary | `claimAsset(i)` | held by the contract |
| Document | whole, to one pre-assigned beneficiary | `claimAsset(i)` | only its SHA-256 + CID on-chain; file encrypted off-chain |

**Escrow, not promises.** Tokens and NFTs are pulled into the contract when they are registered (after an
`approve`). A claim therefore can never fail because the owner moved the asset later, and `revokeWill()` /
`removeAsset()` hand everything back.

**Percentages are taken from a snapshot.** At activation the contract freezes the ETH and token balances. Each
beneficiary gets `snapshot × pct / 100`, so the order of claims does not matter. (Computing from the live balance
would pay the second claimant a percentage of what the first one left behind.)

**Unallocated share.** If percentages sum to less than 100, the remainder stays in the contract. The UI warns
about this; the contract does not prevent it, because a will with one 30% beneficiary is still a valid will.

## 4. Security

### Smart contract

| Rule | Where | Proved by (test) |
|---|---|---|
| Only the owner edits their will | `onlyOwnerOfWill` | "only the will owner can edit their own will" |
| Only the executor activates | `onlyExecutor` → `"Not authorized executor"` | "reverts for anyone who is not the executor" |
| Activation only when eligible | `require(getStatus(owner) == ELIGIBLE)` | "reverts before the deadline and during the grace period" |
| Status cannot be set by hand | computed from `block.timestamp` | "walks ACTIVE → MISSED → ELIGIBLE purely with the passage of time" |
| Percentages ≤ 100, fixable | `totalPercentage + pct <= 100`; `removeBeneficiary` frees it | "removeBeneficiary frees the percentage so a typo is fixable" |
| No double claim (fungible) | `hasClaimed` set before any transfer | "blocks a double claim" |
| No double claim / wrong claimant (whole) | `assignedTo == msg.sender`, `!isClaimed` | "rejects a beneficiary claiming someone else's asset" |
| No re-entrancy | `nonReentrant` + checks-effects-interactions | "a malicious beneficiary contract cannot re-enter claimInheritance" |
| NFT must really be the owner's | `ownerOf(tokenId) == msg.sender`, then escrowed | "refuses an NFT the caller does not hold, or one not approved" |
| No orphaned items | assignee must be a beneficiary; a beneficiary with items cannot be removed | "refuses to remove a beneficiary who still has assigned assets" |
| Bounded gas | max 20 beneficiaries, 50 assets | "caps the number of beneficiaries / assets" |
| Wills are isolated | all escrow keyed by owner | "keeps separate wills' escrow separate" |

The re-entrancy test deploys a hostile beneficiary contract whose `receive()` calls `claimInheritance` again; the
inner call dies on OpenZeppelin's `ReentrancyGuardReentrantCall` and the attacker ends up with exactly its share.

### Application

- Passwords: bcrypt. Sessions: JWT (12 h). Login failures are rate-limited; unknown e-mails take the same time as
  wrong passwords.
- Demo-wallet private keys: AES-256-GCM under `SERVER_ENCRYPTION_KEY`, decrypted in memory per request, never
  sent to the browser.
- Transactions: the backend relays only a fixed whitelist of actions (`actions.js`); arbitrary calldata is refused.
  Every transaction is dry-run first, so a revert comes back with the contract's own reason.
- MetaMask registration: the user signs a one-time challenge; the signature must recover to the claimed address.
- Documents: extension *and* magic-byte check, 10 MB limit, per-file AES-256-GCM key wrapped by the server key.
- Document release: the backend reads the specific asset from the contract and serves the file only if
  `assignedTo` is the caller and `isClaimed` is true — and only if the stored bytes still pass the integrity check.
- HTTP: helmet with a strict Content-Security-Policy (no inline scripts), CORS limited to the local origins.
- Push endpoints must belong to a real browser push service, so the server cannot be made to POST elsewhere.
- Admin: no wallet, no transaction rights; reads metrics only.

## 5. The chain clock (a Ganache trap worth explaining)

Ganache answers `eth_call` and `eth_estimateGas` against the **last mined block**. On a quiet local chain no block
is mined while everyone waits for a deadline, so:

- `getStatus()` read as a view keeps answering `ACTIVE` long after the deadline, and
- estimating gas for `activateInheritance()` fails with "not eligible" — even though the transaction would succeed
  if mined, because the *new* block would carry the current time.

Left alone, the executor's button would fail at exactly the moment the demo needs it. The backend handles it in
`chain.js`:

- `clock.now()` = wall clock + the node's time offset — the timestamp the next block would get.
- Phases shown in the UI are projected to `clock.now()` with the same comparisons the contract uses
  (`lifecycle.js`, unit-tested at the boundaries).
- `clock.tick()` mines one empty block before any transaction is simulated or sent, and whenever the scheduler
  sees a will cross a deadline — so the contract's own view catches up when it matters.

Both wallet modes pass through the backend first (`/tx/send`, `/tx/prepare`), so MetaMask's own gas estimate also
sees a fresh block. The contract still has the last word: it re-checks `block.timestamp` when the transaction is
mined. The API reports both — `status` (projected) and `onChain.status` (what the contract's view says right now).

## 6. Documents

1. Upload → server computes `sha256(plaintext)`, encrypts with a fresh AES-256-GCM key, stores the blob, and
   computes the blob's content ID (a real IPFS CIDv1).
2. `registerWholeAsset(DOCUMENT, …, sha256, cid, assignedTo)` commits both fingerprints on-chain.
3. **Verify integrity** re-derives both from the bytes in storage and compares them with the chain:
   content ID of the encrypted blob vs. `storageCID`, and SHA-256 of the decrypted file vs. `docHash`.
   Any edited byte changes the content ID, and AES-GCM refuses to decrypt it at all.
4. Download for a beneficiary requires their own on-chain `claimAsset(i)` of that document. Claiming ETH unlocks
   nothing.

**Swappable storage.** `storage/local.js` and `storage/ipfs.js` implement the same four functions
(`put`, `get`, `remove`, `cidOf`). `STORAGE_DRIVER=ipfs` sends the already-encrypted blob to a local Kubo node;
nothing else changes. For single-block files the locally computed CID and Kubo's CID are identical.

## 7. Notifications

- `scheduler.js` (node-cron, every 2 s) projects each live will to chain time and sends each stage once per
  check-in cycle: **CHECKIN_WARN** (last quarter of the interval) → **GRACE_START** → **GRACE_WARN** (last quarter
  of the grace period) → **ELIGIBLE**. If several became due while the server was off, only the latest is sent.
- `indexer.js` turns contract events into notifications: named executor, added beneficiary, assigned item,
  check-in confirmed, inheritance activated, claim successful, document unlocked, will revoked.
- Three channels per notification: the in-app bell (always), Web Push through the service worker (if the browser
  subscribed), e-mail (if SMTP is configured).

## 8. Where this differs from the original brief, and why

| Brief | Built | Reason |
|---|---|---|
| NFT registered with an ownership check only | NFT (and ERC-20) moved into escrow at registration | Otherwise the owner could transfer it away and the heir's claim would fail |
| `ethEscrow * pct / 100` at claim time | Percentage of a snapshot taken at activation | Makes payouts independent of claim order |
| Events without indexed fields | `owner` / `beneficiary` indexed; asset index, token, CID added | Filtering in the explorer; matching uploads to on-chain assets |
| — | `reassignAsset`, `removeAsset`, `updateSchedule`, `updateExecutor`, `getPhase`, `getWill`, `previewClaim` | Needed for "Edit will", the Settings page and the dashboards |
| `getStatus()` polled by cron | Phase projected by the backend + clock tick | See §5 |
| Document unlocked by `hasClaimed(owner, beneficiary)` | Unlocked by that asset's own `isClaimed` | Matches §6 of the brief: a fungible claim must not unlock a document |
| Private key stored in `demo_wallet_slots` | Stored once, on the user row; the slot table only maps slot → user | One copy of a secret instead of two |
| Jest + RTL | Vitest + RTL | Vitest runs Vite/ESM code natively; the test API is the same |
| OpenZeppelin (latest) | Pinned to 5.0.2, compiled for EVM `paris` | Newer releases use `MCOPY`, which Ganache 7 cannot execute |
| — | Security Lab page, admin fast-forward tool, `/tx/simulate` | Make the security demo and the timed demo practical |

## 9. Limits to state honestly

- **The executor is trusted to act.** If the owner is gone and the executor never activates, the assets stay in
  escrow. A fallback (e.g. any beneficiary may activate after a much longer delay) would remove this single point
  of failure and is the most valuable next step.
- **A will with no beneficiaries cannot be activated**, so its escrow is recoverable only by the owner.
- **The owner chooses the tokens.** An ERC-20 that reverts on transfer would block `claimInheritance` for that
  will. The demo only offers the bundled token.
- **Demo Wallet mode is custodial.** The server holds those keys (encrypted). It exists to make the demo quick;
  MetaMask mode is the non-custodial path.
- **Ganache's keys are public.** Anyone can import a Ganache account into MetaMask, so "owning" one proves nothing
  outside a local demo.
- **Document confidentiality rests on the server**, which holds the wrapping key. The chain guarantees integrity
  and the unlock condition, not secrecy from the operator.
- **Block timestamps** can be nudged by a block producer by a few seconds; irrelevant against intervals of days.
- **The JWT is kept in `localStorage`.** A strict CSP reduces the XSS risk; an `HttpOnly` cookie would remove it.
