import { chromium } from "playwright-core";
import fs from "node:fs";

const src = fs.readFileSync("scripts/demo-auto.mjs", "utf8");
const match = src.match(/const BANNER_SCRIPT = `([\s\S]*?)`;\n/);
if (!match) throw new Error("BANNER_SCRIPT not found");
const BANNER_SCRIPT = match[1];

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript({ content: BANNER_SCRIPT });
const page = await context.newPage();
await page.goto("http://localhost:4000");
console.log("at landing, __cwDemo:", await page.evaluate(() => typeof window.__cwDemo));
console.log("before:", await page.locator("#cw-demo-title").innerText().catch((e) => `missing: ${e.message}`));
const result = await page.evaluate(() => {
  try {
    window.__cwDemo.set(3, "Hello from test", "The overlay should update");
    return {
      type: typeof window.__cwDemo,
      title: document.getElementById("cw-demo-title")?.textContent,
      detail: document.getElementById("cw-demo-detail")?.textContent,
      step: document.getElementById("cw-demo-step")?.textContent,
      banners: document.querySelectorAll("#cw-demo-banner").length,
    };
  } catch (err) {
    return { error: String(err), stack: err.stack };
  }
});
console.log("after evaluate:", result);
await page.waitForTimeout(300);
await page.goto("http://localhost:4000/app");
await page.waitForTimeout(800);
console.log("after navigation title:", await page.locator("#cw-demo-title").innerText().catch((e) => `missing: ${e.message}`));
console.log("after navigation detail:", await page.locator("#cw-demo-detail").innerText().catch((e) => `missing: ${e.message}`));
await page.screenshot({ path: "D:/Temp/opencode/banner-test.png" });
await browser.close();
