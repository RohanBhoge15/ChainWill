import path from "node:path";
import { db } from "./db.js";
import { storage } from "./storage/index.js";
import { encryptFile, decryptFile, encryptSecret, decryptSecret, sha256Hex, cidV1Raw } from "./crypto.js";
import { manager, lower, ASSET_TYPES } from "./chain.js";
import { bad } from "./http.js";

// extension → { mime, sniff(buffer) }. The stored MIME type comes from this table,
// never from what the browser claimed.
const startsWith = (...bytes) => (buf) => bytes.every((b, i) => buf[i] === b);
const looksLikeText = (buf) => !buf.subarray(0, 4096).includes(0);
const FILE_TYPES = {
  ".pdf": { mime: "application/pdf", sniff: startsWith(0x25, 0x50, 0x44, 0x46) }, // %PDF
  ".png": { mime: "image/png", sniff: startsWith(0x89, 0x50, 0x4e, 0x47) },
  ".jpg": { mime: "image/jpeg", sniff: startsWith(0xff, 0xd8, 0xff) },
  ".jpeg": { mime: "image/jpeg", sniff: startsWith(0xff, 0xd8, 0xff) },
  ".txt": { mime: "text/plain; charset=utf-8", sniff: looksLikeText },
  ".docx": {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sniff: startsWith(0x50, 0x4b, 0x03, 0x04), // zip container
  },
  ".doc": { mime: "application/msword", sniff: startsWith(0xd0, 0xcf, 0x11, 0xe0) },
};
export const ALLOWED_EXTENSIONS = Object.keys(FILE_TYPES);

/** Validate, encrypt and store an upload. Nothing touches the chain yet. */
export async function storeDocument({ user, originalName, buffer }) {
  // multer hands us latin1; browsers send UTF-8 file names
  const name = path.basename(Buffer.from(originalName, "latin1").toString("utf8")).slice(0, 200) || "document";
  const type = FILE_TYPES[path.extname(name).toLowerCase()];
  if (!type) throw bad(`File type not allowed. Accepted: ${ALLOWED_EXTENSIONS.join(", ")}`);
  if (buffer.length === 0) throw bad("File is empty");
  if (!type.sniff(buffer)) throw bad("File content does not match its extension");

  const sha256 = sha256Hex(buffer); // fingerprint of the PLAINTEXT — this is what goes on-chain
  const { key, blob } = encryptFile(buffer);
  const stored = await storage.put(cidV1Raw(blob), blob);
  const wrapped = encryptSecret(key);

  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO documents
         (owner_user_id, owner_address, original_name, mime_type, size_bytes, encrypted_path, sha256_hash, cid, key_enc, key_iv, key_tag)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(user.id, lower(user.wallet_address), name, type.mime, buffer.length, stored.locator, sha256, stored.cid, wrapped.enc, wrapped.iv, wrapped.tag);
  return db.prepare("SELECT * FROM documents WHERE id = ?").get(lastInsertRowid);
}

/** The on-chain asset a document row points at, read LIVE from the contract. */
export async function onChainAsset(doc) {
  if (doc.asset_index === null) return null;
  const assets = await manager.getAssets(doc.owner_address);
  const asset = assets[doc.asset_index];
  if (!asset || ASSET_TYPES[Number(asset.assetType)] !== "DOCUMENT") return null;
  // the row must still describe this exact asset (guards against a stale cache)
  if (asset.docHash !== doc.sha256_hash || asset.storageCID !== doc.cid) return null;
  return {
    index: doc.asset_index,
    docHash: asset.docHash,
    storageCID: asset.storageCID,
    assignedTo: asset.assignedTo,
    isClaimed: asset.isClaimed,
    removed: asset.removed,
  };
}

function documentKey(doc) {
  return decryptSecret({ enc: doc.key_enc, iv: doc.key_iv, tag: doc.key_tag });
}

/**
 * Tamper check. Re-derives both fingerprints from the bytes in storage and
 * compares them with what was committed on-chain (or, for a document that is
 * not registered yet, with what was recorded at upload).
 *   1. content id of the encrypted blob  vs  storageCID
 *   2. sha256 of the decrypted plaintext vs  docHash
 */
export async function verifyDocument(doc, asset) {
  const expected = {
    cid: asset ? asset.storageCID : doc.cid,
    sha256: asset ? asset.docHash : doc.sha256_hash,
    source: asset ? "blockchain" : "upload record (not yet on-chain)",
  };
  const result = {
    ok: false,
    expected,
    actual: { cid: null, sha256: null },
    checks: { stored: false, cid: false, decrypt: false, sha256: false },
    problem: null,
    verifiedAt: new Date().toISOString(),
  };

  let blob;
  try {
    blob = await storage.get(doc.cid);
    result.checks.stored = true;
  } catch {
    result.problem = "The stored file is missing.";
    return result;
  }

  result.actual.cid = await storage.cidOf(blob);
  result.checks.cid = result.actual.cid === expected.cid;

  try {
    const plain = decryptFile(blob, documentKey(doc));
    result.checks.decrypt = true;
    result.actual.sha256 = sha256Hex(plain);
    result.checks.sha256 = result.actual.sha256 === expected.sha256;
  } catch {
    // AES-GCM refuses to decrypt altered ciphertext, so there is no plaintext to hash
    result.actual.sha256 = null;
  }

  result.ok = Object.values(result.checks).every(Boolean);
  if (!result.ok) {
    result.problem = !result.checks.cid
      ? "Hash mismatch — the stored file was altered after its fingerprint was recorded."
      : !result.checks.decrypt
        ? "The stored file could not be decrypted."
        : "Hash mismatch — the document does not match the on-chain SHA-256.";
  }
  return result;
}

/** Decrypt for download. Refuses to hand out bytes that fail the integrity check. */
export async function openDocument(doc, asset) {
  const verdict = await verifyDocument(doc, asset);
  if (!verdict.ok) return { verdict, plain: null };
  const plain = decryptFile(await storage.get(doc.cid), documentKey(doc));
  return { verdict, plain };
}

export async function deleteDocument(doc) {
  await storage.remove(doc.cid);
  db.prepare("DELETE FROM documents WHERE id = ?").run(doc.id);
}
