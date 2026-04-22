import React from "react";

export type InboxListMode = "all" | "unread" | "attachments";

interface MailInboxChipsProps {
  mode: InboxListMode;
  onChange: (mode: InboxListMode) => void;
}

export const MailInboxChips = React.memo(function MailInboxChips({ mode, onChange }: MailInboxChipsProps) {
  return (
    <div className="mail-inbox-chips" role="tablist" aria-label="Filtrer la boîte">
      <button
        type="button"
        role="tab"
        aria-selected={mode === "all"}
        className={`mail-inbox-chip${mode === "all" ? " mail-inbox-chip--active" : ""}`}
        onClick={() => onChange("all")}
      >
        Tous
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "unread"}
        className={`mail-inbox-chip${mode === "unread" ? " mail-inbox-chip--active" : ""}`}
        onClick={() => onChange("unread")}
      >
        Non lus
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "attachments"}
        className={`mail-inbox-chip${mode === "attachments" ? " mail-inbox-chip--active" : ""}`}
        onClick={() => onChange("attachments")}
      >
        Avec PJ
      </button>
    </div>
  );
});
