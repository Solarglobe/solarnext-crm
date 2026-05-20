import { expect, test, type Page, type TestInfo } from "@playwright/test";

async function openDormerQa(page: Page, pv = false) {
  await page.setViewportSize({ width: 1500, height: 940 });
  await page.goto(`/dev/calpinage-visual-qa?fixture=visual_qa_premium_complex&view=validation${pv ? "&pv=1" : ""}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("visual-qa-stage")).toBeVisible();
  await expect(page.getByTestId("visual-qa-viewer-3d")).toBeVisible();
  await page.locator("canvas").first().waitFor({ state: "visible", timeout: 30000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1400);
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string, selector: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.locator(selector).screenshot({ path, animations: "disabled" });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

test.describe("RoofExtensionV1 browser runtime", () => {
  test("fixture lucarne V1 - preuves 2D, 3D, vue rasante et PV autofill", async ({ page }, testInfo) => {
    await openDormerQa(page, false);
    await expect(page.getByText(/extensions=1/)).toBeVisible();

    await attachScreenshot(page, testInfo, "roof-extension-v1-2d", '[data-testid="visual-qa-plan-2d"]');
    await attachScreenshot(page, testInfo, "roof-extension-v1-3d-close", '[data-testid="visual-qa-viewer-3d"]');

    const viewer = page.getByTestId("visual-qa-viewer-3d");
    const box = await viewer.boundingBox();
    if (!box) throw new Error("viewer bbox unavailable");
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.52);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.82, box.y + box.height * 0.82, { steps: 18 });
    await page.mouse.up();
    await page.mouse.wheel(0, 620);
    await page.waitForTimeout(700);
    await attachScreenshot(page, testInfo, "roof-extension-v1-3d-raking", '[data-testid="visual-qa-viewer-3d"]');

    await openDormerQa(page, true);
    await expect(page.locator('[data-pv-layout-3d="on"]')).toBeVisible();
    await attachScreenshot(page, testInfo, "roof-extension-v1-pv-autofill-keepout", '[data-testid="visual-qa-viewer-3d"]');
  });
});
