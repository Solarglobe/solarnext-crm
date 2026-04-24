/**
 * DP1 — persistance brouillon (images + parcelle) après reload.
 *
 * Exécution manuelle (auth CRM requise) :
 * 1. Définir E2E_DP_LEAD_URL (ex. http://localhost:5173/crm/leads/{uuid}/dp) pour un lead éligible DP.
 * 2. npx playwright test dp1-persist-reload.spec.ts
 *
 * Sans variable d’environnement, la suite est ignorée (ne casse pas la CI).
 */

import { test, expect } from "@playwright/test";

const DP_LEAD_URL = (process.env.E2E_DP_LEAD_URL || "").trim();

test.describe("DP1 — brouillon après reload", () => {
  test.beforeEach(() => {
    test.skip(!DP_LEAD_URL, "Définir E2E_DP_LEAD_URL vers /crm/leads/:id/dp (lead éligible, session déjà ouverte ou storageState).");
  });

  test("montage DP + navigation DP1 (smoke)", async ({ page }) => {
    await page.goto(DP_LEAD_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await expect(page.locator("#dp-tool-root")).toBeVisible({ timeout: 45000 });
    await expect(page.locator("#dp-draft-save-status")).toBeAttached();
    await page.getByRole("link", { name: /DP1/i }).first().click();
    await expect(page.locator("#dp1-page")).toBeVisible({ timeout: 25000 });
  });
});
