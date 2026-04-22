/**
 * CP-REFAC-004.1 — Équipes & entreprise (rôles, agences, équipes, org, archives)
 */

import React, { useState } from "react";
import { SaasTabs } from "../../components/ui/SaasTabs";
import { AdminTabRoles } from "../../modules/admin/AdminTabRoles";
import { AdminTabAgencies } from "../../modules/admin/AdminTabAgencies";
import { AdminTabTeams } from "../../modules/admin/AdminTabTeams";
import { AdminTabOrg } from "../../modules/admin/AdminTabOrg";
import { AdminTabArchives } from "../../modules/admin/AdminTabArchives";
import { AdminTabLegalCgv } from "../../modules/admin/AdminTabLegalCgv";
import "../../modules/finance/financial-pole.css";
import "../../modules/admin/admin-org-structure-visual.css";

type StructureTab = "roles" | "agencies" | "teams" | "org" | "legal" | "archives";

const TABS: { id: StructureTab; label: string }[] = [
  { id: "roles", label: "Rôles & permissions" },
  { id: "agencies", label: "Agences" },
  { id: "teams", label: "Équipes" },
  { id: "org", label: "Entreprise" },
  { id: "legal", label: "Documents légaux" },
  { id: "archives", label: "Archives" },
];

export default function OrganizationStructurePage() {
  const [activeTab, setActiveTab] = useState<StructureTab>("teams");

  return (
    <div className="qb-page fin-pole-shell sn-saas-page">
      <header className="fin-pole-list-hero sn-saas-hero">
        <div className="fin-pole-list-hero__text">
          <h1 className="sg-title">Équipes & entreprise</h1>
          <p className="fin-pole-lead">
            Rôles, agences, équipes et archives. L&apos;onglet <strong>Entreprise</strong> concentre identité, logo,
            couverture PDF, couleur documents et numérotation.
          </p>
        </div>
      </header>

      <SaasTabs<StructureTab>
        items={TABS}
        activeId={activeTab}
        onChange={setActiveTab}
        ariaLabel="Sections équipes et entreprise"
        className="org-structure-tabs-segmented"
      />

      <div className="sn-saas-surface org-structure-panel">
        {activeTab === "roles" && <AdminTabRoles />}
        {activeTab === "agencies" && <AdminTabAgencies />}
        {activeTab === "teams" && <AdminTabTeams />}
        {activeTab === "org" && <AdminTabOrg />}
        {activeTab === "legal" && <AdminTabLegalCgv />}
        {activeTab === "archives" && <AdminTabArchives />}
      </div>
    </div>
  );
}
