import type { QuoteDeposit, QuoteDepositType } from "./quote.types";
import LocaleNumberInput from "./LocaleNumberInput";

export interface QuoteDepositSectionProps {
  canEdit: boolean;
  deposit: QuoteDeposit;
  onChange: (patch: Partial<QuoteDeposit>) => void;
}

export default function QuoteDepositSection({ canEdit, deposit, onChange }: QuoteDepositSectionProps) {
  const setType = (type: QuoteDepositType) => {
    onChange({ type, value: type === deposit.type ? deposit.value : 0 });
  };

  return (
    <section className="qb-deposit-block" aria-labelledby="qb-deposit-title">
      <p id="qb-deposit-title" className="qb-subsection-title">
        Acompte
      </p>
      <div className="qb-notes-grid">
        <label className="qb-field">
          <span>Mode</span>
          <select
            className="sn-input qb-field-input"
            disabled={!canEdit}
            value={deposit.type}
            onChange={(e) => setType(e.target.value as QuoteDepositType)}
          >
            <option value="PERCENT">Pourcentage du total TTC</option>
            <option value="AMOUNT">Montant TTC fixe (€)</option>
          </select>
        </label>
        <label className="qb-field">
          <span>{deposit.type === "PERCENT" ? "Valeur (%)" : "Montant (€ TTC)"}</span>
          <LocaleNumberInput
            className="sn-input qb-field-input"
            min={0}
            max={deposit.type === "PERCENT" ? 100 : undefined}
            disabled={!canEdit}
            value={Number.isFinite(deposit.value) ? deposit.value : 0}
            onChange={(n) => onChange({ value: n })}
            minimumFractionDigits={deposit.type === "PERCENT" ? 0 : 2}
            maximumFractionDigits={deposit.type === "PERCENT" ? 2 : 2}
            aria-label={deposit.type === "PERCENT" ? "Acompte en pourcent" : "Acompte montant TTC"}
          />
        </label>
      </div>
      <label className="qb-field qb-field--block">
        <span>Note (optionnel)</span>
        <input
          className="sn-input qb-field-input"
          type="text"
          maxLength={500}
          disabled={!canEdit}
          value={deposit.note ?? ""}
          onChange={(e) => onChange({ note: e.target.value })}
          placeholder="Ex. à la commande, à la livraison…"
        />
      </label>
    </section>
  );
}
