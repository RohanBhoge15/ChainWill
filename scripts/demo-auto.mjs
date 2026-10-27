/**
 * ChainWill — one-command automatic demo.
 *
 *   npm run demo:auto
 *
 * Opens Chrome, drives the real frontend through the whole lifecycle, and pauses
 * at marked "GANACHE MOMENT"s so you can switch to the Ganache GUI and show the
 * same addresses / balances / transactions.
 *
 * Before running:
 *   - Ganache GUI must be open on the prepared workspace (chain ID 1337, port 7545).
 *   - The app must be running:  npm start
 *   - The demo state must be clean. If it is not:
 *       stop the app (Ctrl+C)
 *       npm run demo:reset
 *       npm start
 *
 * Useful env vars:
 *   DEMO_SPEED=1.4       slower, easier to narrate
 *   GANACHE_PAUSE=25     seconds to leave each Ganache moment on screen
 *   DEMO_CLOSE=1         close the browser when finished (instead of leaving it open)
 *   DEMO_HEADLESS=1      useful only for testing the script
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function backendEnv(name) {
  const file = path.join(ROOT, "backend", ".env");
  if (!fs.existsSync(file)) return undefined;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match?.[1] === name) return match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return undefined;
}

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || backendEnv("ADMIN_EMAIL") || "admin@chainwill.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || backendEnv("ADMIN_PASSWORD");
if (!ADMIN_PASSWORD) {
  console.error("Admin password not found. Set ADMIN_PASSWORD or run `npm run setup` to create backend/.env.");
  process.exit(1);
}

const BASE = process.env.DEMO_URL || "http://localhost:4000";
const SPEED = Number(process.env.DEMO_SPEED || 1);
const GANACHE_PAUSE = Math.max(5, Number(process.env.GANACHE_PAUSE || 18));
const CLOSE_AT_END = process.env.DEMO_CLOSE === "1";
const HEADLESS = process.env.DEMO_HEADLESS === "1";
const PDF = path.join(ROOT, "demo", "property_papers.pdf");
const SHOTS = path.join(ROOT, "demo", "screenshots");
const DOWNLOAD = path.join(ROOT, "demo", "downloaded_property_papers.pdf");

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);

const CHROME = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error("Chrome or Edge was not found. Install Chrome, or set CHROME_PATH.");
  process.exit(1);
}

const USERS = {
  alice: { email: "alice@chainwill.demo", password: "ChainWill123", address: "0xC9fcd38E90D17c024c76034cC1954d56F808FDf4", label: "Alice" },
  bob: { email: "bob@chainwill.demo", password: "ChainWill123", address: "0xC490D1c3F7e942A5049F851aBBC7e3DCAD84ae8a", label: "Bob" },
  carol: { email: "carol@chainwill.demo", password: "ChainWill123", address: "0x73B6D91470dB8AA514eA19E9Fa8675fEC0a8b8AD", label: "Carol" },
  dave: { email: "dave@chainwill.demo", password: "ChainWill123", address: "0xb51475F06D4d0d6BA4419e65c1856a5044c3eE3F", label: "Dave" },
  admin: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, address: null, label: "Admin" },
};

const CONTRACTS = {
  willManager: "0xEe3bf8b1C10320b56e99B0E98e521c28C3aFDd83",
  token: "0xfc1Cd5387c893fc0c3Aa62735c74CfC81309FE32",
  nft: "0xB95F5E8E85A2C6A934f9DEf186Ba079708Ac3626",
};

const GANACHE_ACCOUNTS = [
  ["#0", "0x1EEB51183Fe60f4Faa748b4da1133e2dCFC68ac5", "deployer (not a user)"],
  ["#1", USERS.alice.address, "Alice (owner)"],
  ["#2", USERS.bob.address, "Bob (executor)"],
  ["#3", USERS.carol.address, "Carol (60%)"],
  ["#4", USERS.dave.address, "Dave (40%)"],
];

const BANNER_SCRIPT = `
(() => {
  const TONES = {
    emerald: ["#34d399", "rgba(16,185,129,.16)", "#a7f3d0"],
    amber:   ["#fbbf24", "rgba(245,158,11,.18)", "#fde68a"],
    rose:    ["#fb7185", "rgba(244,63,94,.18)", "#fecdd3"],
    sky:     ["#38bdf8", "rgba(14,165,233,.16)", "#bae6fd"],
  };
  const install = () => {
    if (document.getElementById("cw-demo-banner")) return;
    const wrap = document.createElement("div");
    wrap.id = "cw-demo-banner";
    wrap.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483647;width:min(960px,96vw);pointer-events:none;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;";
    wrap.innerHTML = [
      '<div id="cw-demo-card" style="border:1px solid #34d399;background:rgba(7,15,24,.94);backdrop-filter:blur(14px);border-radius:16px;padding:14px 18px;box-shadow:0 18px 60px rgba(0,0,0,.55);">',
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">',
      '<span id="cw-demo-step" style="display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;border-radius:999px;background:#34d399;color:#04120c;font-size:11px;font-weight:800;padding:0 7px;">1</span>',
      '<span id="cw-demo-title" style="color:#f8fafc;font-size:15px;font-weight:750;letter-spacing:.2px;">ChainWill demo</span>',
      '</div>',
      '<div id="cw-demo-detail" style="color:#cbd5e1;font-size:13px;line-height:1.45;">Preparing…</div>',
      '</div>',
    ].join("");
    document.documentElement.appendChild(wrap);
  };
  const KEY = "chainwill.demoBanner";
  const render = (state) => {
    install();
    const { step = 1, title = "ChainWill demo", detail = "Preparing...", tone = "emerald" } = state || {};
    const [border] = TONES[tone] || TONES.emerald;
    const card = document.getElementById("cw-demo-card");
    const badge = document.getElementById("cw-demo-step");
    card.style.borderColor = border;
    card.style.background = "rgba(7,15,24,.94)";
    badge.style.background = border;
    badge.textContent = String(step);
    document.getElementById("cw-demo-title").textContent = title;
    document.getElementById("cw-demo-detail").textContent = detail;
  };
  const readState = () => {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) || "null");
    } catch {
      return null;
    }
  };
  window.__cwDemo = {
    set(step, title, detail, tone = "emerald") {
      const state = { step, title, detail, tone };
      try {
        sessionStorage.setItem(KEY, JSON.stringify(state));
      } catch {
        /* sessionStorage may be unavailable on about:blank */
      }
      render(state);
    },
    hide() {
      try {
        sessionStorage.removeItem(KEY);
      } catch {
        /* ignore */
      }
      const el = document.getElementById("cw-demo-banner");
      if (el) el.remove();
    },
  };
  const start = () => {
    const state = readState();
    if (state) render(state);
    else install();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
`;

// ── terminal helpers ────────────────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  amber: "\x1b[33m",
  rose: "\x1b[31m",
  white: "\x1b[97m",
};
const toAscii = (value) =>
  String(value)
    .replace(/[—–]/g, "-")
    .replace(/[≈]/g, "~")
    .replace(/[→]/g, "->")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[·•]/g, "-")
    .replace(/[⏳]/g, "")
    .replace(/[✔✓]/g, "OK")
    .replace(/[×]/g, "x")
    .replace(/[^\x00-\x7F]/g, "?");
const log = (...args) => console.log(...args.map(toAscii));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function bigBanner(lines, color = c.cyan) {
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  log(`\n${color}${"═".repeat(width)}${c.reset}`);
  for (const line of lines) log(`${color}  ${line.padEnd(width - 4)}  ${c.reset}`);
  log(`${color}${"═".repeat(width)}${c.reset}\n`);
}

// ── API helpers ────────────────────────────────────────────────────────────────
async function apiLogin(user) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  if (!res.ok) throw new Error(`Login failed for ${user.email}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function preflight() {
  if (!fs.existsSync(PDF)) throw new Error(`Demo PDF missing: ${PDF}`);
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
  if (!health?.ok) throw new Error(`The ChainWill app is not reachable at ${BASE}. Run "npm start" first.`);
  if (Number(health.chain.chainId) !== 1337) throw new Error(`Expected chain 1337, found ${health.chain.chainId}.`);
  const explorer = await fetch(`${BASE}/api/explorer/wills`).then((r) => r.json());
  if ((explorer.wills || []).length > 0) {
    throw new Error(
      `The demo state already has ${explorer.wills.length} will(s).\n` +
        `Stop the app (Ctrl+C), run "npm run demo:reset", then "npm start", then run this again.`
    );
  }
  const sessions = {};
  for (const [key, user] of Object.entries(USERS)) sessions[key] = await apiLogin(user);
  return sessions;
}

// ── browser helpers ────────────────────────────────────────────────────────────
async function setBanner(page, step, title, detail, tone = "emerald") {
  await page
    .evaluate(({ step, title, detail, tone }) => window.__cwDemo?.set(step, title, detail, tone), { step, title, detail, tone })
    .catch(() => {});
}

let currentStep = 0;
async function step(page, title, detail, tone = "emerald") {
  currentStep += 1;
  await setBanner(page, currentStep, title, detail, tone);
  log(`\n${c.cyan}${c.bold}STEP ${currentStep}${c.reset}  ${c.white}${title}${c.reset}`);
  log(`${c.dim}        ${detail}${c.reset}`);
}

async function pause(page, ms = 1200) {
  await page.waitForTimeout(Math.round(ms * SPEED));
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${String(currentStep).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  log(`${c.dim}        screenshot → ${path.relative(ROOT, file)}${c.reset}`);
}

async function ganacheMoment(page, title, detail, seconds = GANACHE_PAUSE) {
  const total = Math.round(seconds * SPEED);
  bigBanner([
    "GANACHE GUI MOMENT",
    title,
    "",
    detail,
    "",
    `The script continues automatically in ${total}s.`,
  ], c.amber);
  for (let left = total; left > 0; left -= 1) {
    await setBanner(page, currentStep, `GANACHE MOMENT · ${title}`, `${detail}  ·  continuing in ${left}s`, "amber");
    if (left === total || left % 5 === 0 || left <= 3) log(`${c.amber}  ⏳ ${String(left).padStart(2, "0")}s  ${detail}${c.reset}`);
    await sleep(1000);
  }
  await setBanner(page, currentStep, `Continuing: ${title}`, "The script is driving the app again…", "sky");
  await sleep(400);
}

async function asUser(page, sessions, key) {
  const user = USERS[key];
  await setBanner(page, currentStep, `Switching browser session → ${user.label}`, user.address ? `Wallet ${user.address}` : "Read-only admin (no wallet)", "sky");
  await page.waitForTimeout(650);
  await page.goto(BASE);
  await page.evaluate(({ token }) => localStorage.setItem("chainwill.token", token), { token: sessions[key].token });
  await page.goto(`${BASE}/app`);
  const me = sessions[key].user;
  await page.getByText(me.name, { exact: true }).first().waitFor({ timeout: 20_000 });
  await page.getByText("Sign out", { exact: true }).first().waitFor({ timeout: 20_000 });
  await pause(page, 650);
  log(`${c.green}  ● now: ${me.name} (${me.role})${c.reset}`);
}

async function selectByText(page, locator, text, timeout = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const options = await locator.locator("option").evaluateAll((opts) =>
      opts.map((o) => ({ value: o.value, text: (o.textContent || "").trim(), disabled: o.disabled }))
    );
    const found = options.find((o) => !o.disabled && o.value && o.text.includes(text));
    if (found) {
      await locator.selectOption(found.value);
      return found;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`Could not find select option containing "${text}"`);
}

async function go(page, route, waitText) {
  await page.goto(`${BASE}${route}`);
  if (waitText) await page.getByText(waitText, { exact: false }).first().waitFor({ timeout: 25_000 });
  await pause(page, 600);
}

// ── main ───────────────────────────────────────────────────────────────────────
let browser;
try {
  bigBanner(
    [
      "CHAINWILL · AUTOMATIC DEMO",
      "",
      "This window will drive the real frontend for you.",
      "Keep the Ganache GUI open — the script stops and waits at each GANACHE MOMENT.",
      "Do not click in the browser while the script is running.",
      "",
      `App:      ${BASE}`,
      `Ganache:  http://127.0.0.1:7545  (chain 1337)`,
      `PDF:      ${path.relative(ROOT, PDF)}`,
      "",
      "Checking the demo state…",
    ],
    c.cyan
  );

  const sessions = await preflight();
  log(`${c.green}Preflight OK — no wills on-chain, all five sessions can log in.${c.reset}`);

  browser = await chromium.launch({
    executablePath: CHROME,
    headless: HEADLESS,
    slowMo: HEADLESS ? 0 : 90,
    args: ["--start-maximized", "--disable-infobars", "--disable-notifications"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  const context = await browser.newContext({
    viewport: HEADLESS ? { width: 1440, height: 900 } : null,
    acceptDownloads: true,
  });
  await context.addInitScript({ content: BANNER_SCRIPT });
  const page = await context.newPage();
  await page.goto(BASE);
  await page.bringToFront();

  bigBanner(
    [
      "THE DEMO STARTS IN 5 SECONDS",
      "",
      "Arrange this window and the Ganache GUI side by side.",
      "The browser will switch between Alice, Bob, Carol, Dave and Admin automatically.",
    ],
    c.green
  );
  await sleep(5000);

  // ── 1. identities + addresses ────────────────────────────────────────────────
  await asUser(page, sessions, "alice");
  await step(page, "Alice's wallet — the address you will show in Ganache", "Settings shows the exact Ganache account number and address.", "emerald");
  await go(page, "/app/settings", "Ganache account");
  await page.getByText("Ganache account", { exact: true }).scrollIntoViewIfNeeded();
  await pause(page, 1400);
  await shot(page, "alice-settings-wallet");
  await ganacheMoment(
    page,
    "Show Alice = Ganache account #1",
    "In Ganache → ACCOUNTS, point at #1 (0xC9fc…FDf4). It is the same address on this Settings page.",
    16
  );

  await asUser(page, sessions, "admin");
  await step(page, "The whole address map, in one table", "Admin → Ganache accounts lists slot, address, user and live balance together.", "emerald");
  await go(page, "/app/admin", "Admin dashboard");
  await page.getByText("Ganache accounts", { exact: true }).waitFor({ timeout: 25_000 });
  await page.getByText("Ganache accounts", { exact: true }).scrollIntoViewIfNeeded();
  await pause(page, 1800);
  await shot(page, "admin-ganache-accounts");
  await ganacheMoment(
    page,
    "Ganache ACCOUNTS: #0 deployer, #1–#4 Alice–Dave",
    "Point at the addresses: #0 0x1EEB…, #1 0xC9fc…, #2 0xC490…, #3 0x73B6…, #4 0xb514… . This admin table maps the same addresses to names.",
    20
  );

  // ── 2. Alice creates the will ────────────────────────────────────────────────
  await asUser(page, sessions, "alice");
  await step(page, "Alice creates her will", "Five wizard steps; nothing touches the chain until the final Submit.", "emerald");
  await go(page, "/app", "My will");
  await page.getByRole("link", { name: /Create my will/ }).click();
  await page.getByText("Create your will", { exact: false }).first().waitFor({ timeout: 20_000 });
  await pause(page, 900);

  await page.getByLabel("Will title (optional)").fill("Alice's Last Will");
  await page.getByRole("button", { name: /Live demo/ }).click();
  await pause(page, 900);
  await page.getByRole("button", { name: /Next/ }).click();
  await page.getByText("Executor", { exact: true }).first().waitFor({ timeout: 15_000 });

  await selectByText(page, page.getByLabel("Executor"), "Bob");
  await pause(page, 900);
  await page.getByRole("button", { name: /Next/ }).click();
  await page.getByText("Beneficiary 1", { exact: true }).waitFor({ timeout: 15_000 });

  await selectByText(page, page.getByLabel("Beneficiary 1", { exact: true }), "Carol");
  await page.getByLabel("Share %").nth(0).fill("90");
  await pause(page, 600);
  await page.getByRole("button", { name: "Add beneficiary" }).click();
  await page.getByText("Beneficiary 2", { exact: true }).waitFor({ timeout: 10_000 });
  await selectByText(page, page.getByLabel("Beneficiary 2", { exact: true }), "Dave");
  await page.getByLabel("Share %").nth(1).fill("40");
  await page.getByText(/30% over the limit/).first().waitFor({ timeout: 10_000 });
  await step(page, "The wizard mirrors the contract's 100% rule", "Carol at 90% + Dave at 40% would be 130%. The form catches it before any transaction.", "amber");
  await pause(page, 1200);
  await shot(page, "wizard-over-100");
  await pause(page, 1200);
  await page.getByLabel("Share %").nth(0).fill("60");
  await page.getByText("Fully allocated", { exact: false }).first().waitFor({ timeout: 10_000 });
  await pause(page, 1200);
  await shot(page, "wizard-beneficiaries");
  await page.getByRole("button", { name: /Next/ }).click();
  await page.getByText("Fungible assets", { exact: false }).first().waitFor({ timeout: 15_000 });

  await step(page, "Alice escrows 10 ETH + 1000 CWT + a deed NFT + a PDF", "ETH/tokens split 60/40; the NFT goes whole to Carol and the PDF whole to Dave.", "emerald");
  await page.getByLabel("Deposit ETH").fill("10");
  await page.getByLabel(/Mint & deposit demo tokens/).fill("1000");
  await page.getByLabel("Name", { exact: true }).fill("Property Deed");
  await page.getByLabel("Kind", { exact: true }).selectOption("PROPERTY");
  await selectByText(page, page.getByLabel("Inherited by").nth(0), "Carol");
  await page.getByRole("button", { name: "Add NFT" }).click();
  await pause(page, 600);
  await selectByText(page, page.getByLabel("Inherited by").nth(1), "Dave");
  await page.locator('input[type="file"]').setInputFiles(PDF);
  await page.getByText("property_papers.pdf", { exact: false }).first().waitFor({ timeout: 40_000 });
  await pause(page, 1400);
  await shot(page, "wizard-assets");
  await page.getByRole("button", { name: /Next/ }).click();
  await page.getByText("Submitting sends", { exact: false }).first().waitFor({ timeout: 15_000 });
  await pause(page, 1400);
  await shot(page, "wizard-review");
  await page.getByRole("button", { name: /Sign & submit/ }).click();

  await step(page, "Writing the will to Ganache", "Each checklist line is a real transaction. This is the longest wait — about 15–30 seconds.", "sky");
  await page.getByText("Your will is live on-chain", { exact: false }).first().waitFor({ timeout: 240_000 });
  await pause(page, 1200);
  await shot(page, "will-live");
  await page.getByRole("button", { name: "Open my dashboard" }).click();
  await page.getByRole("button", { name: /I'm alive — check in/ }).waitFor({ timeout: 25_000 });
  await pause(page, 1200);
  await ganacheMoment(
    page,
    "Alice paid 10 ETH into the contract",
    "Ganache → ACCOUNTS: Alice is now ~89.99 ETH and her TX count increased. TRANSACTIONS: newest txs, From Alice, To WillManager 0xEe3b…, value 10 ETH.",
    22
  );

  // ── 3. Explorer ──────────────────────────────────────────────────────────────
  await step(page, "The public Explorer shows the on-chain truth", "Filter by Alice's address and open a transaction hash to see block, gas and decoded events.", "emerald");
  await page.getByRole("link", { name: "Explorer" }).click();
  await page.getByLabel("Filter by address").fill(USERS.alice.address);
  await page.getByRole("button", { name: "Apply" }).click();
  await page.locator("tbody tr").first().waitFor({ timeout: 25_000 });
  await pause(page, 1600);
  await shot(page, "explorer-events");
  await pause(page, 1800);

  // ── 4. Check-in ───────────────────────────────────────────────────────────────
  await step(page, "Alice checks in — the dead-man's switch resets", "The countdown returns to 02:00 and a new transaction appears in Ganache.", "emerald");
  await page.getByRole("link", { name: "My will" }).click();
  await page.getByRole("button", { name: /I'm alive — check in/ }).click();
  await page.getByText(/Checked in — timer reset/).first().waitFor({ timeout: 25_000 });
  await pause(page, 1600);
  await shot(page, "after-checkin");

  // ── 5. Missed deadline + grace ───────────────────────────────────────────────
  await asUser(page, sessions, "admin");
  await step(page, "Fast-forward: Alice stops checking in", "Admin demo tools move the local Ganache clock +2 minutes. This is a demo shortcut, not a production feature.", "amber");
  await go(page, "/app/admin", "Demo tools");
  await page.getByRole("button", { name: /\+2 minutes/ }).click();
  await page.waitForTimeout(2000);
  await asUser(page, sessions, "alice");
  await step(page, "Missing the deadline does NOT activate inheritance yet", "Alice is in Check-in missed. The executor must wait out the one-minute grace period.", "amber");
  await go(page, "/app", "Check-in missed");
  await page.getByText("Check-in missed", { exact: false }).first().waitFor({ timeout: 20_000 });
  await pause(page, 1600);
  await shot(page, "missed-grace");
  await pause(page, 1600);

  await asUser(page, sessions, "admin");
  await step(page, "Grace period over — now the executor is allowed", "Advance one more minute. Alice becomes Eligible for inheritance.", "amber");
  await go(page, "/app/admin", "Demo tools");
  await page.getByRole("button", { name: /\+1 minute/ }).click();
  await page.waitForTimeout(2200);
  await asUser(page, sessions, "alice");
  await page.getByText("Eligible for inheritance", { exact: false }).first().waitFor({ timeout: 25_000 });
  await pause(page, 1600);
  await shot(page, "eligible");

  // ── 6. Unauthorized attempt, then Bob activates ───────────────────────────────
  await asUser(page, sessions, "carol");
  await step(page, "The contract says NO to Carol", "Carol is a beneficiary, not the executor. The Security Lab runs the real contract code as Carol.", "rose");
  await go(page, "/app/security", "Pick a target will");
  await selectByText(page, page.getByLabel("Will", { exact: true }), "Alice");
  await page.getByText("You are", { exact: false }).first().waitFor({ timeout: 15_000 });
  await pause(page, 700);
  await page.locator("li").filter({ hasText: "Activate inheritance on" }).getByRole("button", { name: "Try it" }).click();
  await page.getByText(/Not authorized executor/).first().waitFor({ timeout: 20_000 });
  await pause(page, 1400);
  await shot(page, "security-not-executor");

  await asUser(page, sessions, "bob");
  await step(page, "Bob — the named executor — activates inheritance", "The Activate button is unlocked only because interval + grace have fully elapsed.", "amber");
  await go(page, "/app/executor", "Activate inheritance");
  await page.getByRole("button", { name: "Activate inheritance" }).click();
  await page.getByText(/Inheritance activated/).first().waitFor({ timeout: 30_000 });
  await pause(page, 1600);
  await shot(page, "activated");

  // ── 7. Claims ─────────────────────────────────────────────────────────────────
  await asUser(page, sessions, "carol");
  await step(page, "Carol claims her 60%", "ETH and CWT arrive together. The NFT is claimed separately, because it is a whole item.", "emerald");
  await go(page, "/app/beneficiary", "Inheritance from");
  await page.getByRole("button", { name: /Claim my 60%/ }).click();
  await page.getByText(/Claimed your 60% share/).first().waitFor({ timeout: 30_000 });
  await pause(page, 1300);
  await page.getByRole("button", { name: "Claim this item" }).first().click();
  await page.getByText(/is now in your wallet/).first().waitFor({ timeout: 30_000 });
  await pause(page, 1600);
  await shot(page, "carol-claims");

  await asUser(page, sessions, "dave");
  await step(page, "Dave claims 40% — and the PDF stays locked", "Claiming the ETH share does not unlock the document. Dave must claim that specific asset.", "emerald");
  await go(page, "/app/beneficiary", "Inheritance from");
  await page.getByRole("button", { name: /Claim my 40%/ }).click();
  await page.getByText(/Claimed your 40% share/).first().waitFor({ timeout: 30_000 });
  await pause(page, 1200);
  const docRow = page
    .locator("li")
    .filter({ hasText: "Document" })
    .filter({ has: page.getByRole("button", { name: /Claim this item|Download/ }) })
    .first();
  await docRow.getByRole("button", { name: "Claim this item" }).click();
  await page.getByText(/Document unlocked/).first().waitFor({ timeout: 30_000 });
  await pause(page, 1200);
  const downloadPromise = page.waitForEvent("download", { timeout: 20_000 }).catch(() => null);
  await docRow.getByRole("button", { name: "Download" }).click();
  const download = await downloadPromise;
  if (download) {
    fs.rmSync(DOWNLOAD, { force: true });
    await download.saveAs(DOWNLOAD);
    log(`${c.green}  ● downloaded the decrypted PDF → ${path.relative(ROOT, DOWNLOAD)}${c.reset}`);
  }
  await pause(page, 1500);
  await shot(page, "dave-document");
  await ganacheMoment(
    page,
    "Balances moved — show them in Ganache",
    "Ganache → ACCOUNTS: Carol ≈ 106 ETH, Dave ≈ 104 ETH. The admin dashboard should now show 0 ETH in escrow and 10 ETH inherited.",
    20
  );

  // ── 8. Security Lab, second pass ─────────────────────────────────────────────
  await asUser(page, sessions, "carol");
  await step(page, "Double claim is impossible", "Carol already claimed. The contract's hasClaimed flag rejects a second claim.", "rose");
  await go(page, "/app/security", "Pick a target will");
  await selectByText(page, page.getByLabel("Will", { exact: true }), "Alice");
  await page.getByText("You are", { exact: false }).first().waitFor({ timeout: 15_000 });
  await page.locator("li").filter({ hasText: "Claim a percentage share" }).getByRole("button", { name: "Try it" }).click();
  await page.getByText(/Already claimed/).first().waitFor({ timeout: 20_000 });
  await pause(page, 1400);
  await shot(page, "security-already-claimed");

  await asUser(page, sessions, "dave");
  await step(page, "Nobody can take an item assigned to someone else", "Dave tries to claim Carol's Property Deed NFT. The contract checks assignedTo and refuses.", "rose");
  await go(page, "/app/security", "Pick a target will");
  await selectByText(page, page.getByLabel("Will", { exact: true }), "Alice");
  await page.getByLabel("NFT / document to try to take").waitFor({ timeout: 15_000 });
  await selectByText(page, page.getByLabel("NFT / document to try to take"), "Property Deed");
  await pause(page, 700);
  await page.locator("li").filter({ hasText: "Property Deed" }).getByRole("button", { name: "Try it" }).click();
  await page.getByText(/Not the assigned beneficiary/).first().waitFor({ timeout: 20_000 });
  await pause(page, 1400);
  await shot(page, "security-wrong-heir");

  // ── 9. Tamper demo ────────────────────────────────────────────────────────────
  await asUser(page, sessions, "alice");
  await step(page, "Tamper detection", "The PDF is encrypted on disk. We flip one byte, then verify against the SHA-256 / CID recorded on-chain.", "rose");
  await go(page, "/app/vault", "property_papers.pdf");
  await pause(page, 800);
  log(`${c.amber}  ● running: npm run demo:tamper${c.reset}`);
  execSync("npm run demo:tamper", { cwd: ROOT, stdio: "inherit" });
  const vaultRow = page.locator("li").filter({ hasText: "property_papers.pdf" }).first();
  await vaultRow.getByRole("button", { name: "Verify integrity" }).click();
  await page.getByText(/MODIFIED!/).first().waitFor({ timeout: 20_000 });
  await pause(page, 1600);
  await shot(page, "tamper-modified");
  log(`${c.green}  ● restoring the original bytes…${c.reset}`);
  execSync("npm run demo:restore", { cwd: ROOT, stdio: "inherit" });
  await vaultRow.getByRole("button", { name: "Verify integrity" }).click();
  await page.getByText(/Integrity verified/).first().waitFor({ timeout: 20_000 });
  await pause(page, 1400);
  await shot(page, "tamper-restored");

  // ── 10. Final admin dashboard ─────────────────────────────────────────────────
  await asUser(page, sessions, "admin");
  await step(page, "Final admin dashboard", "Users, wills, escrow, claims, transactions, events and the Ganache accounts table — all live.", "emerald");
  await go(page, "/app/admin", "Admin dashboard");
  await page.getByText("Ganache accounts", { exact: true }).waitFor({ timeout: 25_000 });
  await page.getByText("Ganache accounts", { exact: true }).scrollIntoViewIfNeeded();
  await pause(page, 1800);
  await shot(page, "final-admin");
  await ganacheMoment(
    page,
    "Final balances in Ganache",
    "Alice ≈ 89.99 ETH, Bob ≈ 100 ETH, Carol ≈ 106 ETH, Dave ≈ 104 ETH. The contract now holds 0 ETH after the claims.",
    20
  );

  await setBanner(
    page,
    currentStep,
    "DEMO COMPLETE",
    "You can stop here. Switch to Ganache one last time, or press Ctrl+C in the terminal to close the browser.",
    "emerald"
  );
  bigBanner(
    [
      "DEMO COMPLETE",
      "",
      "Screenshots saved in: demo/screenshots/",
      "Downloaded PDF:      demo/downloaded_property_papers.pdf",
      "",
      "The browser is left open on the final admin dashboard.",
      "Press Ctrl+C in this terminal when you are finished.",
      "",
      "To run the demo again:",
      "  stop the app (Ctrl+C)",
      "  npm run demo:reset",
      "  npm start",
      "  npm run demo:auto",
    ],
    c.green
  );

  if (CLOSE_AT_END) {
    await browser.close();
    process.exit(0);
  }
  await new Promise(() => {});
} catch (err) {
  console.error(`\n${c.rose}${c.bold}AUTOMATIC DEMO STOPPED${c.reset}`);
  console.error(`${c.rose}${err.stack || err.message}${c.reset}`);
  console.error(`\nThe browser is left open so you can see where it stopped.`);
  console.error(`If the chain is dirty, stop the app and run: npm run demo:reset && npm start\n`);
  if (CLOSE_AT_END && browser) await browser.close();
  else await new Promise(() => {});
}
