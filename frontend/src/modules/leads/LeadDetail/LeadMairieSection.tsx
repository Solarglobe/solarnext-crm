/**
 * CP-MAIRIES-004-CLEAN — Bloc Mairie sur fiche lead : affiché seulement si une mairie est liée (consultation).
 */
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../../components/ui/Button";
import { LeadMairieListBadge } from "../../../components/leads/LeadMairieListBadge";
import { updateMairie, type MairieDto } from "../../../services/mairies.api";
import { getUserPermissions } from "../../../services/auth.service";
import { resolveOpenHref } from "../../../pages/mairies/mairiesUi";
import type { Lead } from "../../../services/leads.service";

type Props = {
  lead: Pick<
    Lead,
    | "id"
    | "mairie_id"
    | "mairie_name"
    | "mairie_postal_code"
    | "mairie_city"
    | "mairie_portal_url"
    | "mairie_portal_type"
    | "mairie_account_status"
    | "mairie_account_email"
  >;
};

export default function LeadMairieSection({ lead }: Props) {
  const navigate = useNavigate();
  const [canReadMairie, setCanReadMairie] = useState(false);

  useEffect(() => {
    getUserPermissions()
      .then((p) => {
        const perms = p.permissions ?? [];
        const star = perms.includes("*") || p.superAdmin === true;
        setCanReadMairie(star || perms.includes("mairie.read"));
      })
      .catch(() => setCanReadMairie(false));
  }, []);

  const rowAsDto = useMemo((): MairieDto | null => {
    if (!lead.mairie_id) return null;
    return {
      id: lead.mairie_id,
      name: lead.mairie_name ?? "",
      postal_code: lead.mairie_postal_code ?? "",
      city: lead.mairie_city ?? null,
      portal_url: lead.mairie_portal_url ?? null,
      portal_type: (lead.mairie_portal_type as MairieDto["portal_type"]) ?? "online",
      account_status: (lead.mairie_account_status as MairieDto["account_status"]) ?? "none",
      account_email: lead.mairie_account_email ?? null,
      bitwarden_ref: null,
      notes: null,
      last_used_at: null,
      created_at: "",
      updated_at: "",
      linked_leads_count: 0,
    };
  }, [lead]);

  const openHref = rowAsDto ? resolveOpenHref(rowAsDto) : null;

  const touchLastUsed = () => {
    if (!lead.mairie_id || !canReadMairie) return;
    void updateMairie(lead.mairie_id, { last_used_at: new Date().toISOString() }).catch(() => {});
  };

  const openPortal = () => {
    if (!openHref) return;
    window.open(openHref, "_blank", "noopener,noreferrer");
    touchLastUsed();
  };

  if (!lead.mairie_id) {
    return null;
  }

  return (
    <section
      className="lead-mairie-section lead-mairie-section--clean"
      aria-labelledby="lead-mairie-heading"
    >
      <h3 id="lead-mairie-heading" className="lead-mairie-section__title">
        Mairie / portail DP
      </h3>

      <div className="lead-mairie-section__body lead-mairie-section__body--clean">
        <div className="lead-mairie-section__headline">
          <p className="lead-mairie-section__name">
            <strong>{lead.mairie_name ?? "—"}</strong>
            {lead.mairie_postal_code || lead.mairie_city ? (
              <span className="sn-muted">
                {" "}
                · {lead.mairie_postal_code ?? ""} {lead.mairie_city ?? ""}
              </span>
            ) : null}
          </p>
          <LeadMairieListBadge
            lead={{
              mairie_id: lead.mairie_id,
              mairie_account_status: lead.mairie_account_status,
            }}
          />
        </div>
        <div className="lead-mairie-section__actions lead-mairie-section__actions--clean">
          {canReadMairie ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => navigate(`/mairies/${lead.mairie_id}`)}
            >
              Voir la mairie
            </Button>
          ) : null}
          {openHref ? (
            <Button type="button" variant="primary" size="sm" onClick={openPortal}>
              Ouvrir le portail
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
