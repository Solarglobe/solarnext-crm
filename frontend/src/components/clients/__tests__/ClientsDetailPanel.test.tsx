/**
 * Stepper statut projet — clic, PATCH.
 */
import React from "react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ClientsDetailPanel } from "../ClientsDetailPanel";
import * as leadsService from "../../../services/leads.service";
import type { Lead } from "../../../services/leads.service";

vi.mock("../../../contexts/OrganizationContext", () => ({
  useSuperAdminReadOnly: () => false,
}));

const minimalLead = (over: Partial<Lead> = {}): Lead => ({
  id: "lead-1",
  full_name: "Client Test",
  score: 0,
  potential_revenue: 0,
  inactivity_level: "none",
  status: "CLIENT",
  stage_id: "st-1",
  created_at: "2024-01-01T00:00:00.000Z",
  project_status: "SIGNE",
  ...over,
});

describe("ClientsDetailPanel — stepper statut projet", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("appelle updateLead au clic sur une étape visible", async () => {
    const updateLead = vi.spyOn(leadsService, "updateLead").mockResolvedValue(
      minimalLead({ project_status: "DP_A_DEPOSER" })
    );
    const onLeadUpdated = vi.fn();

    render(
      <MemoryRouter>
        <ClientsDetailPanel
          lead={minimalLead()}
          canArchive={false}
          canEditProjectStatus
          onOpenFull={() => {}}
          onLeadUpdated={onLeadUpdated}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /DP à déposer/i }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Confirmer$/i }));

    await waitFor(() => {
      expect(updateLead).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "lead-1",
          project_status: "DP_A_DEPOSER",
        })
      );
    });
    await waitFor(() => {
      expect(onLeadUpdated).toHaveBeenCalledTimes(1);
    });
  });

  it("désactive le stepper si canEditProjectStatus est false", () => {
    render(
      <MemoryRouter>
        <ClientsDetailPanel
          lead={minimalLead()}
          canArchive={false}
          canEditProjectStatus={false}
          onOpenFull={() => {}}
        />
      </MemoryRouter>
    );
    const current = document.querySelector(
      ".project-status-stepper .step.current"
    );
    expect(current?.textContent).toMatch(/Signé/);
    expect(
      screen.getByRole("button", { name: /Signé/i })
    ).toBeDisabled();
  });

  it("affiche la date de naissance (JJ/MM/AAAA) en lecture seule", async () => {
    render(
      <MemoryRouter>
        <ClientsDetailPanel
          lead={minimalLead({ birth_date: "1990-05-15" })}
          canArchive={false}
          canEditProjectStatus={false}
          onOpenFull={() => {}}
        />
      </MemoryRouter>
    );
    expect(await screen.findByText("15/05/1990")).toBeInTheDocument();
  });

  it("affiche « Non renseignée » sans date de naissance en lecture seule", async () => {
    render(
      <MemoryRouter>
        <ClientsDetailPanel
          lead={minimalLead({ birth_date: null })}
          canArchive={false}
          canEditProjectStatus={false}
          onOpenFull={() => {}}
        />
      </MemoryRouter>
    );
    expect(await screen.findByText("Non renseignée")).toBeInTheDocument();
  });
});
