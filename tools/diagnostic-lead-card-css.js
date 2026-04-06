/**
 * DIAGNOSTIC RUNTIME — Background carte Kanban
 * Extrait les valeurs calculées réelles via Playwright
 * Usage: node tools/diagnostic-lead-card-css.js
 *
 * Prérequis: frontend dev server sur :5173, backend sur :3000, utilisateur connecté
 * OU: passer BASE_URL et utiliser --bypass-auth pour token factice
 */

import { chromium } from "playwright";

const BASE_URL = process.env.CRM_URL || "http://localhost:5173/crm.html";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  // Bypass auth: inject token avant chargement pour accéder à /leads
  if (process.argv.includes("--bypass-auth")) {
    await context.addInitScript(() => {
      localStorage.setItem("solarnext_token", "diagnostic-bypass");
    });
  }

  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/leads`, { waitUntil: "networkidle", timeout: 15000 });
  } catch (e) {
    console.error("Impossible de charger la page. Vérifiez que le serveur frontend tourne sur", BASE_URL);
    await browser.close();
    process.exit(1);
  }

  // Attendre les cartes ou colonnes Kanban
  const hasCards = await page.locator(".lead-card").count() > 0;
  const hasColumns = await page.locator(".sn-leads-kanban-col").count() > 0;

  if (!hasCards && !hasColumns) {
    console.log("Aucune carte Kanban trouvée (leads vides ou page non chargée).");
    console.log("Tentative d'extraction sur la première colonne si présente...");
  }

  const result = await page.evaluate(() => {
    const cards = document.querySelectorAll(".lead-card");
    const columns = document.querySelectorAll(".sn-leads-kanban-col");
    const report = { cards: [], columns: [], stylesheets: [] };

    // 1. Pour chaque carte trouvée
    cards.forEach((el, i) => {
      const computed = window.getComputedStyle(el);
      const bg = computed.backgroundColor || computed.background;
      const classes = el.className;
      report.cards.push({
        index: i,
        classes,
        "background (computed)": bg,
        "background-color (computed)": computed.backgroundColor,
        "background-image (computed)": computed.backgroundImage,
      });
    });

    // 2. Règles CSS qui affectent background pour .lead-card
    const getMatchingRules = (el) => {
      const rules = [];
      try {
        const sheets = Array.from(document.styleSheets);
        for (const sheet of sheets) {
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
      const firstCard = cards[0];
      report.matchingRules = getMatchingRules(firstCard);
    }

    // 3. Colonnes (pour contexte)
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
