import { chromium } from "playwright-core";

const BASE = "http://localhost:4000";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const login = async (email, password) => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`${email}: ${res.status} ${await res.text()}`);
  return res.json();
};

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: false,
  args: ["--start-maximized"],
});
const context = await browser.newContext({ viewport: null });
const page = await context.newPage();
await page.goto(BASE);
const alice = await login("alice@chainwill.demo", "ChainWill123");
await page.evaluate((token) => localStorage.setItem("chainwill.token", token), alice.token);
await page.goto(`${BASE}/app`);
await page.waitForTimeout(2500);
console.log("URL:", page.url());
console.log("TITLE:", await page.title());
console.log("BODY:", (await page.locator("body").innerText()).slice(0, 900));
await page.screenshot({ path: "D:/Temp/opencode/alice-dashboard.png", fullPage: false });
await browser.close();
