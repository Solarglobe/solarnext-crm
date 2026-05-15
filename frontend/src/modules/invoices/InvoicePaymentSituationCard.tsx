/**
 * Carte centrale — situation de paiement (lisibilité comptable).
 */


function eur(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export interface InvoicePaymentSituationCardProps {
  draftMode: boolean;
  totalTtc: number;
  totalPaid: number;
  amountDue: number;
  dueDate: string | null;
  isOverdue: boolean;
  paymentCountActive: number;
  currency: string;
}

export default function InvoicePaymentSituationCard({
  draftMode,
  totalTtc,
  totalPaid,
  amountDue,
  dueDate,
  isOverdue,
  paymentCountActive,
  currency,
}: InvoicePaymentSituationCardProps) {
  return (
    <section className="ib-situation-card" aria-labelledby="ib-situation-title">
      <h2 id="ib-situation-title" className="ib-situation-card__title">
        Situation de paiement
      </h2>
      <p className="ib-situation-card__subtitle">
        Montants officiels après émission ; en brouillon, les totaux reflètent votre saisie en cours.
      </p>
      <div className="ib-situation-card__metrics">
        <div className="ib-situation-metric">
          <span className="ib-situation-metric__label">Montant TTC</span>
          <span className="ib-situation-metric__value">{eur(totalTtc)}</span>
          <span className="ib-situation-metric__hint">{currency}</span>
        </div>
        <div className="ib-situation-metric">
          <span className="ib-situation-metric__label">Encaissé</span>
          <span className="ib-situation-metric__value ib-situation-metric__value--muted">{eur(totalPaid)}</span>
        </div>
        <div className="ib-situation-metric ib-situation-metric--emph">
          <span className="ib-situation-metric__label">Reste à encaisser</span>
          <span
            className={`ib-situation-metric__value ${amountDue > 0.009 ? "ib-situation-metric__value--due" : "ib-situation-metric__value--ok"}`}
          >
            {eur(amountDue)}
          </span>
        </div>
        <div className="ib-situation-metric">
          <span className="ib-situation-metric__label">Échéance</span>
          <span className="ib-situation-metric__value">{dueDate || "—"}</span>
        </div>
        <div className="ib-situation-metric">
          <span className="ib-situation-metric__label">Retard</span>
          <span className={`ib-situation-metric__value ${isOverdue ? "ib-situation-metric__value--alert" : ""}`}>
            {isOverdue ? "Oui" : "Non"}
          </span>
        </div>
        <div className="ib-situation-metric">
          <span className="ib-situation-metric__label">Paiements enregistrés</span>
          <span className="ib-situation-metric__value">{paymentCountActive}</span>
        </div>
      </div>
      {draftMode ? (
        <p className="ib-situation-card__banner">
          <strong>Brouillon</strong> — émettez la facture pour figer les montants et activer les encaissements.
        </p>
      ) : null}
    </section>
  );
}
