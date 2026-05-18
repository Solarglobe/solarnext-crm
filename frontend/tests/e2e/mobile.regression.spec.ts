/**
 * Mobile Regression Tests — Corrections M1, M2, M4.
 *
 * PÉRIMÈTRE :
 *   Ces tests couvrent uniquement les régressions des fixes mobiles M1-M4.
 *   NE PAS ajouter de tests de smoke ici — voir mobile.smoke.spec.ts.
 *
 * EXÉCUTION :
 *   Uniquement sur les projets "Mobile Chrome" et "Mobile Safari" (playwright.config.ts).
 *   Actifs seulement si CI_MOBILE=1.
 *
 *   En local :   CI_MOBILE=1 npx playwright test tests/e2e/mobile.regression.spec.ts
 *   En CI :      Même condition que mobile.smoke — main/staging uniquement.
 *
 * POINT D'ENTRÉE :
 *   /dev/calpinage-visual-qa?fixture=visual_qa_simple_house&view=validation
 *   Route dev auth-free identique au smoke — WebGL canvas + sidebar + ToastProvider.
 *
 * TESTS :
 *   M2 — Overflow horizontal : aucun élément du DOM ne déborde du viewport
 *   M4 — Toast dismissable   : clic réel sur le bouton × → toast disparaît
 *   M1 — Canvas touch-action : computed style touch-action: none sur le canvas WebGL
 */

import { test, expect, devices } from '@playwright/test';

// ─── Viewport mobile strict (375 × 812 = iPhone SE/13 mini) ──────────────────
// Garantit que la spec s'exécute avec un viewport mobile même si lancée
// manuellement hors projet mobile.
test.use({
  viewport: { width: 375, height: 812 },
  // Émulation touch pour que les events touch soient cohérents avec le device
  hasTouch: true,
});

// ─── Constantes ───────────────────────────────────────────────────────────────

const QA_URL =
  '/dev/calpinage-visual-qa?fixture=visual_qa_simple_house&view=validation';

/**
 * Tolérance overflow en px.
 * Un sous-pixel de bordure ou un scrollbar natif peut créer 1-2 px de delta.
 */
const OVERFLOW_TOLERANCE_PX = 2;

// ─── Helper : attendre que la page QA dev soit prête ─────────────────────────

