import fs from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";

const STUDY_ID = "smart-roof-recipe-study";
const STUDY_VERSION_ID = "smart-roof-recipe-version";
const VERSION_NUMBER = 1;
const ARTIFACT_DIR = path.join(process.cwd(), "test-results", "smart-roof-recipe");

function fakeJwt() {
  const enc = (o: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "none", typ: "JWT" })}.${enc({
    exp: Math.floor(Date.now() / 1000) + 3600 * 24 * 365,
    id: "smart-roof-recipe-user",
    email: "smart-roof-recipe@test.local",
    organizationId: "smart-roof-recipe-org",
    role: "user",
    onboardingCompleted: true,
  })}.e2e`;
}

function roofImageDataUrl() {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="620" viewBox="0 0 900 620">',
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#dbeafe"/><stop offset="1" stop-color="#f8fafc"/></linearGradient></defs>',
    '<rect width="900" height="620" fill="url(#g)"/>',
    '<path d="M150 180 L760 120 L820 455 L105 500 Z" fill="#d7b48f" opacity=".42"/>',
    '<path d="M160 185 L755 128 L812 450 L112 492 Z" fill="none" stroke="#8b5e34" stroke-width="3" opacity=".35"/>',
    "</svg>",
  ].join("");
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function emptyGeometryFixture() {
  const scale = { metersPerPixel: 0.1, source: "smart-roof-recipe" };
  const canonical3DWorldContract = {
    schemaVersion: 1,
    metersPerPixel: 0.1,
    northAngleDeg: 0,
    referenceFrame: "LOCAL_IMAGE_ENU",
  };
  const roofState = {
    gps: { lat: 48.8566, lon: 2.3522 },
    map: {
      provider: "google",
      centerLatLng: { lat: 48.8566, lng: 2.3522 },
      zoom: 19,
      bearing: 0,
    },
    scale,
    canonical3DWorldContract,
    image: {
      dataUrl: roofImageDataUrl(),
      width: 900,
      height: 620,
      cssWidth: 900,
      cssHeight: 620,
    },
    roof: { north: { angleDeg: 0 } },
    contoursBati: [],
    ridges: [],
    traits: [],
    obstacles: [],
  };
  return {
    phase: 2,
    currentPhase: "ROOF_EDIT",
    roofSurveyLocked: false,
    roofState,
    roof: {
      scale,
      roof: roofState.roof,
      image: roofState.image,
      gps: roofState.gps,
      canonical3DWorldContract,
      roofPans: [],
    },
    contours: [],
    ridges: [],
    traits: [],
    obstacles: [],
    pans: [],
    placedPanels: [],
    frozenBlocks: [],
    validatedRoofData: null,
    smartRoofDrawing: null,
  };
}

async function installRecipeMocks(context: BrowserContext, server: { geometry: Record<string, unknown>; saves: unknown[] }) {
  await context.route("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/css", body: "" });
  });
  await context.route("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/javascript", body: "window.L = window.L || {};" });
  });
  await context.route("**/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "smart-roof-recipe-user",
        email: "smart-roof-recipe@test.local",
        organizationId: "smart-roof-recipe-org",
        onboardingCompleted: true,
        internalHomeOrganization: true,
      }),
    });
  });
  await context.route("**/auth/permissions", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ permissions: ["study.manage"], superAdmin: false }),
    });
  });
  await context.route("**/auth/refresh", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: fakeJwt() }) });
  });
  await context.route("**/api/organizations**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: "smart-roof-recipe-org", name: "Smart roof recipe" }]),
    });
  });
  await context.route("**/api/public/pv/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/panels")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{
          id: "smart-roof-test-panel",
          brand: "SolarNext",
          name: "Module recette 425 Wc",
          model_ref: "SN-425",
          power_wc: 425,
          width_mm: 1134,
          height_mm: 1722,
          efficiency_pct: 21,
          enabled: true,
        }]),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });
  await context.route("**/api/documents/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });
  await context.route("**/api/mail/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ unread: 0, total: 0 }) });
  });
  await context.route("**/api/studies/*/has-active-study", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ hasActiveStudy: false }) });
  });
  await context.route("**/api/studies/*/versions/*/calpinage", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { geometry_json?: unknown };
      if (body?.geometry_json && typeof body.geometry_json === "object") {
        server.geometry = JSON.parse(JSON.stringify(body.geometry_json));
        server.saves.push(server.geometry);
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        calpinageData: { geometry_json: server.geometry },
      }),
    });
  });
  await context.route("**/api/studies/**", async (route: Route) => {
    const url = route.request().url();
    if (url.includes("/calpinage")) return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        study: { id: STUDY_ID, lead_id: "smart-roof-recipe-lead" },
        versions: [{ id: STUDY_VERSION_ID, version_number: VERSION_NUMBER }],
      }),
    });
  });
}

async function installBrowserRuntime(context: BrowserContext, enableDrawing = true) {
  await context.addInitScript((args) => {
    const noop = () => undefined;
    const forcedDrawing = localStorage.getItem("__smart_roof_recipe_force_drawing");
    const effectiveDrawing = forcedDrawing === "false" ? false : (forcedDrawing === "true" ? true : args.enableDrawing);
    if (effectiveDrawing) {
      localStorage.setItem("calpinage_smart_roof_drawing", "true");
    } else {
      localStorage.setItem("calpinage_smart_roof_drawing", "false");
    }
    localStorage.setItem("calpinage_3d_runtime", "true");
    localStorage.setItem("calpinage_3d_preview", "true");
    (window as unknown as Record<string, unknown>).__CALPINAGE_3D_LIFECYCLE_DEBUG__ = true;
    (window as unknown as Record<string, unknown>).__CALPINAGE_CANONICAL_3D__ = true;
    class FakeLatLng {
      constructor(private readonly latitude: number, private readonly longitude: number) {}
      lat() { return this.latitude; }
      lng() { return this.longitude; }
    }
    class FakePoint {
      constructor(readonly x: number, readonly y: number) {}
    }
    class FakeOverlayView {
      setMap() {}
      getProjection() {
        return {
          fromContainerPixelToLatLng: (point: FakePoint) => new FakeLatLng(48.8566 + point.y / 100000, 2.3522 + point.x / 100000),
          fromLatLngToContainerPixel: (latLng: FakeLatLng) => new FakePoint((latLng.lng() - 2.3522) * 100000, (latLng.lat() - 48.8566) * 100000),
        };
      }
    }
    class FakeMap {
      readonly controls = Array.from({ length: 14 }, () => ({ clear: noop, push: noop, removeAt: noop }));
      private center = new FakeLatLng(48.8566, 2.3522);
      private zoom = 19;
      private heading = 0;
      constructor(readonly element: HTMLElement, readonly options: Record<string, unknown>) {
        const center = options.center as { lat?: number; lng?: number } | undefined;
        if (typeof center?.lat === "number" && typeof center?.lng === "number") {
          this.center = new FakeLatLng(center.lat, center.lng);
        }
        if (typeof options.zoom === "number") this.zoom = options.zoom;
        if (typeof options.heading === "number") this.heading = options.heading;
      }
      addListener() { return { remove: noop }; }
      fitBounds() {}
      getCenter() { return this.center; }
      getHeading() { return this.heading; }
      getTilt() { return 0; }
      getZoom() { return this.zoom; }
      panTo(center: FakeLatLng | { lat: number; lng: number }) {
        this.center = center instanceof FakeLatLng ? center : new FakeLatLng(center.lat, center.lng);
      }
      setCenter(center: FakeLatLng | { lat: number; lng: number }) { this.panTo(center); }
      setHeading(heading: number) { this.heading = heading; }
      setMapTypeId() {}
      setTilt() {}
      setZoom(zoom: number) { this.zoom = zoom; }
    }
    class FakeLatLngBounds {
      extend() {}
      getCenter() { return new FakeLatLng(48.8566, 2.3522); }
    }
    class FakeMarker {
      constructor(readonly options?: Record<string, unknown>) {}
      setMap() {}
      setPosition() {}
    }
    (window as unknown as Record<string, unknown>).google = {
      maps: {
        ControlPosition: {
          TOP_LEFT: 1,
          TOP_CENTER: 2,
          TOP_RIGHT: 3,
          LEFT_TOP: 4,
          RIGHT_TOP: 5,
          LEFT_CENTER: 6,
          RIGHT_CENTER: 7,
          LEFT_BOTTOM: 8,
          RIGHT_BOTTOM: 9,
          BOTTOM_LEFT: 10,
          BOTTOM_CENTER: 11,
          BOTTOM_RIGHT: 12,
        },
        event: {
          addListener: () => ({ remove: noop }),
          addListenerOnce: () => ({ remove: noop }),
          clearInstanceListeners: noop,
          removeListener: noop,
          trigger: noop,
        },
        geometry: { spherical: { computeDistanceBetween: () => 200 } },
        LatLng: FakeLatLng,
        LatLngBounds: FakeLatLngBounds,
        Map: FakeMap,
        MapTypeControlStyle: { DEFAULT: 0, DROPDOWN_MENU: 1, HORIZONTAL_BAR: 2 },
        MapTypeId: { HYBRID: "hybrid", ROADMAP: "roadmap", SATELLITE: "satellite" },
        Marker: FakeMarker,
        OverlayView: FakeOverlayView,
        Point: FakePoint,
      },
    };
  }, { enableDrawing });
}

async function openCalpinage(page: Page) {
  await page.goto(`/studies/${STUDY_ID}/versions/${STUDY_VERSION_ID}/calpinage`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 45000 });
  await page.waitForSelector("#calpinage-canvas-el", { state: "visible", timeout: 45000 });
  await page.waitForFunction(() => {
    const state = (window as unknown as { CALPINAGE_STATE?: { roof?: { image?: unknown } } }).CALPINAGE_STATE;
    const scale = (window as unknown as { CALPINAGE_VIEWPORT_SCALE?: number }).CALPINAGE_VIEWPORT_SCALE;
    return !!state?.roof?.image && Number.isFinite(scale) && scale! > 0;
  }, { timeout: 45000 });
}

async function imageToClient(page: Page, point: { x: number; y: number }) {
  return page.evaluate((pt) => {
    const canvas = document.querySelector<HTMLCanvasElement>("#calpinage-canvas-el");
    if (!canvas) throw new Error("canvas missing");
    const rect = canvas.getBoundingClientRect();
    const w = window as unknown as {
      CALPINAGE_VIEWPORT_SCALE?: number;
      CALPINAGE_VIEWPORT_OFFSET?: { x?: number; y?: number };
      CALPINAGE_STATE?: { roof?: { image?: { height?: number } } };
    };
    const scale = w.CALPINAGE_VIEWPORT_SCALE ?? 1;
    const offset = w.CALPINAGE_VIEWPORT_OFFSET ?? { x: 0, y: 0 };
    const imgH = w.CALPINAGE_STATE?.roof?.image?.height ?? 0;
    return {
      x: rect.left + pt.x * scale + (offset.x ?? 0),
      y: rect.top - (imgH - pt.y) * scale + (offset.y ?? 0),
    };
  }, point);
}

async function clickImage(page: Page, point: { x: number; y: number }) {
  const client = await imageToClient(page, point);
  await page.mouse.move(client.x, client.y);
  await page.waitForTimeout(40);
  await page.mouse.click(client.x, client.y);
  await page.waitForTimeout(90);
}

async function dragImage(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const a = await imageToClient(page, from);
  await page.mouse.move(a.x, a.y);
  await page.waitForTimeout(40);
  await page.mouse.down();
  const b = await imageToClient(page, to);
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.waitForTimeout(40);
  await page.mouse.up();
  await page.waitForTimeout(120);
}

async function openSmartRoofDraft(page: Page) {
  await expect(page.locator("#calpinage-smart-roof-open")).toBeVisible({ timeout: 45000 });
  await page.locator("#calpinage-smart-roof-open").click();
  await expect(page.locator("#calpinage-smart-roof-session-bar")).toBeVisible({ timeout: 10000 });
  await page.locator("#calpinage-smart-roof-tool-draw").click();
}

async function drawPolyline(page: Page, points: readonly { x: number; y: number }[], close = false) {
  for (const point of points) {
    await clickImage(page, point);
  }
  if (close && points.length > 0) {
    await clickImage(page, points[0]!);
  }
  await page.keyboard.press("Enter");
}

async function setFlatHeight(page: Page, value: string) {
  await page.locator("#calpinage-smart-roof-flat-height").fill(value);
  await page.locator("#calpinage-smart-roof-set-flat").click();
  await page.waitForTimeout(150);
}

async function setSelectedHeight(page: Page, value: string) {
  const input = page.locator("#calpinage-smart-roof-height");
  await input.fill(value);
  await expect(input).toHaveValue(value);
  await page.locator("#calpinage-smart-roof-set-height").click();
  await page.waitForTimeout(150);
}

async function smartState(page: Page) {
  return page.evaluate(() => (window as unknown as { __calpinageSmartRoofDrawing?: { getState: () => unknown } }).__calpinageSmartRoofDrawing?.getState());
}

async function activeSnapshot(page: Page) {
  return page.evaluate(() => JSON.stringify((window as unknown as { CALPINAGE_STATE?: unknown }).CALPINAGE_STATE));
}

async function expectSmartRoofEssentialActionsVisible(page: Page) {
  const selectors = [
    "#calpinage-smart-roof-tool-draw",
    "#calpinage-smart-roof-tool-select",
    "#calpinage-smart-roof-new-volume",
    "#calpinage-smart-roof-height",
    "#calpinage-smart-roof-set-height",
    "#calpinage-smart-roof-flat-height",
    "#calpinage-smart-roof-set-flat",
    "#calpinage-smart-roof-apply",
    "#calpinage-smart-roof-close",
  ];
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  for (const selector of selectors) {
    const locator = page.locator(selector);
    await expect(locator, selector).toBeVisible();
    const box = await locator.boundingBox();
    expect(box, `${selector} bounding box`).not.toBeNull();
    expect(box!.x, `${selector} left`).toBeGreaterThanOrEqual(0);
    expect(box!.y, `${selector} top`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${selector} right`).toBeLessThanOrEqual(viewport.width + 1);
    expect(box!.y + box!.height, `${selector} bottom`).toBeLessThanOrEqual(viewport.height + 1);
    if (selector !== "#calpinage-smart-roof-height" && selector !== "#calpinage-smart-roof-flat-height") {
      await locator.click({ trial: true });
    }
  }
}

