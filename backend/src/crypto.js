import crypto from "node:crypto";
import { config } from "./config.js";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

// ── Small secrets (demo-wallet private keys, per-document keys) ──────────────
// Encrypted with the server master key; iv/tag are stored next to the ciphertext.

export function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, config.serverEncryptionKey, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  return { enc: enc.toString("hex"), iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex") };
}

export function decryptSecret({ enc, iv, tag }) {
  const decipher = crypto.createDecipheriv(ALGO, config.serverEncryptionKey, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(enc, "hex")), decipher.final()]);
}

// ── Files ────────────────────────────────────────────────────────────────────
// Each document gets its own random key. Blob layout: iv(12) | ciphertext | tag(16).

export function encryptFile(plain) {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { key, blob: Buffer.concat([iv, body, cipher.getAuthTag()]) };
}

/** Throws if the blob was altered (GCM authentication fails). */
export function decryptFile(blob, key) {
  if (blob.length < IV_BYTES + TAG_BYTES) throw new Error("Encrypted blob is truncated");
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const body = blob.subarray(IV_BYTES, blob.length - TAG_BYTES);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

export const sha256Hex = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
function base32(bytes) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/**
 * A genuine IPFS CIDv1 (multibase base32, codec `raw`, multihash sha2-256) of
 * the given bytes. It is exactly what `ipfs add --cid-version=1 --raw-leaves`
 * prints for a single-block file, so the local store and a real IPFS node agree
 * on small files and the storage layer stays swappable.
 */
export function cidV1Raw(buf) {
  const digest = crypto.createHash("sha256").update(buf).digest();
  return "b" + base32(Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), digest]));
}

export const randomToken = (bytes = 16) => crypto.randomBytes(bytes).toString("hex");
