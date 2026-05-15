import { useState, useEffect } from "react";
import { ModalShell } from "../../components/ui/ModalShell";
import { Button } from "../../components/ui/Button";
import { postInvoiceReminder } from "./invoice-financial.api";
import type { ReminderChannelApi } from "./invoice-financial.types";

const CHANNELS: { value: ReminderChannelApi; label: string }[] = [
  { value: "EMAIL", label: "E-mail" },
  { value: "PHONE", label: "Téléphone" },
  { value: "LETTER", label: "Courrier" },
  { value: "OTHER", label: "Manuel / SMS / autre" },
];

export interface SendReminderModalProps {
  open: boolean;
  invoiceId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function SendReminderModal({ open, invoiceId, onClose, onSuccess }: SendReminderModalProps) {
  const [channel, setChannel] = useState<ReminderChannelApi>("EMAIL");
  const [remindedAt, setRemindedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [note, setNote] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setChannel("EMAIL");
    setRemindedAt(new Date().toISOString().slice(0, 16));
    setNote("");
    setNextAction("");
  }, [open]);

  const submit = async () => {
    setSaving(true);
    setErr(null);
    try {
      const iso = remindedAt ? new Date(remindedAt).toISOString() : undefined;
      let nextIso: string | null = null;
      if (nextAction.trim()) {
        const d = new Date(nextAction);
        if (!Number.isNaN(d.getTime())) nextIso = d.toISOString();
      }
      await postInvoiceReminder(invoiceId, {
        reminded_at: iso,
        channel,
        note: note.trim() || undefined,
        next_action_at: nextIso,
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
      title="Enregistrer une relance"
      subtitle="Journal interne — pas d’envoi e-mail automatisé pour l’instant."
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
          Canal
          <select className="sn-input" value={channel} onChange={(e) => setChannel(e.target.value as ReminderChannelApi)}>
            {CHANNELS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date / heure
          <input className="sn-input" type="datetime-local" value={remindedAt} onChange={(e) => setRemindedAt(e.target.value)} />
        </label>
        <label>
          Note
          <textarea className="sn-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Contenu ou rappel…" />
        </label>
        <label>
          Prochaine action (optionnel)
          <input className="sn-input" type="datetime-local" value={nextAction} onChange={(e) => setNextAction(e.target.value)} />
        </label>
      </div>
    </ModalShell>
  );
}