async function validateRoofAndEnterPhase3(page: Page) {
  const validateButton = page.getByRole("button", { name: "Valider le relevé toiture" });
  await expect(validateButton).toBeEnabled({ timeout: 10000 });
  await validateButton.click();
  await expect.poll(async () => {
    return page.evaluate(() => {
      const state = (window as unknown as { CALPINAGE_STATE?: { currentPhase?: string; roofSurveyLocked?: boolean } }).CALPINAGE_STATE;
      return {
        currentPhase: state?.currentPhase ?? null,
        roofSurveyLocked: state?.roofSurveyLocked ?? null,
      };
    });
  }, { timeout: 15000 }).toEqual({ currentPhase: "PV_LAYOUT", roofSurveyLocked: true });
  await expect(page.locator("#p3-topbar")).toBeVisible({ timeout: 10000 });
}

async function chooseRecipePanel(page: Page) {
  await expect.poll(async () => {
    return page.evaluate(() => (window as unknown as { SOLARNEXT_PANELS?: unknown[] }).SOLARNEXT_PANELS?.length ?? 0);
  }, { timeout: 15000 }).toBeGreaterThan(0);
  await page.evaluate(() => {
    const w = window as unknown as {
      SOLARNEXT_PANELS?: Array<Record<string, unknown>>;
      PV_SELECTED_PANEL?: unknown;
      CALPINAGE_SELECTED_PANEL_ID?: string;
    };
    const panel = w.SOLARNEXT_PANELS?.find((item) => item.id === "smart-roof-test-panel") ?? w.SOLARNEXT_PANELS?.[0];
    if (!panel) throw new Error("Recipe PV panel missing");
    w.CALPINAGE_SELECTED_PANEL_ID = String(panel.id);
    const widthMm = Number(panel.width_mm ?? panel.widthMm);
    const heightMm = Number(panel.height_mm ?? panel.heightMm);
    w.PV_SELECTED_PANEL = {
      id: panel.id,
      brand: panel.brand,
      model: panel.name ?? panel.model_ref,
      reference: panel.model_ref,
      powerWc: Number(panel.power_wc ?? panel.powerWc ?? 0),
      widthMm,
      heightMm,
      widthM: widthMm / 1000,
      heightM: heightMm / 1000,
    };
    const select = document.querySelector<HTMLSelectElement>("#pv-panel-select");
    if (select) {
      select.value = String(panel.id);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
}

async function placePanelWithProductTool(page: Page, point: { x: number; y: number }) {
  await chooseRecipePanel(page);
  const poseButton = page.getByRole("button", { name: "Poser" });
  await expect(poseButton).toBeVisible({ timeout: 10000 });
  await poseButton.click();
  await expect.poll(async () => {
    return page.evaluate(() => (window as unknown as { getPhase3ActiveTool?: () => string }).getPhase3ActiveTool?.() ?? null);
  }).toBe("panels");
  await clickImage(page, point);
  await expect.poll(async () => {
    return page.evaluate(() => {
      const w = window as unknown as {
        CALPINAGE_STATE?: { placedPanels?: unknown[]; frozenBlocks?: unknown[]; activeManipulationBlockId?: string | null };
        pvPlacementEngine?: { getAllPanels?: () => unknown[]; getFrozenBlocks?: () => unknown[]; getFocusBlock?: () => unknown };
      };
      const enginePanels = w.pvPlacementEngine?.getAllPanels?.() ?? [];
      const focusBlock = w.pvPlacementEngine?.getFocusBlock?.();
      return {
        enginePanels: enginePanels.length,
        placedPanels: w.CALPINAGE_STATE?.placedPanels?.length ?? 0,
        frozenBlocks: w.CALPINAGE_STATE?.frozenBlocks?.length ?? w.pvPlacementEngine?.getFrozenBlocks?.()?.length ?? 0,
        hasFocusBlock: !!focusBlock,
      };
    });
  }, { timeout: 15000 }).toMatchObject({ hasFocusBlock: true });
}

async function phase3PlacementSummary(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as {
      CALPINAGE_STATE?: Record<string, unknown>;
      pvPlacementEngine?: { getAllPanels?: () => unknown[]; getFrozenBlocks?: () => unknown[]; getFocusBlock?: () => unknown };
      __SAFE_ZONE_PH3__?: { cache?: { byPanId?: Record<string, unknown> } };
      PV_SELECTED_PANEL?: { id?: string };
      getPhase3ActiveTool?: () => string;
    };
    const state = w.CALPINAGE_STATE ?? {};
    const pans = Array.isArray(state.pans) ? state.pans as Array<Record<string, unknown>> : [];
    const placedPanels = Array.isArray(state.placedPanels) ? state.placedPanels as Array<Record<string, unknown>> : [];
    const enginePanels = w.pvPlacementEngine?.getAllPanels?.() ?? [];
    const frozenBlocks = w.pvPlacementEngine?.getFrozenBlocks?.() ?? [];
    const safeZones = w.__SAFE_ZONE_PH3__?.cache?.byPanId ?? {};
    return {
      currentPhase: state.currentPhase ?? null,
      selectedPanelId: w.PV_SELECTED_PANEL?.id ?? null,
      activeTool: w.getPhase3ActiveTool?.() ?? null,
      panIds: pans.map((pan) => String(pan.id)),
      safeZonePanIds: Object.keys(safeZones),
      placedPanels: placedPanels.length,
      enginePanels: enginePanels.length,
      frozenBlocks: frozenBlocks.length,
      focusBlock: w.pvPlacementEngine?.getFocusBlock?.() ?? null,
      panelRefs: enginePanels.map((panel) => ({
        id: (panel as Record<string, unknown>).id,
        panId: (panel as Record<string, unknown>).panId,
        blockId: (panel as Record<string, unknown>).blockId,
        x: (panel as Record<string, unknown>).x,
        y: (panel as Record<string, unknown>).y,
      })),
    };
  });
}

function panHeightPairs(pans: unknown): number[][] {
  if (!Array.isArray(pans)) return [];
  return pans.map((pan) => {
    const record = pan as Record<string, unknown>;
    const points = (record.points ?? record.polygon ?? record.polygonPx ?? []) as Array<{ h?: unknown }>;
    const values = points
      .map((point) => Number(point.h))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    return [values[0] ?? null, values[values.length - 1] ?? null] as number[];
  }).sort((a, b) => Number(a[0] ?? 0) - Number(b[0] ?? 0) || Number(a[1] ?? 0) - Number(b[1] ?? 0));
}

async function activeRoofSummary(page: Page) {
  return page.evaluate(() => {
    const state = (window as unknown as { CALPINAGE_STATE?: Record<string, unknown> }).CALPINAGE_STATE ?? {};
    const pans = Array.isArray(state.pans) ? state.pans as Array<Record<string, unknown>> : [];
    const smart = state.smartRoofDrawing as { graph?: { groups?: unknown[]; nodes?: unknown[]; segments?: unknown[] } } | undefined;
    const heightPairs = pans.map((pan) => {
      const points = (pan.points ?? pan.polygon ?? pan.polygonPx ?? []) as Array<{ h?: unknown }>;
      const values = points
        .map((point) => Number(point.h))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      return [values[0] ?? null, values[values.length - 1] ?? null];
    }).sort((a, b) => Number(a[0] ?? 0) - Number(b[0] ?? 0) || Number(a[1] ?? 0) - Number(b[1] ?? 0));
    return {
      currentPhase: state.currentPhase ?? null,
      panCount: pans.length,
      panIds: pans.map((pan) => String(pan.id)).sort(),
      heightPairs,
      slopes: pans.map((pan) => Number(pan.tiltDeg ?? pan.slopeDeg)).filter(Number.isFinite).sort((a, b) => a - b),
      inclined: pans.map((pan) => Number(pan.inclinedSurfaceM2 ?? pan.surfaceInclinedM2)).filter(Number.isFinite).sort((a, b) => a - b),
      projected: pans.map((pan) => Number(pan.projectedSurfaceM2 ?? pan.surfaceM2)).filter(Number.isFinite).sort((a, b) => a - b),
      smartGroups: smart?.graph?.groups?.length ?? 0,
      smartNodes: smart?.graph?.nodes?.length ?? 0,
      smartSegments: smart?.graph?.segments?.length ?? 0,
      placedPanels: Array.isArray(state.placedPanels) ? state.placedPanels.length : 0,
      frozenBlocks: Array.isArray(state.frozenBlocks) ? state.frozenBlocks.length : 0,
    };
  });
}

async function applyCurrentSmartDraft(page: Page) {
  await page.locator("#calpinage-smart-roof-apply").click();
  await expect.poll(async () => {
    return page.evaluate(() => (window as unknown as { __calpinageSmartRoofDrawingLastApply?: { ok?: boolean } }).__calpinageSmartRoofDrawingLastApply?.ok ?? false);
  }, { timeout: 10000 }).toBe(true);
}

async function enterPhase3AndPlacePanel(
  page: Page,
  expectedPanCount: number,
  point: { x: number; y: number },
  screenshotName: string,
) {
  const applied = await activeRoofSummary(page);
  expect(applied.panCount).toBe(expectedPanCount);
  await validateRoofAndEnterPhase3(page);
  await page.evaluate(() => {
    const w = window as unknown as { CALPINAGE_RENDER?: () => void };
    if (w.CALPINAGE_RENDER) w.CALPINAGE_RENDER();
  });
  await expect.poll(async () => {
    const summary = await phase3PlacementSummary(page);
    return {
      phase: summary.currentPhase,
      safeZones: summary.safeZonePanIds.length,
    };
  }, { timeout: 15000 }).toEqual({ phase: "PV_LAYOUT", safeZones: expectedPanCount });
  await placePanelWithProductTool(page, point);
  const placement = await phase3PlacementSummary(page);
  expect(placement.currentPhase).toBe("PV_LAYOUT");
  expect(placement.safeZonePanIds).toEqual(expect.arrayContaining(applied.panIds));
  expect(placement.enginePanels).toBeGreaterThan(0);
  expect(placement.panelRefs.some((panel) => applied.panIds.includes(String(panel.panId)))).toBe(true);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, screenshotName), fullPage: true });
  return { applied, placement };
}

