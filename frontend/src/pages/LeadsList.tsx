import React from "react";
import { Card } from "../components/ui/Card";

export default function LeadsList() {
  return (
    <Card style={{ padding: "var(--spacing-24)" }}>
      <h1 style={{ fontSize: "var(--font-size-title-lg)", fontWeight: 700, marginBottom: "var(--spacing-16)" }}>
        Leads
      </h1>
      <p style={{ color: "var(--text-muted)", fontSize: "var(--font-size-body)" }}>
        Liste des leads — à migrer
      </p>
    </Card>
  );
}
