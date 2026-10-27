import { ethers } from "ethers";
import { db } from "./db.js";
import { encryptSecret, decryptSecret, randomToken } from "./crypto.js";
import { provider, ganacheAccount, ganacheAddresses, GANACHE_SLOTS, lower, checksum } from "./chain.js";
import { HttpError } from "./http.js";

export const findUserById = (id) => db.prepare("SELECT * FROM users WHERE id = ?").get(id);
export const findUserByEmail = (email) => db.prepare("SELECT * FROM users WHERE email = ?").get(email);

/** What the browser is allowed to know about a user. Never includes key material. */
export function publicUser(row) {
  const slot = db.prepare("SELECT slot FROM demo_wallet_slots WHERE user_id = ?").get(row.id);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    walletAddress: row.wallet_address ? checksum(row.wallet_address) : null,
    walletMode: row.wallet_mode,
    demoAddress: row.demo_address ? checksum(row.demo_address) : null,
    ganacheSlot: slot ? slot.slot : null,
    createdAt: row.created_at,
  };
}

// ── Demo wallets ─────────────────────────────────────────────────────────────────

// Account 0 deploys the contracts, so it is handed out last.
const SLOT_ORDER = [...Array.from({ length: GANACHE_SLOTS - 1 }, (_, i) => i + 1), 0];
const OVERFLOW_BALANCE = ethers.toBeHex(ethers.parseEther("100"));

function addressInUse(address, exceptUserId = null) {
  const row = db
    .prepare("SELECT id FROM users WHERE (wallet_address = ? OR demo_address = ?) AND id IS NOT ?")
    .get(address, address, exceptUserId);
  return Boolean(row);
}

function storeDemoWallet(userId, wallet, slot) {
  const sealed = encryptSecret(wallet.privateKey);
  const address = lower(wallet.address);
  db.prepare(
    "UPDATE users SET demo_address = ?, encrypted_privkey = ?, privkey_iv = ?, privkey_tag = ? WHERE id = ?"
  ).run(address, sealed.enc, sealed.iv, sealed.tag, userId);
  if (slot !== null) {
    db.prepare("INSERT INTO demo_wallet_slots (slot, user_id, address) VALUES (?, ?, ?)").run(slot, userId, address);
  }
  return address;
}

/** Claim the next free pre-funded Ganache account for a user. Synchronous = race-free. */
const claimSlot = db.transaction((userId) => {
  const taken = new Set(db.prepare("SELECT slot FROM demo_wallet_slots").all().map((r) => r.slot));
  for (const slot of SLOT_ORDER) {
    if (taken.has(slot) || addressInUse(ganacheAddresses[slot])) continue;
    return { slot, address: storeDemoWallet(userId, ganacheAccount(slot), slot) };
  }
  return null;
});

/**
 * Give a user a backend-managed wallet: one of Ganache's 10 pre-funded accounts,
 * or — once those run out — a fresh key funded through the dev node.
 */
export async function assignDemoWallet(userId) {
  const claimed = claimSlot(userId);
  if (claimed) return claimed;

  const wallet = ethers.Wallet.createRandom();
  try {
    await provider.send("evm_setAccountBalance", [wallet.address, OVERFLOW_BALANCE]);
  } catch {
    throw new HttpError(
      409,
      "All 10 pre-funded Ganache accounts are already assigned. Register with MetaMask, or reset the demo with `npm run reset`."
    );
  }
  return { slot: null, address: db.transaction(() => storeDemoWallet(userId, wallet, null))() };
}

/** The signing wallet of a demo-mode user (decrypted in memory, per request). */
export function demoSigner(user) {
  if (user.wallet_mode !== "demo" || !user.encrypted_privkey) {
    throw new HttpError(409, "This account signs with MetaMask — the server holds no key for it.");
  }
  const privateKey = decryptSecret({
    enc: user.encrypted_privkey,
    iv: user.privkey_iv,
    tag: user.privkey_tag,
  }).toString("utf8");
  return new ethers.Wallet(privateKey);
}

// ── MetaMask ownership challenge ─────────────────────────────────────────────────

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_PENDING_CHALLENGES = 5000;
const challenges = new Map(); // lowercase address → { message, expires }

export function createChallenge(address) {
  const normalised = checksum(address);
  const message = [
    "ChainWill wants you to prove you control this wallet.",
    "",
    `Address: ${normalised}`,
    `Nonce: ${randomToken(16)}`,
    `Issued: ${new Date().toISOString()}`,
    "",
    "Signing this message is free and sends no transaction.",
  ].join("\n");
  for (const [key, value] of challenges) if (value.expires < Date.now()) challenges.delete(key);
  // bounded: this endpoint is unauthenticated, so never let it grow without limit
  if (challenges.size >= MAX_PENDING_CHALLENGES) challenges.delete(challenges.keys().next().value);
  challenges.set(lower(normalised), { message, expires: Date.now() + CHALLENGE_TTL_MS });
  return message;
}

/** Verifies a personal_sign signature over the pending challenge. One use only. */
export function verifyChallenge(address, signature) {
  const key = lower(address);
  const challenge = challenges.get(key);
  challenges.delete(key);
  if (!challenge || challenge.expires < Date.now()) {
    throw new HttpError(400, "Wallet challenge expired — please connect MetaMask again.");
  }
  let signer;
  try {
    signer = ethers.verifyMessage(challenge.message, signature);
  } catch {
    throw new HttpError(400, "Invalid wallet signature.");
  }
  if (lower(signer) !== key) throw new HttpError(400, "Signature does not match the wallet address.");
  return key;
}

export function assertAddressFree(address, exceptUserId = null) {
  if (addressInUse(lower(address), exceptUserId)) {
    throw new HttpError(409, "This wallet address is already linked to another ChainWill account.");
  }
}
