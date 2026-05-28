import { completeOnboarding, expect, loginViaUi, test } from "./support/e2eTest";
import type { Page } from "../frontend/node_modules/@playwright/test";

const ESSENTIAL_PAGES = [
  { path: "/dashboard", label: /tableau|dashboard/i },
  { path: "/leads", label: /leads|prospects|dossiers/i },
  { path: "/clients", label: /clients/i },
  { path: "/quotes", label: /devis/i },
  { path: "/invoices", label: /factures/i },
  { path: "/settings", label: /parametres|param.tres/i },
] as const;

async function assertUsableCrmPage(page: Page, label: RegExp) {
  await expect(page.locator("body")).toContainText(label);
  await expect(page.locator("body")).not.toContainText(/access denied|acces refuse|acc.s refus.|page introuvable/i);
  await expect(page.locator("body")).not.toContainText(/cannot read|undefined is not|runtime error/i);
}

test.describe("release go/no-go CRM smoke", () => {
  test("onboarding guard blocks the CRM until mandatory setup is completed", async ({ page, seed }) => {
    await loginViaUi(page, seed, /\/onboarding/);
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.locator("body")).toContainText(/bienvenue|configuration|onboarding|organisation/i);

    await completeOnboarding(seed);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);
    await assertUsableCrmPage(page, /tableau|dashboard/i);
  });

  test("essential CRM pages are reachable and readable on desktop", async ({ page, seed }, testInfo) => {
    await completeOnboarding(seed);
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaUi(page, seed);

    for (const route of ESSENTIAL_PAGES) {
      await page.goto(route.path);
      await expect(page).toHaveURL(new RegExp(route.path.replace("/", "\\/")));
      await assertUsableCrmPage(page, route.label);
    }

    await testInfo.attach("release-desktop-dashboard", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });

  test("mobile navigation keeps core CRM entries accessible", async ({ page, seed }, testInfo) => {
    await completeOnboarding(seed);
    await page.setViewportSize({ width: 390, height: 844 });
    await loginViaUi(page, seed);

    await page.goto("/dashboard");
    await assertUsableCrmPage(page, /tableau|dashboard/i);

    const body = page.locator("body");
    for (const item of ["Leads", "Clients", "Devis", "Factures", "Parametres"]) {
      await expect(body).toContainText(new RegExp(item, "i"));
    }

    await page.goto("/leads");
    await assertUsableCrmPage(page, /leads|prospects|dossiers/i);

    await testInfo.attach("release-mobile-leads", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });
});
