/**
 * Formulaire création / édition mairie (POST / PATCH /api/mairies).
 */
import React, { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import type { MairieDto, MairieWritePayload } from "../../services/mairies.api";
import type { MairieAccountStatus, MairiePortalType } from "../../services/mairies.api";

export type MairieDuplicateDisplay = {
  message: string;
  suggestion?: { name: string | null; postal_code: string | null; city: string | null } | null;
};

type MairieFormProps = {
  mode: "create" | "edit";
  /** Page pleine (édition) ou contenu de `ModalShell` (création). */
  variant?: "page" | "modal";
  initial: MairieDto | null;
  loading: boolean;
  saving: boolean;
  canEdit: boolean;
  error: string | null;
  duplicateInfo: MairieDuplicateDisplay | null;
  onSubmit: (payload: MairieWritePayload) => Promise<void>;
  onCancel: () => void;
};

function emptyToNull(s: string): string | null {
  const t = s.trim();
  return t === "" ? null : t;
}

function validatePayload(values: {
  name: string;
  postal_code: string;
  city: string;
  portal_url: string;
  account_email: string;
}): string | null {
  if (!values.name.trim()) return "Le nom est obligatoire.";
  if (!values.postal_code.trim()) return "Le code postal est obligatoire.";
  if (values.account_email.trim()) {
    const em = values.account_email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return "Email compte invalide.";
  }
  if (values.portal_url.trim()) {
    try {
      // mailto: sans // est valide en navigateur
      new URL(values.portal_url.trim());
    } catch {
      return "URL portail invalide.";
    }
  }
  return null;
}

export function MairieForm({
  mode,
  variant = "page",
  initial,
  loading,
  saving,
  canEdit,
  error,
  duplicateInfo,
  onSubmit,
  onCancel,
}: MairieFormProps) {
  const [name, setName] = useState("");
  const [postal_code, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [portal_url, setPortalUrl] = useState("");
  const [portal_type, setPortalType] = useState<MairiePortalType>("online");
  const [account_status, setAccountStatus] = useState<MairieAccountStatus>("none");
  const [account_email, setAccountEmail] = useState("");
  const [bitwarden_ref, setBitwardenRef] = useState("");
  const [notes, setNotes] = useState("");
  const [localErr, setLocalErr] = useState<string | null>(null);

  useEffect(() => {
    if (!initial) return;
    setName(initial.name ?? "");
    setPostalCode(initial.postal_code ?? "");
    setCity(initial.city ?? "");
    setPortalUrl(initial.portal_url ?? "");
    setPortalType(initial.portal_type ?? "online");
    setAccountStatus(initial.account_status ?? "none");
    setAccountEmail(initial.account_email ?? "");
    setBitwardenRef(initial.bitwarden_ref ?? "");
    setNotes(initial.notes ?? "");
  }, [initial]);

  const disabledAll = !canEdit || saving;

  const formTitle = useMemo(() => (mode === "create" ? "Nouvelle mairie" : "Modifier la mairie"), [mode]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalErr(null);
    const values = { name, postal_code, city, portal_url, account_email };
    const v = validatePayload(values);
    if (v) {
      setLocalErr(v);
      return;
    }
    const payload: MairieWritePayload = {
      name: name.trim(),
      postal_code: postal_code.trim(),
      city: emptyToNull(city),
      portal_url: emptyToNull(portal_url),
      portal_type,
      account_status,
      account_email: emptyToNull(account_email),
      bitwarden_ref: emptyToNull(bitwarden_ref),
      notes: emptyToNull(notes),
    };
    await onSubmit(payload);
  }

  if (loading && mode === "edit") {
    return <p className="qb-muted">Chargement…</p>;
  }

  const inModal = variant === "modal";

  return (
    <div className={`mairie-form${inModal ? " mairie-form--in-modal" : ""}`}>
      {inModal ? null : (
        <>
          <div style={{ marginBottom: 16 }}>
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              ← Retour à la liste
            </Button>
          </div>
          <h2 className="mairies-page__title" style={{ marginBottom: 16 }}>
            {formTitle}
          </h2>
        </>
      )}

      {error ? (
        <p className="qb-error-inline" style={{ marginBottom: 12 }}>
          {error}
        </p>
      ) : null}
      {localErr ? (
        <p className="qb-error-inline" style={{ marginBottom: 12 }}>
          {localErr}
        </p>
      ) : null}

      {duplicateInfo ? (
        <div
          className="sn-card mairie-form__duplicate"
          role="alert"
          style={{
            marginBottom: 16,
            padding: 14,
            borderLeft: "4px solid #f59e0b",
            background: "rgba(245, 158, 11, 0.08)",
          }}
        >
          <h3 className="mairie-form__duplicate-title">Cette mairie existe déjà</h3>
          {duplicateInfo.suggestion ? (
            <p className="mairie-form__duplicate-suggestion">
              {[
                duplicateInfo.suggestion.name,
                duplicateInfo.suggestion.city,
                duplicateInfo.suggestion.postal_code,
              ]
                .filter(Boolean)
                .join(" – ")}
            </p>
          ) : null}
        </div>
      ) : null}

      <form onSubmit={handleSubmit}>
        <div className="mairie-form__grid">
          <div className="mairie-form__field">
            <label htmlFor="mairie-name">Nom *</label>
            <input
              id="mairie-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={disabledAll}
              required
              autoComplete="organization"
            />
          </div>
          <div className="mairie-form__field">
            <label htmlFor="mairie-cp">Code postal *</label>
            <input
              id="mairie-cp"
              value={postal_code}
              onChange={(e) => setPostalCode(e.target.value)}
              disabled={disabledAll}
              required
            />
          </div>
          <div className="mairie-form__field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="mairie-city">Ville</label>
            <input id="mairie-city" value={city} onChange={(e) => setCity(e.target.value)} disabled={disabledAll} />
          </div>
          <div className="mairie-form__field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="mairie-url">URL portail</label>
            <input
              id="mairie-url"
              value={portal_url}
              onChange={(e) => setPortalUrl(e.target.value)}
              disabled={disabledAll}
              placeholder="https://… ou mailto:…"
            />
          </div>
          <div className="mairie-form__field">
            <label htmlFor="mairie-ptype">Type de portail</label>
            <select
              id="mairie-ptype"
              value={portal_type}
              onChange={(e) => setPortalType(e.target.value as MairiePortalType)}
              disabled={disabledAll}
            >
              <option value="online">Online</option>
              <option value="email">Email</option>
              <option value="paper">Papier</option>
            </select>
          </div>
          <div className="mairie-form__field">
            <label htmlFor="mairie-status">Statut du compte</label>
            <select
              id="mairie-status"
              value={account_status}
              onChange={(e) => setAccountStatus(e.target.value as MairieAccountStatus)}
              disabled={disabledAll}
            >
              <option value="none">Non créé</option>
              <option value="to_create">À créer</option>
              <option value="created">OK</option>
            </select>
          </div>
          <div className="mairie-form__field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="mairie-mail">Email du compte portail</label>
            <input
              id="mairie-mail"
              type="email"
              value={account_email}
              onChange={(e) => setAccountEmail(e.target.value)}
              disabled={disabledAll}
            />
          </div>
          <div className="mairie-form__field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="mairie-bw">Référence Bitwarden</label>
            <input id="mairie-bw" value={bitwarden_ref} onChange={(e) => setBitwardenRef(e.target.value)} disabled={disabledAll} />
          </div>
          <div className="mairie-form__field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="mairie-notes">Notes</label>
            <textarea id="mairie-notes" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={disabledAll} rows={4} />
          </div>
        </div>
        {canEdit ? (
          <div className="mairie-form__actions">
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Enregistrement…" : mode === "create" ? "Créer" : "Enregistrer"}
            </Button>
            <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
              Annuler
            </Button>
          </div>
        ) : (
          <p className="qb-muted" style={{ marginTop: 16 }}>
            Lecture seule — vous n’avez pas la permission de modification.
          </p>
        )}
      </form>
    </div>
  );
}
