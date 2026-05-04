import React, { useMemo, useState } from "react";
import type { InvoiceReminderApi } from "./invoice-financial.types";
import SendReminderModal from "./SendReminderModal";
import { Button } from "../../components/ui/Button";

function fmtDt(d: string) {
  try {
    return new Date(d).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return d;
  }
}

function channelLabel(ch: string): string {
  const u = String(ch).toUpperCase();
  const m: Record<string, string> = {
    EMAIL: "E-mail",
    PHONE: "Téléphone",
    LETTER: "Courrier",
    OTHER: "Manuel / autre",
  };
  return m[u] || ch;
}

export interface InvoiceRemindersPanelProps {
  invoiceId: string;
  reminders: InvoiceReminderApi[];
  canRelaunch: boolean;
  relaunchDisabledReason?: string | null;
  onRefresh: () => void;
}

export default function InvoiceRemindersPanel({
  invoiceId,
  reminders,
  canRelaunch,
  relaunchDisabledReason,
  onRefresh,
}: InvoiceRemindersPanelProps) {
  const [open, setOpen] = useState(false);

  const summary = useMemo(() => {
    if (!reminders.length) return "Aucune relance enregistrée";
    const sorted = [...reminders].sort((a, b) => new Date(b.reminded_at).getTime() - new Date(a.reminded_at).getTime());
    const last = sorted[0];
    const n = reminders.length;
    if (n === 1) return `1 relance · dernière le ${fmtDt(last.reminded_at)}`;
    return `${n} relances · dernière le ${fmtDt(last.reminded_at)}`;
  }, [reminders]);

  return (
    <div className="if-panel">
      <div className="if-panel-head">
        <h3 className="if-panel-title">Relances</h3>
        <Button type="button" variant="outlineGold" size="sm" disabled={!canRelaunch} onClick={() => setOpen(true)}>
          Relancer
        </Button>
      </div>
      {relaunchDisabledReason && !canRelaunch ? <p className="if-panel-sub">{relaunchDisabledReason}</p> : null}
      <p className="if-panel-sub" style={{ marginTop: 0 }}>
        <strong>{summary}</strong>
      </p>
      <div className="if-panel-body">
        {reminders.length === 0 ? (
          <p className="if-muted">Historique vide.</p>
        ) : (
          <table className="sn-ui-table if-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Canal</th>
                <th>Note</th>
                <th>Suivi</th>
              </tr>
            </thead>
            <tbody>
              {reminders.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDt(r.reminded_at)}</td>
                  <td>{channelLabel(r.channel)}</td>
                  <td className="if-muted">{r.note || "—"}</td>
                  <td className="if-muted">{r.next_action_at ? fmtDt(r.next_action_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <SendReminderModal open={open} invoiceId={invoiceId} onClose={() => setOpen(false)} onSuccess={onRefresh} />
    </div>
  );
}
