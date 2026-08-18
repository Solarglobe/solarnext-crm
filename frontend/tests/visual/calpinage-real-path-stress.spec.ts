import { inflateSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";

const STUDY_ID = "p2b-study-real-path";
const STUDY_VERSION_ID = "p2b-version-uuid";
const VERSION_NUMBER = 1;

type RuntimeIssue = {
  readonly type: "error" | "warning" | "pageerror";
  readonly text: string;
};

type CanvasStats = {
  readonly width: number;
  readonly height: number;
  readonly blueRatio: number;
  readonly coloredRatio: number;
  readonly channelSpread: number;
};

const CRITICAL_WARNING_PATTERNS = [
  /Multiple instances of Three\.js/i,
  /invalid hook call/i,
  /React has detected a change in the order of Hooks/i,
  /webglcontextlost/i,
  /THREE\.WebGLRenderer/i,
  /R3F/i,
  /stats-?gl/i,
];

function fakeJwt() {
  const enc = (o: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "none", typ: "JWT" })}.${enc({
    exp: Math.floor(Date.now() / 1000) + 3600 * 24 * 365,
    id: "p2b-user",
    email: "p2b@test.local",
    organizationId: "p2b-org",
    role: "user",
    onboardingCompleted: true,
  })}.e2e`;
}

function stableGeometryFixture() {
  const generatedAt = new Date("2026-08-18T08:00:00.000Z").toISOString();
  const roofState = {
    gps: { lat: 48.8566, lon: 2.3522 },
    map: {
      provider: "google",
      centerLatLng: { lat: 48.8566, lng: 2.3522 },
      zoom: 19,
      bearing: 0,
    },
    scale: { metersPerPixel: 0.05, source: "p2b-fixture" },
    canonical3DWorldContract: {
      schemaVersion: 1,
      metersPerPixel: 0.05,
      northAngleDeg: 0,
      referenceFrame: "LOCAL_IMAGE_ENU",
    },
    image: {
      dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      width: 900,
      height: 620,
      cssWidth: 900,
      cssHeight: 620,
    },
    roof: { north: { angleDeg: 0 } },
    contoursBati: [
      {
        id: "contour-main",
        closed: true,
        roofRole: "contour",
        points: [
          { x: 80, y: 80, h: 4 },
          { x: 360, y: 80, h: 4 },
          { x: 360, y: 240, h: 6 },
          { x: 80, y: 240, h: 6 },
        ],
      },
    ],
    ridges: [
      {
        id: "ridge-main",
        roofRole: "main",
        a: { x: 80, y: 160, h: 7 },
        b: { x: 360, y: 160, h: 7 },
      },
    ],
    traits: [],
    obstacles: [
      {
        id: "chimney-p2b",
        type: "polygon",
        kind: "chimney",
        heightM: 1.2,
        points: [
          { x: 255, y: 125 },
          { x: 278, y: 125 },
          { x: 278, y: 148 },
          { x: 255, y: 148 },
        ],
      },
    ],
  };
  const pans = [
    {
      id: "pan-a",
      polygonPx: [
        { x: 100, y: 100, h: 4.2 },
        { x: 220, y: 100, h: 4.2 },
        { x: 220, y: 220, h: 6.4 },
        { x: 100, y: 220, h: 6.4 },
      ],
      points: [
        { x: 100, y: 100, h: 4.2 },
        { x: 220, y: 100, h: 4.2 },
        { x: 220, y: 220, h: 6.4 },
        { x: 100, y: 220, h: 6.4 },
      ],
      polygon: [
        { x: 100, y: 100 },
        { x: 220, y: 100 },
        { x: 220, y: 220 },
        { x: 100, y: 220 },
      ],
      physical: {
        slope: { mode: "auto", computedDeg: 20, valueDeg: null },
        orientation: { azimuthDeg: 180, label: "Sud" },
      },
    },
    {
      id: "pan-b",
      polygonPx: [
        { x: 220, y: 100, h: 4.2 },
        { x: 340, y: 100, h: 4.2 },
        { x: 340, y: 220, h: 6.4 },
        { x: 220, y: 220, h: 6.4 },
      ],
      points: [
        { x: 220, y: 100, h: 4.2 },
        { x: 340, y: 100, h: 4.2 },
        { x: 340, y: 220, h: 6.4 },
        { x: 220, y: 220, h: 6.4 },
      ],
      polygon: [
        { x: 220, y: 100 },
        { x: 340, y: 100 },
        { x: 340, y: 220 },
        { x: 220, y: 220 },
      ],
      physical: {
        slope: { mode: "auto", computedDeg: 20, valueDeg: null },
        orientation: { azimuthDeg: 180, label: "Sud" },
      },
    },
  ];
  return {
    meta: { generatedAt },
    calpinageCheckpoint: { savedAt: generatedAt },
    calpinage_meta: {
      version: "CALPINAGE_V1",
      savedAt: generatedAt,
      geometryHash: "p2b-geometry",
      panelsHash: "p2b-panels",
      shadingHash: "p2b-shading",
      shadingComputedAt: generatedAt,
      shadingSource: "persisted",
      shadingValid: true,
    },
    phase: 3,
    currentPhase: "PV_LAYOUT",
    roofSurveyLocked: true,
    roofState,
    roof: {
      scale: roofState.scale,
      roof: roofState.roof,
      canonical3DWorldContract: roofState.canonical3DWorldContract,
      roofPans: pans,
    },
    contours: roofState.contoursBati,
    ridges: roofState.ridges,
    traits: [],
    obstacles: roofState.obstacles,
    pans,
    validatedRoofData: {
      roofState,
      scale: roofState.scale,
      north: { north: { angleDeg: 0 } },
      gps: roofState.gps,
      pans: pans.map((pan) => ({
        id: pan.id,
        polygon: pan.polygon,
        points: pan.points,
        orientationDeg: 180,
        tiltDeg: 20,
        surfaceM2: 36,
        roofType: "PITCHED",
      })),
    },
    pvParams: {
      distanceLimitesCm: 20,
      espacementHorizontalCm: 2,
      espacementVerticalCm: 4.5,
      orientationPanneaux: "portrait",
      margesCm: { faitageCm: 20, aretierCm: 20, egoutCm: 20, riveCm: 20, obstacleCm: 20 },
    },
    panel: { id: "panel-p2b" },
    inverter: { id: "micro-p2b" },
    frozenBlocks: [
      {
        id: "block-p2b-a",
        panId: "pan-a",
        orientation: "portrait",
        rotation: 0,
        useScreenAxes: true,
        panels: [
          { id: "block-p2b-a_0", center: { x: 145, y: 145 }, widthPx: 22, heightPx: 36, rotation: 0 },
          { id: "block-p2b-a_1", center: { x: 172, y: 145 }, widthPx: 22, heightPx: 36, rotation: 0 },
        ],
      },
    ],
    placedPanels: [
      { panId: "pan-a", x: 145, y: 145, widthPx: 22, heightPx: 36 },
      { panId: "pan-a", x: 172, y: 145, widthPx: 22, heightPx: 36 },
    ],
    shading: {
      computedAt: generatedAt,
      totalLossPct: 4.8,
      combined: { totalLossPct: 4.8 },
      near: { totalLossPct: 1.2 },
      far: { totalLossPct: 3.6, source: "horizon_mask" },
      panelCount: 2,
      perPanel: [
        { panelId: "block-p2b-a_0", lossPct: 4.1 },
        { panelId: "block-p2b-a_1", lossPct: 5.4 },
      ],
    },
    shadowVolumes: [],
    roofExtensions: [],
    featureFlags: {
      canonical3D: true,
      canonical3DNearShading: true,
    },
  };
}

async function installMocks(context: BrowserContext) {
  let calpinageLoadCount = 0;
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
        id: "p2b-user",
        email: "p2b@test.local",
        organizationId: "p2b-org",
        role: "user",
        onboardingCompleted: true,
        internalHomeOrganization: true,
      }),
    });
  });
  await context.route("**/auth/permissions", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ permissions: [], superAdmin: false }),
    });
  });
  await context.route("**/auth/refresh", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: fakeJwt() }) });
  });
  await context.route("**/api/organizations**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: "p2b-org", name: "P2B" }]) });
  });
  await context.route("**/api/leads**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });
  await context.route("**/api/public/pv/panels", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "panel-p2b",
          brand: "SolarNext",
          name: "P2B 425",
          model_ref: "SN-P2B-425",
          power_wc: 425,
          width_mm: 1134,
          height_mm: 1722,
          efficiency_pct: 21.2,
          technology: "mono",
        },
      ]),
    });
  });
  await context.route("**/api/public/pv/inverters", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: "micro-p2b", brand: "SolarNext", name: "Micro P2B", type: "micro", power_w: 400 }]),
    });
  });
  await context.route("**/api/studies/*/has-active-study", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ hasActiveStudy: false }) });
  });
  await context.route("**/api/studies/*/versions/*/calpinage", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return;
    }
    calpinageLoadCount += 1;
    const delayMs = calpinageLoadCount % 4 === 0 ? 350 : calpinageLoadCount % 5 === 0 ? 900 : 0;
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        calpinageData: {
          geometry_json: stableGeometryFixture(),
          annual_production_kwh: 8120,
        },
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
        study: { id: STUDY_ID, lead_id: "lead-p2b" },
        versions: [{ id: STUDY_VERSION_ID, version_number: VERSION_NUMBER }],
      }),
    });
  });
}

function installConsoleCollection(page: Page): RuntimeIssue[] {
  const issues: RuntimeIssue[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error" && message.type() !== "warning") return;
    const text = message.text();
    if (message.type() === "error" || CRITICAL_WARNING_PATTERNS.some((p) => p.test(text))) {
      issues.push({ type: message.type() as "error" | "warning", text });
    }
  });
  page.on("pageerror", (error) => {
    issues.push({ type: "pageerror", text: error.message });
  });
  return issues;
}

function readUint32(buffer: Buffer, offset: number) {
  return buffer.readUInt32BE(offset);
}

function paeth(a: number, b: number, c: number) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function imageStats(buffer: Buffer): CanvasStats {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const chunks: Buffer[] = [];
  while (offset < buffer.length) {
    const length = readUint32(buffer, offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = readUint32(data, 0);
      height = readUint32(data, 4);
      colorType = data[9]!;
    } else if (type === "IDAT") {
      chunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!width || !height || !channels) throw new Error(`PNG non supporte colorType=${colorType}`);
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  let src = 0;
  let dst = 0;
  const previous = new Uint8Array(stride);
  const current = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[src++]!;
    for (let x = 0; x < stride; x++) {
      const value = raw[src++]!;
      const left = x >= channels ? current[x - channels]! : 0;
      const up = previous[x]!;
      const upperLeft = x >= channels ? previous[x - channels]! : 0;
      current[x] =
        filter === 0 ? value :
        filter === 1 ? (value + left) & 255 :
        filter === 2 ? (value + up) & 255 :
        filter === 3 ? (value + Math.floor((left + up) / 2)) & 255 :
        filter === 4 ? (value + paeth(left, up, upperLeft)) & 255 :
        value;
    }
    for (let x = 0; x < width; x++) {
      out[dst++] = current[x * channels]!;
      out[dst++] = current[x * channels + 1]!;
      out[dst++] = current[x * channels + 2]!;
      out[dst++] = channels === 4 ? current[x * channels + 3]! : 255;
    }
    previous.set(current);
  }
  let blueLike = 0;
  let colored = 0;
  let samples = 0;
  let minR = 255;
  let maxR = 0;
  let minG = 255;
  let maxG = 0;
  let minB = 255;
  let maxB = 0;
  for (let y = 0; y < height; y += 3) {
    for (let x = 0; x < width; x += 3) {
      const i = (y * width + x) * 4;
      const r = out[i]!;
      const g = out[i + 1]!;
      const b = out[i + 2]!;
      samples += 1;
      minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      minG = Math.min(minG, g); maxG = Math.max(maxG, g);
      minB = Math.min(minB, b); maxB = Math.max(maxB, b);
      if (b > 70 && b > r * 1.35 && b > g * 1.08) blueLike += 1;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 18) colored += 1;
    }
  }
  return {
    width,
    height,
    blueRatio: blueLike / samples,
    coloredRatio: colored / samples,
    channelSpread: maxR - minR + maxG - minG + maxB - minB,
  };
}

async function openRealCalpinage(page: Page, cycle: number) {
  await page.goto(`/studies/${STUDY_ID}/versions/${STUDY_VERSION_ID}/calpinage?p2bCycle=${cycle}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 45000 });
  await page.waitForFunction(() => {
    const w = window as unknown as { CALPINAGE_STATE?: { pans?: unknown[]; roofSurveyLocked?: boolean } };
    return Array.isArray(w.CALPINAGE_STATE?.pans) && w.CALPINAGE_STATE.pans.length >= 2 && w.CALPINAGE_STATE.roofSurveyLocked === true;
  }, { timeout: 45000 });
  await expect(page.locator("#btn-toggle-view-3d")).toBeVisible({ timeout: 30000 });
}

