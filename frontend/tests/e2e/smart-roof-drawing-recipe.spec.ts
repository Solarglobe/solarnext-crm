import fs from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";

const STUDY_ID = "smart-roof-recipe-study";
const STUDY_VERSION_ID = "smart-roof-recipe-version";
const VERSION_NUMBER = 1;
const ARTIFACT_DIR = path.join(process.cwd(), "test-results", "smart-roof-recipe");

function fakeJwt() {
  const enc = (o: Record<string, unknown>) => Buffer.from(JSON.stringify(o)).toString("base64url");
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
    map: { provider: "google", centerLatLng: { lat: 48.8566, lng: 2.3522 }, zoom: 19, bearing: 0 },
    scale,
    canonical3DWorldContract,
    image: { dataUrl: roofImageDataUrl(), width: 900, height: 620, cssWidth: 900, cssHeight: 620 },
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
    roof: { scale, roof: roofState.roof, image: roofState.image, gps: roofState.gps, canonical3DWorldContract, roofPans: [] },
    contours: [],
    ridges: [],
    traits: [],
    obstacles: [],
    shadowVolumes: [],
    roofExtensions: [],
    pans: [],
    placedPanels: [],
    frozenBlocks: [],
    validatedRoofData: null,
    smartRoofDrawing: null,
  };
}

function geometryWithExistingObstacleAndExtension() {
  const geometry = emptyGeometryFixture();
  const roofObstacle = {
    id: "existing-roof-window",
    type: "polygon",
    businessId: "roof_window",
    points: [
      { x: 225, y: 220 },
      { x: 255, y: 220 },
      { x: 255, y: 245 },
      { x: 225, y: 245 },
    ],
    shapeMeta: { originalType: "rect", centerX: 240, centerY: 232.5, width: 30, height: 25, angle: 0 },
  };
  const manualExtension = {
    id: "existing-manual-extension",
    type: "roof_extension",
    kind: "dormer",
    supportPanId: "pan-1",
    visualModel: "manual_outline_gable",
    contour: {
      closed: true,
      points: [
        { x: 270, y: 220, h: 0 },
        { x: 300, y: 220, h: 0 },
        { x: 300, y: 250, h: 0 },
        { x: 270, y: 250, h: 0 },
      ],
    },
    ridge: {
      a: { x: 285, y: 220, h: 1 },
      b: { x: 285, y: 250, h: 1 },
    },
    ridgeHeightRelM: 1,
    heightReference: "support_plane_normal",
  };
  geometry.obstacles = [roofObstacle];
  geometry.roofState = {
    ...(geometry.roofState as Record<string, unknown>),
    obstacles: [roofObstacle],
  };
  geometry.roofExtensions = [manualExtension];
  return geometry;
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
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ permissions: ["study.manage"], superAdmin: false }) });
  });
  await context.route("**/auth/refresh", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: fakeJwt() }) });
  });
  await context.route("**/api/organizations**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: "smart-roof-recipe-org", name: "Smart roof recipe" }]) });
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
      body: JSON.stringify({ ok: true, calpinageData: { geometry_json: server.geometry } }),
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

async function installBrowserRuntime(context: BrowserContext, enableDrawing: boolean) {
  await context.addInitScript((enabled) => {
    const noop = () => undefined;
    if (enabled) localStorage.setItem("calpinage_smart_roof_drawing", "true");
    else localStorage.removeItem("calpinage_smart_roof_drawing");
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
        if (typeof center?.lat === "number" && typeof center?.lng === "number") this.center = new FakeLatLng(center.lat, center.lng);
        if (typeof options.zoom === "number") this.zoom = options.zoom;
        if (typeof options.heading === "number") this.heading = options.heading;
      }
      addListener() { return { remove: noop }; }
      fitBounds() {}
      getCenter() { return this.center; }
      getHeading() { return this.heading; }
      getTilt() { return 0; }
      getZoom() { return this.zoom; }
      panTo(center: FakeLatLng | { lat: number; lng: number }) { this.center = center instanceof FakeLatLng ? center : new FakeLatLng(center.lat, center.lng); }
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
        ControlPosition: { TOP_LEFT: 1, TOP_CENTER: 2, TOP_RIGHT: 3, LEFT_TOP: 4, RIGHT_TOP: 5, LEFT_CENTER: 6, RIGHT_CENTER: 7, LEFT_BOTTOM: 8, RIGHT_BOTTOM: 9, BOTTOM_LEFT: 10, BOTTOM_CENTER: 11, BOTTOM_RIGHT: 12 },
        event: { addListener: () => ({ remove: noop }), addListenerOnce: () => ({ remove: noop }), clearInstanceListeners: noop, removeListener: noop, trigger: noop },
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
  }, enableDrawing);
}

