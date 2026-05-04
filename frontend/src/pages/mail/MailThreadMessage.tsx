import React, { useEffect, useMemo, useState } from "react";
import type { MailMessageAttachment, ThreadMessage } from "../../services/mailApi";
import { fetchDocumentBlob, resolveAttachmentDocumentId } from "../../services/mailApi";
import { sanitizeMailHtml } from "./sanitizeMailHtml";
import { formatAttachmentSize, formatViewerMessageDate, isImageMime } from "./mailThreadFormat";

function avatarLetter(label: string): string {
  const c = label.trim().charAt(0);
  return c ? c.toUpperCase() : "?";
}

function getMessageSenderLabel(message: ThreadMessage): string {
  if (message.direction === "OUTBOUND") return "Vous";
  const from = message.participants.find((p) => p.type === "FROM");
  const name = from?.name?.trim();
  if (name) return name;
  if (from?.email) return from.email;
  return "Expéditeur";
}

function outboundDeliveryBadge(m: ThreadMessage): React.ReactNode {
  if (m.direction !== "OUTBOUND") return null;
  const st = m.outbox?.status?.toLowerCase();
  const msgSt = m.status?.toUpperCase();
  if (st === "sent" || msgSt === "SENT") return null;

  if (st === "queued" || msgSt === "QUEUED") {
    return (
      <span className="sn-badge sn-badge-neutral" title="En file d’envoi">
        En attente
      </span>
    );
  }
  if (st === "sending" || msgSt === "SENDING") {
    return (
      <span className="sn-badge sn-badge-info" title="Envoi SMTP en cours">
        Envoi en cours
      </span>
    );
  }
  if (st === "retrying") {
    const when = m.outbox?.nextAttemptAt
      ? `Prochain essai : ${new Date(m.outbox.nextAttemptAt).toLocaleString("fr-FR")}`
      : "Relance automatique prévue";
    return (
      <span className="sn-badge sn-badge-warn" title={when}>
        Relance prévue
      </span>
    );
  }
  if (st === "failed" || msgSt === "FAILED") {
    const err = m.outbox?.lastError?.trim();
    return (
      <span className="sn-badge sn-badge-danger" title={err || "Échec d’envoi"}>
        Échec envoi
      </span>
    );
  }
  if (st === "cancelled") {
    return (
      <span className="sn-badge sn-badge-neutral" title="Envoi annulé">
        Annulé
      </span>
    );
  }
  return null;
}

function IconFile() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

const AttachmentImagePreview = React.memo(function AttachmentImagePreview({
  documentId,
  name,
  mimeType,
}: {
  documentId: string;
  name: string;
  mimeType: string | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const blob = await fetchDocumentBlob(documentId);
        if (cancelled) return;
        const u = URL.createObjectURL(blob);
        revoked = u;
        setUrl(u);
      } catch {
        if (!cancelled) setErr(true);
      }
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [documentId]);

  if (err || !url) {
    return (
      <button type="button" className="mail-att mail-att--img-fallback" disabled={!err}>
        {err ? "Image indisponible" : "Chargement…"}
      </button>
    );
  }

  return (
    <a
      className="mail-att mail-att--img"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      download={name}
      title={name}
    >
      <img src={url} alt={name || "Pièce jointe"} className="mail-att__img" />
      {!isImageMime(mimeType) && <span className="mail-att__img-cap">{name}</span>}
    </a>
  );
});

const AttachmentRow = React.memo(function AttachmentRow({
  att,
  onOpenDocument,
}: {
  att: MailMessageAttachment;
  onOpenDocument: (documentId: string, fileName: string) => void;
}) {
  const docId = resolveAttachmentDocumentId(att);
  const name = att.document?.fileName ?? att.fileName ?? "Fichier";
  const mime = att.document?.mimeType ?? att.mimeType;
  const size = formatAttachmentSize(att.document?.fileSize ?? att.sizeBytes ?? null);
  const isImg = isImageMime(mime);

  if (docId && isImg) {
    return <AttachmentImagePreview documentId={docId} name={name} mimeType={mime} />;
  }

  return (
    <button
      type="button"
      className="mail-att mail-att--file"
      disabled={!docId}
      title={docId ? "Ouvrir le fichier" : "Document non lié"}
      onClick={() => docId && onOpenDocument(docId, name)}
    >
      <span className="mail-att__icon" aria-hidden>
        <IconFile />
      </span>
      <span className="mail-att__meta">
        <span className="mail-att__name">{name}</span>
        {size ? <span className="mail-att__size">{size}</span> : null}
      </span>
    </button>
  );
});

export interface MailThreadMessageProps {
  message: ThreadMessage;
  showSubject: boolean;
  onOpenDocument: (documentId: string, fileName: string) => void;
}

export const MailThreadMessage = React.memo(function MailThreadMessage({
  message: m,
  showSubject,
  onOpenDocument,
}: MailThreadMessageProps) {
  const outbound = m.direction === "OUTBOUND";
  const label = getMessageSenderLabel(m);
  const letter = avatarLetter(label);

  const sanitizedHtml = useMemo(() => {
    const raw = m.bodyHtml?.trim();
    if (!raw) return null;
    return sanitizeMailHtml(raw);
  }, [m.bodyHtml]);

  const atts = m.attachments?.length ? m.attachments : [];

  return (
    <article className={`mail-msg mail-msg--${outbound ? "out" : "in"}`} data-message-id={m.id}>
      <div className="mail-msg__inner">
        <div className="mail-msg__avatar" aria-hidden>
          {letter}
        </div>
        <div className="mail-msg__col">
          <header className="mail-msg__head">
            <span className="mail-msg__who">{label}</span>
            <time className="mail-msg__when" dateTime={m.sentAt || undefined}>
              {formatViewerMessageDate(m.sentAt)}
            </time>
            {outbound && outboundDeliveryBadge(m)}
            {outbound && m.openedAt && (
              <span className="sn-badge sn-badge-success" title={`Ouvert le ${new Date(m.openedAt).toLocaleString("fr-FR")}`}>
                Ouvert
              </span>
            )}
            {outbound && m.clickedAt && (
              <span className="sn-badge sn-badge-info" title={`Lien cliqué le ${new Date(m.clickedAt).toLocaleString("fr-FR")}`}>
                Cliqué
              </span>
            )}
            {!outbound && (
              <span
                className={m.isRead ? "sn-badge sn-badge-neutral" : "sn-badge sn-badge-warn"}
                title="Message entrant"
              >
                {m.isRead ? "Lu" : "Non lu"}
              </span>
            )}
          </header>
          {showSubject && m.subject ? <p className="mail-msg__subject-line">{m.subject}</p> : null}
          <div className={`mail-msg__bubble mail-msg__bubble--${outbound ? "out" : "in"}`}>
            {sanitizedHtml ? (
              <div className="mail-msg__html" dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />
            ) : m.bodyText?.trim() ? (
              <div className="mail-msg__text">{m.bodyText}</div>
            ) : (
              <p className="mail-msg__empty">(Aucun contenu)</p>
            )}
          </div>
          {atts.length > 0 && (
            <div className="mail-msg__atts" role="list">
              {atts.map((a) => (
                <div key={a.id} className="mail-msg__att-wrap" role="listitem">
                  <AttachmentRow att={a} onOpenDocument={onOpenDocument} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
});
