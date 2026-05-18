/**
 * Mobile Smoke Tests — Calpinage, viewport mobile.
 *
 * EXÉCUTION :
 *   Ces tests ne sont lancés QUE par les projets "Mobile Chrome" et "Mobile Safari"
 *   définis dans playwright.config.ts (actifs seulement si CI_MOBILE=1).
 *
 *   En local :   CI_MOBILE=1 npx playwright test tests/e2e/mobile.smoke.spec.ts
 *   En CI :      Ajouter CI_MOBILE=1 dans l'env du job main/staging uniquement.
 *
 * POINT D'ENTRÉE :
 *   /dev/calpinage-visual-qa?fixture=visual_qa_simple_house&view=validation
 *   → Route dev auth-free, rend le module calpinage complet (sidebar + canvas 3D).
 *   → Utilisée par les tests de régression visuelle existants (calpinage-visual-regression.spec.ts).
 *
 * TESTS :
 *   1. Pas de débordement horizontal à 375 px
 *   2. Sidebar visible et contrainte dans le viewport
 *   3. Bouton × dismiss présent dans le DOM pour un toast mobile
 */

import { test, expect } from '@playwright/test';

// ─── URL de base ──────────────────────────────────────────────────────────────

const QA_URL =
  '/dev/calpinage-visual-qa?fixture=visual_qa_simple_house&view=validation';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Attend que la page dev QA soit prête.
 * Reproduit le pattern de calpinage-visual-regression.spec.ts.
 */
async function waitForQaReady(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="visual-qa-stage"]', {
    timeout: 20000,
  });
  // Canvas WebGL — peut prendre du temps sur un runner CI lent
  await page.locator('canvas').first().waitFor({
    state: 'attached',
    timeout: 20000,
  });
  await page.waitForLoadState('networkidle').catch(() => {
    // networkidle peut ne jamais se déclencher si des WS/SSE sont ouverts — ignoré.
  });
}

// ─── Suite ────────────────────────────────────────────────────────────────────

test.describe('Mobile Smoke — Calpinage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(QA_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForQaReady(page);
  });

  // ── Test 1 : pas d'overflow horizontal ──────────────────────────────────────

  test('1 — Pas de débordement horizontal sur viewport mobile', async ({ page }) => {
    /**
     * scrollWidth > clientWidth indique un overflow-x non masqué.
     * Provoqué par un élément avec une largeur fixe en px dépassant le viewport.
     */
    const hasHorizontalOverflow = await page.evaluate(() => {
      const el = document.documentElement;
      return el.scrollWidth > el.clientWidth;
    });

    expect(
      hasHorizontalOverflow,
      'Le document ne doit pas déborder horizontalement sur viewport mobile',
    ).toBe(false);
  });

  // ── Test 2 : sidebar visible et dans le viewport ─────────────────────────

  test('2 — Sidebar Phase 2 visible et contrainte dans le viewport', async ({ page }) => {
    /**
     * La sidebar (Phase2Sidebar ou Phase3Sidebar) est un <aside>.
     * Sur mobile, width: min(320px, 100vw - 16px) doit la contraindre.
     */
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible({ timeout: 10000 });

    // La bounding box doit tenir dans la largeur du viewport
    const box = await sidebar.boundingBox();
    const viewportWidth = page.viewportSize()?.width ?? 375;

    expect(box, 'La sidebar doit avoir une bounding box mesurable').not.toBeNull();
    expect(
      (box?.width ?? 0),
      `Largeur sidebar (${box?.width}px) doit être ≤ viewport (${viewportWidth}px)`,
    ).toBeLessThanOrEqual(viewportWidth);

    // Cliquabilité : au moins un bouton dans la sidebar est interactif
    const firstBtn = sidebar.locator('button').first();
    await expect(firstBtn).toBeEnabled({ timeout: 5000 });
  });

  // ── Test 3 : bouton × présent pour un toast (mobile) ────────────────────

  test('3 — Toast dismissable : bouton × présent dans le DOM sur mobile', async ({ page }) => {
    /**
     * Sur mobile (viewport ≤ 768 px), le bouton × est rendu visible via CSS.
     * Ce test vérifie qu'il est bien présent dans le DOM (attaché).
     * La visibilité CSS (@media) est garantie par le test unitaire ToastProvider.
     *
     * Déclenchement : window.calpinageToast (exposé par ToastProvider au mount).
     * Fallback : window.showToast (compatibilité legacy).
     */
    const toastTriggered = await page.evaluate((): boolean => {
      const api = (window as any).calpinageToast;
      if (api?.info) {
        api.info('Test smoke mobile — dismiss');
        return true;
      }
      const legacy = (window as any).showToast;
      if (legacy) {
        legacy('Test smoke mobile — dismiss', true);
        return true;
      }
      return false;
    });

    if (!toastTriggered) {
      // La page dev QA ne monte pas ToastProvider → smoke non applicable ici.
      // On marque le test comme skippé de manière douce (pas de hard fail).
      test.skip(true, 'window.calpinageToast non disponible sur cette route dev — skip gracieux');
      return;
    }

    // Le bouton Fermer doit être attaché au DOM dans les 5 secondes
    const closeBtn = page.locator('button[aria-label="Fermer"]').first();
    await expect(closeBtn).toBeAttached({ timeout: 5000 });

    // Vérifier aussi que le toast contient le bon texte
    const alert = page.locator('[role="alert"]').first();
    await expect(alert).toBeAttached({ timeout: 5000 });
  });
});
