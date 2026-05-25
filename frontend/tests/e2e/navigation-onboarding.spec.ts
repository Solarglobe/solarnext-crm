import { expect, test, type Page, type Route } from "@playwright/test";

type RoleFixture = {
  name: "standard" | "adminOrg";
  permissions: string[];
  superAdmin?: boolean;
  onboardingCompleted: boolean;
};

const ROLE_FIXTURES: Record<RoleFixture["name"], RoleFixture> = {
  standard: {
    name: "standard",
    permissions: ["lead.read.self"],
    onboardingCompleted: true,
  },
  adminOrg: {
    name: "adminOrg",
    permissions: [
      "lead.read.all",
      "client.read.all",
      "org.settings.manage",
      "user.manage",
      "rbac.manage",
      "structure.manage",
      "mail.accounts.manage",
    ],
    onboardingCompleted: true,
  },
};

function fakeJwt(role: RoleFixture): string {
  const payload = {
    exp: Math.floor(Date.now() / 1000) + 3600,
    userId: `user-${role.name}`,
    organizationId: "org-e2e",
    role: role.superAdmin ? "SUPER_ADMIN" : "ADMIN",
  };
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value))
      .toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.e2e`;
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installCrmApiMocks(page: Page, role: RoleFixture) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();

    if (!path.startsWith("/auth") && !path.startsWith("/api")) {
      await route.continue();
      return;
    }

    if (path === "/auth/refresh" && method === "POST") {
      await fulfillJson(route, { accessToken: fakeJwt(role) });
      return;
    }
    if (path === "/auth/me") {
      await fulfillJson(route, {
        id: `user-${role.name}`,
        email: `${role.name}@example.test`,
        organizationId: "org-e2e",
        onboardingCompleted: role.onboardingCompleted,
        internalHomeOrganization: false,
        mfaEnabled: false,
        organizationRequiresMfa: false,
      });
      return;
    }
    if (path === "/auth/permissions") {
      await fulfillJson(route, {
        permissions: role.permissions,
        superAdmin: role.superAdmin === true,
      });
      return;
    }
    if (path === "/api/organizations") {
      await fulfillJson(route, [{ id: "org-e2e", name: "SolarNext E2E" }]);
      return;
    }
    if (path === "/api/organizations/onboarding" && method === "GET") {
      await fulfillJson(route, {
        completed: role.onboardingCompleted,
        completedSteps: [],
        organization: { id: "org-e2e", name: "SolarNext E2E" },
        data: {
          profile: { name: "SolarNext E2E" },
          mail: { mode: "solarnext", email: "" },
          collaborators: [],
          lead: { first_name: "", last_name: "", email: "" },
        },
      });
      return;
    }
    if (path === "/api/organizations/onboarding" && method === "PATCH") {
      await fulfillJson(route, { ok: true });
      return;
    }
    if (path === "/auth/mfa/status") {
      await fulfillJson(route, { enabled: false, organizationRequiresMfa: false });
      return;
    }
    if (path === "/api/organizations/security") {
      await fulfillJson(route, { requireMfa: role.permissions.includes("org.settings.manage") });
      return;
    }
    if (path === "/auth/sessions") {
      await fulfillJson(route, {
        sessions: [
          {
            id: "session-current",
            sessionId: "session-current",
            deviceHint: "Desktop Chrome",
            ipAddress: "127.0.0.1",
            countryHint: "Local",
            createdAt: "2026-05-25T10:00:00.000Z",
            lastUsedAt: "2026-05-25T10:05:00.000Z",
            expiresAt: "2026-05-26T10:00:00.000Z",
            current: true,
          },
        ],
      });
      return;
    }
    if (path === "/api/admin/audit-log") {
      await fulfillJson(route, {
        rows: [
          {
            id: "audit-1",
            action: "AUTH_LOGIN_SUCCESS",
            entity_type: "auth",
            user_email: "admin@example.test",
            ip_address: "127.0.0.1",
            route: "/auth/login",
            method: "POST",
            status_code: 200,
            created_at: "2026-05-25T10:00:00.000Z",
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
      });
      return;
    }
    if (path === "/api/admin/audit-log/export.csv") {
      await route.fulfill({
        status: 200,
        contentType: "text/csv",
        body: "created_at,action\n2026-05-25T10:00:00.000Z,AUTH_LOGIN_SUCCESS\n",
      });
      return;
    }

    await fulfillJson(route, { ok: true, items: [], rows: [], total: 0 });
  });
}

test.describe("Navigation et onboarding CRM", () => {
  test("redirige vers l'onboarding quand le demarrage guide n'est pas termine", async ({ page }) => {
    await installCrmApiMocks(page, {
      ...ROLE_FIXTURES.adminOrg,
      onboardingCompleted: false,
    });

    await page.goto("/dashboard");

    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole("heading", { name: "Entreprise" })).toBeVisible();
    await expect(page.getByText(/Premier d.*marrage/)).toBeVisible();
  });

  test("l'onboarding expose uniquement les etapes reelles, sans pipeline fictif", async ({ page }) => {
    await installCrmApiMocks(page, {
      ...ROLE_FIXTURES.adminOrg,
      onboardingCompleted: false,
    });

    await page.goto("/onboarding");

    await expect(page.getByRole("button", { name: /Entreprise/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Mail/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /quipe/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Premier lead/ })).toBeVisible();
    await expect(page.getByText(/Pipeline/i)).toHaveCount(0);
  });

  test("le hub Parametres reste filtre par role standard", async ({ page }) => {
    await installCrmApiMocks(page, ROLE_FIXTURES.standard);

    await page.goto("/settings");

    const main = page.locator("main.settings-hub");
    await expect(page.getByRole("heading", { name: "Centre de configuration CRM" })).toBeVisible();
    await expect(main.getByRole("link", { name: /Securite/ })).toBeVisible();
    await expect(main.getByRole("link", { name: /Journal d'audit/ })).toHaveCount(0);
    await expect(main.getByRole("link", { name: /Utilisateurs/ })).toHaveCount(0);
  });

  test("un admin organisation voit Securite et Journal d'audit", async ({ page }) => {
    await installCrmApiMocks(page, ROLE_FIXTURES.adminOrg);

    await page.goto("/settings");

    const main = page.locator("main.settings-hub");
    await expect(main.getByRole("link", { name: /Securite/ })).toBeVisible();
    await expect(main.getByRole("link", { name: /Journal d'audit/ })).toBeVisible();

    await main.getByRole("link", { name: /Securite/ }).click();
    await expect(page.getByRole("heading", { name: "Securite" })).toBeVisible();
    await expect(page.getByText("Sessions actives")).toBeVisible();

    await page.goto("/admin/audit-log");
    await expect(page.getByRole("heading", { name: "Journal d'audit" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
    await expect(page.locator("tbody").getByText("AUTH_LOGIN_SUCCESS")).toBeVisible();
  });

  test("la sidebar mobile s'ouvre et expose la navigation basique", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installCrmApiMocks(page, ROLE_FIXTURES.adminOrg);

    await page.goto("/settings");
    await page.getByRole("button", { name: "Ouvrir le menu" }).click();

    await expect(page.getByRole("navigation", { name: "Navigation principale" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Operations/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Parametres/ })).toBeVisible();
    const sidebarNav = page.getByRole("navigation", { name: "Navigation principale" });
    await expect(sidebarNav.getByRole("link", { name: "Securite", exact: true })).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth > root.clientWidth + 2;
    });
    expect(hasHorizontalOverflow).toBe(false);
  });
});