async function openCalpinage(page: Page) {
  await page.goto(`/studies/${STUDY_ID}/versions/${STUDY_VERSION_ID}/calpinage`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 45_000 });
  await page.waitForSelector("#calpinage-canvas-el", { state: "visible", timeout: 45_000 });
  await page.waitForFunction(() => {
    const state = (window as unknown as { CALPINAGE_STATE?: { roof?: { image?: unknown } } }).CALPINAGE_STATE;
    const scale = (window as unknown as { CALPINAGE_VIEWPORT_SCALE?: number }).CALPINAGE_VIEWPORT_SCALE;
    return !!state?.roof?.image && Number.isFinite(scale) && scale! > 0;
  }, { timeout: 45_000 });
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
    return { x: rect.left + pt.x * scale + (offset.x ?? 0), y: rect.top - (imgH - pt.y) * scale + (offset.y ?? 0) };
  }, point);
}

async function clickImage(page: Page, point: { x: number; y: number }, modifiers: ("Control" | "Shift")[] = []) {
  const client = await imageToClient(page, point);
  await page.mouse.move(client.x, client.y);
  await page.waitForTimeout(40);
  for (const modifier of modifiers) await page.keyboard.down(modifier);
  await page.mouse.click(client.x, client.y);
  for (const modifier of modifiers.slice().reverse()) await page.keyboard.up(modifier);
  await page.waitForTimeout(100);
}

async function dragImage(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const a = await imageToClient(page, from);
  const b = await imageToClient(page, to);
  await page.mouse.move(a.x, a.y);
  await page.waitForTimeout(30);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function drawPolyline(page: Page, points: readonly { x: number; y: number }[], close = false) {
  for (const point of points) await clickImage(page, point);
  if (close && points.length > 0) await clickImage(page, points[0]!);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
}

async function expectToolbarControlsInsideViewport(page: Page) {
  const selectors = [
    "#calpinage-tool-select",
    "#calpinage-tool-dessin-toiture",
    "#calpinage-btn-height-edit",
    "#calpinage-tool-obstacle",
    "#calpinage-tool-shadow-volume",
    "#calpinage-tool-roof-extension",
    "#calpinage-tool-undo",
    "#calpinage-tool-redo",
    ".calpinage-btn-delete",
  ];
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    await expect(locator, selector).toBeVisible();
    const box = await locator.boundingBox();
    expect(box, `${selector} bounding box`).not.toBeNull();
    expect(box!.x + box!.width, `${selector} right`).toBeLessThanOrEqual(viewport.width + 1);
    expect(box!.y + box!.height, `${selector} bottom`).toBeLessThanOrEqual(viewport.height + 1);
    const isDisabled = await locator.evaluate((el) => (el as HTMLButtonElement).disabled === true);
    if (!isDisabled) await locator.click({ trial: true });
  }
  const visibleValidate = page.getByRole("button", { name: "Valider le relevé toiture" });
  await expect(visibleValidate).toBeVisible();
  const validateBox = await visibleValidate.boundingBox();
  expect(validateBox, "visible roof validation bounding box").not.toBeNull();
  expect(validateBox!.x + validateBox!.width, "visible roof validation right").toBeLessThanOrEqual(viewport.width + 1);
  expect(validateBox!.y + validateBox!.height, "visible roof validation bottom").toBeLessThanOrEqual(viewport.height + 1);
}

