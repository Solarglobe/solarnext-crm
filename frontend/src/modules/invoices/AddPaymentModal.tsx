import React, { useState, useEffect } from "react";
import { ModalShell } from "../../components/ui/ModalShell";
import { Button } from "../../components/ui/Button";
import { postInvoicePayment } from "./invoice-financial.api";

const METHOD_OPTIONS = [
  { value: "Virement", label: "Virement" },
  { value: "Carte bancaire", label: "Carte" },
  { value: "Chèque", label: "Chèque" },
  { value: "Espèces", label: "Espèces" },
  { value: "Autre", label: "Autre" },
];

export interface AddPaymentModalProps {
  open: boolean;
  invoiceId: string;
  maxAmount: number;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddPaymentModal({ open, invoiceId, maxAmount, onClose, onSuccess }: AddPaymentModalProps) {
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("Virement");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setAmount("");
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setMethod("Virement");
    setReference("");
    setNotes("");
  }, [open]);

  const submit = async () => {
    const amt = parseFloat(amount.replace(",", "."));
    if (!Number.isFinite(amt) || amt <= 0) {
      setErr("Montant invalide");
      return;
    }
    if (amt > maxAmount + 0.0001) {
      setErr(`Le montant ne peut pas dépasser le reste à payer (${maxAmount.toFixed(2)} €).`);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await postInvoicePayment(invoiceId, {
        amount: amt,
        payment_date: paymentDate,
        payment_method: method,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onSuccess();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Ajouter un paiement"
      subtitle={`Reste encaissable au plus : ${maxAmount.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €`}
      size="sm"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="button" variant="primary" disabled={saving} onClick={() => void submit()}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </>
      }
    >
      <div className="if-modal-grid">
        {err ? <p className="qb-error-inline">{err}</p> : null}
        <label>
          Montant (€)
          <input className="sn-input" type="number" min={0} step={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label>
          Date de paiement
          <input className="sn-input" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
        </label>
        <label>
          Méthode
          <select className="sn-input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHOD_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Référence (optionnel)
          <input className="sn-input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="N° transaction, chèque…" />
        </label>
        <label>
          Note interne (optionnel)
          <textarea className="sn-input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
    </ModalShell>
  );
}
