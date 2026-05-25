import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsHubPage from "../SettingsHubPage";
import { getUserPermissions } from "../../../services/auth.service";

vi.mock("../../../services/auth.service", () => ({
  getUserPermissions: vi.fn(),
}));

const mockedGetUserPermissions = vi.mocked(getUserPermissions);

function renderHub() {
  return render(
    <MemoryRouter>
      <SettingsHubPage />
    </MemoryRouter>
  );
}

describe("SettingsHubPage security and audit discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rend Securite visible pour un admin organisation", async () => {
    mockedGetUserPermissions.mockResolvedValue({ permissions: ["org.settings.manage"], superAdmin: false });

    renderHub();

    const securityLink = await screen.findByRole("link", { name: /Securite/i });
    expect(securityLink).toHaveAttribute("href", "/settings/security");
    expect(within(securityLink).getByText("MFA + sessions")).toBeInTheDocument();
    expect(within(securityLink).getByText("MFA")).toBeInTheDocument();
    expect(within(securityLink).getByText("Sessions")).toBeInTheDocument();
  });

  it("rend Journal d'audit visible pour un admin organisation", async () => {
    mockedGetUserPermissions.mockResolvedValue({ permissions: ["org.settings.manage"], superAdmin: false });

    renderHub();

    const auditLink = await screen.findByRole("link", { name: /Journal d'audit/i });
    expect(auditLink).toHaveAttribute("href", "/admin/audit-log");
    expect(within(auditLink).getByText("Audit org")).toBeInTheDocument();
    expect(within(auditLink).getByText("Export CSV")).toBeInTheDocument();
    expect(within(auditLink).getByText(/Admin organisation/)).toBeInTheDocument();
  });

  it("masque le Journal d'audit pour un utilisateur standard", async () => {
    mockedGetUserPermissions.mockResolvedValue({ permissions: ["lead.read.self"], superAdmin: false });

    renderHub();

    expect(await screen.findByRole("link", { name: /Securite/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Journal d'audit/i })).not.toBeInTheDocument();
  });

  it("garde les liens de securite et audit fonctionnels", async () => {
    mockedGetUserPermissions.mockResolvedValue({ permissions: ["org.settings.manage"], superAdmin: false });

    renderHub();

    expect(await screen.findByRole("link", { name: /Securite/i })).toHaveAttribute("href", "/settings/security");
    expect(screen.getByRole("link", { name: /Journal d'audit/i })).toHaveAttribute("href", "/admin/audit-log");
  });
});
