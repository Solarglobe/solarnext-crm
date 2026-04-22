import React from "react";

export interface MailComposerRecipientsProps {
  to: string;
  cc: string;
  bcc: string;
  onTo: (v: string) => void;
  onCc: (v: string) => void;
  onBcc: (v: string) => void;
  showCc: boolean;
  showBcc: boolean;
  onToggleCc: () => void;
  onToggleBcc: () => void;
  disabled?: boolean;
  /** Sauvegarde immédiate du brouillon au blur (sans debounce). */
  onFieldBlur?: () => void;
}

export const MailComposerRecipients = React.memo(function MailComposerRecipients({
  to,
  cc,
  bcc,
  onTo,
  onCc,
  onBcc,
  showCc,
  showBcc,
  onToggleCc,
  onToggleBcc,
  disabled,
  onFieldBlur,
}: MailComposerRecipientsProps) {
  return (
    <div className="mail-composer-rcpt">
      <label className="mail-composer-field">
        <span className="mail-composer-field__label">À</span>
        <input
          type="text"
          className="mail-composer-field__input"
          placeholder="adresse@… , …"
          value={to}
          onChange={(e) => onTo(e.target.value)}
          onBlur={() => onFieldBlur?.()}
          disabled={disabled}
          autoComplete="off"
        />
      </label>
      <div className="mail-composer-rcpt__extra">
        {!showCc && (
          <button type="button" className="mail-composer-rcpt__link" onClick={onToggleCc} disabled={disabled}>
            Cc
          </button>
        )}
        {!showBcc && (
          <button type="button" className="mail-composer-rcpt__link" onClick={onToggleBcc} disabled={disabled}>
            Cci
          </button>
        )}
      </div>
      {showCc && (
        <label className="mail-composer-field">
          <span className="mail-composer-field__label">Cc</span>
          <input
            type="text"
            className="mail-composer-field__input"
            value={cc}
            onChange={(e) => onCc(e.target.value)}
            onBlur={() => onFieldBlur?.()}
            disabled={disabled}
            autoComplete="off"
          />
        </label>
      )}
      {showBcc && (
        <label className="mail-composer-field">
          <span className="mail-composer-field__label">Cci</span>
          <input
            type="text"
            className="mail-composer-field__input"
            value={bcc}
            onChange={(e) => onBcc(e.target.value)}
            onBlur={() => onFieldBlur?.()}
            disabled={disabled}
            autoComplete="off"
          />
        </label>
      )}
    </div>
  );
});
