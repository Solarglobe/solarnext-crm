/**
 * CP-REFAC-004.1 — Utilisateurs (entreprise)
 */

import React from "react";
import { Card } from "../../components/ui/Card";
import { AdminTabUsers } from "../../modules/admin/AdminTabUsers";

export default function OrganizationUsersPage() {
  return (
    <div className="admin-page">
      <header className="admin-header" style={{ marginBottom: "var(--spacing-24)" }}>
        <h1 className="sg-title">Utilisateurs</h1>
        <p style={{ color: "var(--text-muted)", fontSize: "var(--font-size-body)", margin: "var(--spacing-8) 0 0" }}>
          Comptes, rôles et accès équipes
        </p>
      </header>
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
        <AdminTabUsers />
      </Card>
    </div>
  );
}
