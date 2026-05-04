/**
 * Vérifie que le SPA monte (jeton factice pour `isAuthenticated`).
 * Usage : AUDIT_URL=http://127.0.0.1:5175 node scripts/verify-spa-bootstrap.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.AUDIT_URL || "http://127.0.0.1:5173";

const FAKE_JWT = [
  Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
  Buffer.from(JSON.stringify({ exp: 9_999_999_999 })).toString("base64url"),
  "sig",
].join(".");

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(
  ({ token }) => {
    localStorage.setItem("solarnext_theme", "dark");
    localStorage.setItem("solarnext_token", token);
  },
  { token: FAKE_JWT }
);
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});

await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForTimeout(3000);

const data = await page.evaluate(() => {
  const html = document.documentElement;
  const root = document.querySelector("#root");
  const cs = getComputedStyle(html);
  return {
    url: location.href,
    rootChildCount: root?.children?.length ?? 0,
    htmlClass: html.className,
    hasThemeDark: html.classList.contains("theme-dark"),
    hasSnAppPage: html.classList.contains("sn-app-page"),
    styleSheetCount: document.styleSheets.length,
    vars: {
      "--color-bg-page": cs.getPropertyValue("--color-bg-page").trim(),
      "--bg-card": cs.getPropertyValue("--bg-card").trim(),
      "--text-primary": cs.getPropertyValue("--text-primary").trim(),
    },
  };
});

await browser.close();

const fatalBootstrap = consoleErrors.some(
  (t) =>
    t.includes("does not provide an export named") ||
    t.includes("Uncaught SyntaxError") ||
    t.includes("Failed to fetch dynamically imported module")
);

console.log(JSON.stringify({ ...data, consoleErrors, fatalBootstrap }, null, 2));
if (fatalBootstrap) process.exitCode = 1;
if (data.rootChildCount === 0) process.exitCode = 1;
if (!data.hasSnAppPage || !data.hasThemeDark) process.exitCode = 1;
if (!data.vars["--color-bg-page"] || !data.vars["--bg-card"] || !data.vars["--text-primary"]) {
  process.exitCode = 1;
}
