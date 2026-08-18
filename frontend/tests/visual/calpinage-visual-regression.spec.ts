import { inflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";

const maxDiffPixelRatio = Number(process.env.CALPINAGE_VISUAL_MAX_DIFF_RATIO ?? "0.018");
const maxDiffPixels = Number(process.env.CALPINAGE_VISUAL_MAX_DIFF_PIXELS ?? "4500");

type Viewport = { readonly width: number; readonly height: number };

type RuntimeIssue = {
  readonly type: "error" | "warning" | "pageerror";
  readonly text: string;
};

const CRITICAL_WARNING_PATTERNS = [
  /Multiple instances of Three\.js/i,
  /invalid hook call/i,
  /React has detected a change in the order of Hooks/i,
  /webglcontextlost/i,
  /THREE\.WebGLRenderer/i,
  /R3F/i,
];

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

async function waitForViewerReady(page: Page) {
  await page.waitForFunction(() => {
    const lifecycle = (window as unknown as {
      __CALPINAGE_3D_VIEWER_LIFECYCLE__?: { readonly viewerReady?: boolean; readonly lastBlockReason?: string };
    }).__CALPINAGE_3D_VIEWER_LIFECYCLE__;
    return lifecycle?.viewerReady === true && lifecycle.lastBlockReason === "NONE";
  });
  await expect(page.getByTestId("solar-scene-3d-viewer-root")).toHaveAttribute("data-lifecycle-first-frame-rendered", "true");
}

async function openVisualQa(
  page: Page,
  fixture: string,
  viewport: Viewport,
  extraParams: Record<string, string> = {},
) {
  await page.setViewportSize(viewport);
  const params = new URLSearchParams({ fixture, view: "validation", ...extraParams });
  await page.goto(`/dev/calpinage-visual-qa?${params.toString()}`, {
    waitUntil: "domcontentloaded",
  });
  const stage = page.getByTestId("visual-qa-stage");
  await expect(stage).toBeVisible();
  await expect(page.getByTestId("visual-qa-viewer-3d")).toBeVisible();
  await page.locator("canvas").first().waitFor({ state: "visible", timeout: 30000 });
  await waitForViewerReady(page);
  return stage;
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

function decodePngRgba(buffer: Buffer): { width: number; height: number; data: Uint8Array } {
  if (buffer.toString("ascii", 1, 4) !== "PNG") throw new Error("Screenshot PNG invalide");
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
  const bpp = channels;
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
      const left = x >= bpp ? current[x - bpp]! : 0;
      const up = previous[x]!;
      const upperLeft = x >= bpp ? previous[x - bpp]! : 0;
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
  return { width, height, data: out };
}

function imageStats(buffer: Buffer) {
  const png = decodePngRgba(buffer);
  let blueLike = 0;
  let colored = 0;
  let samples = 0;
  let minR = 255;
  let maxR = 0;
  let minG = 255;
  let maxG = 0;
  let minB = 255;
  let maxB = 0;
  for (let y = 0; y < png.height; y += 3) {
    for (let x = 0; x < png.width; x += 3) {
      const i = (y * png.width + x) * 4;
      const r = png.data[i]!;
      const g = png.data[i + 1]!;
      const b = png.data[i + 2]!;
      samples += 1;
      minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      minG = Math.min(minG, g); maxG = Math.max(maxG, g);
      minB = Math.min(minB, b); maxB = Math.max(maxB, b);
      if (b > 70 && b > r * 1.35 && b > g * 1.08) blueLike += 1;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 18) colored += 1;
    }
  }
  return {
    width: png.width,
    height: png.height,
    blueRatio: blueLike / samples,
    coloredRatio: colored / samples,
    channelSpread: maxR - minR + maxG - minG + maxB - minB,
  };
}

async function expectViewerNotBlue(page: Page) {
  const viewer = page.getByTestId("visual-qa-viewer-3d");
  const box = await viewer.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(200);
  expect(box?.height ?? 0).toBeGreaterThan(160);
  const screenshot = await viewer.screenshot({ animations: "disabled" });
  const stats = imageStats(screenshot);
  expect(stats.width).toBeGreaterThan(200);
  expect(stats.height).toBeGreaterThan(160);
  expect(stats.channelSpread).toBeGreaterThan(80);
  expect(stats.coloredRatio).toBeGreaterThan(0.03);
  expect(stats.blueRatio).toBeLessThan(0.92);
}

async function expectSemanticGeometry(page: Page, expected: { patches: number; panels?: number; obstacles?: number }) {
  const root = page.getByTestId("solar-scene-3d-viewer-root");
  await expect(root).toHaveAttribute("data-lifecycle-viewer-ready", "true");
  await expect(root).toHaveAttribute("data-lifecycle-block-reason", "NONE");
  await expect(root).toHaveAttribute("data-roof-patch-count", String(expected.patches));
  if (expected.panels != null) await expect(root).toHaveAttribute("data-pv-panel-count", String(expected.panels));
  if (expected.obstacles != null) await expect(root).toHaveAttribute("data-obstacle-volume-count", String(expected.obstacles));
  const diagnostics = await page.evaluate(() => {
    const api = (window as unknown as { __CALPINAGE_3D_DEBUG_API__?: { snapshot?: () => unknown } }).__CALPINAGE_3D_DEBUG_API__;
    return api?.snapshot?.();
  });
  expect(diagnostics).toBeTruthy();
}

test.describe("VISUAL-CALPINAGE - P2 viewer readiness and screenshots", () => {
  test.afterEach(async ({ page }, testInfo) => {
    const issues = (testInfo.attachments.find((a) => a.name === "runtime-issues")?.body?.toString("utf8"));
    await expect(page.locator(".vite-error-overlay")).toHaveCount(0);
    if (issues && issues !== "[]") throw new Error(`Console runtime critique: ${issues}`);
  });

  for (const [name, fixture, viewport, expected] of [
    ["maison simple desktop", "visual_qa_simple_house", { width: 1440, height: 900 }, { patches: 2, obstacles: 1 }],
    ["premium complexe desktop", "visual_qa_premium_complex", { width: 1440, height: 900 }, { patches: 3, obstacles: 9 }],
    ["premium complexe laptop", "visual_qa_premium_complex", { width: 1366, height: 768 }, { patches: 3, obstacles: 9 }],
    ["premium complexe tablette", "visual_qa_premium_complex", { width: 820, height: 1180 }, { patches: 3, obstacles: 9 }],
    ["premium complexe mobile", "visual_qa_premium_complex", { width: 390, height: 844 }, { patches: 3, obstacles: 9 }],
    ["dossier dense", "dense_loaded_case", { width: 1440, height: 900 }, { patches: 3, obstacles: 3 }],
    ["monopan", "mono-pan-nominal", { width: 1440, height: 900 }, { patches: 1, obstacles: 1 }],
    ["double pente", "dual-pan-ridge", { width: 1440, height: 900 }, { patches: 2, obstacles: 0 }],
    ["partiel affichable", "partial_degraded_like", { width: 1440, height: 900 }, { patches: 2, obstacles: 1 }],
    ["simple_gable_clean", "simple_gable_clean", { width: 1440, height: 900 }, { patches: 2, obstacles: 0 }],
  ] as const) {
    test(`${name} - frame initiale visible sans interaction`, async ({ page }, testInfo) => {
      const issues = installConsoleCollection(page);
      const stage = await openVisualQa(page, fixture, viewport, { delivery: "before" });
      await expectSemanticGeometry(page, expected);
      await expectViewerNotBlue(page);
      if (name === "maison simple desktop") {
        await expect(stage).toHaveScreenshot("calpinage-simple-house-desktop.png", {
          animations: "disabled",
          maxDiffPixelRatio,
          maxDiffPixels,
        });
      }
      await testInfo.attach("runtime-issues", {
        body: Buffer.from(JSON.stringify(issues)),
        contentType: "application/json",
      });
    });
  }

  test("non-regression ecran bleu - remounts, resize puis zoom seulement apres frame visible", async ({ page }, testInfo) => {
    const issues = installConsoleCollection(page);
    await openVisualQa(page, "visual_qa_premium_complex", { width: 1440, height: 900 }, { remount: "4", strict: "1" });
    await expectViewerNotBlue(page);
    const before = await page.evaluate(() => (window as any).__CALPINAGE_3D_VIEWER_LIFECYCLE__);
    await page.setViewportSize({ width: 1024, height: 720 });
    await waitForViewerReady(page);
    await expectViewerNotBlue(page);
    const viewer = page.getByTestId("visual-qa-viewer-3d");
    const box = await viewer.boundingBox();
    if (!box) throw new Error("viewer bbox unavailable");
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.wheel(0, -320);
    await page.mouse.wheel(0, 320);
    await waitForViewerReady(page);
    await expectViewerNotBlue(page);
    const after = await page.evaluate(() => (window as any).__CALPINAGE_3D_VIEWER_LIFECYCLE__);
    expect(before.viewerReady).toBe(true);
    expect(after.viewerReady).toBe(true);
    expect(before.firstFrameRendered).toBe(true);
    await testInfo.attach("runtime-issues", {
      body: Buffer.from(JSON.stringify(issues)),
      contentType: "application/json",
    });
  });

  test("donnees apres montage, changement fixture et Last Known Good affichable", async ({ page }, testInfo) => {
    const issues = installConsoleCollection(page);
    await openVisualQa(page, "visual_qa_simple_house", { width: 1440, height: 900 }, {
      delivery: "after",
      switchTo: "dense_loaded_case",
      reliability: "degraded",
    });
    await expectSemanticGeometry(page, { patches: 3, obstacles: 3 });
    await expect(page.getByTestId("solar-scene-3d-viewer-root")).toHaveAttribute("data-viewer-reliability", "degraded");
    await expectViewerNotBlue(page);
    await testInfo.attach("runtime-issues", {
      body: Buffer.from(JSON.stringify(issues)),
      contentType: "application/json",
    });
  });

  test("scene invalide explicite - pas de canvas bleu ambigu", async ({ page }, testInfo) => {
    const issues = installConsoleCollection(page);
    await openVisualQa(page, "visual_qa_simple_house", { width: 1440, height: 900 }, { reliability: "invalid" });
    await expect(page.getByTestId("solar-scene-3d-viewer-root")).toHaveAttribute("data-viewer-reliability", "invalid");
    await expect(page.getByTestId("viewer-reliability-notice")).toBeVisible();
    await expectViewerNotBlue(page);
    await testInfo.attach("runtime-issues", {
      body: Buffer.from(JSON.stringify(issues)),
      contentType: "application/json",
    });
  });

  test("WebGL context lost/restored - diagnostic explicite et scene non declaree prete pendant la perte", async ({ page }, testInfo) => {
    const issues = installConsoleCollection(page);
    await openVisualQa(page, "visual_qa_simple_house", { width: 1440, height: 900 });
    await page.locator("canvas").first().dispatchEvent("webglcontextlost", { cancelable: true });
    await page.waitForFunction(() => {
      const lifecycle = (window as any).__CALPINAGE_3D_VIEWER_LIFECYCLE__;
      return lifecycle?.webglContextLost === true && lifecycle?.viewerReady === false;
    });
    await expect(page.getByTestId("solar-scene-3d-viewer-root")).toHaveAttribute("data-lifecycle-block-reason", "CONTEXT_LOST");
    await page.locator("canvas").first().dispatchEvent("webglcontextrestored");
    await page.waitForFunction(() => {
      const lifecycle = (window as any).__CALPINAGE_3D_VIEWER_LIFECYCLE__;
      return lifecycle?.webglContextRestored === true;
    });
    await testInfo.attach("runtime-issues", {
      body: Buffer.from(JSON.stringify(issues)),
      contentType: "application/json",
    });
  });
});
