import { expect, test } from "@playwright/test";

test.describe("Mail Phase 6C demo surface", () => {
  test("desktop shows composer, attachments states, reply/forward controls and history folders", async ({ page }) => {
    await page.goto("/dev/mail-ui");
    await expect(page.getByRole("button", { name: /Nouveau message/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Répondre/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Transférer/ }).first()).toBeVisible();
    await expect(page.getByText(/Pièces jointes/).first()).toBeVisible();
    await expect(page.getByText(/Synchronisation partielle/)).toBeVisible();
    await expect(page.getByRole("dialog", { name: /Nouveau message demo/ })).toBeVisible();
  });

  test("mobile width keeps mail demo usable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dev/mail-ui");
    await expect(page.getByText("Inbox").first()).toBeVisible();
    await expect(page.getByRole("dialog", { name: /Nouveau message demo/ })).toBeVisible();
  });
});

