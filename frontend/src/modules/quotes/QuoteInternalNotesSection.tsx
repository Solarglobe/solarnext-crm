/**
 * Notes strictement internes — non destinées au PDF client (phase produit ultérieure pour le masquage exact).
 */

import React from "react";

export interface QuoteInternalNotesSectionProps {
  canEdit: boolean;
  notes: string;
  onNotesChange: (v: string) => void;
}

export default function QuoteInternalNotesSection({ canEdit, notes, onNotesChange }: QuoteInternalNotesSectionProps) {
  return (
    <label className="qb-field qb-field--block">
      <span>Notes internes (équipe uniquement)</span>
      <textarea
        className="sn-input qb-textarea"
        rows={3}
        disabled={!canEdit}
        value={notes}
        onChange={(e) => onNotesChange(e.target.value)}
        placeholder="Éléments de contexte, historique interne, ne pas communiquer au client…"
      />
    </label>
  );
}
