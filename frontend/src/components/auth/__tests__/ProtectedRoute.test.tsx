import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProtectedRoute } from "../ProtectedRoute";
import { ensureAuthenticated, getCurrentUser } from "../../../services/auth.service";

vi.mock("../../../services/auth.service", () => ({
  ensureAuthenticated: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock("../../../services/organizations.service", () => ({
  wasImpersonationTokenExpiredAndCleared: vi.fn(() => false),
}));

const mockedEnsureAuthenticated = vi.mocked(ensureAuthenticated);
const mockedGetCurrentUser = vi.mocked(getCurrentUser);

function renderProtected(initialPath = "/dashboard") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <div>Dashboard prive</div>
            </ProtectedRoute>
          }
        />
        <Route
          path="/onboarding"
          element={
            <ProtectedRoute>
              <div>Onboarding guide</div>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<div>Connexion</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ProtectedRoute onboarding guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirige un token valide non onboarde vers /onboarding", async () => {
    mockedEnsureAuthenticated.mockResolvedValue(true);
    mockedGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "user@test.local",
      organizationId: "org-1",
      onboardingCompleted: false,
    });

    renderProtected("/dashboard");

    expect(await screen.findByText("Onboarding guide")).toBeInTheDocument();
  });

  it("laisse passer un token valide deja onboarde", async () => {
    mockedEnsureAuthenticated.mockResolvedValue(true);
    mockedGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "user@test.local",
      organizationId: "org-1",
      onboardingCompleted: true,
    });

    renderProtected("/dashboard");

    expect(await screen.findByText("Dashboard prive")).toBeInTheDocument();
  });

  it("redirige un utilisateur non authentifie vers /login", async () => {
    mockedEnsureAuthenticated.mockResolvedValue(false);

    renderProtected("/dashboard");

    expect(await screen.findByText("Connexion")).toBeInTheDocument();
    expect(mockedGetCurrentUser).not.toHaveBeenCalled();
  });

  it("ne boucle pas quand la route courante est /onboarding", async () => {
    mockedEnsureAuthenticated.mockResolvedValue(true);
    mockedGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "user@test.local",
      organizationId: "org-1",
      onboardingCompleted: false,
    });

    renderProtected("/onboarding");

    await waitFor(() => expect(screen.getByText("Onboarding guide")).toBeInTheDocument());
  });

  it("exempte la maison mere SolarGlobe", async () => {
    mockedEnsureAuthenticated.mockResolvedValue(true);
    mockedGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "admin@solarglobe.fr",
      organizationId: "org-1",
      onboardingCompleted: false,
      internalHomeOrganization: true,
    });

    renderProtected("/dashboard");

    expect(await screen.findByText("Dashboard prive")).toBeInTheDocument();
  });
});
