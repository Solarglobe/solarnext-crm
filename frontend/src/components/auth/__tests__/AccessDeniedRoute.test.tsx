import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminRoute } from "../AdminRoute";
import { ProtectedRoute } from "../ProtectedRoute";
import { SuperAdminRoute } from "../SuperAdminRoute";
import { ensureAuthenticated, getCurrentUser, getUserPermissions } from "../../../services/auth.service";

vi.mock("../../../services/auth.service", () => ({
  ensureAuthenticated: vi.fn(),
  getCurrentUser: vi.fn(),
  getUserPermissions: vi.fn(),
}));

vi.mock("../../../services/organizations.service", () => ({
  wasImpersonationTokenExpiredAndCleared: vi.fn(() => false),
}));

const mockedEnsureAuthenticated = vi.mocked(ensureAuthenticated);
const mockedGetCurrentUser = vi.mocked(getCurrentUser);
const mockedGetUserPermissions = vi.mocked(getUserPermissions);

function renderSecureRoutes(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/organization/users"
          element={
            <ProtectedRoute>
              <AdminRoute anyOf={["user.manage"]}>
                <div>Gestion utilisateurs</div>
              </AdminRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/organizations"
          element={
            <ProtectedRoute>
              <SuperAdminRoute>
                <div>Organisations super admin</div>
              </SuperAdminRoute>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<div>Connexion</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function mockAuthenticatedUser() {
  mockedEnsureAuthenticated.mockResolvedValue(true);
  mockedGetCurrentUser.mockResolvedValue({
    id: "user-1",
    email: "user@test.local",
    organizationId: "org-1",
    onboardingCompleted: true,
  });
}

describe("Access denied routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("affiche une page 403 pour un non admin sur /organization/users", async () => {
    mockAuthenticatedUser();
    mockedGetUserPermissions.mockResolvedValue({ permissions: ["lead.read.self"], superAdmin: false });

    renderSecureRoutes("/organization/users");

    expect(await screen.findByRole("heading", { name: "Acces refuse" })).toBeInTheDocument();
    expect(screen.getByText("403")).toBeInTheDocument();
    expect(screen.getByText("/organization/users")).toBeInTheDocument();
    expect(screen.getByText("Gestion des utilisateurs")).toBeInTheDocument();
    expect(screen.queryByText("Gestion utilisateurs")).not.toBeInTheDocument();
    expect(screen.queryByText("user.manage")).not.toBeInTheDocument();
  });

  it("affiche une page 403 pour un non super admin sur /admin/organizations", async () => {
    mockAuthenticatedUser();
    mockedGetUserPermissions.mockResolvedValue({ permissions: ["org.settings.manage"], superAdmin: false });

    renderSecureRoutes("/admin/organizations");

    expect(await screen.findByRole("heading", { name: "Acces support reserve" })).toBeInTheDocument();
    expect(screen.getByText("403")).toBeInTheDocument();
    expect(screen.getByText("/admin/organizations")).toBeInTheDocument();
    expect(screen.getByText("Support SolarNext super admin")).toBeInTheDocument();
    expect(screen.queryByText("Organisations super admin")).not.toBeInTheDocument();
  });

  it("redirige un utilisateur non authentifie vers /login", async () => {
    mockedEnsureAuthenticated.mockResolvedValue(false);

    renderSecureRoutes("/organization/users");

    expect(await screen.findByText("Connexion")).toBeInTheDocument();
    expect(mockedGetCurrentUser).not.toHaveBeenCalled();
    expect(mockedGetUserPermissions).not.toHaveBeenCalled();
  });
});
