/**
 * DIAGNOSTIC RUNTIME — Background carte Kanban
 * Extrait les valeurs calculées réelles via Playwright
 * Usage: node scripts/diagnostic-lead-card-css.js
 *
 * Prérequis: frontend dev server sur :5173
 * --bypass-auth : injecte un token factice pour accéder à /leads sans login
 */

import { chromium } from "playwright";

const BASE_URL = process.env.CRM_URL || "http://localhost:5173/crm.html";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  if (process.argv.includes("--bypass-auth")) {
    await context.addInitScript(() => {
      localStorage.setItem("solarnext_token", "diagnostic-bypass");
    });
  }

  const page = await context.newPage();

  const fullUrl = `${BASE_URL}/leads`;
  try {
    const res = await page.goto(fullUrl, { waitUntil: "load", timeout: 25000 });
    if (res && !res.ok()) {
      console.error("HTTP", res.status(), res.statusText());
    }
    await page.waitForTimeout(4000); // laisser charger leads
  } catch (e) {
    console.error("Impossible de charger la page:", e.message);
    console.error("URL tentée:", fullUrl);
    await browser.close();
    process.exit(1);
  }

  const result = await page.evaluate(() => {
    const cards = document.querySelectorAll(".lead-card");
    const columns = document.querySelectorAll(".sn-leads-kanban-col");
    const report = { cards: [], columns: [], matchingRules: [] };

    cards.forEach((el, i) => {
      const computed = window.getComputedStyle(el);
      report.cards.push({
        index: i,
        classes: el.className,
        "background (computed)": computed.backgroundColor || computed.background,
        "background-color (computed)": computed.backgroundColor,
        "background-image (computed)": computed.backgroundImage,
      });
    });

    const getMatchingRules = (el) => {
      const rules = [];
      try {
        for (const sheet of Array.from(document.styleSheets)) {
          try {
            const cssRules = sheet.cssRules || sheet.rules;
            if (!cssRules) continue;
            for (const rule of cssRules) {
              if (rule.selectorText && el.matches(rule.selectorText)) {
                const bg = rule.style?.background || rule.style?.backgroundColor;
                if (bg) {
                  rules.push({
                    selector: rule.selectorText,
                    background: bg,
                    href: sheet.href || "(inline)",
                  });
                }
              }
            }
          } catch (_) {}
        }
      } catch (_) {}
      return rules;
    };

    if (cards.length > 0) {
      report.matchingRules = getMatchingRules(cards[0]);
    }

    columns.forEach((el, i) => {
      const computed = window.getComputedStyle(el);
      report.columns.push({
        index: i,
        classes: el.className,
        "background (computed)": computed.backgroundColor || computed.background,
      });
    });

    return report;
  });

  console.log("\n========== RAPPORT DIAGNOSTIC RUNTIME ==========\n");
  console.log("URL:", `${BASE_URL}/leads`);
  console.log("Cartes .lead-card trouvées:", result.cards.length);
  console.log("Colonnes .sn-leads-kanban-col trouvées:", result.columns.length);

  if (result.cards.length > 0) {
    const c = result.cards[0];
    console.log("\n--- CARTE 1 (première carte) ---");
    console.log("Classes:", c.classes);
    console.log("Background calculé réel:", c["background (computed)"]);
    console.log("Background-color calculé:", c["background-color (computed)"]);
    console.log("Background-image calculé:", c["background-image (computed)"]);

    if (result.matchingRules && result.matchingRules.length > 0) {
      console.log("\n--- RÈGLES CSS APPLIQUÉES (background) ---");
      result.matchingRules.forEach((r, i) => {
        console.log(`${i + 1}. ${r.selector} → ${r.background} (${r.href})`);
      });
    }
  }

  if (result.columns.length > 0) {
    console.log("\n--- COLONNES (contexte) ---");
    result.columns.slice(0, 3).forEach((col) => {
      console.log(`Col ${col.index} [${col.classes}]: background = ${col["background (computed)"]}`);
    });
  }

  console.log("\n================================================\n");
  await browser.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
