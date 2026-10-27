/**
 * End-to-end test: plays the whole viva demo script against a RUNNING stack
 * (Ganache + deployed contracts + this backend) through the public HTTP API.
 *
 *   npm run test:e2e            (from the project root, with `npm run dev` or `npm start` running)
 *
 * Instead of waiting out the 2 min + 1 min timers it uses the admin
 * "fast-forward" demo tool, so ENABLE_DEMO_TOOLS must be true.
 * Every run registers brand-new users, so it can be repeated on the same chain.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { ethers } from "ethers";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(backendRoot, ".env"), quiet: true });

const API = process.env.API_URL || `http://127.0.0.1:${process.env.PORT || 4000}`;
const STORAGE_DIR = path.resolve(backendRoot, process.env.STORAGE_DIR || "secure-storage");
const run = crypto.randomBytes(3).toString("hex");
const PASSWORD = "correct-horse-battery";

let passed = 0;
const step = (title) => console.log(`\n\x1b[1m${title}\x1b[0m`);
const ok = (message) => {
  passed++;
  console.log(`  \x1b[32m✔\x1b[0m ${message}`);
};

async function api(method, route, { token, body, form, raw } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${API}/api${route}`, {
    method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
const get = (route, token) => api("GET", route, { token });
const post = (route, token, body = {}) => api("POST", route, { token, body });

/** Expect an API call to succeed and return its JSON. */
async function must(promise, expected = 200) {
  const { status, data } = await promise;
  assert.equal(status, expected, `expected HTTP ${expected}, got ${status}: ${JSON.stringify(data)}`);
  return data;
}

/** Expect the CONTRACT to reject a transaction with this reason. */
async function mustRevert(promise, reason) {
  const { status, data } = await promise;
  assert.equal(status, 400, `expected a revert, got HTTP ${status}: ${JSON.stringify(data)}`);
  assert.equal(data.reverted, true, `expected a contract revert: ${JSON.stringify(data)}`);
  assert.equal(data.error, reason);
  ok(`reverted: "${reason}"`);
}

const tx = (user, action, params = {}) => post("/tx/send", user.token, { action, params });
const send = (user, action, params) => must(tx(user, action, params));

async function register(name, extra = {}) {
  const email = `${name.toLowerCase()}.${run}@example.com`;
  const data = await must(post("/auth/register", null, { name, email, password: PASSWORD, walletMode: "demo", ...extra }), 201);
  return { name, email, token: data.token, address: data.user.walletAddress, user: data.user };
}

const notifications = async (user) => (await must(get("/notifications?limit=200", user.token))).notifications;
const hasNotification = async (user, type) => (await notifications(user)).some((n) => n.type === type);
const wallet = (user) => must(get("/wallet", user.token));
const myWill = async (user) => (await must(get("/wills/mine", user.token))).will;
const willOf = async (viewer, owner) => (await must(get(`/wills/${owner.address}`, viewer.token))).will;
const eventOf = (receipt, name) => receipt.events.find((e) => e.name === name);