async function expectNormalOptionMenusPreserved(page: Page) {
  await page.locator("#calpinage-tool-obstacle").click();
  await expect(page.locator("#calpinage-obstacle-dropdown")).toBeVisible();
  await expect(page.locator("#calpinage-obstacle-dropdown [data-obstacle-business-id]")).toHaveCount(4);
  await expect.poll(async () =>
    page.locator("#calpinage-obstacle-dropdown [data-obstacle-business-id]").evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-obstacle-business-id")),
    ),
  ).toEqual(["roof_window", "dormer_keepout", "keepout_zone", "generic_polygon_keepout"]);

  await page.locator("#calpinage-tool-shadow-volume").click();
  await expect(page.locator("#calpinage-shadow-volume-dropdown")).toBeVisible();
  await expect(page.locator("#calpinage-shadow-volume-dropdown [data-shadow-business-id]")).toHaveCount(4);
  await expect.poll(async () =>
    page.locator("#calpinage-shadow-volume-dropdown [data-shadow-business-id]").evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-shadow-business-id")),
    ),
  ).toEqual(["chimney_square", "chimney_round", "vmc_round", "antenna"]);

  await page.locator("#calpinage-tool-roof-extension").click();
  await expect(page.locator("#calpinage-roof-extension-dropdown")).toBeVisible();
  await expect(page.locator("#calpinage-roof-extension-dropdown [data-dormer-tool]")).toHaveCount(3);
  await expect.poll(async () =>
    page.locator("#calpinage-roof-extension-dropdown [data-dormer-tool]").evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-dormer-tool")),
    ),
  ).toEqual(["contour", "hips", "ridge"]);
}

async function chooseRoofObstacle(page: Page) {
  await page.locator("#calpinage-tool-obstacle").click();
  await expect(page.locator("#calpinage-obstacle-dropdown")).toBeVisible();
  await page.locator('[data-obstacle-business-id="roof_window"]').click();
}

async function chooseShadowObstacle(page: Page) {
  await page.locator("#calpinage-tool-shadow-volume").click();
  await expect(page.locator("#calpinage-shadow-volume-dropdown")).toBeVisible();
  await page.locator('[data-shadow-business-id="chimney_square"]').click();
}

async function saveScreenshot(page: Page, name: string) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACT_DIR, name), fullPage: true });
}

async function validateRoofAndEnterPhase3(page: Page) {
  const validateButton = page.getByRole("button", { name: "Valider le relevé toiture" });
  await expect(validateButton).toBeEnabled({ timeout: 10_000 });
  await validateButton.click();
  await expect.poll(async () => page.evaluate(() => {
    const state = (window as unknown as { CALPINAGE_STATE?: { currentPhase?: string; roofSurveyLocked?: boolean } }).CALPINAGE_STATE;
    return { currentPhase: state?.currentPhase ?? null, roofSurveyLocked: state?.roofSurveyLocked ?? null };
  }), { timeout: 15_000 }).toEqual({ currentPhase: "PV_LAYOUT", roofSurveyLocked: true });
  await expect(page.locator("#p3-topbar")).toBeVisible({ timeout: 10_000 });
}

