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
    return { text: "Pas de mairie", className: "lead-mairie-list-badge-slot sn-badge sn-badge-neutral" };
  }
  const st = lead.mairie_account_status;
  if (st === "to_create") {
    return { text: "Mairie à créer", className: "lead-mairie-list-badge-slot sn-badge sn-badge-warn" };
  }
  if (st === "created") {
    return { text: "Mairie OK", className: "lead-mairie-list-badge-slot sn-badge sn-badge-success" };
  }
  return { text: "Mairie non créée", className: "lead-mairie-list-badge-slot sn-badge sn-badge-danger" };
}

export function LeadMairieListBadge({ lead }: { lead: Pick<Lead, "mairie_id" | "mairie_account_status"> }) {
  const { text, className } = labelAndClass(lead);
  return (
    <span className={className} title={text}>
      {text}
    </span>
  );
}
