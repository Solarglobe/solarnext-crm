import { Button } from "../../components/ui/Button";

export interface InvoiceNotesProps {
  canEdit: boolean;
  notes: string;
  paymentTerms: string;
  issueDate: string | null;
  dueDate: string | null;
  onChange: (field: "notes" | "payment_terms" | "issue_date" | "due_date", value: string) => void;
  onDuePreset: (days: number) => void;
}

export default function InvoiceNotes({
  canEdit,
  notes,
  paymentTerms,
  issueDate,
  dueDate,
  onChange,
  onDuePreset,
}: InvoiceNotesProps) {
  return (
    <section className="qb-section ib-notes-section">
      <div className="ib-notes-grid">
        <div className="ib-notes-col">
          <h3 className="ib-subtitle">Dates</h3>
          <div className="ib-date-row">
            <label className="ib-label">
              Date d&apos;émission
              <input
                className="sn-input ib-input-full"
                type="date"
                disabled={!canEdit}
                value={issueDate || ""}
                onChange={(e) => onChange("issue_date", e.target.value)}
              />
            </label>
            <label className="ib-label">
              Date d&apos;échéance
              <input
                className="sn-input ib-input-full"
                type="date"
                disabled={!canEdit}
                value={dueDate || ""}
                onChange={(e) => onChange("due_date", e.target.value)}
              />
            </label>
          </div>
          {canEdit ? (
            <div className="ib-due-presets">
              <span className="ib-muted">Raccourcis échéance :</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => onDuePreset(0)}>
                Comptant
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => onDuePreset(30)}>
                30 j
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => onDuePreset(45)}>
                45 j
              </Button>
            </div>
          ) : null}
        </div>
        <div className="ib-notes-col">
          <h3 className="ib-subtitle">Notes (visibles document)</h3>
          <textarea
            className="sn-input ib-textarea"
            rows={3}
            disabled={!canEdit}
            value={notes}
            onChange={(e) => onChange("notes", e.target.value)}
            placeholder="Mention complémentaire, référence dossier…"
          />
        </div>
        <div className="ib-notes-col">
          <h3 className="ib-subtitle">Conditions de règlement</h3>
          <textarea
            className="sn-input ib-textarea"
            rows={4}
            disabled={!canEdit}
            value={paymentTerms}
            onChange={(e) => onChange("payment_terms", e.target.value)}
            placeholder="Pénalités de retard, IBAN, délais, mentions légales…"
          />
        </div>
      </div>
    </section>
  );
}
