import React, { useCallback, useRef } from "react";

export interface LocalAttachment {
  id: string;
  file: File;
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const x = r.result as string;
      const i = x.indexOf(",");
      resolve(i >= 0 ? x.slice(i + 1) : x);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

export interface MailComposerAttachmentsProps {
  items: LocalAttachment[];
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
}

export const MailComposerAttachments = React.memo(function MailComposerAttachments({
  items,
  onAdd,
  onRemove,
  disabled,
}: MailComposerAttachmentsProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const fl = e.target.files;
      if (fl?.length) onAdd(Array.from(fl));
      e.target.value = "";
    },
    [onAdd]
  );

  return (
    <div className="mail-composer-att">
      <input
        ref={inputRef}
        type="file"
        className="mail-composer-att__input"
        multiple
        disabled={disabled}
        onChange={onChange}
      />
      <button
        type="button"
        className="mail-composer-att__add"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        + Pièce jointe
      </button>
      {items.length > 0 && (
        <ul className="mail-composer-att__list">
          {items.map((it) => (
            <li key={it.id} className="mail-composer-att__row">
              <span className="mail-composer-att__name" title={it.file.name}>
                {it.file.name}
              </span>
              <span className="mail-composer-att__size">{formatSize(it.file.size)}</span>
              <button type="button" className="mail-composer-att__rm" disabled={disabled} onClick={() => onRemove(it.id)} title="Retirer">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
