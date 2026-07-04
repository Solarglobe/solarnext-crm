/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Login from "../Login";
import { ensureAuthenticated, getCurrentUser } from "../../services/auth.service";

vi.mock("../../services/auth.service", () => {
  class LoginAmbiguousError extends Error {
    organizations: { id: string; name: string | null }[];

    constructor(organizations: { id: string; name: string | null }[] = []) {
      super("Plusieurs comptes pour cet email.");
      this.organizations = organizations;
    }
  }

  return {
    ensureAuthenticated: vi.fn(),
    getCurrentUser: vi.fn(),
    login: vi.fn(),
    LoginAmbiguousError,
  };
});

vi.mock("../../theme/themeApply", () => ({
  applyTheme: vi.fn(),
  readStoredTheme: vi.fn(() => "light"),
}));

const mockedEnsureAuthenticated = vi.mocked(ensureAuthenticated);
const mockedGetCurrentUser = vi.mocked(getCurrentUser);

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<div>Dashboard</div>} />
        <Route path="/onboarding" element={<div>Onboarding</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("Login session restore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restaure une session existante et redirige vers le dashboard", async () => {
    mockedEnsureAuthenticated.mockResolvedValue(true);
    mockedGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "user@test.local",
      organizationId: "org-1",
      onboardingCompleted: true,
    });

    renderLogin();

    expect(await screen.findByText("Dashboard")).toBeTruthy();
  });

  it("respecte l'onboarding apres restauration de session", async () => {
    mockedEnsureAuthenticated.mockResolvedValue(true);
    mockedGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "user@test.local",
      organizationId: "org-1",
      onboardingCompleted: false,
    });

    renderLogin();

    expect(await screen.findByText("Onboarding")).toBeTruthy();
  });
});