async function main() {
  console.log(`ChainWill end-to-end test against ${API} (run ${run})`);

  // ───────────────────────────────────────────────────────────────────────────
  step("0. Stack is up");
  const health = await must(get("/health"));
  assert.equal(health.chain.reachable, true);
  const chain = await must(get("/chain/config"));
  assert.equal(chain.chainId, 1337);
  assert.equal(chain.demoTools, true, "ENABLE_DEMO_TOOLS must be true for this test");
  ok(`chain ${chain.chainId} reachable at block ${health.chain.blockNumber}, WillManager ${chain.contracts.WillManager}`);

  const admin = await must(post("/auth/login", null, { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }));
  assert.equal(admin.user.role, "admin");
  assert.equal(admin.user.walletAddress, null);
  const travel = (seconds) => must(post("/admin/time-travel", admin.token, { seconds }));
  ok("admin can log in and has no wallet (read-only role)");

  // ───────────────────────────────────────────────────────────────────────────
  step("1. Register Alice (owner), Bob (executor), Carol (60%), Dave (40%), Eve (outsider)");
  const alice = await register("Alice");
  const bob = await register("Bob");
  const carol = await register("Carol");
  const dave = await register("Dave");
  const eve = await register("Eve");
  const everyone = [alice, bob, carol, dave, eve];
  assert.equal(new Set(everyone.map((u) => u.address)).size, 5, "every user gets a distinct wallet");
  for (const user of everyone) {
    const w = await wallet(user);
    assert.equal(w.mode, "demo");
    assert.ok(Number(w.ethFormatted) > 90, `${user.name} should be funded, has ${w.ethFormatted} ETH`);
    assert.equal(JSON.stringify(user.user).includes("privkey"), false);
  }
  ok(`5 demo wallets assigned and funded (${everyone.map((u) => `${u.name} ${u.address.slice(0, 8)}…`).join(", ")})`);

  assert.equal((await post("/auth/register", null, { name: "Alice", email: alice.email, password: PASSWORD })).status, 409);
  assert.equal((await post("/auth/register", null, { name: "Zed", email: `zed.${run}@example.com`, password: "short" })).status, 400);
  assert.equal((await post("/auth/login", null, { email: alice.email, password: "wrong-password" })).status, 401);
  assert.equal((await get("/wills/mine")).status, 401);
  assert.equal((await get("/admin/metrics", alice.token)).status, 403);
  ok("duplicate e-mail, weak password, wrong password, missing token and non-admin access are all rejected");

  const login = await must(post("/auth/login", null, { email: alice.email, password: PASSWORD }));
  assert.equal(login.user.walletAddress, alice.address);
  ok("login returns the same on-chain identity");

  // ───────────────────────────────────────────────────────────────────────────
  step("2. Alice creates her will: interval 2 min, grace 1 min");
  assert.equal(await myWill(alice), null);
  const created = await send(alice, "createWill", { executor: bob.address, interval: 120, grace: 60 });
  assert.ok(eventOf(created, "WillCreated"));
  ok(`will created in tx ${created.txHash.slice(0, 12)}… (block ${created.blockNumber}, gas ${created.gasUsed})`);
  await must(api("PUT", "/wills/mine/meta", { token: alice.token, body: { title: "Alice's Last Will", note: "demo" } }));

  await mustRevert(tx(alice, "createWill", { executor: bob.address, interval: 120, grace: 60 }), "Will already exists");
  await mustRevert(tx(eve, "createWill", { executor: eve.address, interval: 120, grace: 60 }), "Owner cannot be the executor");

  // demo step 11: a wrong percentage is fixable
  await send(alice, "addBeneficiary", { wallet: carol.address, pct: 90 });
  await mustRevert(tx(alice, "addBeneficiary", { wallet: dave.address, pct: 40 }), "Total percentage exceeds 100");
  await send(alice, "removeBeneficiary", { wallet: carol.address });
  await send(alice, "addBeneficiary", { wallet: carol.address, pct: 60 });
  await send(alice, "addBeneficiary", { wallet: dave.address, pct: 40 });
  await mustRevert(tx(alice, "addBeneficiary", { wallet: eve.address, pct: 1 }), "Total percentage exceeds 100");
  ok("typo 90% → removed → Carol 60% + Dave 40% = 100%");

  // fungible assets
  await send(alice, "depositEth", { amount: "10" });
  await send(alice, "mintToken", { amount: "1000" });
  await mustRevert(tx(alice, "depositToken", { amount: "1000" }), "Token allowance too low — approve the WillManager first");
  await send(alice, "approveToken", { amount: "1000" });
  await send(alice, "depositToken", { amount: "1000" });
  ok("10 ETH and 1000 CWT escrowed (deposit without approval is refused)");

  // whole assets
  const deedId = eventOf(await send(alice, "mintNft", { name: "Property Deed", kind: "PROPERTY" }), "DeedMinted").args.tokenId;
  await mustRevert(tx(alice, "registerNft", { tokenId: deedId, assignedTo: eve.address }), "Assignee is not a beneficiary");
  await send(alice, "approveNft", { tokenId: deedId });
  const deedIndex = Number(eventOf(await send(alice, "registerNft", { tokenId: deedId, assignedTo: carol.address }), "AssetRegistered").args.assetIndex);
  const carId = eventOf(await send(alice, "mintNft", { name: "Car Title", kind: "VEHICLE" }), "DeedMinted").args.tokenId;
  await send(alice, "approveNft", { tokenId: carId });
  const carIndex = Number(eventOf(await send(alice, "registerNft", { tokenId: carId, assignedTo: dave.address }), "AssetRegistered").args.assetIndex);
  const eveNft = eventOf(await send(eve, "mintNft", { name: "Eve's Yacht", kind: "OTHER" }), "DeedMinted").args.tokenId;
  await mustRevert(tx(alice, "registerNft", { tokenId: eveNft, assignedTo: carol.address }), "Caller does not own this NFT");
  ok(`Property Deed NFT #${deedId} → Carol, Car Title NFT #${carId} → Dave`);

  // document
  const pdf = Buffer.from(`%PDF-1.4\n% ChainWill e2e ${run}\n1 0 obj << /Title (Property Papers) >> endobj\n%%EOF\n`);
  const uploadForm = (name, bytes) => {
    const form = new FormData();
    form.append("file", new Blob([bytes]), name);
    return form;
  };
  assert.equal((await api("POST", "/documents", { token: alice.token, form: uploadForm("malware.exe", pdf) })).status, 400);
  assert.equal((await api("POST", "/documents", { token: alice.token, form: uploadForm("fake.pdf", Buffer.from("not a pdf")) })).status, 400);
  const uploaded = (await must(api("POST", "/documents", { token: alice.token, form: uploadForm("property_papers.pdf", pdf) }), 201)).document;
  assert.equal(uploaded.sha256, crypto.createHash("sha256").update(pdf).digest("hex"));
  assert.equal(uploaded.onChain.registered, false);
  const blobPath = path.join(STORAGE_DIR, `${uploaded.cid}.enc`);
  assert.ok(fs.existsSync(blobPath), "encrypted blob is on disk");
  assert.equal(fs.readFileSync(blobPath).includes(Buffer.from("Property Papers")), false, "blob must not contain plaintext");
  ok("upload validated (wrong extension / wrong magic bytes refused), stored AES-encrypted at rest");

  const registered = await send(alice, "registerDocument", { documentId: uploaded.id, assignedTo: dave.address });
  const docIndex = Number(eventOf(registered, "AssetRegistered").args.assetIndex);
  assert.equal(eventOf(registered, "AssetRegistered").args.docHash, uploaded.sha256);
  await mustRevertHttp(tx(alice, "registerDocument", { documentId: uploaded.id, assignedTo: dave.address }), 400);
  ok(`sha256 + CID committed on-chain as asset #${docIndex}, assigned whole to Dave`);

  let will = await myWill(alice);
  assert.equal(will.phase, "ACTIVE");
  assert.equal(will.title, "Alice's Last Will");
  assert.equal(will.totalPercentage, 100);
  assert.equal(will.ethEscrowFormatted, "10");
  assert.equal(will.tokens[0].escrowedFormatted, "1000");
  assert.equal(will.assets.length, 5);
  assert.equal(will.assets[deedIndex].assignedTo.name, "Carol");
  assert.equal(will.assets[docIndex].document.originalName, "property_papers.pdf");
  assert.equal(will.beneficiaries.find((b) => b.name === "Carol").share.ethFormatted, "6");
  ok("live will read-back: ACTIVE, 100%, 10 ETH + 1000 CWT, 5 assets, Carol's projected share 6 ETH");

  // ───────────────────────────────────────────────────────────────────────────
  step("3. Explorer shows the events (public, no login)");
  const explorer = await must(get(`/explorer/events?address=${alice.address}&limit=200`));
  const names = new Set(explorer.events.map((e) => e.event));
  for (const expected of ["WillCreated", "BeneficiaryAdded", "BeneficiaryRemoved", "AssetRegistered", "AssetAssigned"]) {
    assert.ok(names.has(expected), `explorer is missing ${expected}`);
  }
  const createdRow = explorer.events.find((e) => e.event === "WillCreated");
  assert.equal(createdRow.txHash, created.txHash);
  const txDetail = await must(get(`/explorer/tx/${created.txHash}`));
  assert.equal(txDetail.succeeded, true);
  assert.equal(txDetail.from.name, "Alice");
  const filtered = await must(get(`/explorer/events?event=WillCreated&address=${eve.address}`));
  assert.equal(filtered.total, 0);
  ok(`${explorer.total} events for Alice's address with tx hash, block and timestamp; filters work`);

  // ───────────────────────────────────────────────────────────────────────────
  step("4. Roles see the will; notifications were delivered");
  assert.equal((await must(get("/wills/as-executor", bob.token))).wills.length, 1);
  assert.equal((await must(get("/wills/as-executor", carol.token))).wills.length, 0);
  const carolView = (await must(get("/wills/as-beneficiary", carol.token))).wills;
  assert.equal(carolView.length, 1);
  assert.equal(carolView[0].viewer.beneficiary.percentage, 60);
  assert.equal(carolView[0].assets[docIndex].document, null, "Carol must not see the name of Dave's document");
  assert.ok(await hasNotification(bob, "EXECUTOR_NAMED"));
  assert.ok(await hasNotification(carol, "BENEFICIARY_ADDED"));
  assert.ok(await hasNotification(carol, "ASSET_ASSIGNED"));
  assert.ok(await hasNotification(dave, "ASSET_ASSIGNED"));
  ok("Bob sees it as executor, Carol/Dave as beneficiaries; role notifications arrived");

  const daveDocs = await must(get("/documents", dave.token));
  assert.equal(daveDocs.inherited.length, 1);
  assert.equal(daveDocs.inherited[0].canDownload, false);
  assert.equal((await get(`/documents/${uploaded.id}/download`, dave.token)).status, 403);
  assert.equal((await get(`/documents/${uploaded.id}/download`, carol.token)).status, 403);
  assert.equal((await get(`/documents/${uploaded.id}/download`, eve.token)).status, 403);
  const ownerCopy = await api("GET", `/documents/${uploaded.id}/download`, { token: alice.token, raw: true });
  assert.equal(ownerCopy.status, 200);
  assert.deepEqual(Buffer.from(await ownerCopy.arrayBuffer()), pdf);
  ok("document is locked for everyone except its uploader before any claim");

  // ───────────────────────────────────────────────────────────────────────────
  step("5. Alice checks in → timer resets");
  await travel(40);
  const before = (await myWill(alice)).checkInDeadline;
  await send(alice, "checkIn");
  will = await myWill(alice);
  assert.ok(will.checkInDeadline > before);
  assert.equal(will.phase, "ACTIVE");
  assert.ok(await hasNotification(alice, "CHECKIN"));
  ok("deadline moved forward; check-in confirmation notification sent");
  await mustRevert(tx(bob, "activateInheritance", { owner: alice.address }), "Will is not eligible for inheritance");

  // ───────────────────────────────────────────────────────────────────────────
  step("6. Alice goes silent: warning → missed → grace → eligible");
  await travel(95); // 25s before the deadline
  assert.equal((await myWill(alice)).phase, "ACTIVE");
  assert.ok(await hasNotification(alice, "CHECKIN_WARN"));
  ok('T-minus: "⏰ Please check in" sent to Alice');

  await travel(30); // deadline passed
  will = await willOf(bob, alice);
  assert.equal(will.phase, "MISSED");
  assert.equal(will.status, "ACTIVE", "MISSED is a soft state — the on-chain status is still ACTIVE");
  assert.ok(await hasNotification(alice, "GRACE_START"));
  assert.ok(await hasNotification(bob, "GRACE_START"));
  ok("MISSED: grace-period notification sent to Alice and Bob");
  await mustRevert(tx(bob, "activateInheritance", { owner: alice.address }), "Will is not eligible for inheritance");

  await travel(45); // inside the last quarter of the grace period
  assert.ok(await hasNotification(bob, "GRACE_WARN"));
  ok('"🚨 becomes eligible soon" sent');

  await travel(15); // grace over
  will = await willOf(bob, alice);
  assert.equal(will.phase, "ELIGIBLE");
  assert.equal(will.status, "ELIGIBLE");
  assert.equal(will.onChain.status, "ELIGIBLE", "the contract itself now reports ELIGIBLE");
  assert.ok(await hasNotification(bob, "ELIGIBLE"));
  ok("ELIGIBLE: contract view agrees, Bob is told he can activate");

  // ───────────────────────────────────────────────────────────────────────────
  step("7. Only the executor can activate");
  await mustRevert(tx(eve, "activateInheritance", { owner: alice.address }), "Not authorized executor");
  await mustRevert(tx(carol, "activateInheritance", { owner: alice.address }), "Not authorized executor");
  await mustRevert(tx(carol, "claimInheritance", { owner: alice.address }), "Inheritance has not been activated");
  const activation = await send(bob, "activateInheritance", { owner: alice.address });
  assert.ok(eventOf(activation, "InheritanceActivated"));
  will = await willOf(bob, alice);
  assert.equal(will.phase, "ACTIVATED");
  assert.equal(will.ethSnapshotFormatted, "10");
  assert.ok(await hasNotification(carol, "ACTIVATED"));
  assert.ok(await hasNotification(dave, "ACTIVATED"));
  assert.ok(await hasNotification(bob, "ACTIVATED_BY_YOU"));
  ok(`Bob activated in tx ${activation.txHash.slice(0, 12)}…; Carol and Dave were notified`);
  await mustRevert(tx(alice, "checkIn"), "Will is no longer active");

  // ───────────────────────────────────────────────────────────────────────────
  step("8. Carol claims her 60% and the Property Deed NFT");
  const carolBefore = await wallet(carol);
  const carolClaim = await send(carol, "claimInheritance", { owner: alice.address });
  const carolAfter = await wallet(carol);
  const gained = Number(ethers.formatEther(BigInt(carolAfter.eth) - BigInt(carolBefore.eth)));
  assert.ok(gained > 5.99 && gained <= 6, `Carol should gain 6 ETH minus gas, gained ${gained}`);
  assert.equal(carolAfter.token.balanceFormatted, "600");
  await send(carol, "claimAsset", { owner: alice.address, assetIndex: deedIndex });
  assert.deepEqual((await wallet(carol)).nfts.map((n) => n.name), ["Property Deed"]);
  assert.ok(await hasNotification(carol, "CLAIMED"));
  assert.equal((await willOf(carol, alice)).phase, "PARTIALLY_CLAIMED");
  ok(`+${gained.toFixed(4)} ETH, 600 CWT and the deed NFT are in Carol's wallet (tx ${carolClaim.txHash.slice(0, 12)}…)`);

  // ───────────────────────────────────────────────────────────────────────────
  step("9. Dave claims his 40%, the car NFT and the document");
  await send(dave, "claimInheritance", { owner: alice.address });
  assert.equal((await wallet(dave)).token.balanceFormatted, "400");
  assert.equal(
    (await get(`/documents/${uploaded.id}/download`, dave.token)).status,
    403,
    "claiming ETH must NOT unlock the document"
  );
  ok("fungible claim alone does not unlock the document");
  await send(dave, "claimAsset", { owner: alice.address, assetIndex: carIndex });
  await send(dave, "claimAsset", { owner: alice.address, assetIndex: docIndex });
  const daveCopy = await api("GET", `/documents/${uploaded.id}/download`, { token: dave.token, raw: true });
  assert.equal(daveCopy.status, 200);
  assert.equal(daveCopy.headers.get("x-document-sha256"), uploaded.sha256);
  assert.deepEqual(Buffer.from(await daveCopy.arrayBuffer()), pdf);
  assert.ok(await hasNotification(dave, "DOC_UNLOCKED"));
  ok("after claimAsset(document) on-chain, Dave downloads the decrypted, byte-identical PDF");

  will = await willOf(dave, alice);
  assert.equal(will.phase, "FULLY_CLAIMED");
  assert.equal(will.ethEscrowFormatted, "0");
  assert.equal(will.claims.length >= 6, true);
  assert.ok(will.claims.every((c) => /^0x[0-9a-f]{64}$/.test(c.txHash)));
  ok(`will is FULLY_CLAIMED, escrow is empty, ${will.claims.length} claim receipts with tx hashes`);

  // ───────────────────────────────────────────────────────────────────────────
  step("10. Security demo — the contract refuses");
  await mustRevert(tx(carol, "claimInheritance", { owner: alice.address }), "Already claimed");
  await mustRevert(tx(carol, "claimAsset", { owner: alice.address, assetIndex: deedIndex }), "Already claimed");
  await mustRevert(tx(dave, "claimAsset", { owner: alice.address, assetIndex: deedIndex }), "Not the assigned beneficiary");
  await mustRevert(tx(eve, "claimInheritance", { owner: alice.address }), "Not a beneficiary");
  await mustRevert(tx(eve, "activateInheritance", { owner: alice.address }), "Not authorized executor");
  assert.equal((await get(`/documents/${uploaded.id}/download`, carol.token)).status, 403);
  assert.equal((await post("/tx/send", eve.token, { action: "selfdestruct", params: {} })).status, 400);
  ok("unknown actions are not relayed; Carol still cannot read Dave's document");

  // ───────────────────────────────────────────────────────────────────────────
  step("11. Tamper demo — edit the stored file");
  let verdict = await must(post(`/documents/${uploaded.id}/verify`, dave.token));
  assert.equal(verdict.ok, true);
  assert.equal(verdict.expected.source, "blockchain");
  assert.equal(verdict.actual.sha256, uploaded.sha256);
  ok("untouched file verifies against the on-chain fingerprints");

  const original = fs.readFileSync(blobPath);
  const tampered = Buffer.from(original);
  tampered[20] ^= 0xff;
  fs.writeFileSync(blobPath, tampered);
  try {
    verdict = await must(post(`/documents/${uploaded.id}/verify`, dave.token));
    assert.equal(verdict.ok, false);
    assert.equal(verdict.checks.cid, false);
    assert.notEqual(verdict.actual.cid, verdict.expected.cid);
    assert.match(verdict.problem, /Hash mismatch/);
    assert.equal((await get(`/documents/${uploaded.id}/download`, dave.token)).status, 409);
    ok(`one flipped byte → "${verdict.problem}" and the download is refused`);
  } finally {
    fs.writeFileSync(blobPath, original);
  }
  assert.equal((await must(post(`/documents/${uploaded.id}/verify`, alice.token))).ok, true);
  assert.equal((await post(`/documents/${uploaded.id}/verify`, eve.token)).status, 403);
  ok("restored file verifies again; outsiders cannot even run the check");

  // ───────────────────────────────────────────────────────────────────────────
  step("12. MetaMask Mode: sign in the 'browser', backend only prepares + confirms");
  const provider = new ethers.JsonRpcProvider(chain.rpcUrl, chain.chainId, { staticNetwork: true });
  const mm = ethers.Wallet.createRandom().connect(provider);
  await provider.send("evm_setAccountBalance", [mm.address, ethers.toBeHex(ethers.parseEther("50"))]);

  const challenge = await must(get(`/auth/challenge?address=${mm.address}`));
  const forged = await ethers.Wallet.createRandom().signMessage(challenge.message);
  assert.equal(
    (await post("/auth/register", null, { name: "Mallory", email: `mallory.${run}@example.com`, password: PASSWORD, walletMode: "metamask", address: mm.address, signature: forged })).status,
    400
  );
  ok("a signature from a different key is rejected");

  const challenge2 = await must(get(`/auth/challenge?address=${mm.address}`));
  const frank = await register("Frank", { walletMode: "metamask", address: mm.address, signature: await mm.signMessage(challenge2.message) });
  assert.equal(frank.address, mm.address);
  assert.equal(frank.user.walletMode, "metamask");
  assert.equal((await tx(frank, "checkIn")).status, 409, "the backend holds no key for MetaMask users");

  const viaMetaMask = async (action, params = {}) => {
    const prepared = await must(post("/tx/prepare", frank.token, { action, params }));
    assert.equal(prepared.tx.from, mm.address);
    const sent = await mm.sendTransaction({ to: prepared.tx.to, data: prepared.tx.data, value: prepared.tx.value });
    return must(post("/tx/confirm", frank.token, { txHash: sent.hash, action }));
  };
  await viaMetaMask("createWill", { executor: eve.address, interval: 3600, grace: 600 });
  await viaMetaMask("addBeneficiary", { wallet: carol.address, pct: 100 });
  await viaMetaMask("depositEth", { amount: "2.5" });
  const franksWill = await myWill(frank);
  assert.equal(franksWill.ethEscrowFormatted, "2.5");
  assert.equal(franksWill.executor.name, "Eve");
  ok("will created, beneficiary added and 2.5 ETH escrowed with browser-side signatures");

  const doomed = await post("/tx/prepare", frank.token, { action: "addBeneficiary", params: { wallet: dave.address, pct: 5 } });
  assert.equal(doomed.status, 400);
  assert.equal(doomed.data.error, "Total percentage exceeds 100");
  ok("prepare dry-runs the call and reports the contract's revert reason before MetaMask opens");
  assert.equal((await post("/tx/confirm", eve.token, { txHash: created.txHash })).status, 403);
  ok("confirming somebody else's transaction is refused");

  const balanceBefore = await provider.getBalance(mm.address);
  const revoked = await viaMetaMask("revokeWill");
  assert.equal(ethers.formatEther(eventOf(revoked, "WillRevoked").args.ethRefunded), "2.5");
  assert.ok((await provider.getBalance(mm.address)) > balanceBefore + ethers.parseEther("2.49"));
  assert.equal((await myWill(frank)).phase, "REVOKED");
  assert.ok(await hasNotification(eve, "REVOKED"));
  ok("revokeWill returned the 2.5 ETH; executor notified");

  // ───────────────────────────────────────────────────────────────────────────
  step("13. Link / unlink MetaMask on a demo account");
  const mm2 = ethers.Wallet.createRandom();
  const linkChallenge = await must(get(`/auth/challenge?address=${mm2.address}`));
  const linked = await must(post("/wallet/link-metamask", eve.token, { address: mm2.address, signature: await mm2.signMessage(linkChallenge.message) }));
  assert.equal(linked.user.walletMode, "metamask");
  assert.equal(linked.user.walletAddress, mm2.address);
  const takenChallenge = await must(get(`/auth/challenge?address=${mm.address}`));
  assert.equal(
    (await post("/wallet/link-metamask", eve.token, { address: mm.address, signature: await mm.signMessage(takenChallenge.message) })).status,
    409
  );
  const unlinked = await must(post("/wallet/unlink-metamask", eve.token));
  assert.equal(unlinked.user.walletMode, "demo");
  assert.equal(unlinked.user.walletAddress, eve.address);
  ok("identity switches to the MetaMask address and back; an address in use cannot be linked twice");

  // ───────────────────────────────────────────────────────────────────────────
  step("14. Admin transparency dashboard reports real values");
  const metrics = await must(get("/admin/metrics", admin.token));
  assert.ok(metrics.users.total >= 7);
  assert.ok(metrics.wills.total >= 2);
  assert.ok(metrics.wills.phases.FULLY_CLAIMED >= 1);
  assert.ok(metrics.wills.phases.REVOKED >= 1);
  assert.ok(Number(metrics.claims.ethClaimed) >= 10);
  assert.ok(Number(metrics.claims.tokensClaimed) >= 1000);
  assert.ok(metrics.claims.nftsClaimed >= 2 && metrics.claims.documentsClaimed >= 1);
  assert.ok(metrics.activity.activations >= 1 && metrics.activity.checkIns >= 2);
  assert.ok(BigInt(metrics.activity.gasUsed) > 0n);
  assert.equal(metrics.accounts.length, 10);
  const onChainEscrow = ethers.formatEther(await provider.getBalance(chain.contracts.WillManager));
  assert.equal(Number(metrics.escrow.eth), Number(onChainEscrow), "escrow metric equals the contract's real balance");
  const adminUsers = await must(get("/admin/users", admin.token));
  assert.equal(adminUsers.users.find((u) => u.email === alice.email).ownWillPhase, "FULLY_CLAIMED");
  assert.equal((await post("/tx/send", admin.token, { action: "checkIn", params: {} })).status, 409);
  ok(
    `${metrics.users.total} users, ${metrics.wills.total} wills, ${metrics.claims.ethClaimed} ETH claimed, ` +
      `${metrics.activity.transactions} txs, ${metrics.activity.gasUsed} gas — admin itself cannot transact`
  );

  // ───────────────────────────────────────────────────────────────────────────
  step("15. Notification centre");
  const inbox = await must(get("/notifications", dave.token));
  assert.ok(inbox.unread > 0);
  await must(post(`/notifications/${inbox.notifications[0].id}/read`, dave.token));
  assert.equal((await must(get("/notifications", dave.token))).unread, inbox.unread - 1);
  await must(post("/notifications/read-all", dave.token));
  assert.equal((await must(get("/notifications", dave.token))).unread, 0);
  const push = await must(get("/notifications/push/config", dave.token));
  assert.equal(typeof push.enabled, "boolean");
  ok(`Dave had ${inbox.notifications.length} notifications; mark-read and read-all work; push ${push.enabled ? "configured" : "not configured"}`);

  console.log(`\n\x1b[32m\x1b[1mALL GOOD — ${passed} checks passed.\x1b[0m\n`);
}

async function mustRevertHttp(promise, status) {
  const res = await promise;
  assert.equal(res.status, status, JSON.stringify(res.data));
}

main().catch((err) => {
  console.error(`\n\x1b[31m\x1b[1mFAILED after ${passed} passing checks\x1b[0m\n`);
  console.error(err);
  process.exit(1);
});
