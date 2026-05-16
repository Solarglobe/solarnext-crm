import { expect, test, type Page } from "@playwright/test";

const maxDiffPixelRatio = Number(process.env.CALPINAGE_VISUAL_MAX_DIFF_RATIO ?? "0.018");
const maxDiffPixels = Number(process.env.CALPINAGE_VISUAL_MAX_DIFF_PIXELS ?? "4500");

async function openVisualQa(page: Page, fixture: string, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.goto(`/dev/calpinage-visual-qa?fixture=${fixture}&view=validation`, {
    waitUntil: "domcontentloaded",
  });
  const stage = page.getByTestId("visual-qa-stage");
  await expect(stage).toBeVisible();
  await page.locator("canvas").first().waitFor({ state: "visible", timeout: 30000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
  return stage;
}

test.describe("VISUAL-CALPINAGE - regression 2D/3D premium", () => {
  test("maison simple - desktop", async ({ page }) => {
    const stage = await openVisualQa(page, "visual_qa_simple_house", { width: 1440, height: 900 });
    await expect(stage).toHaveScreenshot("calpinage-simple-house-desktop.png", {
      animations: "disabled",
      maxDiffPixelRatio,
      maxDiffPixels,
    });
  });

  test("scene premium complexe - desktop", async ({ page }) => {
    const stage = await openVisualQa(page, "visual_qa_premium_complex", { width: 1440, height: 900 });
    await expect(stage).toHaveScreenshot("calpinage-premium-complex-desktop.png", {
      animations: "disabled",
      maxDiffPixelRatio,
      maxDiffPixels,
    });
  });

  test("scene premium complexe - mobile", async ({ page }) => {
    const stage = await openVisualQa(page, "visual_qa_premium_complex", { width: 390, height: 844 });
    await expect(stage).toHaveScreenshot("calpinage-premium-complex-mobile.png", {
      animations: "disabled",
      maxDiffPixelRatio,
      maxDiffPixels,
    });
  });

  test("stress multi-pans charge - desktop", async ({ page }) => {
    const stage = await openVisualQa(page, "dense_loaded_case", { width: 1440, height: 900 });
    await expect(stage).toHaveScreenshot("calpinage-dense-loaded-stress-desktop.png", {
      animations: "disabled",
      maxDiffPixelRatio,
      maxDiffPixels,
    });
  });
});
