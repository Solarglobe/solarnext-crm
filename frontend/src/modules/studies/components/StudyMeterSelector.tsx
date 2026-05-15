/**
 * Bloc « Compteur de référence de cette étude » — devis technique.
 * Source : study_versions.data_json.selected_meter_id + GET lead meters.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../../../services/api";
import { getCrmApiBase } from "@/config/crmApiBase";
import { postStudyVersionDataMerge, type StudyWithVersions } from "../../../services/studies.service";

const DEFAULT_API = getCrmApiBase();

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
}

function formatGridTypeLabel(gridType: string | null | undefined): string {
  const g = (gridType || "").trim().toLowerCase();
  if (g === "tri" || g === "triphase" || g === "triphasé") return "Triphasé";
  if (g === "mono" || g === "monophase" || g === "monophasé") return "Monophasé";
  if (!g) return "—";
  return String(gridType);
}

function annualKwhDisplay(m: {
  consumption_mode?: string | null;
  consumption_annual_kwh?: number | null;
  consumption_annual_calculated_kwh?: number | null;
}): string {
  if (m.consumption_mode === "MONTHLY") {
    const v = m.consumption_annual_calculated_kwh;
    if (v == null || !Number.isFinite(Number(v))) return "—";
    return `${Number(v).toLocaleString("fr-FR")} kWh/an`;
  }
  const v = m.consumption_annual_kwh;
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `${Number(v).toLocaleString("fr-FR")} kWh/an`;
}

function resolveCurrentVersionId(body: StudyWithVersions, currentVersionNum: number | undefined): string | null {
  const n = currentVersionNum;
  if (n == null || !Number.isFinite(n)) return null;
  const v = body.versions?.find((x) => x.version_number === n);
  return v?.id ?? null;
}

export interface StudyMeterSelectorProps {
  studyId: string;
  /** UUID study_versions (URL quote-builder) */
  versionId: string;
  locked: boolean;
  apiBase?: string;
  /** kVA affiché pour la batterie virtuelle — aligné sur le compteur résolu */
  onMeterPowerKvaResolved?: (kva: number) => void;
  /** Après changement de compteur (nouvelle version créée + navigation faite par ce composant) */
  onCalcContextInvalidated?: () => void;
}

