/**
 * CP-LEAD-V2 / P3 — Onglet Documents (hub métier sectionné)
 */

import React from "react";
import DocumentUploader, { type Document } from "../../../components/DocumentUploader";

interface DocumentsTabProps {
  entityId: string;
  documents: Document[];
  onRefresh: () => void;
}

export default function DocumentsTab({ entityId, documents, onRefresh }: DocumentsTabProps) {
  return (
    <section className="crm-lead-card">
      <div className="crm-lead-card-head">
        <h2 className="crm-lead-card-title">Documents</h2>
        <p className="crm-lead-card-subtitle" style={{ margin: "6px 0 0", color: "#6b5530", fontSize: "0.9rem" }}>
          Devis, factures, propositions et pièces classées par nature — prêt pour l’espace client.
        </p>
      </div>
      <DocumentUploader
        entityType="lead"
        entityId={entityId}
        documents={documents}
        onRefresh={onRefresh}
      />
    </section>
  );
}
