import { useState, useEffect } from "react";
import { ModalShell } from "../../components/ui/ModalShell";
import { Button } from "../../components/ui/Button";
import { postCreditNoteDraftForInvoice, postIssueCreditNote } from "./invoice-financial.api";
import { VAT_OPTIONS } from "../quotes/quoteCalc";

function buildLineFromTtc(ttc: number, vatRate: number, motif: string) {
  const r = vatRate / 100;
  const unit_ht = Math.round((ttc / (1 + r)) * 100) / 100;
  return {
    label: "Avoir",
    description: motif.slice(0, 500),
    quantity: 1,
    unit_price_ht: unit_ht,
    discount_ht: 0,
    vat_rate: vatRate,
  };
}

export interface CreateCreditModalProps {
  open: boolean;
  invoiceId: string;
  maxTtc: number;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreateCreditModal({ open, invoiceId, maxTtc, onClose, onSuccess }: CreateCreditModalProps) {
  const [amountTtc, setAmountTtc] = useState("");
  const [vatRate, setVatRate] = useState(20);
  const [motif, setMotif] = useState("");
  const [issueNow, setIssueNow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setAmountTtc("");
    setVatRate(20);
    setMotif("");
    setIssueNow(false);
  }, [open]);

  const submit = async () => {
    const ttc = parseFloat(amountTtc.replace(",", "."));
    if (!Number.isFinite(ttc) || ttc <= 0) {
      setErr("Saisissez un montant TTC supérieur à 0.");
      return;
    }
    if (ttc > maxTtc + 0.01) {
      setErr(`Le montant ne peut pas dépasser le reste à payer (${maxTtc.toFixed(2)} € TTC).`);
      return;
    }
    if (!motif.trim()) {
      setErr("Indiquez un motif.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const lines = [buildLineFromTtc(ttc, vatRate, motif.trim())];
      const draft = await postCreditNoteDraftForInvoice(invoiceId, {
        lines,
        reason_text: motif.trim(),
      });
      const cnId = String((draft as { id?: string }).id || "");
      if (issueNow && cnId) {
        await postIssueCreditNote(cnId);
      }
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
      title="Créer un avoir"
      subtitle={`Montant disponible : ${maxTtc.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} € TTC`}
      size="sm"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="button" variant="primary" disabled={saving} onClick={() => void submit()}>
            {saving ? "Création…" : "Créer l'avoir"}
          </Button>
        </>
      }
    >
      <div className="if-modal-grid">
        {err ? <p className="qb-error-inline">{err}</p> : null}
        <label>
          Montant TTC (€)
          <input className="sn-input" type="number" min={0} step={0.01} value={amountTtc} onChange={(e) => setAmountTtc(e.target.value)} />
        </label>
        <label>
          Motif
          <textarea className="sn-input" rows={3} value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Ex. geste commercial, correction de facture..." />
        </label>
        <details className="if-modal-advanced">
          <summary>Options avancées</summary>
          <label>
            TVA
            <select className="sn-input" value={vatRate} onChange={(e) => setVatRate(parseFloat(e.target.value))}>
              {VAT_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v} %
                </option>
              ))}
            </select>
          </label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={issueNow} onChange={(e) => setIssueNow(e.target.checked)} />
            <span>Émettre maintenant</span>
          </label>
        </details>
      </div>
    </ModalShell>
  );
}
