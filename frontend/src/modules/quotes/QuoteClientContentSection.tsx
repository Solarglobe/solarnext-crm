/**
 * Textes destinés au client / au PDF (hors notes internes équipe).
 */

import React, { useState } from "react";
import type { QuoteTextTemplateItem } from "../../services/admin.api";

export interface QuoteClientContentSectionProps {
  canEdit: boolean;
  commercialNotes: string;
  technicalNotes: string;
  paymentTerms: string;
  templatesCommercial: QuoteTextTemplateItem[];
  templatesTechnical: QuoteTextTemplateItem[];
  templatesPayment: QuoteTextTemplateItem[];
  onCommercialNotesChange: (v: string) => void;
  onTechnicalNotesChange: (v: string) => void;
  onPaymentTermsChange: (v: string) => void;
}

export default function QuoteClientContentSection({
  canEdit,
  commercialNotes,
  technicalNotes,
  paymentTerms,
  templatesCommercial,
  templatesTechnical,
  templatesPayment,
  onCommercialNotesChange,
  onTechnicalNotesChange,
  onPaymentTermsChange,
}: QuoteClientContentSectionProps) {
  const [selCommercial, setSelCommercial] = useState("");
  const [selTechnical, setSelTechnical] = useState("");
  const [selPayment, setSelPayment] = useState("");

  return (
    <div className="qb-client-fields qb-client-fields--pro">
      <div className="qb-field qb-field--block">
        <span>Notes commerciales</span>
        <div className="qb-template-row">
          <select
            className="sn-input qb-template-select"
            disabled={!canEdit || templatesCommercial.length === 0}
            value={selCommercial}
            onChange={(e) => {
              const id = e.target.value;
              setSelCommercial("");
              if (!id) return;
              const t = templatesCommercial.find((x) => x.id === id);
              if (t) onCommercialNotesChange(t.content);
            }}
            aria-label="Choisir un modèle pour les notes commerciales"
          >
            <option value="">
              {templatesCommercial.length === 0 ? "Aucun modèle (catalogue admin)" : "Choisir un modèle…"}
            </option>
            {templatesCommercial.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <textarea
          className="sn-input qb-textarea"
          rows={3}
          disabled={!canEdit}
          value={commercialNotes}
          onChange={(e) => onCommercialNotesChange(e.target.value)}
          placeholder="Argumentaire, conditions générales visibles…"
        />
      </div>

      <div className="qb-field qb-field--block">
        <span>Détails techniques (synthèse client)</span>
        <div className="qb-template-row">
          <select
            className="sn-input qb-template-select"
            disabled={!canEdit || templatesTechnical.length === 0}
            value={selTechnical}
            onChange={(e) => {
              const id = e.target.value;
              setSelTechnical("");
              if (!id) return;
              const t = templatesTechnical.find((x) => x.id === id);
              if (t) onTechnicalNotesChange(t.content);
            }}
            aria-label="Choisir un modèle pour les détails techniques"
          >
            <option value="">
              {templatesTechnical.length === 0 ? "Aucun modèle (catalogue admin)" : "Choisir un modèle…"}
            </option>
            {templatesTechnical.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <textarea
          className="sn-input qb-textarea"
          rows={3}
          disabled={!canEdit}
          value={technicalNotes}
          onChange={(e) => onTechnicalNotesChange(e.target.value)}
          placeholder="Précisions techniques compréhensibles par le client…"
        />
      </div>

      <div className="qb-field qb-field--block">
        <span>Modalités de paiement</span>
        <div className="qb-template-row">
          <select
            className="sn-input qb-template-select"
            disabled={!canEdit || templatesPayment.length === 0}
            value={selPayment}
            onChange={(e) => {
              const id = e.target.value;
              setSelPayment("");
              if (!id) return;
              const t = templatesPayment.find((x) => x.id === id);
              if (t) onPaymentTermsChange(t.content);
            }}
            aria-label="Choisir un modèle pour les modalités de paiement"
          >
            <option value="">
              {templatesPayment.length === 0 ? "Aucun modèle (catalogue admin)" : "Choisir un modèle…"}
            </option>
            {templatesPayment.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <textarea
          className="sn-input qb-textarea"
          rows={3}
          disabled={!canEdit}
          value={paymentTerms}
          onChange={(e) => onPaymentTermsChange(e.target.value)}
          placeholder="Échéancier, acomptes, délais…"
        />
      </div>
    </div>
  );
}
