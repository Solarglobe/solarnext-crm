import React from "react";

export type InboxListMode = "all" | "unread" | "attachments";

interface MailInboxChipsProps {
  mode: InboxListMode;
  onChange: (mode: InboxListMode) => void;
}

export const MailInboxChips = React.memo(function MailInboxChips({ mode, onChange }: MailInboxChipsProps) {
  return (
    <div className="mail-inbox-sn-tablist" role="tablist" aria-label="Filtrer la boîte">
      <button
        type="button"
        role="tab"
        aria-selected={mode === "all"}
        className={`mail-inbox-sn-tab sn-badge ${mode === "all" ? "sn-badge-info" : "sn-badge-neutral"}`}
        onClick={() => onChange("all")}
      >
        Tous
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "unread"}
        className={`mail-inbox-sn-tab sn-badge ${mode === "unread" ? "sn-badge-info" : "sn-badge-neutral"}`}
        onClick={() => onChange("unread")}
      >
        Non lus
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "attachments"}
        className={`mail-inbox-sn-tab sn-badge ${mode === "attachments" ? "sn-badge-info" : "sn-badge-neutral"}`}
        onClick={() => onChange("attachments")}
      >
        Avec PJ
      </button>
    </div>
  );
});
