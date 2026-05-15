/**
 * Bloc unique « Conditions commerciales » : acompte + validité.
 * Remise commerciale : ligne au PU HT négatif (tableau des lignes).
 */

import QuoteDepositSection from "./QuoteDepositSection";
import type { QuoteDeposit } from "./quote.types";
import LocaleNumberInput from "./LocaleNumberInput";

export interface QuoteCommercialSectionProps {
  canEdit: boolean;
  deposit: QuoteDeposit;
  onDepositChange: (patch: Partial<QuoteDeposit>) => void;
  validityDays: number;
  onValidityDaysChange: (n: number) => void;
}

export default function QuoteCommercialSection({
  canEdit,
  deposit,
  onDepositChange,
  validityDays,
  onValidityDaysChange,
}: QuoteCommercialSectionProps) {
  return (
    <div className="qb-commercial-inner">
      <QuoteDepositSection canEdit={canEdit} deposit={deposit} onChange={onDepositChange} />
      <div className="qb-commercial-grid">
        <label className="qb-field" style={{ gridColumn: "1 / -1" }}>
          <span>Validité du devis (jours)</span>
          <LocaleNumberInput
            className="sn-input qb-field-input"
            min={1}
            max={3650}
            disabled={!canEdit}
            integer
            value={validityDays}
            onChange={onValidityDaysChange}
            emptyCommitValue={30}
            aria-label="Validité du devis en jours"
          />
        </label>
        <p className="qb-section-hint" style={{ gridColumn: "1 / -1", margin: 0 }}>
          Remise sur le montant du devis : ajoutez une ligne libre avec un prix unitaire HT négatif (ex. remise
          commerciale).
        </p>
      </div>
    </div>
  );
}
