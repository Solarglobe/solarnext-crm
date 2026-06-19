import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";

export interface InvoiceNotesProps {
  canEdit: boolean;
  notes: string;
  paymentTerms: string;
  issueDate: string | null;
  dueDate: string | null;
  /** Total TTC de la facture — sert à pré-remplir le montant de déblocage. */
  invoiceTotalTtc?: number;
  onChange: (field: "notes" | "payment_terms" | "issue_date" | "due_date", value: string) => void;
  onDuePreset: (days: number) => void;
}

const RELEASE_PREFIX = "Bon pour déblocage de la somme de";

/** Retire toute ligne de mention de déblocage existante. */
function stripReleaseMention(text: string): string {
  return (text || "")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith(RELEASE_PREFIX))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatEur(amount: number): string {
  return amount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Construit la ligne de mention exigée par la banque pour le déblocage des fonds. */
function buildReleaseLine(amount: number): string {
  const amt = Number.isFinite(amount) && amount > 0 ? `${formatEur(amount)} €` : "……… €";
  return `${RELEASE_PREFIX} ${amt} (financement par crédit affecté). Règlement à effectuer sur le RIB ci-dessous.`;
}

function withReleaseMention(text: string, amount: number): string {
  const base = stripReleaseMention(text);
  const line = buildReleaseLine(amount);
  return base ? `${base}\n${line}` : line;
}

export default function InvoiceNotes({
  canEdit,
  notes,
  paymentTerms,
  issueDate,
  dueDate,
  invoiceTotalTtc,
  onChange,
  onDuePreset,
}: InvoiceNotesProps) {
  const releaseActive = (notes || "").split(/\r?\n/).some((l) => l.trim().startsWith(RELEASE_PREFIX));
  const [amountInput, setAmountInput] = useState<string>("");

  // Pré-remplit le montant avec le total TTC dès qu'il est connu (tant que l'utilisateur n'a rien saisi).
  useEffect(() => {
    if (!amountInput && invoiceTotalTtc && invoiceTotalTtc > 0) {
      setAmountInput(invoiceTotalTtc.toFixed(2));
    }
  }, [invoiceTotalTtc, amountInput]);

  const parseAmount = (s: string): number => {
    const n = parseFloat(String(s).replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };

  const toggleRelease = (checked: boolean) => {
    if (!canEdit) return;
    if (checked) onChange("notes", withReleaseMention(notes, parseAmount(amountInput)));
    else onChange("notes", stripReleaseMention(notes));
  };

  const onAmountChange = (value: string) => {
    setAmountInput(value);
    if (releaseActive) onChange("notes", withReleaseMention(notes, parseAmount(value)));
  };

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
          <h3 className="ib-subtitle">Note client</h3>
          <textarea
            className="sn-input ib-textarea"
            rows={3}
            disabled={!canEdit}
            value={notes}
            onChange={(e) => onChange("notes", e.target.value)}
            placeholder="Ex. référence dossier, précision utile au client..."
          />
          <div className="ib-release">
            <label className="ib-release-toggle">
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={releaseActive}
                onChange={(e) => toggleRelease(e.target.checked)}
              />
              <span>Déblocage de crédit (mention banque)</span>
            </label>
            <label className="ib-release-amount">
              Montant à débloquer
              <input
                className="sn-input"
                type="text"
                inputMode="decimal"
                disabled={!canEdit}
                value={amountInput}
                onChange={(e) => onAmountChange(e.target.value)}
                placeholder="ex. 14 500,00"
              />
              <span className="ib-release-unit">€</span>
            </label>
            <p className="ib-release-hint">
              Coche la case pour ajouter « {RELEASE_PREFIX} … € » à la note. Le RIB s&apos;affiche déjà sur la facture.
              La mention manuscrite et la signature du client restent à apposer sur l&apos;exemplaire envoyé à la banque.
            </p>
          </div>
        </div>
        <details className="ib-notes-col ib-form-advanced">
          <summary>Conditions de règlement</summary>
          <textarea
            className="sn-input ib-textarea"
            rows={4}
            disabled={!canEdit}
            value={paymentTerms}
            onChange={(e) => onChange("payment_terms", e.target.value)}
            placeholder="Ex. délai de règlement, IBAN, pénalités de retard..."
          />
        </details>
      </div>
    </section>
  );
}
