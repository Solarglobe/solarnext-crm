/**
 * Modal envoi email groupé (segment leads — opt-in + email)
 */

import { useEffect, useState, useCallback } from "react";
import { ModalShell } from "../ui/ModalShell";
import { Button } from "../ui/Button";
import {
  buildBulkFiltersPayload,
  postBulkSendPreview,
  postBulkSend,
} from "../../services/mailBulk.service";
import type { LeadsFilters } from "../../services/leads.service";

type Props = {
  open: boolean;
  onClose: () => void;
  filters: LeadsFilters;
  /** Si non vide : envoi limité à ces dossiers (sinon segment = filtres courants). */
  selectedLeadIds?: string[] | null;
};

export function BulkEmailModal({ open, onClose, filters, selectedLeadIds }: Props) {
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const [countError, setCountError] = useState<string | null>(null);

  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    queued: number;
    errors?: { email: string; message: string }[];
  } | null>(null);

  const refreshCount = useCallback(async () => {
    setCountLoading(true);
    setCountError(null);
    try {
      const payload = buildBulkFiltersPayload(filters, selectedLeadIds);
      const { count } = await postBulkSendPreview(payload);
      setRecipientCount(count);
    } catch (e) {
      setRecipientCount(null);
      setCountError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setCountLoading(false);
    }
  }, [filters, selectedLeadIds]);

  useEffect(() => {
    if (!open) return;
    setSuccess(null);
    setSendError(null);
    setSubject("");
    setHtml("");
    void refreshCount();
  }, [open, refreshCount]);

  const handleSend = async () => {
    const sub = subject.trim();
    const body = html.trim();
    if (!sub || !body) {
      setSendError("Renseignez l’objet et le contenu.");
      return;
    }
    const n = recipientCount ?? 0;
    if (n === 0) {
      setSendError("Aucun destinataire pour ce segment.");
      return;
    }
    if (
      !window.confirm(
        `Envoyer cet email à ${n} destinataire${n > 1 ? "s" : ""} (opt-in marketing, e-mail renseigné) ? Les messages seront mis en file d’attente d’envoi.`
      )
    ) {
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      const payload = buildBulkFiltersPayload(filters, selectedLeadIds);
      const result = await postBulkSend({
        filters: payload,
        subject: sub,
        html: body,
      });
      setSuccess({ queued: result.queued, errors: result.errors });
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Erreur d’envoi");
    } finally {
      setSending(false);
    }
  };

  const footer = success ? (
    <Button type="button" variant="primary" onClick={onClose}>
      Fermer
    </Button>
  ) : (
    <>
      <Button type="button" variant="ghost" onClick={onClose} disabled={sending}>
        Annuler
      </Button>
      <Button
        type="button"
        variant="primary"
        onClick={() => void handleSend()}
        disabled={sending || countLoading || (recipientCount ?? 0) === 0}
      >
        {sending ? "Envoi…" : "Envoyer"}
      </Button>
    </>
  );

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Envoyer un email au segment"
      subtitle="Maximum 200 envois par lot. Adresse e-mail requise."
      size="lg"
      footer={footer}
    >
      {success ? (
        <div className="sn-bulk-email-success" role="status">
          <p>
            <strong>{success.queued}</strong> message{success.queued !== 1 ? "s" : ""} mis en file d’attente
            d’envoi. Vous pouvez suivre l’état dans Mail → File d’attente.
          </p>
          {success.errors && success.errors.length > 0 ? (
            <p className="sn-leads-page__error" style={{ marginTop: 10 }}>
              {success.errors.length} envoi{success.errors.length !== 1 ? "s" : ""} en erreur (ex.{" "}
              {success.errors[0]?.email}).
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <div className="sn-bulk-email-meta">
            <p className="sn-bulk-email-optin-hint" role="note">
              Seuls les contacts avec opt-in marketing seront inclus.
            </p>
            {countLoading ? (
              <p>Calcul des destinataires…</p>
            ) : countError ? (
              <p className="sn-leads-page__error" role="alert">
                {countError}
              </p>
            ) : (
              <p role="status">
                <strong>{recipientCount ?? 0}</strong> destinataire
                {(recipientCount ?? 0) !== 1 ? "s" : ""} au total
                {(recipientCount ?? 0) >= 200 ? " (plafond 200 appliqué)" : ""}
              </p>
            )}
            <button type="button" className="sn-btn sn-btn-ghost sn-btn-sm" onClick={() => void refreshCount()}>
              Actualiser le nombre
            </button>
          </div>

          <label className="sn-filter-label" htmlFor="sn-bulk-email-subject" style={{ marginTop: 12 }}>
            Objet
          </label>
          <div className="sn-filter-control" style={{ marginBottom: 12 }}>
            <input
              id="sn-bulk-email-subject"
              type="text"
              className="sn-input"
              style={{ width: "100%" }}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Objet du message"
              autoComplete="off"
            />
          </div>

          <label className="sn-filter-label" htmlFor="sn-bulk-email-body">
            Contenu (HTML simple accepté)
          </label>
          <textarea
            id="sn-bulk-email-body"
            className="sn-input"
            style={{ width: "100%", minHeight: 200, resize: "vertical", boxSizing: "border-box" }}
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            placeholder="<p>Bonjour …</p>"
          />

          {sendError ? (
            <p className="sn-leads-page__error" role="alert" style={{ marginTop: 8 }}>
              {sendError}
            </p>
          ) : null}
        </>
      )}
    </ModalShell>
  );
}
