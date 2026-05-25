import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(process.cwd(), "..");

function readRepo(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("CRM route permission matrix", () => {
  const doc = readRepo("docs/crm-route-permission-matrix.md");

  it("documents protected CRM routes from the router", () => {
    const routes = [
      "/dashboard",
      "/leads",
      "/leads/:id",
      "/clients",
      "/clients/:id",
      "/planning",
      "/finance",
      "/quotes",
      "/quotes/:id",
      "/invoices",
      "/invoices/new",
      "/invoices/:id",
      "/documents",
      "/mairies",
      "/installation/fiche-technique",
      "/mail",
      "/mail/outbox",
      "/settings",
      "/settings/mail",
      "/settings/security",
      "/organization/users",
      "/organization/structure",
      "/organization/roles",
      "/organization/catalog",
      "/admin/settings/pv",
      "/admin/organizations",
      "/admin/audit-log",
    ];

    for (const route of routes) {
      expect(doc, route).toContain(route);
    }
  });

  it("documents every visible sidebar menu target", () => {
    const menuTargets = [
      "Tableau de bord",
      "Leads",
      "Clients",
      "Planning",
      "Devis",
      "Factures",
      "Vue financiere",
      "Documents",
      "Boite mail",
      "Boite d'envoi",
      "Portails mairie",
      "Fiches techniques",
      "Installateurs",
      "Tous les parametres",
      "Organisation",
      "Utilisateurs",
      "Roles",
      "Catalogue devis",
      "Configuration mail",
      "Securite",
      "Journal d'audit",
      "Parametres PV",
      "Organisations",
    ];

    for (const label of menuTargets) {
      expect(doc, label).toContain(label);
    }
  });

  it("documents CRM permissions and justified redirects", () => {
    const permissions = [
      "lead.read.all",
      "lead.read.self",
      "client.read.all",
      "client.read.self",
      "quote.manage",
      "invoice.manage",
      "mission.read.self",
      "mission.read.all",
      "org.settings.manage",
      "structure.manage",
      "rbac.manage",
      "user.manage",
      "QUOTE_CATALOG:READ",
      "QUOTE_CATALOG:WRITE",
      "mail.accounts.manage",
      "mairie.read",
      "SuperAdminRoute",
    ];
    const redirects = [
      "/crm",
      "/clients/:id",
      "/mail/accounts",
      "/settings/mail-signatures",
      "/organization/org-settings",
      "/admin/organization",
    ];

    for (const permission of permissions) {
      expect(doc, permission).toContain(permission);
    }
    for (const redirect of redirects) {
      expect(doc, redirect).toContain(redirect);
    }
  });
});
