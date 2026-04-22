/**
 * Bloc unique « Conditions commerciales » : acompte + validité + remise document (% + € HT).
 */

import React from "react";
import QuoteDepositSection from "./QuoteDepositSection";
import type { QuoteDeposit } from "./quote.types";
import LocaleNumberInput from "./LocaleNumberInput";

export interface QuoteCommercialSectionProps {
  canEdit: boolean;
  deposit: QuoteDeposit;
  onDepositChange: (patch: Partial<QuoteDeposit>) => void;
  validityDays: number;
  globalDiscountPercent: number;
  globalDiscountAmountHt: number;
  onValidityDaysChange: (n: number) => void;
  onGlobalDiscountPercentChange: (n: number) => void;
  onGlobalDiscountAmountHtChange: (n: number) => void;
}

export default function QuoteCommercialSection({
  canEdit,
  deposit,
  onDepositChange,
  validityDays,
  globalDiscountPercent,
  globalDiscountAmountHt,
  onValidityDaysChange,
  onGlobalDiscountPercentChange,
  onGlobalDiscountAmountHtChange,
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
        <label className="qb-field">
          <span>Remise sur le document (HT, %)</span>
          <LocaleNumberInput
            className="sn-input qb-field-input"
            min={0}
            max={100}
            disabled={!canEdit}
            value={globalDiscountPercent}
            onChange={onGlobalDiscountPercentChange}
            maximumFractionDigits={2}
            aria-label="Remise globale sur le document en pourcent"
          />
        </label>
        <label className="qb-field">
          <span>Remise fixe sur le document (€ HT)</span>
          <LocaleNumberInput
            className="sn-input qb-field-input"
            min={0}
            disabled={!canEdit}
            value={globalDiscountAmountHt}
            onChange={onGlobalDiscountAmountHtChange}
            minimumFractionDigits={2}
            maximumFractionDigits={2}
            aria-label="Remise globale sur le document en euros hors taxes"
          />
        </label>
      </div>
    </div>
  );
}
