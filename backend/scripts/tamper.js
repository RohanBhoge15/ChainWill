/**
 * Tamper demo helper (demo step 10).
 *
 *   npm run demo:tamper     flips one byte in the newest stored document
 *   npm run demo:restore    puts the original bytes back
 *
 * Then click "Verify integrity" in the Document Vault: the re-computed
 * fingerprints no longer match the ones committed on-chain.
 * Equivalent to opening the .enc file in a hex editor and changing a byte.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../src/config.js";

if (config.storageDriver !== "local") {
  console.error("The tamper demo works on the local storage driver only (IPFS content is immutable by design).");
  process.exit(1);
}

const dir = config.storageDir;
const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];

if (process.argv.includes("--restore")) {
  const backups = files.filter((f) => f.endsWith(".bak"));
  for (const backup of backups) {
    fs.renameSync(path.join(dir, backup), path.join(dir, backup.replace(/\.bak$/, "")));
    console.log(`restored ${backup.replace(/\.bak$/, "")}`);
  }
  if (backups.length === 0) console.log("nothing to restore");
  process.exit(0);
}

const blobs = files
  .filter((f) => f.endsWith(".enc") && !files.includes(`${f}.bak`))
  .map((f) => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);

if (blobs.length === 0) {
  console.error(`No untampered documents found in ${dir}. Upload one in the Document Vault first.`);
  process.exit(1);
}

const target = path.join(dir, blobs[0].name);
const bytes = fs.readFileSync(target);
fs.writeFileSync(`${target}.bak`, bytes);
const position = Math.floor(bytes.length / 2);
const before = bytes[position];
bytes[position] ^= 0xff;
fs.writeFileSync(target, bytes);

console.log(`tampered ${blobs[0].name}`);
console.log(`  byte ${position}: 0x${before.toString(16).padStart(2, "0")} → 0x${bytes[position].toString(16).padStart(2, "0")}`);
console.log('Now click "Verify integrity" on that document. Undo with: npm run demo:restore');
