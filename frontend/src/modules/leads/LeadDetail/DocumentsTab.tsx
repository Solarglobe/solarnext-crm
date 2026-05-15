/**
 * CP-LEAD-V2 / P3 — Onglet Documents (hub métier sectionné)
 */

import DocumentUploader, { type Document } from "../../../components/DocumentUploader";

interface DocumentsTabProps {
  leadId: string;
  leadDocuments: Document[];
  clientId?: string;
  clientDocuments?: Document[];
  onRefresh: () => void;
}

export default function DocumentsTab({
  leadId,
  leadDocuments,
  clientId,
  clientDocuments = [],
  onRefresh,
}: DocumentsTabProps) {
  return (
    <section style={{ display: "grid", gap: 16 }}>
      {clientId ? (
        <div className="crm-lead-card">
          <div className="crm-lead-card-head">
            <h2 className="crm-lead-card-title">Documents client</h2>
            <p className="crm-lead-card-subtitle">
              Factures, devis et documents contractuels rattachés à l’entité client.
            </p>
          </div>
          <DocumentUploader
            entityType="client"
            entityId={clientId}
            documents={clientDocuments}
            onRefresh={onRefresh}
          />
        </div>
      ) : null}

      <div className="crm-lead-card">
        <div className="crm-lead-card-head">
          <h2 className="crm-lead-card-title">{clientId ? "Documents du lead" : "Documents"}</h2>
          <p className="crm-lead-card-subtitle">
            Devis, factures, propositions et pièces classées par nature — prêt pour l’espace client.
          </p>
        </div>
        <DocumentUploader
          entityType="lead"
          entityId={leadId}
          documents={leadDocuments}
          onRefresh={onRefresh}
        />
      </div>
    </section>
  );
}
