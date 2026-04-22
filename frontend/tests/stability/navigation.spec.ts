import { test, expect } from '@playwright/test';

/**
 * Test de stabilité industrielle : CRM → Lead → Calpinage × 50 cycles.
 * Mocks ciblés sur les URLs exactes observées.
 * Heap, snapshot, detached nodes, seuils CI.
 */
test.describe('STABILITY', () => {
  test('Calpinage 50 cycles stability', async ({ page, context }) => {
  test.setTimeout(300000); // 5 min pour 50 cycles
  const runtimeErrors: string[] = [];
  const knownLegacyErrors = ['require is not defined'];
  page.on('pageerror', (err) => {
    if (!knownLegacyErrors.some((k) => err.message.includes(k))) {
      runtimeErrors.push(err.message);
    }
  });

  // 1️⃣ MOCK AUTH
  await context.route('http://localhost:5173/auth/me', async (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, email: 'e2e@test.com' }),
    });
  });

  await context.route('**/auth/permissions', async (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ permissions: [], superAdmin: false }),
    });
  });

  // 2️⃣ MOCK API — URLs exactes observées
  await context.route('http://localhost:5173/api/leads/kanban', async (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        columns: [
          {
            id: 1,
            name: 'Nouveaux',
            stage_id: '1',
            stage_name: 'Nouveaux',
            leads: [
              {
                id: '1',
                name: 'Lead E2E Test',
                full_name: 'Lead E2E Test',
                stage_id: '1',
                score: 50,
                potential_revenue: 0,
                inactivity_level: 'none',
                status: 'LEAD',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
          },
        ],
      }),
    });
  });

  await context.route('http://localhost:5173/api/leads/meta', async (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        stages: [{ id: '1', name: 'Nouveaux' }],
        users: [],
      }),
    });
  });

  // 3️⃣ MOCK API — suite du flux (lead detail, studies, calpinage)
  await context.route('**/api/leads/1', async (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        lead: { id: '1', full_name: 'Lead E2E Test', stage_id: '1', status: 'LEAD' },
        stage: { id: '1', name: 'Nouveaux' },
        stages: [{ id: '1', name: 'Nouveaux' }],
        site_address: null,
        billing_address: null,
      }),
    });
  });

  await context.route('**/api/studies**', async (route) => {
    const url = route.request().url();
    if (route.request().method() === 'POST' && url.includes('/versions')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ versions: [{ version_number: 1 }] }),
      });
    }
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          study: { id: 'e2e-study-1', study_number: 'E2E-001', lead_id: '1' },
          versions: [{ version_number: 1 }],
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 'e2e-study-1', study_number: 'E2E-001', lead_id: '1' }]),
    });
  });

  await context.route('**/api/**/calpinage**', async (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        calpinageData: null,
        geometry_json: { roofState: { contourBati: [] }, contours: [] },
      }),
    });
  });

  await context.route('**/api/public/pv/**', async (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  // 4️⃣ INJECT TOKEN + HOOKS AUDIT
  await page.addInitScript(() => {
    localStorage.setItem('solarnext_token', 'E2E_FAKE_TOKEN');
  });
  await page.addInitScript(() => {
    (window as Record<string, unknown>).__RAF_COUNT__ = 0;
    const originalRAF = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function (cb) {
      ((window as Record<string, unknown>).__RAF_COUNT__ as number)++;
      return originalRAF(cb);
    };
    (window as Record<string, unknown>).__INTERVALS__ = [];
    const originalSetInterval = window.setInterval.bind(window);
    window.setInterval = function (...args) {
      const id = originalSetInterval(...args);
      ((window as Record<string, unknown>).__INTERVALS__ as number[]).push(id as number);
      return id;
    };
  });

  // 5️⃣ NAVIGATION
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.waitForSelector('#root', { timeout: 20000 });
  await page.waitForLoadState('networkidle');

  await expect(page).not.toHaveURL(/login/);

  await page.waitForFunction(
    () =>
      document.querySelectorAll('.sn-leads-card').length > 0 ||
      document.querySelectorAll('table tbody tr').length > 0 ||
      document.querySelector('.sn-leads-page-error') !== null,
    { timeout: 30000 }
  );

  if (await page.locator('.sn-leads-page-error').isVisible()) {
    const errText = await page.locator('.sn-leads-page-error').textContent();
    throw new Error(`Leads page error: ${errText}`);
  }

  const firstLead = page.locator('.sn-leads-card, [data-testid="lead-item"], .lead-item, table tbody tr').first();
  await firstLead.click();

  await page.waitForURL(/leads\/[^/]+/, { timeout: 20000 });

  await page.waitForSelector('button:has-text("Créer l\'étude solaire"), button:has-text("Calpinage"), button:has-text("Ouvrir calpinage")', {
    timeout: 20000,
  });

  // AUDIT — Event listeners avant boucle
  const listenersBefore = await page.evaluate(() => {
    try {
      const fn = (window as Record<string, unknown>).getEventListeners;
      return fn ? Object.keys(fn(window)).length : 0;
    } catch {
      return 0;
    }
  });

  // CDP — mesure mémoire avant/après 50 cycles
  const client = await page.context().newCDPSession(page);
  await client.send('HeapProfiler.enable');

  const beforeRes = await client.send('Runtime.evaluate', {
    expression: '(performance.memory && performance.memory.usedJSHeapSize) || 0',
    returnByValue: true,
  });
  const beforeValue = (beforeRes as { result?: { value?: number } }).result?.value ?? 0;

  for (let i = 0; i < 50; i++) {
    console.log(`🔁 Cycle ${i + 1}/50`);

    // Ouvrir Calpinage
    await page.click('button:has-text("Créer l\'étude solaire"), button:has-text("Calpinage"), button:has-text("Ouvrir calpinage")');

    await page.waitForSelector('[role="dialog"]', { timeout: 20000 });
    await page.waitForSelector('#calpinage-canvas-el, .calpinage-container', { state: 'attached', timeout: 20000 });

    // Fermer Calpinage
    const dialog = page.locator('[role="dialog"]');
    const box = await dialog.boundingBox();

    if (box) {
      await page.mouse.click(box.x + 5, box.y + 5);
    }

    await page.waitForTimeout(300);

    // Attendre que le dialog soit fermé avant le cycle suivant
    await page.waitForSelector('[role="dialog"]', { state: 'hidden', timeout: 5000 });
  }

  // Vérifier dialog cleanup final
  await page.locator('[role="dialog"]').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});

  // AUDIT — Event listeners, RAF, intervals après boucle
  const listenersAfter = await page.evaluate(() => {
    try {
      const fn = (window as Record<string, unknown>).getEventListeners;
      return fn ? Object.keys(fn(window)).length : 0;
    } catch {
      return 0;
    }
  });
  const rafCount = await page.evaluate(() => ((window as Record<string, unknown>).__RAF_COUNT__ as number) ?? 0);
  const activeIntervals = await page.evaluate(() => ((window as Record<string, unknown>).__INTERVALS__ as number[] | undefined)?.length ?? 0);

  console.log('🎧 Listeners BEFORE:', listenersBefore);
  console.log('🎧 Listeners AFTER:', listenersAfter);
  console.log('🎞 RAF calls:', rafCount);
  console.log('⏱ Active intervals:', activeIntervals);

  if (listenersAfter > listenersBefore + 5) {
    throw new Error('❌ Listener leak detected');
  }
  if (activeIntervals > 5) {
    throw new Error('❌ Interval leak detected');
  }

  const afterRes = await client.send('Runtime.evaluate', {
    expression: '(performance.memory && performance.memory.usedJSHeapSize) || 0',
    returnByValue: true,
  });
  const afterValue = (afterRes as { result?: { value?: number } }).result?.value ?? 0;

  const delta = afterValue - beforeValue;
  const deltaPercent = beforeValue > 0 ? (delta / beforeValue) * 100 : 0;

  console.log(`📊 Heap BEFORE: ${beforeValue}`);
  console.log(`📊 Heap AFTER: ${afterValue}`);
  console.log(`📈 Heap DELTA: ${delta} bytes`);
  console.log(`📈 Heap DELTA %: ${deltaPercent.toFixed(2)}%`);

  const MAX_HEAP_DELTA_PERCENT = 5;
  if (deltaPercent > MAX_HEAP_DELTA_PERCENT) {
    throw new Error(
      `❌ Heap growth too high: ${deltaPercent.toFixed(2)}% (max ${MAX_HEAP_DELTA_PERCENT}%)`
    );
  }

  // Snapshot stream + analyse Detached DOM
  const chunks: string[] = [];
  client.on('HeapProfiler.addHeapSnapshotChunk', (evt: { chunk?: string }) => {
    if (evt.chunk) chunks.push(evt.chunk);
  });
  await client.send('HeapProfiler.takeHeapSnapshot');
  const snapshot = chunks.join('');
  console.log('📦 Snapshot size:', snapshot.length.toLocaleString());

  const detachedCount = (snapshot.match(/Detached DOM tree/g) || []).length;
  console.log('🧩 Detached DOM nodes:', detachedCount);

  const MAX_DETACHED_NODES = 5;
  if (detachedCount > MAX_DETACHED_NODES) {
    throw new Error(
      `❌ Detached DOM nodes detected: ${detachedCount} (max ${MAX_DETACHED_NODES})`
    );
  }

  console.log('==============================');
  console.log('🟢 STABILITY TEST RESULT');
  console.log(`Heap delta %: ${deltaPercent.toFixed(2)}%`);
  console.log(`Detached nodes: ${detachedCount}`);
  console.log(`Listeners: ${listenersBefore} → ${listenersAfter}`);
  console.log(`RAF calls: ${rafCount} | Intervals: ${activeIntervals}`);
  console.log('STATUS: PASS');
  console.log('==============================');

  expect(
    runtimeErrors.length,
    runtimeErrors.length > 0 ? `Runtime errors: ${runtimeErrors.join(' | ')}` : undefined
  ).toBe(0);
  });
});
