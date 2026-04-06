/**
 * CP-REFAC-004.1 — Équipes & entreprise (rôles, agences, équipes, org, archives)
 */

import React, { useState } from "react";
import { Card } from "../../components/ui/Card";
import { AdminTabRoles } from "../../modules/admin/AdminTabRoles";
import { AdminTabAgencies } from "../../modules/admin/AdminTabAgencies";
import { AdminTabTeams } from "../../modules/admin/AdminTabTeams";
import { AdminTabOrg } from "../../modules/admin/AdminTabOrg";
import { AdminTabArchives } from "../../modules/admin/AdminTabArchives";

type StructureTab = "roles" | "agencies" | "teams" | "org" | "archives";

const TABS: { id: StructureTab; label: string }[] = [
  { id: "roles", label: "Rôles & permissions" },
  { id: "agencies", label: "Agences" },
  { id: "teams", label: "Équipes" },
  { id: "org", label: "Entreprise" },
  { id: "archives", label: "Archives" },
];

const tabBtnStyle: React.CSSProperties = {
  padding: "var(--spacing-8) var(--spacing-16)",
  borderRadius: "var(--radius-btn)",
  border: "1px solid transparent",
  fontWeight: 500,
  cursor: "pointer",
  transition: "all var(--ease)",
};

export default function OrganizationStructurePage() {
  const [activeTab, setActiveTab] = useState<StructureTab>("teams");

  return (
    <div className="admin-page">
      <header className="admin-header" style={{ marginBottom: "var(--spacing-24)" }}>
        <h1 className="sg-title">Équipes & entreprise</h1>
        <p style={{ color: "var(--text-muted)", fontSize: "var(--font-size-body)", margin: "var(--spacing-8) 0 0", maxWidth: 720 }}>
          Structure de l&apos;entreprise : rôles, agences, équipes, paramètres et archives.
        </p>
      </header>

      <div
        className="admin-tabs"
        style={{
          display: "flex",
          gap: "var(--spacing-4)",
          marginBottom: "var(--spacing-24)",
          flexWrap: "wrap",
          borderBottom: "1px solid var(--sn-border-soft)",
          paddingBottom: "var(--spacing-8)",
        }}
      >
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`admin-tab-btn ${activeTab === id ? "admin-tab-active" : ""}`}
            style={{
              ...tabBtnStyle,
              background: activeTab === id ? "rgba(124, 58, 237, 0.15)" : "transparent",
              color: activeTab === id ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <Card
        variant="premium"
        padding="lg"
        className="sn-card-premium admin-card"
        style={{
          background: "var(--surface-card)",
          border: "1px solid var(--border-soft)",
          borderRadius: "var(--radius-16)",
          backdropFilter: "blur(14px)",
        }}
      >
        {activeTab === "roles" && <AdminTabRoles />}
        {activeTab === "agencies" && <AdminTabAgencies />}
        {activeTab === "teams" && <AdminTabTeams />}
        {activeTab === "org" && <AdminTabOrg />}
        {activeTab === "archives" && <AdminTabArchives />}
      </Card>
    </div>
  );
}