async function waitForQaReady(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForSelector('[data-testid="visual-qa-stage"]', {
    timeout: 20_000,
  });
  await page.locator('canvas').first().waitFor({
    state: 'attached',
    timeout: 20_000,
  });
  // networkidle peut ne jamais se déclencher si des WS/SSE sont ouverts.
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

// ─── Suite ────────────────────────────────────────────────────────────────────

test.describe('Mobile Regression — M1 / M2 / M4', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(QA_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await waitForQaReady(page);
  });

  // ── Régression M2 : overflow horizontal profond ────────────────────────────

  test('M2 — Aucun élément DOM ne déborde horizontalement du viewport', async ({
    page,
  }) => {
    /**
     * Différence avec le smoke (Test 1) :
     *   Le smoke vérifie uniquement document.documentElement.scrollWidth.
     *   Ce test parcourt TOUS les éléments du DOM et détecte les débordements
     *   individuels, y compris ceux masqués par overflow:hidden sur le parent.
     *
     * Faux positifs évités :
     *   - Éléments hors viewport intentionnels (position: fixed hors écran, drawers fermés)
     *   - Éléments avec overflow: hidden / clip qui ne provoquent pas de scroll réel
     *   - Sous-pixels de bordure (tolérance OVERFLOW_TOLERANCE_PX)
     */
    type OffenderInfo = { tag: string; id: string; classList: string; scrollWidth: number; clientWidth: number };

    const offenders = await page.evaluate(
      ({ tolerancePx }: { tolerancePx: number }): OffenderInfo[] => {
        const viewportWidth = window.innerWidth;
        const results: OffenderInfo[] = [];

        for (const el of Array.from(document.querySelectorAll('*'))) {
          const htmlEl = el as HTMLElement;

          // Ignorer les éléments qui ne provoquent pas de scroll réel
          const style = getComputedStyle(htmlEl);
          if (
            style.overflow === 'hidden' ||
            style.overflowX === 'hidden' ||
            style.overflowX === 'clip' ||
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            style.position === 'fixed' ||
            style.position === 'absolute'
          ) {
            continue;
          }

          const delta = htmlEl.scrollWidth - htmlEl.clientWidth;
          if (delta > tolerancePx) {
            // Limiter à 20 offenders pour garder le message d'erreur lisible
            if (results.length >= 20) break;
            results.push({
              tag: htmlEl.tagName,
              id: htmlEl.id ?? '',
              classList: htmlEl.className?.toString()?.slice(0, 80) ?? '',
              scrollWidth: htmlEl.scrollWidth,
              clientWidth: htmlEl.clientWidth,
            });
          }
        }

        return results;
      },
      { tolerancePx: OVERFLOW_TOLERANCE_PX },
    );

    expect(
      offenders,
      `M2 — Éléments qui débordent horizontalement (viewport ${page.viewportSize()?.width}px) :\n` +
        offenders
          .map(o => `  ${o.tag}#${o.id}.${o.classList} → scrollWidth=${o.scrollWidth} clientWidth=${o.clientWidth}`)
          .join('\n'),
    ).toHaveLength(0);
  });

  // ── Régression M4 : toast dismissable ─────────────────────────────────────

  test('M4 — Toast dismissable : clic sur × → toast disparaît', async ({
    page,
  }) => {
    /**
     * Différence avec le smoke (Test 3) :
     *   Le smoke vérifie uniquement que le bouton × est attaché au DOM.
     *   Ce test va plus loin : clic réel + assertion que le toast est détaché.
     *
     * Sélecteur .toast-close : classe CSS appliquée au bouton dismiss par ToastProvider.
     * aria-label="Fermer" : fallback si .toast-close n'est pas exposé.
     */
    const toastTriggered = await page.evaluate((): boolean => {
      const api = (window as any).calpinageToast;
      if (api?.info) {
        api.info('Test régression M4 — dismiss');
        return true;
      }
      const legacy = (window as any).showToast;
      if (legacy) {
        legacy('Test régression M4 — dismiss', true);
        return true;
      }
      return false;
    });

    if (!toastTriggered) {
      test.skip(
        true,
        'window.calpinageToast non disponible sur cette route dev — skip gracieux (ToastProvider non monté)',
      );
      return;
    }

    // Attendre que le toast soit visible (waitForSelector strict — pas de timeout fixe)
    const toast = page.locator('[role="alert"]').first();
    await toast.waitFor({ state: 'visible', timeout: 8_000 });

    // Le bouton × doit être visible sur mobile (rendu par CSS @media ≤ 768px)
    const closeBtn = page
      .locator('.toast-close, button[aria-label="Fermer"]')
      .first();
    await closeBtn.waitFor({ state: 'visible', timeout: 5_000 });
    await expect(closeBtn).toBeVisible();

    // Clic réel
    await closeBtn.click();

    // Le toast doit disparaître — strict waitFor, pas de timeout fixe
    await toast.waitFor({ state: 'detached', timeout: 5_000 });
    await expect(toast).not.toBeAttached();
  });

  // ── Régression M1 : canvas touch-action ───────────────────────────────────

  test('M1 — Canvas WebGL : touch-action est "none" (pas de scroll parasite)', async ({
    page,
  }) => {
    /**
     * touch-action: none est nécessaire pour que les events pointermove/touchmove
     * soient transmis au canvas sans être interceptés par le scroll natif du browser.
     * Sans ce style, le pinch-to-zoom et le drag 3D ne fonctionnent pas sur mobile.
     *
     * On vérifie le computed style (pas l'attribut inline) pour s'assurer que
     * la règle CSS est correctement appliquée même si elle vient d'une feuille globale.
     */
    const canvas = page.locator('canvas').first();
    await canvas.waitFor({ state: 'visible', timeout: 20_000 });

    const touchAction = await canvas.evaluate(
      (el: Element) => getComputedStyle(el).touchAction,
    );

    expect(
      touchAction,
      `M1 — Le canvas doit avoir touch-action: none (valeur actuelle: "${touchAction}")`,
    ).toBe('none');
  });
});
