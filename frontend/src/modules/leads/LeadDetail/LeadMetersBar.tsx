import React, { useCallback, useState } from "react";

export interface LeadMeterListItem {
  id: string;
  name: string;
  is_default: boolean;
  meter_power_kva?: number | null;
  grid_type?: string | null;
  consumption_mode?: string | null;
  consumption_annual_kwh?: number | null;
  consumption_annual_calculated_kwh?: number | null;
  consumption_pdl?: string | null;
  sort_order?: number;
}

function fmtKva(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "— kVA";
  return `${n} kVA`;
}

/** Affichage carte : toujours suffixe /an (spéc V2 multi-compteurs). */
function fmtKwhAnnualPerYear(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "— kWh/an";
  return `${Number(n).toLocaleString("fr-FR")} kWh/an`;
}

export function annualKwhForCard(m: LeadMeterListItem): number | null | undefined {
  if (m.consumption_mode === "MONTHLY") {
    return m.consumption_annual_calculated_kwh ?? null;
  }
  return m.consumption_annual_kwh ?? null;
}

function formatGridTypeLabel(gridType: string | null | undefined): string {
  const g = (gridType || "").trim().toLowerCase();
  if (g === "tri" || g === "triphase" || g === "triphasé") return "Triphasé";
  if (g === "mono" || g === "monophase" || g === "monophasé") return "Monophasé";
  if (!g) return "Réseau non défini";
  return gridType || "Réseau non défini";
}

export interface LeadMetersBarProps {
  /** `null` = chargement en cours ; `[]` = liste chargée vide. */
  meters: LeadMeterListItem[] | null;
  /** Si défini : échec GET /meters (remplace le faux « Chargement… »). */
  metersFetchError?: string | null;
  selectedId: string | null;
  /** Ouvre la modal d’édition pour ce compteur. */
  onOpenMeter: (id: string) => void | Promise<void>;
  /** Ouvre la modal de création (aucun POST avant enregistrement). */
  onRequestAdd: () => void | Promise<void>;
  onSetDefault: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  busy?: boolean;
}

export default function LeadMetersBar({
  meters,
  metersFetchError = null,
  selectedId,
  onOpenMeter,
  onRequestAdd,
  onSetDefault,
  onDelete,
  busy = false,
}: LeadMetersBarProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const closeMenu = useCallback(() => setOpenMenuId(null), []);

  const list = meters ?? [];

  return (
    <div className="crm-lead-meters">
      <div className="crm-lead-meters__header">
        <span className="crm-lead-meters__title">Compteurs</span>
        {meters === null || Boolean(metersFetchError) ? (
          <button
            type="button"
            className="sn-btn sn-btn-outline-gold sn-btn-sm crm-lead-meters__add-primary"
            disabled={busy || meters === null || Boolean(metersFetchError)}
            onClick={() => void onRequestAdd()}
          >
            + Ajouter compteur
          </button>
        ) : null}
      </div>

      <div className="crm-lead-meters__body">
        {metersFetchError ? (
          <p className="crm-lead-meters__error" role="alert">
            {metersFetchError}
          </p>
        ) : meters === null ? (
          <p className="crm-lead-meters__loading" aria-live="polite">
            Chargement des compteurs…
          </p>
        ) : list.length === 0 ? (
          <div className="crm-lead-meters__empty-premium">
            <p className="crm-lead-meters__empty-premium-title">Aucun compteur enregistré</p>
            <p className="crm-lead-meters__empty-premium-text">
              Ajoutez un ou plusieurs compteurs pour préparer les futures études.
            </p>
            <button
              type="button"
              className="sn-btn sn-btn-outline-gold sn-btn-sm crm-lead-meters__empty-premium-cta"
              disabled={busy}
              onClick={() => void onRequestAdd()}
            >
              + Ajouter compteur
            </button>
          </div>
        ) : (
          <>
          <div className="crm-lead-meters__row">
            {list.map((m) => {
              const selected = m.id === selectedId;
              const annual = annualKwhForCard(m);
              const kvaLine = fmtKva(m.meter_power_kva);
              const gridLine = formatGridTypeLabel(m.grid_type);
              return (
                <div
                  key={m.id}
                  className={
                    "crm-lead-meters__card" + (selected ? " crm-lead-meters__card--selected" : "")
                  }
                >
                  <button
                    type="button"
                    className="crm-lead-meters__card-main"
                    disabled={busy}
                    onClick={() => void onOpenMeter(m.id)}
                  >
                    <span className="crm-lead-meters__card-name-row">
                      <span className="crm-lead-meters__card-name">{m.name || "Sans nom"}</span>
                      {m.is_default ? (
                        <span className="sn-badge sn-badge-success">Principal</span>
                      ) : null}
                    </span>
                    <span className="crm-lead-meters__card-kwh">{fmtKwhAnnualPerYear(annual)}</span>
                    <span className="crm-lead-meters__card-meta">
                      {kvaLine} • {gridLine}
                    </span>
                  </button>
                  <div className="crm-lead-meters__card-tools">
                    <button
                      type="button"
                      className="crm-lead-meters__kebab"
                      disabled={busy}
                      aria-expanded={openMenuId === m.id}
                      aria-label={`Actions ${m.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuId((id) => (id === m.id ? null : m.id));
                      }}
                    >
                      ⋮
                    </button>
                    {openMenuId === m.id ? (
                      <div className="crm-lead-meters__menu" role="menu">
                        {!m.is_default ? (
                          <button
                            type="button"
                            role="menuitem"
                            className="crm-lead-meters__menu-item"
                            onClick={() => {
                              closeMenu();
                              void onSetDefault(m.id);
                            }}
                          >
                            Définir comme compteur principal
                          </button>
                        ) : null}
                        {list.length > 1 ? (
                          <button
                            type="button"
                            role="menuitem"
                            className="crm-lead-meters__menu-item crm-lead-meters__menu-item--danger"
                            onClick={() => {
                              closeMenu();
                              if (window.confirm(`Supprimer le compteur « ${m.name} » ?`)) {
                                void onDelete(m.id);
                              }
                            }}
                          >
                            Supprimer
                          </button>
                        ) : (
                          <span className="crm-lead-meters__menu-muted">
                            Suppression impossible (dernier compteur)
                          </span>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="crm-lead-meters__footer">
            <button
              type="button"
              className="sn-btn sn-btn-outline-gold sn-btn-sm"
              disabled={busy}
              onClick={() => void onRequestAdd()}
            >
              + Ajouter compteur
            </button>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