async function chooseRecipePanel(page: Page) {
  await expect.poll(async () => page.evaluate(() =>
    (window as unknown as { SOLARNEXT_PANELS?: unknown[] }).SOLARNEXT_PANELS?.length ?? 0,
  ), { timeout: 15_000 }).toBeGreaterThan(0);
  await page.evaluate(() => {
    const w = window as unknown as {
      SOLARNEXT_PANELS?: Array<Record<string, unknown>>;
      PV_SELECTED_PANEL?: unknown;
      CALPINAGE_SELECTED_PANEL_ID?: string;
    };
    const panel = w.SOLARNEXT_PANELS?.find((item) => item.id === "smart-roof-test-panel") ?? w.SOLARNEXT_PANELS?.[0];
    if (!panel) throw new Error("Recipe PV panel missing");
    const widthMm = Number(panel.width_mm ?? panel.widthMm);
    const heightMm = Number(panel.height_mm ?? panel.heightMm);
    w.CALPINAGE_SELECTED_PANEL_ID = String(panel.id);
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

async function placePanelWithProductTool(page: Page, point: { x: number; y: number }) {
  await chooseRecipePanel(page);
  const poseButton = page.getByRole("button", { name: "Poser" });
  await expect(poseButton).toBeVisible({ timeout: 10_000 });
  await poseButton.click();
  await expect.poll(async () =>
    page.evaluate(() => (window as unknown as { getPhase3ActiveTool?: () => string }).getPhase3ActiveTool?.() ?? null),
  ).toBe("panels");
  await clickImage(page, point);
  await expect.poll(async () => {
    const summary = await phase3PlacementSummary(page);
    return { enginePanels: summary.enginePanels, hasFocusBlock: !!summary.focusBlock };
  }, { timeout: 15_000 }).toMatchObject({ hasFocusBlock: true });
}

async function activeRoofSummary(page: Page) {
  return page.evaluate(() => {
    const state = (window as unknown as { CALPINAGE_STATE?: Record<string, unknown> }).CALPINAGE_STATE ?? {};
    const pans = Array.isArray(state.pans) ? state.pans as Array<Record<string, unknown>> : [];
    const smart = state.smartRoofDrawing as { graph?: { groups?: unknown[]; nodes?: unknown[]; segments?: unknown[] } } | undefined;
    const heightPairs = pans.map((pan) => {
      const points = (pan.points ?? pan.polygon ?? pan.polygonPx ?? []) as Array<{ h?: unknown }>;
      const values = points.map((point) => Number(point.h)).filter(Number.isFinite).sort((a, b) => a - b);
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
      obstacles: Array.isArray(state.obstacles) ? state.obstacles.length : 0,
      shadowVolumes: Array.isArray(state.shadowVolumes) ? state.shadowVolumes.length : 0,
      roofExtensions: Array.isArray(state.roofExtensions) ? state.roofExtensions.length : 0,
      placedPanels: Array.isArray(state.placedPanels) ? state.placedPanels.length : 0,
      frozenBlocks: Array.isArray(state.frozenBlocks) ? state.frozenBlocks.length : 0,
      smartPersisted: !!state.smartRoofDrawing,
    };
  });
}

async function expectSmartPansInSidebar(page: Page, count: number) {
  for (let i = 1; i <= count; i += 1) {
    await expect(page.locator("#zone-a-phase2").getByText(`Pan ${i}`, { exact: true })).toBeVisible({ timeout: 10_000 });
  }
}

async function expectPhase3ReadyForPanels(page: Page, expectedPanCount: number) {
  await page.evaluate(() => {
    const w = window as unknown as { CALPINAGE_RENDER?: () => void };
    if (typeof w.CALPINAGE_RENDER === "function") w.CALPINAGE_RENDER();
  });
  await expect.poll(async () => {
    const summary = await phase3PlacementSummary(page);
    return { phase: summary.currentPhase, safeZones: summary.safeZonePanIds.length };
  }, { timeout: 15_000 }).toEqual({ phase: "PV_LAYOUT", safeZones: expectedPanCount });
}

test.describe("Smart roof drawing uses the normal Phase 2 interface", () => {
  test("keeps the legacy toolbar untouched when the flag is off", async ({ page, context }) => {
    await installBrowserRuntime(context, false);
    await installRecipeMocks(context, { geometry: emptyGeometryFixture(), saves: [] });
    await openCalpinage(page);

    const drawingButton = page.locator("#calpinage-tool-dessin-toiture");
    await expect(drawingButton).toContainText("Dessin toiture");
    await drawingButton.click();
    await expect(page.locator("#calpinage-dessin-toiture-dropdown")).toBeVisible();
    await expect(page.locator('[data-tool="contour"]')).toBeVisible();
    await expect(page.locator('[data-tool="trait"]')).toBeVisible();
    await expect(page.locator('[data-tool="ridge"]')).toBeVisible();
    await expect(page.locator("#calpinage-smart-roof-open")).toHaveCount(0);
    await expect(page.locator("#calpinage-smart-roof-session-bar")).toHaveCount(0);
    await saveScreenshot(page, "toolbar-flag-off.png");
  });

  test("draws, edits heights, keeps obstacle menus, validates normally and reaches Phase 3", async ({ page, context }) => {
    const server = { geometry: emptyGeometryFixture(), saves: [] };
    await installBrowserRuntime(context, true);
    await installRecipeMocks(context, server);
    await openCalpinage(page);

    for (const viewport of [{ width: 1366, height: 768 }, { width: 1536, height: 864 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(viewport);
      await expectToolbarControlsInsideViewport(page);
      await saveScreenshot(page, `toolbar-flag-on-${viewport.width}x${viewport.height}.png`);
    }

    const drawingButton = page.locator("#calpinage-tool-dessin-toiture");
    await expect(drawingButton).toContainText("Dessiner");
    await expect(page.locator("#calpinage-smart-roof-open")).toHaveCount(0);
    await expect(page.locator("#calpinage-smart-roof-session-bar")).toHaveCount(0);
    await expect(page.locator("#calpinage-smart-roof-apply")).toHaveCount(0);
    await expect(page.locator("#calpinage-smart-roof-new-volume")).toHaveCount(0);
    await expectNormalOptionMenusPreserved(page);

    await drawingButton.click();
    await drawPolyline(page, [
      { x: 180, y: 150 },
      { x: 620, y: 150 },
      { x: 620, y: 330 },
      { x: 620, y: 500 },
      { x: 180, y: 500 },
      { x: 180, y: 330 },
    ], true);
    await drawPolyline(page, [{ x: 180, y: 330 }, { x: 620, y: 330 }]);
    await drawPolyline(page, [
      { x: 365, y: 385 },
      { x: 435, y: 385 },
      { x: 435, y: 455 },
      { x: 365, y: 455 },
    ], true);
    await drawPolyline(page, [{ x: 400, y: 385 }, { x: 400, y: 455 }]);
    await clickImage(page, { x: 120, y: 260 });
    await page.keyboard.press("Enter");

    await expect.poll(async () => page.evaluate(() => {
      const w = window as unknown as {
        __calpinageSmartRoofDrawing?: { getState: () => { compile?: { result?: { legacyState?: { pans?: unknown[]; roofExtensions?: unknown[] } } } } };
        getPhase2Data?: () => { canValidate?: boolean };
        CALPINAGE_STATE?: { pans?: unknown[]; roofExtensions?: unknown[] };
      };
      const smart = w.__calpinageSmartRoofDrawing?.getState();
      return {
        smartPans: smart?.compile?.result?.legacyState?.pans?.length ?? 0,
        smartExtensions: smart?.compile?.result?.legacyState?.roofExtensions?.length ?? 0,
        activePans: w.CALPINAGE_STATE?.pans?.length ?? 0,
        activeExtensions: w.CALPINAGE_STATE?.roofExtensions?.length ?? 0,
        canValidate: w.getPhase2Data?.().canValidate ?? false,
      };
    }), { timeout: 15_000 }).toEqual({ smartPans: 2, smartExtensions: 1, activePans: 2, activeExtensions: 1, canValidate: true });
    await saveScreenshot(page, "smart-roof-drawn-with-dormer.png");

    await page.locator("#calpinage-btn-height-edit").click();
    await clickImage(page, { x: 180, y: 150 });
    await clickImage(page, { x: 620, y: 150 }, ["Control"]);
    await expect.poll(async () => page.evaluate(() => {
      const state = (window as unknown as { CALPINAGE_STATE?: { selectedHeightPoints?: unknown[] } }).CALPINAGE_STATE;
      return state?.selectedHeightPoints?.length ?? 0;
    }), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    await saveScreenshot(page, "height-multipoint-selection.png");
    const heightInput = page.locator("#height-edit-inplace-container input").first();
    await expect(heightInput).toBeVisible();
    await heightInput.fill("3.8");
    await page.keyboard.press("Enter");
    await expect.poll(async () => page.evaluate(() => {
      const smart = (window as unknown as { __calpinageSmartRoofDrawing?: { getState: () => { graph: { nodes: Array<{ height?: { valueM?: number } }> } } } }).__calpinageSmartRoofDrawing?.getState();
      return smart?.graph.nodes.filter((node) => node.height?.valueM === 3.8).length ?? 0;
    }), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);

    await chooseRoofObstacle(page);
    await dragImage(page, { x: 250, y: 240 }, { x: 310, y: 290 });
    await expect.poll(async () => page.evaluate(() => {
      const state = (window as unknown as { CALPINAGE_STATE?: { obstacles?: unknown[] } }).CALPINAGE_STATE;
      return state?.obstacles?.length ?? 0;
    }), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);

    await chooseShadowObstacle(page);
    await dragImage(page, { x: 535, y: 240 }, { x: 585, y: 290 });
    await expect.poll(async () => page.evaluate(() => {
      const state = (window as unknown as { CALPINAGE_STATE?: { shadowVolumes?: unknown[] } }).CALPINAGE_STATE;
      return state?.shadowVolumes?.length ?? 0;
    }), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
    await saveScreenshot(page, "roof-and-shadow-obstacles-added.png");

    await drawingButton.click();
    await expect.poll(async () => page.evaluate(() => {
      const state = (window as unknown as { CALPINAGE_STATE?: { obstacles?: unknown[]; shadowVolumes?: unknown[] } }).CALPINAGE_STATE;
      return { obstacles: state?.obstacles?.length ?? 0, shadowVolumes: state?.shadowVolumes?.length ?? 0 };
    }), { timeout: 10_000 }).toEqual({ obstacles: 1, shadowVolumes: 1 });

    await page.locator("#calpinage-tool-undo").click();
    await page.locator("#calpinage-tool-redo").click();

    const validateButton = page.getByRole("button", { name: "Valider le relevé toiture" });
    await expect(validateButton).toBeEnabled({ timeout: 10_000 });
    await validateButton.click();
    await expect.poll(async () => page.evaluate(() => {
      const state = (window as unknown as { CALPINAGE_STATE?: { currentPhase?: string; roofSurveyLocked?: boolean } }).CALPINAGE_STATE;
      return { currentPhase: state?.currentPhase ?? null, roofSurveyLocked: state?.roofSurveyLocked ?? null };
    }), { timeout: 15_000 }).toEqual({ currentPhase: "PV_LAYOUT", roofSurveyLocked: true });
    await expect(page.locator("#p3-topbar")).toBeVisible();
    await saveScreenshot(page, "phase3-after-normal-validation.png");

    const exported = await page.evaluate(() => {
      const win = window as unknown as {
        getCalpinageGeometryForPersist?: () => { geometry_json?: unknown } | null;
      };
      return win.getCalpinageGeometryForPersist?.()?.geometry_json ?? null;
    });
    const g = exported as {
      smartRoofDrawing?: unknown;
      roofState?: { obstacles?: unknown[] };
      shadowVolumes?: unknown[];
      roofExtensions?: unknown[];
      pans?: unknown[];
    };
    expect(g.smartRoofDrawing).toBeTruthy();
    expect(g.roofState?.obstacles?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(g.shadowVolumes?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(g.roofExtensions?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(g.pans?.length ?? 0).toBeGreaterThanOrEqual(2);

    await expect.poll(() => server.saves.length, { timeout: 12_000 }).toBeGreaterThan(0);
    await page.reload({ waitUntil: "domcontentloaded" });
    await openCalpinage(page);
    await expect.poll(async () => activeRoofSummary(page), { timeout: 15_000 }).toMatchObject({
      currentPhase: "PV_LAYOUT",
      panCount: 2,
      obstacles: 1,
      shadowVolumes: 1,
      roofExtensions: 1,
      smartPersisted: true,
    });

    await page.evaluate(() => localStorage.removeItem("calpinage_smart_roof_drawing"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await openCalpinage(page);
    await expect.poll(async () => activeRoofSummary(page), { timeout: 15_000 }).toMatchObject({
      currentPhase: "PV_LAYOUT",
      panCount: 2,
      smartPersisted: true,
    });
    const flagOffExport = await page.evaluate(() =>
      (window as unknown as { getCalpinageGeometryForPersist?: () => { geometry_json?: Record<string, unknown> } | null })
        .getCalpinageGeometryForPersist?.()?.geometry_json ?? null,
    );
    expect(flagOffExport?.smartRoofDrawing).toBeTruthy();
  });

  test("draws a four-pan roof with the single button and reaches Phase 3 with panel safe zones", async ({ page, context }) => {
    const server = { geometry: emptyGeometryFixture(), saves: [] };
    await installBrowserRuntime(context, true);
    await installRecipeMocks(context, server);
    await page.setViewportSize({ width: 1536, height: 864 });
    await openCalpinage(page);

    const drawingButton = page.locator("#calpinage-tool-dessin-toiture");
    await drawingButton.click();
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

    await expect.poll(async () => page.evaluate(() => {
      const state = (window as unknown as {
        __calpinageSmartRoofDrawing?: { getState: () => { compile?: { message?: string; result?: { legacyState?: { pans?: unknown[]; ridges?: unknown[]; traits?: unknown[] } } } } };
      }).__calpinageSmartRoofDrawing?.getState();
      return {
        panCount: state?.compile?.result?.legacyState?.pans?.length ?? 0,
        ridgeCount: state?.compile?.result?.legacyState?.ridges?.length ?? 0,
        traitCount: state?.compile?.result?.legacyState?.traits?.length ?? 0,
        estimated: /relief estime/i.test(state?.compile?.message ?? ""),
      };
    }), { timeout: 10_000 }).toEqual({ panCount: 4, ridgeCount: 1, traitCount: 4, estimated: true });
    await expectSmartPansInSidebar(page, 4);
    await saveScreenshot(page, "four-pan-single-button-ready.png");

    await validateRoofAndEnterPhase3(page);
    await expectPhase3ReadyForPanels(page, 4);
    await placePanelWithProductTool(page, { x: 250, y: 218 });
    const placement = await phase3PlacementSummary(page);
    const roof = await activeRoofSummary(page);
    expect(placement.safeZonePanIds).toEqual(expect.arrayContaining(roof.panIds));
    expect(placement.panelRefs.some((panel) => roof.panIds.includes(String(panel.panId)))).toBe(true);
    await saveScreenshot(page, "four-pan-phase3-panel.png");
  });

  test("draws a multipan L without filling the empty corner and keeps Phase 3 limits", async ({ page, context }) => {
    const server = { geometry: emptyGeometryFixture(), saves: [] };
    await installBrowserRuntime(context, true);
    await installRecipeMocks(context, server);
    await page.setViewportSize({ width: 1536, height: 864 });
    await openCalpinage(page);

    const drawingButton = page.locator("#calpinage-tool-dessin-toiture");
    await drawingButton.click();
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

    await expect.poll(async () => page.evaluate(() => {
      const api = (window as any).__calpinageSmartRoofDrawing;
      const state = api?.getState();
      const candidate = api?.prepareApplication();
      const panArea = (candidate?.legacyState?.pans ?? []).reduce((sum, pan) => sum + Number(pan.projectedSurfaceM2 ?? pan.surfaceM2 ?? 0), 0);
      const valleyCount = (state?.compile?.result?.legacyState?.traits ?? []).filter((trait) => trait.smartRoofRole === "valley").length;
      return {
        panCount: state?.compile?.result?.legacyState?.pans?.length ?? 0,
        ridgeCount: state?.compile?.result?.legacyState?.ridges?.length ?? 0,
        valleyCount,
        area: Math.round(panArea),
        estimated: /relief estime/i.test(state?.compile?.message ?? ""),
      };
    }), { timeout: 10_000 }).toEqual({ panCount: 5, ridgeCount: 3, valleyCount: 2, area: 108, estimated: true });
    await expectSmartPansInSidebar(page, 5);
    await saveScreenshot(page, "l-multipan-single-button-ready.png");

    await validateRoofAndEnterPhase3(page);
    await expectPhase3ReadyForPanels(page, 5);
    await placePanelWithProductTool(page, { x: 285, y: 215 });
    const beforeForbidden = (await phase3PlacementSummary(page)).enginePanels;
    await clickImage(page, { x: 295, y: 295 });
    await page.waitForTimeout(300);
    expect((await phase3PlacementSummary(page)).enginePanels).toBe(beforeForbidden);
    await saveScreenshot(page, "l-multipan-phase3-panel.png");
  });

  test("keeps existing roof obstacles and manual extensions when smart drawing publishes the roof", async ({ page, context }) => {
    const server = { geometry: geometryWithExistingObstacleAndExtension(), saves: [] };
    await installBrowserRuntime(context, true);
    await installRecipeMocks(context, server);
    await page.setViewportSize({ width: 1536, height: 864 });
    await openCalpinage(page);

    await expect.poll(async () => activeRoofSummary(page), { timeout: 10_000 }).toMatchObject({
      obstacles: 1,
      roofExtensions: 1,
    });

    const drawingButton = page.locator("#calpinage-tool-dessin-toiture");
    await drawingButton.click();
    await drawPolyline(page, [
      { x: 200, y: 200 },
      { x: 320, y: 200 },
      { x: 320, y: 300 },
      { x: 200, y: 300 },
    ], true);
    await drawPolyline(page, [{ x: 200, y: 250 }, { x: 320, y: 250 }]);

    await expect.poll(async () => activeRoofSummary(page), { timeout: 10_000 }).toMatchObject({
      panCount: 2,
      obstacles: 1,
      roofExtensions: 1,
    });
    await validateRoofAndEnterPhase3(page);
    const exported = await page.evaluate(() =>
      (window as unknown as { getCalpinageGeometryForPersist?: () => { geometry_json?: Record<string, unknown> } | null })
        .getCalpinageGeometryForPersist?.()?.geometry_json ?? null,
    );
    expect(exported?.smartRoofDrawing).toBeTruthy();
    expect(((exported?.roofState as { obstacles?: unknown[] } | undefined)?.obstacles ?? []).length).toBe(1);
    expect((exported?.roofExtensions as unknown[] | undefined)?.length).toBe(1);
    await saveScreenshot(page, "existing-obstacle-extension-preserved.png");
  });
});