async function assert3DVisible(page: Page) {
  const root = page.getByTestId("solar-scene-3d-viewer-root");
  try {
    await expect(root).toBeVisible({ timeout: 45000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => {
      const zone = document.querySelector("#zone-c-3d");
      const mount = (window as unknown as Record<string, unknown>)["__CALPINAGE_3D_BRIDGE_MOUNT__"];
      const lifecycle = (window as unknown as Record<string, unknown>)["__CALPINAGE_3D_VIEWER_LIFECYCLE__"];
      const bridge = (window as unknown as Record<string, unknown>)["__LAST_3D_BRIDGE__"];
      const renderError = (window as unknown as Record<string, unknown>)["__CALPINAGE_3D_RENDER_ERROR__"];
      const state = (window as unknown as { CALPINAGE_STATE?: { pans?: unknown[]; roofSurveyLocked?: boolean; currentPhase?: string } }).CALPINAGE_STATE;
      return {
        viewMode: (window as unknown as { __CALPINAGE_VIEW_MODE__?: string }).__CALPINAGE_VIEW_MODE__,
        hasSwitchFn: typeof (window as unknown as { __calpinageSwitchTo3D?: unknown }).__calpinageSwitchTo3D === "function",
        zoneConnected: !!zone?.isConnected,
        zoneClass: zone?.getAttribute("class") ?? "",
        zoneText: (zone?.textContent ?? "").slice(0, 300),
        zoneHtmlHead: (zone?.innerHTML ?? "").slice(0, 800),
        mount,
        lifecycle,
        bridge,
        renderError,
        state: {
          panCount: state?.pans?.length ?? null,
          roofSurveyLocked: state?.roofSurveyLocked ?? null,
          currentPhase: state?.currentPhase ?? null,
        },
      };
    });
    throw new Error(`Viewer root absent apres switch 3D: ${JSON.stringify(diagnostics, null, 2)}\n${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    await page.waitForFunction(() => {
      const lifecycle = (window as unknown as {
        __CALPINAGE_3D_VIEWER_LIFECYCLE__?: { viewerReady?: boolean; lastBlockReason?: string; firstFrameRendered?: boolean };
      }).__CALPINAGE_3D_VIEWER_LIFECYCLE__;
      const renderability = (window as unknown as {
        __CALPINAGE_3D_RENDERABILITY__?: {
          renderableObjectCount?: number;
          boundsFinite?: boolean;
          cameraFinite?: boolean;
          frustumIntersectsBounds?: boolean;
          frameCount?: number;
        };
      }).__CALPINAGE_3D_RENDERABILITY__;
      return lifecycle?.viewerReady === true &&
        lifecycle.lastBlockReason === "NONE" &&
        lifecycle.firstFrameRendered === true &&
        renderability?.boundsFinite === true &&
        renderability.cameraFinite === true &&
        renderability.frustumIntersectsBounds === true &&
        (renderability.renderableObjectCount ?? 0) > 0 &&
        (renderability.frameCount ?? 0) > 0;
    }, { timeout: 45000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      lifecycle: (window as unknown as Record<string, unknown>)["__CALPINAGE_3D_VIEWER_LIFECYCLE__"],
      renderability: (window as unknown as Record<string, unknown>)["__CALPINAGE_3D_RENDERABILITY__"],
      bridge: (window as unknown as Record<string, unknown>)["__LAST_3D_BRIDGE__"],
      mount: (window as unknown as Record<string, unknown>)["__CALPINAGE_3D_BRIDGE_MOUNT__"],
      rootAttrs: Object.fromEntries(
        Array.from(document.querySelector("[data-testid='solar-scene-3d-viewer-root']")?.attributes ?? []).map((attr) => [attr.name, attr.value]),
      ),
    }));
    throw new Error(`Viewer monte mais non ready: ${JSON.stringify(diagnostics, null, 2)}\n${error instanceof Error ? error.message : String(error)}`);
  }
  await expect(root).toHaveAttribute("data-roof-patch-count", "2");
  await expect(root).toHaveAttribute("data-lifecycle-block-reason", "NONE");
  const canvas = root.locator("canvas").first();
  await expect(canvas).toBeVisible();
  const stats = imageStats(await canvas.screenshot({ animations: "disabled" }));
  expect(stats.width).toBeGreaterThan(200);
  expect(stats.height).toBeGreaterThan(160);
  expect(stats.channelSpread, `canvas stats ${JSON.stringify(stats)}`).toBeGreaterThan(60);
  expect(stats.coloredRatio, `canvas stats ${JSON.stringify(stats)}`).toBeGreaterThan(0.015);
  expect(stats.blueRatio, `canvas stats ${JSON.stringify(stats)}`).toBeLessThan(0.92);
  return stats;
}

async function forceSwitch(page: Page, mode: "2D" | "3D") {
  await page.evaluate((nextMode) => {
    const w = window as unknown as {
      __CALPINAGE_VIEW_MODE__?: string;
      __calpinageSwitchTo2D?: () => void;
      __calpinageSwitchTo3D?: () => void;
    };
    if (nextMode === "2D" && typeof w.__calpinageSwitchTo2D === "function") {
      w.__calpinageSwitchTo2D();
      return;
    }
    if (nextMode === "3D" && typeof w.__calpinageSwitchTo3D === "function") {
      w.__calpinageSwitchTo3D();
      return;
    }
    throw new Error(`Fonction legacy de switch ${nextMode} absente`);
  }, mode);
  await page.waitForFunction((nextMode) => (window as unknown as { __CALPINAGE_VIEW_MODE__?: string }).__CALPINAGE_VIEW_MODE__ === nextMode, mode);
}

async function enter3DAndAssert(page: Page) {
  const already3D = await page.evaluate(() => (window as unknown as { __CALPINAGE_VIEW_MODE__?: string }).__CALPINAGE_VIEW_MODE__ === "3D");
  if (!already3D) {
    await page.locator("#btn-toggle-view-3d").click();
    await page.waitForFunction(() => (window as unknown as { __CALPINAGE_VIEW_MODE__?: string }).__CALPINAGE_VIEW_MODE__ === "3D", { timeout: 15000 });
  }
  return assert3DVisible(page);
}

test.describe("VISUAL-CALPINAGE-P2B - vrai chemin CalpinageApp", () => {
  test("stress 20 cycles route CRM reelle, 2D->3D, frustum, canvas et StatsGl", async ({ page, context }, testInfo) => {
    test.setTimeout(900000);
    await installMocks(context);
    await page.addInitScript((token) => {
      localStorage.setItem("solarnext_token", token);
      localStorage.setItem("calpinage_konva", "1");
      (window as unknown as Record<string, unknown>).__CALPINAGE_3D_STATS_GL__ = true;
      (window as unknown as Record<string, unknown>).__CALPINAGE_3D_LIFECYCLE_DEBUG__ = true;
      const noop = () => undefined;
      class FakeLatLng {
        private readonly latitude: number;
        private readonly longitude: number;
        constructor(lat: number, lng: number) {
          this.latitude = lat;
          this.longitude = lng;
        }
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
    }, fakeJwt());

    const issues = installConsoleCollection(page);
    const cycles = Number(process.env.CALPINAGE_STRESS_CYCLES ?? "20");
    const cycleReports: Array<Record<string, unknown>> = [];
    const cdp = await context.newCDPSession(page).catch(() => null);

    for (let i = 0; i < cycles; i++) {
      const viewport = i % 4 === 0
        ? { width: 390, height: 844 }
        : i % 4 === 1
          ? { width: 820, height: 1180 }
          : i % 4 === 2
            ? { width: 1366, height: 768 }
            : { width: 1440, height: 900 };
      await page.setViewportSize(viewport);
      if (cdp) await cdp.send("Emulation.setCPUThrottlingRate", { rate: i % 5 === 0 ? 4 : 1 });

      const startedAt = Date.now();
      await openRealCalpinage(page, i);
      const firstStats = await enter3DAndAssert(page);

      if (i % 3 === 0) {
        await forceSwitch(page, "2D");
        await forceSwitch(page, "3D");
        await forceSwitch(page, "2D");
        await forceSwitch(page, "3D");
        await assert3DVisible(page);
      }

      if (i % 2 === 0) {
        await page.evaluate(() => {
          const eventName = "CALPINAGE_OFFICIAL_RUNTIME_STRUCTURAL_CHANGE";
          window.dispatchEvent(new CustomEvent(eventName, {
            detail: { reason: "P2B_DOUBLE_EMIT_A", changedDomains: ["pans"], timestamp: Date.now() },
          }));
          window.dispatchEvent(new CustomEvent(eventName, {
            detail: { reason: "P2B_DOUBLE_EMIT_B", changedDomains: ["pans"], timestamp: Date.now() },
          }));
        });
        await assert3DVisible(page);
      }

      const root = page.getByTestId("solar-scene-3d-viewer-root");
      const box = await root.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, -240);
        await page.mouse.wheel(0, 180);
      }
      const afterZoomStats = await assert3DVisible(page);
      const renderability = await page.evaluate(() => (window as unknown as Record<string, unknown>).__CALPINAGE_3D_RENDERABILITY__);
      const lifecycle = await page.evaluate(() => (window as unknown as Record<string, unknown>).__CALPINAGE_3D_VIEWER_LIFECYCLE__);
      const statsGl = await page.evaluate(() => (window as unknown as Record<string, unknown>).__CALPINAGE_3D_STATS_GL_PROBE__);
      expect((lifecycle as { viewerReady?: boolean } | undefined)?.viewerReady).toBe(true);
      expect((lifecycle as { lastBlockReason?: string } | undefined)?.lastBlockReason).toBe("NONE");
      await expect(page.locator("#calpinage-stats-gl")).toBeAttached({ timeout: 10000 });
      expect((statsGl as { frameCount?: number } | undefined)?.frameCount ?? 0).toBeGreaterThan(0);

      cycleReports.push({
        cycle: i + 1,
        viewport,
        elapsedMs: Date.now() - startedAt,
        firstStats,
        afterZoomStats,
        renderability,
        lifecycle,
        statsGl,
      });

      await page.goto("/leads", { waitUntil: "domcontentloaded" });
      await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    }

    if (cdp) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 }).catch(() => undefined);

    const reportMode = process.env.CALPINAGE_STRESS_MODE
      ?? String((testInfo.config.metadata as { calpinageStressMode?: unknown } | undefined)?.calpinageStressMode ?? "dev");
    const report = {
      mode: reportMode,
      generatedAt: new Date().toISOString(),
      cycles,
      issueCount: issues.length,
      issues,
      cycleReports,
    };
    const reportDir = path.join(process.cwd(), "test-results");
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, `calpinage-p2b-stress-${reportMode}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    await testInfo.attach(`calpinage-p2b-stress-${report.mode}`, {
      body: Buffer.from(JSON.stringify(report, null, 2)),
      contentType: "application/json",
    });

    expect(issues, `Console/page issues: ${JSON.stringify(issues, null, 2)}`).toEqual([]);
  });
});
