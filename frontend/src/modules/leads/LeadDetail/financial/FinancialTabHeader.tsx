import React from "react";
import { Link } from "react-router-dom";
import { Button } from "../../../../components/ui/Button";

interface FinancialTabHeaderProps {
  onCreateQuote: () => void;
}

export default function FinancialTabHeader({ onCreateQuote }: FinancialTabHeaderProps) {
  return (
    <header className="fin-tab-header">
      <div className="fin-tab-header-text">
        <h2 className="fin-tab-header-title">Financier</h2>
        <p className="fin-tab-header-desc">Devis, facturation et suivi documentaire du dossier</p>
      </div>
      <div className="fin-tab-header-actions">
        <Link to="/finance" className="sn-btn sn-btn-ghost sn-btn-sm" style={{ textDecoration: "none" }}>
          Hub financier
        </Link>
        <Link to="/quotes" className="sn-btn sn-btn-ghost sn-btn-sm" style={{ textDecoration: "none" }}>
          Tous les devis
        </Link>
        <Button type="button" variant="primary" size="sm" onClick={onCreateQuote}>
          Créer un devis
        </Button>
      </div>
    </header>
  );
}
