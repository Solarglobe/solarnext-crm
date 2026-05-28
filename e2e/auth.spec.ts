import { API_URL, completeOnboarding, expect, test } from "./support/e2eTest";

test.describe("auth critical flow", () => {
  test("login with a verified account opens the dashboard", async ({ page, seed }) => {
    await completeOnboarding(seed);

    const me = await fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${seed.token}` },
    });
    expect(me.status).toBe(200);

    await page.addInitScript((token) => {
      window.localStorage.setItem("solarnext_token", token);
    }, seed.token);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator("body")).toContainText(/dashboard|tableau|solarnext/i);
  });

  test.fixme("signup -> email verification -> login -> dashboard", async () => {
    // Public registration and email verification endpoints are not exposed yet.
  });

  test.fixme("forgot password -> reset -> reconnect", async () => {
    // Public forgot/reset password endpoints are not exposed yet.
  });
});
