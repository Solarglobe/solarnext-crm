/**
 * CP-LEAD-CREATE-05 — Overlay création rapide Lead
 * Modal centré, style glassmorphism, validation selon customer_type :
 *   PERSON : firstName* + lastName* + (phone OU email)
 *   PRO    : companyName* + (phone OU email) ; contactName optionnel
 */

import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createLead } from "../../services/leads.service";
import { Button } from "../../components/ui/Button";
import { ModalShell } from "../../components/ui/ModalShell";
import "./create-lead-modal.css";

interface CreateLeadModalProps {
  onClose: () => void;
}

type CustomerType = "PERSON" | "PRO";

export default function CreateLeadModal({ onClose }: CreateLeadModalProps) {
  const navigate = useNavigate();
  const firstInputRef = useRef<HTMLInputElement>(null);

  const [customerType, setCustomerType] = useState<CustomerType>("PERSON");

  // Champs PERSON
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  // Champs PRO
  const [companyName, setCompanyName] = useState("");
  const [contactFirstName, setContactFirstName] = useState("");
  const [contactLastName, setContactLastName] = useState("");

  // Champs communs
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    firstInputRef.current?.focus();
  }, [customerType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const ph = phone.trim();
    const em = email.trim();

    if (!ph && !em) {
      setError("Le téléphone ou l'email est obligatoire (au moins un des deux).");
      return;
    }

    if (customerType === "PERSON") {
      const fn = firstName.trim();
      const ln = lastName.trim();
      if (!fn) { setError("Le prénom est obligatoire."); firstInputRef.current?.focus(); return; }
      if (!ln) { setError("Le nom est obligatoire."); return; }

      setSaving(true);
      try {
        const lead = await createLead({
          customer_type: "PERSON",
          firstName: fn,
          lastName: ln,
          phone: ph || undefined,
          email: em || undefined,
        });
        onClose();
        navigate(`/leads/${lead.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur lors de la création");
      } finally {
        setSaving(false);
      }
    } else {
      const cn = companyName.trim();
      if (!cn) { setError("Le nom de l'entreprise est obligatoire."); firstInputRef.current?.focus(); return; }

      setSaving(true);
      try {
        const lead = await createLead({
          customer_type: "PRO",
          companyName: cn,
          contactFirstName: contactFirstName.trim() || undefined,
          contactLastName: contactLastName.trim() || undefined,
          phone: ph || undefined,
          email: em || undefined,
        });
        onClose();
        navigate(`/leads/${lead.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur lors de la création");
      } finally {
        setSaving(false);
      }
    }
  };

  return (
    <ModalShell
      open
      onClose={onClose}
      closeOnBackdropClick
      size="md"
      title="Nouveau lead"
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" type="submit" form="create-lead-form" disabled={saving}>
            {saving ? "Création…" : "Créer"}
          </Button>
        </>
      }
    >
      <div className="create-lead-type-toggle">
        <button
          type="button"
          className={`create-lead-type-btn${customerType === "PERSON" ? " active" : ""}`}
          onClick={() => { setCustomerType("PERSON"); setError(null); }}
        >
          Particulier
        </button>
        <button
          type="button"
          className={`create-lead-type-btn${customerType === "PRO" ? " active" : ""}`}
          onClick={() => { setCustomerType("PRO"); setError(null); }}
        >
          Professionnel
        </button>
      </div>

      <form id="create-lead-form" onSubmit={handleSubmit}>
        {customerType === "PERSON" ? (
          <>
            <div className="create-lead-field">
              <label htmlFor="create-lead-firstName">Prénom *</label>
              <input
                ref={firstInputRef}
                id="create-lead-firstName"
                type="text"
                className="sn-input"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Prénom"
                autoComplete="given-name"
                style={{ width: "100%", boxSizing: "border-box" }}
              />
            </div>
            <div className="create-lead-field">
              <label htmlFor="create-lead-lastName">Nom *</label>
              <input
                id="create-lead-lastName"
                type="text"
                className="sn-input"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Nom"
                autoComplete="family-name"
                style={{ width: "100%", boxSizing: "border-box" }}
              />
            </div>
          </>
        ) : (
          <>
            <div className="create-lead-field">
              <label htmlFor="create-lead-companyName">Nom de l'entreprise *</label>
              <input
                ref={firstInputRef}
                id="create-lead-companyName"
                type="text"
                className="sn-input"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Raison sociale"
                autoComplete="organization"
                style={{ width: "100%", boxSizing: "border-box" }}
              />
            </div>
            <div className="create-lead-field-row">
              <div className="create-lead-field">
                <label htmlFor="create-lead-contactFirstName">Prénom du contact</label>
                <input
                  id="create-lead-contactFirstName"
                  type="text"
                  className="sn-input"
                  value={contactFirstName}
                  onChange={(e) => setContactFirstName(e.target.value)}
                  placeholder="Prénom"
                  autoComplete="given-name"
                  style={{ width: "100%", boxSizing: "border-box" }}
                />
              </div>
              <div className="create-lead-field">
                <label htmlFor="create-lead-contactLastName">Nom du contact</label>
                <input
                  id="create-lead-contactLastName"
                  type="text"
                  className="sn-input"
                  value={contactLastName}
                  onChange={(e) => setContactLastName(e.target.value)}
                  placeholder="Nom"
                  autoComplete="family-name"
                  style={{ width: "100%", boxSizing: "border-box" }}
                />
              </div>
            </div>
          </>
        )}

        <div className="create-lead-field">
          <label htmlFor="create-lead-phone">Téléphone</label>
          <input
            id="create-lead-phone"
            type="tel"
            className="sn-input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="06 12 34 56 78"
            autoComplete="tel"
            style={{ width: "100%", boxSizing: "border-box" }}
          />
        </div>
        <div className="create-lead-field">
          <label htmlFor="create-lead-email">Email</label>
          <input
            id="create-lead-email"
            type="email"
            className="sn-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@exemple.fr"
            autoComplete="email"
            style={{ width: "100%", boxSizing: "border-box" }}
          />
        </div>
        <p className="create-lead-hint">* Téléphone ou email obligatoire (au moins un)</p>
        {error && <p className="create-lead-error">{error}</p>}
      </form>
    </ModalShell>
  );
}
