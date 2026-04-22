/**
 * CP-MAIRIES-004 — pastille discrète dans les listes leads.
 */
import React from "react";
import type { Lead } from "../../services/leads.service";

function labelAndClass(lead: Pick<Lead, "mairie_id" | "mairie_account_status">): {
  text: string;
  className: string;
} {
  if (!lead.mairie_id) {
    return { text: "Pas de mairie", className: "lead-mairie-badge lead-mairie-badge--empty" };
  }
  const st = lead.mairie_account_status;
  if (st === "to_create") {
    return { text: "Mairie à créer", className: "lead-mairie-badge lead-mairie-badge--orange" };
  }
  if (st === "created") {
    return { text: "Mairie OK", className: "lead-mairie-badge lead-mairie-badge--green" };
  }
  return { text: "Mairie non créée", className: "lead-mairie-badge lead-mairie-badge--red" };
}

export function LeadMairieListBadge({ lead }: { lead: Pick<Lead, "mairie_id" | "mairie_account_status"> }) {
  const { text, className } = labelAndClass(lead);
  return (
    <span className={className} title={text}>
      {text}
    </span>
  );
}