export default function StudyMeterSelector({
  studyId,
  versionId,
  locked,
  apiBase = DEFAULT_API,
  onMeterPowerKvaResolved,
  onCalcContextInvalidated,
}: StudyMeterSelectorProps) {
  const navigate = useNavigate();
  const [leadId, setLeadId] = useState<string | null>(null);
  const [studyLoadError, setStudyLoadError] = useState<string | null>(null);
  const [studySliceReady, setStudySliceReady] = useState(false);
  const [meters, setMeters] = useState<LeadMeterListItem[] | null>(null);
  const [metersError, setMetersError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  /** selected_meter_id explicite dans data_json de la version affichée */
  const [explicitSelectedId, setExplicitSelectedId] = useState<string | null>(null);

  const loadStudySlice = useCallback(async () => {
    setStudySliceReady(false);
    setStudyLoadError(null);
    try {
      const res = await apiFetch(`${apiBase}/api/studies/${encodeURIComponent(studyId)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `Étude ${res.status}`);
      }
      const body = (await res.json()) as {
        study?: { lead_id?: string | null };
        versions?: Array<{ id: string; version_number: number; data?: Record<string, unknown> }>;
      };
      const lid = body.study?.lead_id ?? null;
      setLeadId(lid);
      const ver = body.versions?.find((x) => x.id === versionId);
      const raw = ver?.data?.selected_meter_id;
      const ex =
        typeof raw === "string" && raw.trim() !== ""
          ? raw.trim()
          : null;
      setExplicitSelectedId(ex);
    } catch (e) {
      setLeadId(null);
      setExplicitSelectedId(null);
      setStudyLoadError(e instanceof Error ? e.message : "Erreur chargement étude");
    } finally {
      setStudySliceReady(true);
    }
  }, [apiBase, studyId, versionId]);

  useEffect(() => {
    void loadStudySlice();
  }, [loadStudySlice]);

  const loadMeters = useCallback(async () => {
    if (!leadId) {
      setMeters(null);
      return;
    }
    setMetersError(null);
    setMeters(null);
    try {
      const res = await apiFetch(`${apiBase}/api/leads/${encodeURIComponent(leadId)}/meters`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `Compteurs ${res.status}`);
      }
      const list = (await res.json()) as LeadMeterListItem[];
      setMeters(Array.isArray(list) ? list : []);
    } catch (e) {
      setMeters([]);
      setMetersError(e instanceof Error ? e.message : "Erreur compteurs");
    }
  }, [apiBase, leadId]);

  useEffect(() => {
    void loadMeters();
  }, [loadMeters]);

  const defaultMeterId = useMemo(() => {
    if (!meters || meters.length === 0) return null;
    return meters.find((m) => m.is_default)?.id ?? meters[0]?.id ?? null;
  }, [meters]);

  /** Compteur effectivement utilisé par le moteur : explicite sinon défaut */
  const effectiveMeterId = useMemo(() => {
    if (explicitSelectedId && meters?.some((m) => m.id === explicitSelectedId)) {
      return explicitSelectedId;
    }
    return defaultMeterId;
  }, [explicitSelectedId, meters, defaultMeterId]);

  const usesDefaultFallback = explicitSelectedId == null && effectiveMeterId != null;

  const listItemForEffective = useMemo(
    () => meters?.find((m) => m.id === effectiveMeterId) ?? null,
    [meters, effectiveMeterId]
  );

  useEffect(() => {
    if (!leadId || !effectiveMeterId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void (async () => {
      try {
        const res = await apiFetch(
          `${apiBase}/api/leads/${encodeURIComponent(leadId)}/meters/${encodeURIComponent(effectiveMeterId)}`
        );
        if (!res.ok) {
          if (!cancelled) setDetail(null);
          return;
        }
        const json = (await res.json()) as { meter?: Record<string, unknown> };
        if (!cancelled) {
          setDetail(json.meter ?? null);
          const kva = json.meter?.meter_power_kva;
          const n = kva != null ? Number(kva) : NaN;
          if (Number.isFinite(n) && n > 0) {
            onMeterPowerKvaResolved?.(n);
          } else {
            onMeterPowerKvaResolved?.(9);
          }
        }
      } catch {
        if (!cancelled) setDetail(null);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, leadId, effectiveMeterId, onMeterPowerKvaResolved]);

  const handleChooseMeter = async (meterId: string) => {
    if (locked || !studyId || saving) return;
    const alreadyResolved =
      meterId === effectiveMeterId &&
      (explicitSelectedId === meterId ||
        (explicitSelectedId == null &&
          defaultMeterId != null &&
          meterId === defaultMeterId));
    if (alreadyResolved) {
      setModalOpen(false);
      return;
    }
    setSaving(true);
    try {
      const merged = await postStudyVersionDataMerge(studyId, { selected_meter_id: meterId });
      const cv = merged.study?.current_version;
      const newId = resolveCurrentVersionId(merged, cv);
      if (!newId) {
        throw new Error("Réponse serveur : nouvelle version introuvable");
      }
      setModalOpen(false);
      onCalcContextInvalidated?.();
      navigate(`/studies/${studyId}/versions/${newId}/quote-builder`, { replace: true });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Impossible de changer de compteur");
    } finally {
      setSaving(false);
    }
  };

  if (studyLoadError) {
    return (
      <section className="sqb-study-meter sqb-study-meter--error" aria-live="polite">
        <p className="sqb-text sqb-muted">{studyLoadError}</p>
      </section>
    );
  }

  if (!studySliceReady) {
    return (
      <section className="sqb-study-meter sqb-study-meter--muted" aria-live="polite">
        <p className="sqb-text sqb-muted">Chargement du contexte étude…</p>
      </section>
    );
  }

  if (!leadId) {
    return (
      <section className="sqb-study-meter sqb-study-meter--muted" aria-live="polite">
        <p className="sqb-text sqb-muted">Aucun lead associé — sélection de compteur indisponible.</p>
      </section>
    );
  }

  const d = detail;
  const name = (d?.name as string) || listItemForEffective?.name || "—";
  const pdl = (d?.consumption_pdl as string) || listItemForEffective?.consumption_pdl || "—";
  const kva = d?.meter_power_kva ?? listItemForEffective?.meter_power_kva;
  const grid = formatGridTypeLabel((d?.grid_type as string) || listItemForEffective?.grid_type || null);
  const conso = d
    ? annualKwhDisplay({
        consumption_mode: d.consumption_mode as string,
        consumption_annual_kwh: d.consumption_annual_kwh as number,
        consumption_annual_calculated_kwh: d.consumption_annual_calculated_kwh as number,
      })
    : listItemForEffective
      ? annualKwhDisplay(listItemForEffective)
      : "—";
  const isDefaultRow =
    (d?.is_default as boolean) === true || listItemForEffective?.is_default === true;

  return (
    <>
      <section className="sqb-study-meter" aria-labelledby="sqb-study-meter-title">
        <div className="sqb-study-meter__head">
          <div>
            <h2 id="sqb-study-meter-title" className="sqb-study-meter__title">
              Compteur de référence de cette étude
            </h2>
            <p className="sqb-study-meter__subtitle">
              Les calculs et projections sont basés sur ce compteur
            </p>
          </div>
          {!locked && meters && meters.length > 0 && (
            <button
              type="button"
              className="sn-btn sn-btn-outline-gold sn-btn-sm"
              disabled={saving || detailLoading}
              onClick={() => setModalOpen(true)}
            >
              Changer
            </button>
          )}
        </div>

        {metersError && (
          <p className="sqb-study-meter__warn" role="alert">
            {metersError}
          </p>
        )}

        {meters && meters.length === 0 && !metersError && (
          <p className="sqb-study-meter__hint" role="status">
            Aucun compteur sur ce dossier. Ajoutez-en depuis la fiche lead (Vue générale).
          </p>
        )}

        {usesDefaultFallback && !metersError && meters && meters.length > 0 && (
          <p className="sqb-study-meter__hint-stack">
            <span className="sn-badge sn-badge-warn">Compteur par défaut utilisé</span>
          </p>
        )}

        {!isDefaultRow && !usesDefaultFallback && (
          <>
            <p className="sqb-study-meter__hint-stack">
              <span className="sn-badge sn-badge-neutral">Hors compteur principal</span>
            </p>
            <p className="sqb-study-meter__hint">
              Ce compteur n’est pas le compteur principal du site.
            </p>
          </>
        )}

        <div className={`sqb-study-meter__card${detailLoading ? " sqb-study-meter__card--loading" : ""}`}>
          <dl className="sqb-study-meter__dl">
            <div>
              <dt>Nom</dt>
              <dd>{detailLoading ? "…" : name}</dd>
            </div>
            <div>
              <dt>PDL</dt>
              <dd>{detailLoading ? "…" : pdl || "—"}</dd>
            </div>
            <div>
              <dt>Puissance compteur</dt>
              <dd>{detailLoading ? "…" : kva != null && Number.isFinite(Number(kva)) ? `${kva} kVA` : "—"}</dd>
            </div>
            <div>
              <dt>Réseau</dt>
              <dd>{detailLoading ? "…" : grid}</dd>
            </div>
            <div>
              <dt>Consommation annuelle</dt>
              <dd>{detailLoading ? "…" : conso}</dd>
            </div>
            <div>
              <dt>Heures pleines / creuses</dt>
              <dd>
                {detailLoading
                  ? "…"
                  : d?.hp_hc === true
                    ? "Oui"
                    : d?.hp_hc === false
                      ? "Non"
                      : "—"}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {modalOpen && meters && meters.length > 0 && (
        <div
          className="sqb-study-meter-modal-root"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sqb-study-meter-modal-title"
        >
          <button
            type="button"
            className="sqb-study-meter-modal-backdrop"
            aria-label="Fermer"
            onClick={() => !saving && setModalOpen(false)}
          />
          <div className="sqb-study-meter-modal-panel">
            <div className="sqb-study-meter-modal-head">
              <h3 id="sqb-study-meter-modal-title">Choisir le compteur de référence</h3>
              <button
                type="button"
                className="sn-btn sn-btn-ghost sn-btn-sm"
                disabled={saving}
                onClick={() => setModalOpen(false)}
              >
                Fermer
              </button>
            </div>
            <ul className="sqb-study-meter-modal-list">
              {meters.map((m) => (
                <li key={m.id} className="sqb-study-meter-modal-item">
                  <div className="sqb-study-meter-modal-item__main">
                    <span className="sqb-study-meter-modal-item__name">{m.name || "Sans nom"}</span>
                    {m.is_default ? (
                      <span className="sn-badge sn-badge-success">Principal</span>
                    ) : null}
                    <p className="sqb-study-meter-modal-item__meta">
                      {annualKwhDisplay(m)} ·{" "}
                      {m.meter_power_kva != null ? `${m.meter_power_kva} kVA` : "— kVA"} ·{" "}
                      {formatGridTypeLabel(m.grid_type)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="sn-btn sn-btn-outline-gold sn-btn-sm"
                    disabled={saving}
                    onClick={() => void handleChooseMeter(m.id)}
                  >
                    Choisir ce compteur
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