test.describe("Smart roof drawing integrated recipe", () => {
  test.beforeEach(async () => {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  });

  test("draws a measured two-slope roof with mouse, applies it, reopens it, and keeps the flag off path readable", async ({ page, context }) => {
    const server = { geometry: emptyGeometryFixture(), saves: [] as unknown[] };
    const consoleIssues: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleIssues.push(msg.text());
    });
    page.on("pageerror", (err) => consoleIssues.push(err.message));
    await installRecipeMocks(context, server);
    await installBrowserRuntime(context, true);

    await openCalpinage(page);
    await openSmartRoofDraft(page);
    const protectedBefore = await activeSnapshot(page);

    await drawPolyline(page, [
      { x: 200, y: 220 },
      { x: 300, y: 220 },
      { x: 300, y: 300 },
      { x: 200, y: 300 },
    ], true);
    await expect.poll(async () => {
      const state = await smartState(page) as { compile?: { status?: string; message?: string; result?: { legacyState?: { pans?: unknown[] } } } } | undefined;
      return {
        status: state?.compile?.status ?? null,
        panCount: state?.compile?.result?.legacyState?.pans?.length ?? 0,
        estimated: /relief estime/i.test(state?.compile?.message ?? ""),
      };
    }).toEqual({ status: "computed", panCount: 1, estimated: true });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "01-gable-rectangle.png"), fullPage: true });

    const canvasCenter = await imageToClient(page, { x: 250, y: 260 });
    await page.mouse.move(canvasCenter.x, canvasCenter.y);
    await page.mouse.wheel(0, -420);
    await page.waitForTimeout(250);

    await drawPolyline(page, [{ x: 200, y: 260 }, { x: 300, y: 260 }]);
    await expect.poll(async () => {
      const state = await smartState(page) as { graph?: { segments?: unknown[] } } | undefined;
      return state?.graph?.segments?.length ?? 0;
    }).toBe(7);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "02-gable-inner-line-after-zoom.png"), fullPage: true });

    await page.locator("#calpinage-smart-roof-tool-select").click();
    const idsBeforeDrag = await page.evaluate(() => {
      const state = (window as unknown as { __calpinageSmartRoofDrawing?: { getState: () => { graph: { segments: { id: string }[] } } } }).__calpinageSmartRoofDrawing?.getState();
      return state?.graph.segments.map((s) => s.id).sort() ?? [];
    });
    await dragImage(page, { x: 200, y: 260 }, { x: 200, y: 240 });
    const idsAfterDrag = await page.evaluate(() => {
      const state = (window as unknown as { __calpinageSmartRoofDrawing?: { getState: () => { graph: { segments: { id: string }[] } } } }).__calpinageSmartRoofDrawing?.getState();
      return state?.graph.segments.map((s) => s.id).sort() ?? [];
    });
    expect(idsAfterDrag).toEqual(idsBeforeDrag);
    await expect.poll(async () => {
      return page.evaluate(() => {
        const state = (window as unknown as { __calpinageSmartRoofDrawing?: { getState: () => { graph: { nodes: { x: number; y: number }[] } } } }).__calpinageSmartRoofDrawing?.getState();
        return state?.graph.nodes.some((n) => Math.abs(n.x - 200) <= 0.1 && Math.abs(n.y - 240) <= 0.1) ?? false;
      });
    }).toBe(true);
    await page.locator("#calpinage-smart-roof-undo").click();
    await expect.poll(async () => {
      return page.evaluate(() => {
        const state = (window as unknown as { __calpinageSmartRoofDrawing?: { getState: () => { graph: { nodes: { x: number; y: number }[]; segments: unknown[] } } } }).__calpinageSmartRoofDrawing?.getState();
        return {
          hasOriginalJunction: state?.graph.nodes.some((n) => Math.abs(n.x - 200) <= 0.1 && Math.abs(n.y - 260) <= 0.1) ?? false,
          segments: state?.graph.segments.length ?? 0,
        };
      });
    }).toEqual({ hasOriginalJunction: true, segments: 7 });

    await clickImage(page, { x: 250, y: 260 });
    await page.keyboard.press("Delete");
    await expect.poll(async () => {
      const state = await smartState(page) as { graph?: { segments?: unknown[] } } | undefined;
      return state?.graph?.segments?.length ?? 0;
    }).toBeLessThan(7);
    await page.locator("#calpinage-smart-roof-undo").click();
    await expect.poll(async () => {
      const state = await smartState(page) as { graph?: { segments?: unknown[] } } | undefined;
      return state?.graph?.segments?.length ?? 0;
    }).toBe(7);

    expect(await activeSnapshot(page)).toBe(protectedBefore);
    await setFlatHeight(page, "3");
    await clickImage(page, { x: 250, y: 260 });
    await expect.poll(async () => {
      const state = await smartState(page) as { selected?: { type?: string; segmentId?: string }; graph?: { segments?: Array<{ id: string }> } } | undefined;
      return {
        type: state?.selected?.type ?? null,
        selectedExists: !!state?.graph?.segments?.some((s) => s.id === state?.selected?.segmentId),
      };
    }).toEqual({ type: "segment", selectedExists: true });
    await setSelectedHeight(page, "5");
    await expect.poll(async () => {
      return page.evaluate(() => {
        const state = (window as unknown as {
          __calpinageSmartRoofDrawing?: {
            getState: () => {
              selected?: { type?: string; segmentId?: string };
              graph: {
                nodes: Array<{ id: string; height?: { valueM?: number } }>;
                segments: Array<{ id: string; startNodeId: string; endNodeId: string; height?: { valueM?: number } }>;
              };
              diagnostics?: Array<{ code?: string; message?: string }>;
            };
          };
        }).__calpinageSmartRoofDrawing?.getState();
        if (!state?.selected || state.selected.type !== "segment") return null;
        const segment = state.graph.segments.find((s) => s.id === state.selected?.segmentId);
        if (!segment) return null;
        const heights = [segment.startNodeId, segment.endNodeId]
          .map((id) => state.graph.nodes.find((n) => n.id === id)?.height?.valueM ?? null)
          .sort((a, b) => Number(a ?? 0) - Number(b ?? 0));
        return {
          selectedSegmentId: segment.id,
          segmentHeight: segment.height?.valueM ?? null,
          endpointHeights: heights,
          diagnosticCodes: state.diagnostics?.map((item) => item.code).filter(Boolean) ?? [],
        };
      });
    }).toMatchObject({ segmentHeight: 5, endpointHeights: [5, 5] });

    const candidate = await page.evaluate(() => {
      const api = (window as unknown as { __calpinageSmartRoofDrawing?: { prepareApplication: () => unknown } }).__calpinageSmartRoofDrawing;
      return api?.prepareApplication();
    }) as { status?: string; legacyState?: { pans?: Array<Record<string, unknown>> } };
    expect(candidate.status).toBe("ready");
    expect(candidate.legacyState?.pans?.length).toBe(2);
    for (const pan of candidate.legacyState?.pans ?? []) {
      expect(Number(pan.projectedSurfaceM2 ?? pan.surfaceM2)).toBeCloseTo(40, 2);
      expect(Number(pan.inclinedSurfaceM2)).toBeCloseTo(44.72135955, 2);
      expect(Number(pan.tiltDeg ?? pan.slopeDeg)).toBeCloseTo(26.56505118, 2);
    }

    await page.screenshot({ path: path.join(ARTIFACT_DIR, "03-gable-relief-ready.png"), fullPage: true });
    await page.locator("#calpinage-smart-roof-apply").click();
    await expect.poll(async () => {
      return page.evaluate(() => {
        const last = (window as unknown as { __calpinageSmartRoofDrawingLastApply?: { ok?: boolean } }).__calpinageSmartRoofDrawingLastApply;
        return last?.ok === true;
      });
    }).toBe(true);
    await expect.poll(() => {
      const last = server.saves.at(-1) as { smartRoofDrawing?: { kind?: string } } | undefined;
      return last?.smartRoofDrawing?.kind ?? null;
    }, { timeout: 8000 }).toBe("smartRoofDrawing");

    const applied = await page.evaluate(() => {
      const state = (window as unknown as { CALPINAGE_STATE?: Record<string, unknown>; __CALPINAGE_VIEW_MODE__?: string }).CALPINAGE_STATE!;
      const last = (window as unknown as { __calpinageSmartRoofDrawingLastApply?: { candidate?: { legacyState?: { pans?: Array<Record<string, unknown>> } } } }).__calpinageSmartRoofDrawingLastApply;
      const restoreDebug = (window as unknown as { __calpinageSmartRoofDrawingLastMetricRestore?: unknown }).__calpinageSmartRoofDrawingLastMetricRestore;
      const pans = state.pans as Array<Record<string, unknown>>;
      return {
        smartKind: (state.smartRoofDrawing as { kind?: string } | undefined)?.kind,
        panCount: pans.length,
        restoreDebug,
        candidatePanDebug: (last?.candidate?.legacyState?.pans ?? []).map((p) => ({
          id: p.id,
          keys: Object.keys(p).sort(),
          surfaceM2: p.surfaceM2,
          projectedSurfaceM2: p.projectedSurfaceM2,
          inclinedSurfaceM2: p.inclinedSurfaceM2,
          tiltDeg: p.tiltDeg,
          smartSourceSegmentIds: p.smartSourceSegmentIds,
        })),
        panDebug: pans.map((p) => ({
          id: p.id,
          keys: Object.keys(p).sort(),
          surfaceM2: p.surfaceM2,
          projectedSurfaceM2: p.projectedSurfaceM2,
          inclinedSurfaceM2: p.inclinedSurfaceM2,
          tiltDeg: p.tiltDeg,
          slopeDeg: p.slopeDeg,
          physical: p.physical,
        })),
        projected: pans.map((p) => Number(p.projectedSurfaceM2 ?? p.surfaceM2)),
        inclined: pans.map((p) => Number(p.inclinedSurfaceM2)),
        slopes: pans.map((p) => Number(p.tiltDeg ?? p.slopeDeg)),
        graphNodes: (state.smartRoofDrawing as { graph?: { nodes?: unknown[] } } | undefined)?.graph?.nodes?.length ?? 0,
        graphSegments: (state.smartRoofDrawing as { graph?: { segments?: unknown[] } } | undefined)?.graph?.segments?.length ?? 0,
        viewMode: (window as unknown as { __CALPINAGE_VIEW_MODE__?: string }).__CALPINAGE_VIEW_MODE__,
      };
    });
    expect(applied.smartKind).toBe("smartRoofDrawing");
    expect(applied.panCount).toBe(2);
    expect(applied.graphNodes).toBe(6);
    expect(applied.graphSegments).toBe(7);
    expect(applied.projected, JSON.stringify({ active: applied.panDebug, candidate: applied.candidatePanDebug, restoreDebug: applied.restoreDebug }, null, 2)).toEqual(expect.arrayContaining([expect.closeTo(40, 2), expect.closeTo(40, 2)]));
    expect(applied.inclined, JSON.stringify(applied.panDebug, null, 2)).toEqual(expect.arrayContaining([expect.closeTo(44.72135955, 2), expect.closeTo(44.72135955, 2)]));
    expect(applied.slopes, JSON.stringify(applied.panDebug, null, 2)).toEqual(expect.arrayContaining([expect.closeTo(26.56505118, 2), expect.closeTo(26.56505118, 2)]));

    const switchedTo3D = await page.evaluate(() => {
      const w = window as unknown as { __calpinageSwitchTo3D?: () => void };
      if (typeof w.__calpinageSwitchTo3D !== "function") return false;
      w.__calpinageSwitchTo3D();
      return true;
    });
    if (switchedTo3D) {
      await page.waitForFunction(() => (window as unknown as { __CALPINAGE_VIEW_MODE__?: string }).__CALPINAGE_VIEW_MODE__ === "3D", { timeout: 15000 });
      await expect(page.locator("#zone-c-3d.visible")).toBeVisible({ timeout: 45000 });
      await page.screenshot({ path: path.join(ARTIFACT_DIR, "04-gable-3d.png"), fullPage: true });
      await page.evaluate(() => {
        (window as unknown as { __calpinageSwitchTo2D?: () => void }).__calpinageSwitchTo2D?.();
      });
      await page.waitForFunction(() => (window as unknown as { __CALPINAGE_VIEW_MODE__?: string }).__CALPINAGE_VIEW_MODE__ === "2D", { timeout: 15000 });
    }

    await page.reload({ waitUntil: "domcontentloaded" });
    await openCalpinage(page);
    const reopenDebug = await page.evaluate((ids) => {
      const state = (window as unknown as { CALPINAGE_STATE?: Record<string, unknown> }).CALPINAGE_STATE ?? {};
      const keys = Object.keys(localStorage).filter((key) => key.includes(ids.studyId) || key.includes(ids.versionNumber) || key.includes(ids.versionId)).sort();
      return {
        stateSmartKind: (state.smartRoofDrawing as { kind?: string } | undefined)?.kind ?? null,
        invalidSmartKind: (state.smartRoofDrawingInvalid as { kind?: string } | undefined)?.kind ?? null,
        diagnostics: state.smartRoofDrawingLoadDiagnostics ?? null,
        openButtons: Array.from(document.querySelectorAll<HTMLButtonElement>("#calpinage-smart-roof-open")).map((button) => {
          const rect = button.getBoundingClientRect();
          return {
            text: button.textContent?.trim() ?? "",
            hidden: button.hidden,
            display: getComputedStyle(button).display,
            visibleBox: rect.width > 0 && rect.height > 0,
          };
        }),
        localStorageKeys: keys,
        localStorageSmartKinds: keys.map((key) => {
          const raw = localStorage.getItem(key);
          try {
            const parsed = raw ? JSON.parse(raw) : null;
            return { key, kind: parsed?.smartRoofDrawing?.kind ?? null, hasPans: Array.isArray(parsed?.pans) ? parsed.pans.length : null };
          } catch {
            return { key, kind: null, hasPans: null };
          }
        }),
      };
    }, { studyId: STUDY_ID, versionId: STUDY_VERSION_ID, versionNumber: String(VERSION_NUMBER) });
    expect(await page.locator("#calpinage-smart-roof-open").textContent(), JSON.stringify({ reopenDebug, serverGeometrySmartKind: (server.geometry.smartRoofDrawing as { kind?: string } | undefined)?.kind }, null, 2)).toContain("Reprendre le dessin unique");
    await page.locator("#calpinage-smart-roof-open").click();
    await expect.poll(async () => {
      const state = await smartState(page) as { sourceImportCount?: number; graph?: { nodes?: unknown[]; segments?: unknown[] } } | undefined;
      return {
        sourceImportCount: state?.sourceImportCount,
        nodes: state?.graph?.nodes?.length,
        segments: state?.graph?.segments?.length,
      };
    }).toEqual({ sourceImportCount: 0, nodes: 6, segments: 7 });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "05-gable-reopened-draft.png"), fullPage: true });
    await page.locator("#calpinage-smart-roof-close").click();

    await page.evaluate(() => {
      localStorage.setItem("__smart_roof_recipe_force_drawing", "false");
      localStorage.setItem("calpinage_smart_roof_drawing", "false");
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await openCalpinage(page);
    const flagOff = await page.evaluate(() => ({
      hasApi: typeof (window as unknown as { __calpinageSmartRoofDrawing?: unknown }).__calpinageSmartRoofDrawing !== "undefined",
      smartKind: ((window as unknown as { CALPINAGE_STATE?: { smartRoofDrawing?: { kind?: string } } }).CALPINAGE_STATE?.smartRoofDrawing)?.kind,
      openHidden: (document.querySelector<HTMLButtonElement>("#calpinage-smart-roof-open")?.hidden ?? null),
      legacyDrawDisabled: document.querySelector<HTMLButtonElement>("#calpinage-tool-dessin-toiture")?.disabled ?? false,
    }));
    expect(flagOff).toMatchObject({
      hasApi: false,
      smartKind: "smartRoofDrawing",
      openHidden: true,
      legacyDrawDisabled: true,
    });

    expect(consoleIssues.filter((text) => !/Dimensions image/i.test(text))).toEqual([]);
  });

  test("draws and applies a flat L without filling the concavity", async ({ page, context }) => {
    const server = { geometry: emptyGeometryFixture(), saves: [] as unknown[] };
    await installRecipeMocks(context, server);
    await installBrowserRuntime(context, true);

    await openCalpinage(page);
    await openSmartRoofDraft(page);
    await drawPolyline(page, [
      { x: 200, y: 200 },
      { x: 320, y: 200 },
      { x: 320, y: 240 },
      { x: 240, y: 240 },
      { x: 240, y: 320 },
      { x: 200, y: 320 },
    ], true);
    await setFlatHeight(page, "3");

    const candidate = await page.evaluate(() => {
      const api = (window as unknown as { __calpinageSmartRoofDrawing?: { prepareApplication: () => unknown } }).__calpinageSmartRoofDrawing;
      return api?.prepareApplication();
    }) as { status?: string; legacyState?: { pans?: Array<Record<string, unknown>> } };
    expect(candidate.status).toBe("ready");
    expect(candidate.legacyState?.pans?.length).toBe(1);
    const pan = candidate.legacyState?.pans?.[0] ?? {};
    expect(Number(pan.projectedSurfaceM2 ?? pan.surfaceM2)).toBeCloseTo(80, 2);
    expect(Number(pan.inclinedSurfaceM2)).toBeCloseTo(80, 2);
    expect(((pan.polygon ?? pan.polygonPx ?? pan.points) as unknown[])?.length).toBe(6);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, "06-flat-l-ready.png"), fullPage: true });
    await page.locator("#calpinage-smart-roof-apply").click();
    await expect.poll(async () => {
      return page.evaluate(() => (window as unknown as { CALPINAGE_STATE?: { pans?: unknown[] } }).CALPINAGE_STATE?.pans?.length ?? 0);
    }).toBe(1);
    await expect.poll(() => {
      const last = server.saves.at(-1) as { smartRoofDrawing?: { kind?: string } } | undefined;
      return last?.smartRoofDrawing?.kind ?? null;
    }, { timeout: 8000 }).toBe("smartRoofDrawing");
  });

  test("draws an unknown four-pan roof and receives ridge/hip interpretation", async ({ page, context }) => {
    const server = { geometry: emptyGeometryFixture(), saves: [] as unknown[] };
    await installRecipeMocks(context, server);
    await installBrowserRuntime(context, true);

    await openCalpinage(page);
    await openSmartRoofDraft(page);
    await drawPolyline(page, [
      { x: 200, y: 200 },
      { x: 300, y: 200 },
      { x: 300, y: 280 },
      { x: 200, y: 280 },
    ], true);
    await drawPolyline(page, [{ x: 240, y: 240 }, { x: 260, y: 240 }]);
    await drawPolyline(page, [{ x: 200, y: 200 }, { x: 240, y: 240 }]);
    await drawPolyline(page, [{ x: 200, y: 280 }, { x: 240, y: 240 }]);
    await drawPolyline(page, [{ x: 300, y: 200 }, { x: 260, y: 240 }]);
    await drawPolyline(page, [{ x: 300, y: 280 }, { x: 260, y: 240 }]);

    await expect.poll(async () => {
      const state = await smartState(page) as {
        compile?: {
          status?: string;
          message?: string;
          result?: {
            legacyState?: { pans?: unknown[]; ridges?: unknown[]; traits?: unknown[] };
            normalizedGraph?: { segments?: Array<{ role?: { value?: string; source?: string } }> };
          };
        };
      } | undefined;
      const roles = state?.compile?.result?.normalizedGraph?.segments?.map((s) => s.role?.value).filter(Boolean) ?? [];
      return {
        status: state?.compile?.status ?? null,
        panCount: state?.compile?.result?.legacyState?.pans?.length ?? 0,
        ridgeCount: state?.compile?.result?.legacyState?.ridges?.length ?? 0,
        hipCount: roles.filter((role) => role === "hip").length,
        estimated: /relief estime/i.test(state?.compile?.message ?? ""),
      };
    }, { timeout: 10000 }).toEqual({ status: "computed", panCount: 4, ridgeCount: 1, hipCount: 4, estimated: true });

    const candidate = await page.evaluate(() => {
      return (window as unknown as { __calpinageSmartRoofDrawing?: { prepareApplication: () => { status?: string } } }).__calpinageSmartRoofDrawing?.prepareApplication();
    });
    expect(candidate?.status).toBe("ready");
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "07-four-pan-ready.png"), fullPage: true });
    await applyCurrentSmartDraft(page);
    const phase3 = await enterPhase3AndPlacePanel(page, 4, { x: 250, y: 218 }, "07-four-pan-phase3-panel.png");
    expect(phase3.applied.slopes.every((slope) => slope > 0)).toBe(true);
    expect(phase3.applied.inclined.every((area, index) => area >= (phase3.applied.projected[index] ?? 0))).toBe(true);
  });

  test("draws the reference L multipan roof without filling the missing corner", async ({ page, context }) => {
    const server = { geometry: emptyGeometryFixture(), saves: [] as unknown[] };
    await installRecipeMocks(context, server);
    await installBrowserRuntime(context, true);

    await openCalpinage(page);
    await openSmartRoofDraft(page);
    await drawPolyline(page, [
      { x: 200, y: 200 },
      { x: 320, y: 200 },
      { x: 320, y: 260 },
      { x: 260, y: 260 },
      { x: 260, y: 320 },
      { x: 200, y: 320 },
    ], true);
    await drawPolyline(page, [{ x: 200, y: 230 }, { x: 320, y: 230 }]);
    await drawPolyline(page, [{ x: 230, y: 230 }, { x: 230, y: 320 }]);
    await drawPolyline(page, [{ x: 200, y: 260 }, { x: 230, y: 230 }]);
    await drawPolyline(page, [{ x: 260, y: 260 }, { x: 230, y: 230 }]);

    await expect.poll(async () => {
      const state = await smartState(page) as {
        compile?: {
          status?: string;
          message?: string;
          result?: {
            legacyState?: { pans?: Array<Record<string, unknown>>; ridges?: unknown[]; traits?: unknown[] };
            normalizedGraph?: { segments?: Array<{ role?: { value?: string; source?: string } }> };
          };
        };
      } | undefined;
      const roles = state?.compile?.result?.normalizedGraph?.segments?.map((s) => s.role?.value).filter(Boolean) ?? [];
      const polygonAreaPx2 = (points: Array<{ x?: number; y?: number }>) => Math.abs(points.reduce((sum, point, index) => {
        const next = points[(index + 1) % points.length] ?? points[0] ?? {};
        return sum + Number(point.x ?? 0) * Number(next.y ?? 0) - Number(point.y ?? 0) * Number(next.x ?? 0);
      }, 0) / 2);
      const area = (state?.compile?.result?.legacyState?.pans ?? []).reduce((sum, pan) => {
        const points = (pan.polygon ?? pan.polygonPx ?? pan.points ?? []) as Array<{ x?: number; y?: number }>;
        return sum + polygonAreaPx2(points) * 0.01;
      }, 0);
      return {
        status: state?.compile?.status ?? null,
        panCount: state?.compile?.result?.legacyState?.pans?.length ?? 0,
        ridgeCount: state?.compile?.result?.legacyState?.ridges?.length ?? 0,
        valleyCount: roles.filter((role) => role === "valley").length,
        area: Math.round(area),
        estimated: /relief estime/i.test(state?.compile?.message ?? ""),
      };
    }, { timeout: 10000 }).toEqual({ status: "computed", panCount: 5, ridgeCount: 3, valleyCount: 2, area: 108, estimated: true });

    const candidate = await page.evaluate(() => {
      return (window as unknown as { __calpinageSmartRoofDrawing?: { prepareApplication: () => { status?: string } } }).__calpinageSmartRoofDrawing?.prepareApplication();
    });
    expect(candidate?.status).toBe("ready");
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "08-l-multipan-ready.png"), fullPage: true });
    await applyCurrentSmartDraft(page);
    const phase3 = await enterPhase3AndPlacePanel(page, 5, { x: 285, y: 215 }, "08-l-multipan-phase3-panel.png");
    const beforeForbidden = phase3.placement.enginePanels;
    await clickImage(page, { x: 295, y: 295 });
    await page.waitForTimeout(300);
    const afterForbidden = await phase3PlacementSummary(page);
    expect(afterForbidden.enginePanels).toBe(beforeForbidden);
  });

  test("draws a simple dormer as unknown nested lines and publishes it to the existing 3D extension model", async ({ page, context }) => {
    const server = { geometry: emptyGeometryFixture(), saves: [] as unknown[] };
    await installRecipeMocks(context, server);
    await installBrowserRuntime(context, true);

    await openCalpinage(page);
    await openSmartRoofDraft(page);
    await drawPolyline(page, [
      { x: 200, y: 200 },
      { x: 300, y: 200 },
      { x: 300, y: 280 },
      { x: 200, y: 280 },
    ], true);
    await drawPolyline(page, [
      { x: 230, y: 220 },
      { x: 250, y: 220 },
      { x: 250, y: 250 },
      { x: 230, y: 250 },
    ], true);
    await drawPolyline(page, [{ x: 240, y: 220 }, { x: 240, y: 250 }]);

    await expect.poll(async () => {
      const state = await smartState(page) as {
        compile?: {
          status?: string;
          message?: string;
          result?: { legacyState?: { pans?: unknown[]; roofExtensions?: Array<Record<string, unknown>> } };
        };
      } | undefined;
      const extension = state?.compile?.result?.legacyState?.roofExtensions?.[0];
      return {
        status: state?.compile?.status ?? null,
        panCount: state?.compile?.result?.legacyState?.pans?.length ?? 0,
        extensionCount: state?.compile?.result?.legacyState?.roofExtensions?.length ?? 0,
        supportPanIdPresent: typeof extension?.supportPanId === "string" && extension.supportPanId.length > 0,
        estimated: /relief estime/i.test(state?.compile?.message ?? ""),
      };
    }, { timeout: 10000 }).toEqual({
      status: "computed",
      panCount: 1,
      extensionCount: 1,
      supportPanIdPresent: true,
      estimated: true,
    });

    const candidate = await page.evaluate(() => {
      return (window as unknown as { __calpinageSmartRoofDrawing?: { prepareApplication: () => {
        status?: string;
        legacyState?: { roofExtensions?: Array<Record<string, unknown>> };
      } } }).__calpinageSmartRoofDrawing?.prepareApplication();
    }) as {
      status?: string | null;
      legacyState?: { roofExtensions?: Array<{ supportPanId?: string; ridgeHeightRelM?: number; heightReference?: string }> };
    };
    expect(candidate.status).toBe("ready");
    const extension = candidate.legacyState?.roofExtensions?.[0];
    expect(extension).toMatchObject({
      ridgeHeightRelM: 1,
      heightReference: "support_plane_normal",
    });
    expect(extension?.supportPanId).toBeTruthy();
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "09-dormer-ready.png"), fullPage: true });

    await page.locator("#calpinage-smart-roof-apply").click();
    await expect.poll(async () => {
      return page.evaluate(() => {
        const state = (window as unknown as { CALPINAGE_STATE?: { roofExtensions?: unknown[] } }).CALPINAGE_STATE;
        return state?.roofExtensions?.length ?? 0;
      });
    }).toBe(1);
    const switchedTo3D = await page.evaluate(() => {
      const w = window as unknown as { __calpinageSwitchTo3D?: () => void };
      if (typeof w.__calpinageSwitchTo3D !== "function") return false;
      w.__calpinageSwitchTo3D();
      return true;
    });
    if (switchedTo3D) {
      await page.waitForFunction(() => (window as unknown as { __CALPINAGE_VIEW_MODE__?: string }).__CALPINAGE_VIEW_MODE__ === "3D", { timeout: 15000 });
      await expect(page.locator("#zone-c-3d.visible")).toBeVisible({ timeout: 45000 });
      await expect(page.locator("[data-extension-volume-count='1']")).toBeVisible({ timeout: 45000 });
      await page.screenshot({ path: path.join(ARTIFACT_DIR, "10-dormer-3d.png"), fullPage: true });
    }
  });

  test("keeps essential smart drawing actions visible with the side panel open", async ({ page, context }) => {
    const server = { geometry: emptyGeometryFixture(), saves: [] as unknown[] };
    page.on("dialog", (dialog) => dialog.accept());
    await installRecipeMocks(context, server);
    await installBrowserRuntime(context, true);

    for (const size of [
      { width: 1366, height: 768, name: "1366x768" },
      { width: 1536, height: 864, name: "1536x864" },
    ]) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openCalpinage(page);
      await openSmartRoofDraft(page);
      await drawPolyline(page, [
        { x: 200, y: 220 },
        { x: 300, y: 220 },
        { x: 300, y: 300 },
        { x: 200, y: 300 },
      ], true);
      await drawPolyline(page, [{ x: 200, y: 260 }, { x: 300, y: 260 }]);
      await setFlatHeight(page, "3");
      await page.locator("#calpinage-smart-roof-tool-select").click();
      await clickImage(page, { x: 250, y: 260 });
      await setSelectedHeight(page, "5");

      await expect.poll(async () => {
        const state = await smartState(page) as { compile?: { status?: string; result?: { legacyState?: { pans?: unknown[] } } } } | undefined;
        return {
          status: state?.compile?.status ?? null,
          panCount: state?.compile?.result?.legacyState?.pans?.length ?? 0,
        };
      }).toEqual({ status: "computed", panCount: 2 });
      await expectSmartRoofEssentialActionsVisible(page);
      await page.screenshot({ path: path.join(ARTIFACT_DIR, `11-toolbar-${size.name}.png`), fullPage: true });
      await page.locator("#calpinage-smart-roof-close").click();
      await expect(page.locator("#calpinage-smart-roof-session-bar")).toBeHidden({ timeout: 10000 });
      await page.reload({ waitUntil: "domcontentloaded" });
    }
  });

  test("draws adjacent distinct volumes without height fusion, then reaches Phase 3 with setbacks and panels", async ({ page, context }) => {
    const server = { geometry: emptyGeometryFixture(), saves: [] as unknown[] };
    const consoleIssues: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleIssues.push(msg.text());
    });
    page.on("pageerror", (err) => consoleIssues.push(err.message));
    await installRecipeMocks(context, server);
    await installBrowserRuntime(context, true);

    await page.setViewportSize({ width: 1536, height: 864 });
    await openCalpinage(page);
    await openSmartRoofDraft(page);

    await drawPolyline(page, [
      { x: 200, y: 220 },
      { x: 300, y: 220 },
      { x: 300, y: 300 },
      { x: 200, y: 300 },
    ], true);
    await drawPolyline(page, [{ x: 200, y: 260 }, { x: 300, y: 260 }]);
    await setFlatHeight(page, "3");
    await page.locator("#calpinage-smart-roof-tool-select").click();
    await clickImage(page, { x: 250, y: 260 });
    await setSelectedHeight(page, "5");

    await page.locator("#calpinage-smart-roof-new-volume").click();
    await page.locator("#calpinage-smart-roof-tool-draw").click();
    await drawPolyline(page, [
      { x: 300, y: 220 },
      { x: 400, y: 220 },
      { x: 400, y: 300 },
      { x: 300, y: 300 },
    ], true);
    await drawPolyline(page, [{ x: 300, y: 260 }, { x: 400, y: 260 }]);
    await setFlatHeight(page, "5");
    await page.locator("#calpinage-smart-roof-tool-select").click();
    await clickImage(page, { x: 350, y: 260 });
    await setSelectedHeight(page, "7");

    const beforeCandidate = await page.evaluate(() => {
      const api = (window as unknown as { __calpinageSmartRoofDrawing?: { prepareApplication: () => unknown; getState: () => unknown } }).__calpinageSmartRoofDrawing;
      const candidate = api?.prepareApplication() as { status?: string; legacyState?: { contours?: unknown[]; ridges?: unknown[]; pans?: Array<Record<string, unknown>> }; blockingDiagnostics?: Array<{ code?: string }> } | undefined;
      const state = api?.getState() as { graph?: { groups?: unknown[]; nodes?: Array<{ id: string; x: number; y: number; groupId?: string | null; height?: { valueM?: number } }>; segments?: Array<{ id: string; groupId?: string | null; height?: { valueM?: number } }> } } | undefined;
      const pans = candidate?.legacyState?.pans ?? [];
      const heightPairs = pans.map((pan) => {
        const values = ((pan.points ?? pan.polygon ?? []) as Array<{ h?: number }>).map((point) => Number(point.h)).filter(Number.isFinite).sort((a, b) => a - b);
        return [values[0] ?? null, values[values.length - 1] ?? null];
      }).sort((a, b) => Number(a[0] ?? 0) - Number(b[0] ?? 0) || Number(a[1] ?? 0) - Number(b[1] ?? 0));
      const contactNodes = (state?.graph?.nodes ?? [])
        .filter((node) => Math.abs(node.x - 300) <= 0.1)
        .map((node) => ({ groupId: node.groupId ?? null, y: node.y, h: node.height?.valueM ?? null }))
        .sort((a, b) => String(a.groupId).localeCompare(String(b.groupId)) || a.y - b.y || Number(a.h ?? 0) - Number(b.h ?? 0));
      return {
        status: candidate?.status ?? null,
        contourCount: candidate?.legacyState?.contours?.length ?? 0,
        ridgeCount: candidate?.legacyState?.ridges?.length ?? 0,
        panCount: pans.length,
        heightPairs,
        groupCount: state?.graph?.groups?.length ?? 0,
        segmentGroups: Array.from(new Set((state?.graph?.segments ?? []).map((segment) => segment.groupId ?? null))).sort(),
        contactNodes,
        blockingCodes: candidate?.blockingDiagnostics?.map((item) => item.code).filter(Boolean) ?? [],
      };
    });
    expect(beforeCandidate).toMatchObject({
      status: "ready",
      contourCount: 2,
      ridgeCount: 2,
      panCount: 4,
      groupCount: 2,
      heightPairs: [[3, 5], [3, 5], [5, 7], [5, 7]],
    });
    expect((beforeCandidate as { blockingCodes?: string[] }).blockingCodes ?? []).not.toContain("SMART_ROOF_NODE_HEIGHT_CONFLICT");
    expect((beforeCandidate as { contactNodes?: Array<{ groupId: string | null; h: number | null }> }).contactNodes ?? []).toEqual(expect.arrayContaining([
      expect.objectContaining({ h: 3 }),
      expect.objectContaining({ h: 5 }),
      expect.objectContaining({ h: 7 }),
    ]));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "13-two-distinct-volumes-ready.png"), fullPage: true });

    await clickImage(page, { x: 350, y: 260 });
    await setSelectedHeight(page, "7.5");
    const afterBHeightChange = await page.evaluate(() => {
      const api = (window as unknown as { __calpinageSmartRoofDrawing?: { prepareApplication: () => unknown } }).__calpinageSmartRoofDrawing;
      const candidate = api?.prepareApplication() as { status?: string; legacyState?: { pans?: Array<Record<string, unknown>> } } | undefined;
      const pairs = (candidate?.legacyState?.pans ?? []).map((pan) => {
        const values = ((pan.points ?? pan.polygon ?? []) as Array<{ h?: number }>).map((point) => Number(point.h)).filter(Number.isFinite).sort((a, b) => a - b);
        return [values[0] ?? null, values[values.length - 1] ?? null];
      }).sort((a, b) => Number(a[0] ?? 0) - Number(b[0] ?? 0) || Number(a[1] ?? 0) - Number(b[1] ?? 0));
      return { status: candidate?.status ?? null, pairs };
    });
    expect(afterBHeightChange).toEqual({ status: "ready", pairs: [[3, 5], [3, 5], [5, 7.5], [5, 7.5]] });

    await page.locator("#calpinage-smart-roof-apply").click();
    await expect.poll(async () => {
      return page.evaluate(() => (window as unknown as { __calpinageSmartRoofDrawingLastApply?: { ok?: boolean } }).__calpinageSmartRoofDrawingLastApply?.ok ?? false);
    }).toBe(true);
    const applied = await page.evaluate(() => {
      const state = (window as unknown as { CALPINAGE_STATE?: Record<string, unknown> }).CALPINAGE_STATE ?? {};
      const pans = Array.isArray(state.pans) ? state.pans as Array<Record<string, unknown>> : [];
      return {
        panCount: pans.length,
        smartGroups: ((state.smartRoofDrawing as { graph?: { groups?: unknown[] } } | undefined)?.graph?.groups ?? []).length,
        panIds: pans.map((pan) => pan.id).sort(),
        heightPairs: pans.map((pan) => {
          const values = ((pan.points ?? pan.polygon ?? []) as Array<{ h?: number }>).map((point) => Number(point.h)).filter(Number.isFinite).sort((a, b) => a - b);
          return [values[0] ?? null, values[values.length - 1] ?? null];
        }).sort((a, b) => Number(a[0] ?? 0) - Number(b[0] ?? 0) || Number(a[1] ?? 0) - Number(b[1] ?? 0)),
      };
    });
    expect(applied).toMatchObject({
      panCount: 4,
      smartGroups: 2,
      heightPairs: [[3, 5], [3, 5], [5, 7.5], [5, 7.5]],
    });

    await validateRoofAndEnterPhase3(page);
    await page.evaluate(() => {
      const w = window as unknown as { CALPINAGE_RENDER?: () => void };
      if (w.CALPINAGE_RENDER) w.CALPINAGE_RENDER();
    });
    await expect.poll(async () => {
      const summary = await phase3PlacementSummary(page);
      return {
        phase: summary.currentPhase,
        safeZones: summary.safeZonePanIds.length,
      };
    }, { timeout: 15000 }).toEqual({ phase: "PV_LAYOUT", safeZones: 4 });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "14-two-distinct-phase3.png"), fullPage: true });

    await placePanelWithProductTool(page, { x: 225, y: 240 });
    const placement = await phase3PlacementSummary(page);
    expect(placement.currentPhase).toBe("PV_LAYOUT");
    expect(placement.safeZonePanIds).toEqual(expect.arrayContaining((applied as { panIds: string[] }).panIds));
    expect(placement.enginePanels).toBeGreaterThan(0);
    expect(placement.panelRefs.some((panel) => (applied as { panIds: string[] }).panIds.includes(String(panel.panId)))).toBe(true);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "15-two-distinct-panel-placement.png"), fullPage: true });

    await expect.poll(() => {
      const last = server.saves.at(-1) as { smartRoofDrawing?: { graph?: { groups?: unknown[]; nodes?: unknown[]; segments?: unknown[] } }; placedPanels?: unknown[]; frozenBlocks?: unknown[] } | undefined;
      return {
        smartKind: last?.smartRoofDrawing ? "smartRoofDrawing" : null,
        groups: last?.smartRoofDrawing?.graph?.groups?.length ?? 0,
        nodes: last?.smartRoofDrawing?.graph?.nodes?.length ?? 0,
        segments: last?.smartRoofDrawing?.graph?.segments?.length ?? 0,
        panels: Math.max(last?.placedPanels?.length ?? 0, last?.frozenBlocks?.length ?? 0),
      };
    }, { timeout: 12000 }).toMatchObject({ smartKind: "smartRoofDrawing", groups: 2, panels: expect.any(Number) });
    expect(Math.max(...server.saves.map((save) => {
      const item = save as { placedPanels?: unknown[]; frozenBlocks?: unknown[] };
      return Math.max(item.placedPanels?.length ?? 0, item.frozenBlocks?.length ?? 0);
    }))).toBeGreaterThan(0);

    const persisted = server.geometry as {
      smartRoofDrawing?: { graph?: { groups?: unknown[]; nodes?: unknown[]; segments?: unknown[] } };
      pans?: unknown[];
      placedPanels?: unknown[];
      frozenBlocks?: unknown[];
    };
    expect(persisted.smartRoofDrawing?.graph?.groups).toHaveLength(2);
    expect(panHeightPairs(persisted.pans)).toEqual([[3, 5], [3, 5], [5, 7.5], [5, 7.5]]);
    expect(Math.max(persisted.placedPanels?.length ?? 0, persisted.frozenBlocks?.length ?? 0)).toBeGreaterThan(0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await openCalpinage(page);
    await expect.poll(async () => activeRoofSummary(page), { timeout: 15000 }).toMatchObject({
      panCount: 4,
      smartGroups: 2,
      heightPairs: [[3, 5], [3, 5], [5, 7.5], [5, 7.5]],
    });
    const restored = await activeRoofSummary(page);
    expect(restored.currentPhase).toBe("PV_LAYOUT");
    expect(Math.max(restored.placedPanels, restored.frozenBlocks)).toBeGreaterThan(0);
    expect(restored.slopes.every((slope) => slope > 20)).toBe(true);
    expect(restored.inclined.every((area, index) => area >= (restored.projected[index] ?? 0))).toBe(true);

    expect(consoleIssues.filter((text) => !/Dimensions image/i.test(text))).toEqual([]);
  });

  test("keeps an incomplete draft blocked and leaves the active study untouched", async ({ page, context }) => {
    const server = { geometry: emptyGeometryFixture(), saves: [] as unknown[] };
    await installRecipeMocks(context, server);
    await installBrowserRuntime(context, true);

    await openCalpinage(page);
    await openSmartRoofDraft(page);
    const before = await activeSnapshot(page);
    await drawPolyline(page, [{ x: 200, y: 220 }, { x: 300, y: 220 }]);
    await setFlatHeight(page, "3");
    const candidate = await page.evaluate(() => {
      const api = (window as unknown as { __calpinageSmartRoofDrawing?: { prepareApplication: () => unknown } }).__calpinageSmartRoofDrawing;
      return api?.prepareApplication();
    }) as { status?: string; blockingDiagnostics?: Array<{ code?: string; message?: string }> };
    expect(candidate.status).not.toBe("ready");
    expect(candidate.blockingDiagnostics?.length ?? 0).toBeGreaterThan(0);
    await page.locator("#calpinage-smart-roof-apply").click();
    await page.waitForTimeout(200);
    expect(await activeSnapshot(page)).toBe(before);
    expect(server.saves).toHaveLength(0);
  });
});
