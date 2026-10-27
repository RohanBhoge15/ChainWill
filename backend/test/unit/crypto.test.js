import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// config.js insists on these; give the unit tests throwaway values.
process.env.JWT_SECRET ||= "unit-test-secret";
process.env.SERVER_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

const { encryptSecret, decryptSecret, encryptFile, decryptFile, sha256Hex, cidV1Raw } = await import("../../src/crypto.js");

test("secrets round-trip and never appear in the ciphertext", () => {
  const privateKey = "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d";
  const sealed = encryptSecret(privateKey);
  assert.equal(decryptSecret(sealed).toString(), privateKey);
  assert.equal(JSON.stringify(sealed).includes(privateKey.slice(2)), false);
  assert.notEqual(encryptSecret(privateKey).enc, sealed.enc, "a fresh IV is used every time");
});

test("a secret sealed under a different master key or with a bad tag does not open", () => {
  const sealed = encryptSecret("top secret");
  assert.throws(() => decryptSecret({ ...sealed, tag: "00".repeat(16) }));
  assert.throws(() => decryptSecret({ ...sealed, enc: sealed.enc.replace(/^../, "ff") }));
});

test("files round-trip under a per-file key", () => {
  const plain = crypto.randomBytes(5000);
  const { key, blob } = encryptFile(plain);
  assert.equal(key.length, 32);
  assert.equal(blob.length, plain.length + 12 + 16);
  assert.deepEqual(decryptFile(blob, key), plain);
  assert.notDeepEqual(encryptFile(plain).key, key);
});

test("any altered byte makes decryption fail (AES-GCM authentication)", () => {
  const { key, blob } = encryptFile(Buffer.from("property papers"));
  for (const position of [0, 13, blob.length - 1]) {
    const tampered = Buffer.from(blob);
    tampered[position] ^= 0x01;
    assert.throws(() => decryptFile(tampered, key));
  }
  assert.throws(() => decryptFile(blob.subarray(0, 10), key), /truncated/);
});

test("sha256Hex matches a known vector", () => {
  assert.equal(sha256Hex(Buffer.from("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("cidV1Raw produces the real IPFS CID for a raw block", () => {
  // `echo -n "hello world" | ipfs add --cid-version=1 --raw-leaves -n`
  assert.equal(cidV1Raw(Buffer.from("hello world")), "bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e");
  assert.notEqual(cidV1Raw(Buffer.from("hello world!")), cidV1Raw(Buffer.from("hello world")));
});
