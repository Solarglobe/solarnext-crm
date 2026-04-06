/**
 * Modal création / édition compteur — état 100 % local jusqu’à « Enregistrer » (pas d’autosave).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import JSZip from "jszip";
import { apiFetch } from "../../../services/api";
import { ModalShell } from "../../../components/ui/ModalShell";
import type { OverviewLeadSnapshot } from "./overviewSave";
import { applyMeterRowToLeadSnapshot, buildMeterAutosavePayload } from "./overviewSave";
import {
  formatEnergyKwh,
  formatEnergyKwhPerYear,
} from "./leadEnergyFormat";
import MonthlyConsumptionGrid from "./MonthlyConsumptionGrid";
import {
  CONSUMPTION_PROFILE_OPTIONS,
  GRID_TYPE_OPTIONS,
  TARIFF_TYPE_OPTIONS,
} from "./meterFormOptions";
import type { EquipementActuelParams, EquipementsAVenir } from "./equipmentPilotageHelpers";
import type { EquipmentItem, EquipmentKind, EquipmentV2 } from "./equipmentTypes";
import {
  createDefaultEquipmentItem,
  ensureActuelV2FromApi,
  ensureAvenirV2FromApi,
  legacyActuelStringFromItems,
} from "./equipmentV2Normalize";
import { buildOrderedEquipmentGroups, equipmentGroupKey } from "./equipmentGrouping";
import EquipmentCard from "./EquipmentCard";

const EQUIPMENT_ADD_CHOICES: {
  kind: EquipmentKind;
  label: string;
  pac_type?: "air_eau" | "air_air";
}[] = [
  { kind: "ve", label: "Véhicule électrique" },
  { kind: "pac", label: "PAC air / eau — chauffage", pac_type: "air_eau" },
  { kind: "pac", label: "PAC air / air — chauffage + froid", pac_type: "air_air" },
  { kind: "ballon", label: "Ballon ECS" },
];

export interface EnergyEngineResult {
  annual_kwh: number;
  hourly: number[];
  debug?: { service_annual_kwh?: number; sum_hourly?: number };
}

function parseEnergyEngineFromProfile(ep: unknown): EnergyEngineResult | null {
  if (!ep || typeof ep !== "object") return null;
  const o = ep as {
    engine?: EnergyEngineResult;
    summary?: { annual_kwh?: number };
    hourly?: number[];
  };
  const e = o.engine;
  if (
    e &&
    typeof e.annual_kwh === "number" &&
    Number.isFinite(e.annual_kwh) &&
    Array.isArray(e.hourly) &&
    e.hourly.length >= 8760
  ) {
    return {
      annual_kwh: e.annual_kwh,
      hourly: e.hourly.slice(0, 8760),
      debug: e.debug,
    };
  }
  if (
    typeof o.summary?.annual_kwh === "number" &&
    Number.isFinite(o.summary.annual_kwh) &&
    Array.isArray(o.hourly) &&
    o.hourly.length >= 8760
  ) {
    return {
      annual_kwh: o.summary.annual_kwh,
      hourly: o.hourly.slice(0, 8760),
    };
  }
  return null;
}

function defaultMonths(): { month: number; kwh: number }[] {
  return Array.from({ length: 12 }, (_, i) => ({ month: i + 1, kwh: 0 }));
}

function emptyDraft(): OverviewLeadSnapshot {
  return {
    consumption_mode: "ANNUAL",
    hp_hc: false,
    grid_type: "",
    consumption_profile: "",
    tariff_type: "",
    supplier_name: "",
    consumption_pdl: "",
    consumption_annual_kwh: undefined,
    consumption_annual_calculated_kwh: undefined,
    equipement_actuel: null,
    equipement_actuel_params: null,
    equipements_a_venir: null,
    energy_profile: null,
  };
}

export interface LeadMeterModalProps {
  open: boolean;
  mode: "create" | "edit";
  meterId: string | null;
  leadId: string;
  apiBase: string;
  /** Pour libellé par défaut « Compteur N » si le nom est vide. */
  nextMeterOrdinal: number;
  onClose: () => void;
  /** Après succès API — parent rafraîchit liste / sélection. */
  onSaveSuccess: (result: { meterId: string; created: boolean }) => void;
}

export default function LeadMeterModal({
  open,
  mode,
  meterId,
  leadId,
  apiBase,
  nextMeterOrdinal,
  onClose,
  onSaveSuccess,
}: LeadMeterModalProps) {
  const [meterName, setMeterName] = useState("");
  const [draft, setDraft] = useState<OverviewLeadSnapshot>(() => emptyDraft());
  const [monthlyLocal, setMonthlyLocal] = useState(defaultMonths);
  const [energyEngine, setEnergyEngine] = useState<EnergyEngineResult | null>(null);
  const [energyFileName, setEnergyFileName] = useState<string | null>(null);
  const [energyLoading, setEnergyLoading] = useState(false);
  const [energyError, setEnergyError] = useState<string | null>(null);
  const [equipmentKindPicker, setEquipmentKindPicker] = useState<null | "actuel" | "avenir">(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const patchDraft = useCallback((p: Partial<OverviewLeadSnapshot>) => {
    setDraft((d) => ({ ...d, ...p }));
  }, []);

  const consumptionMode = draft.consumption_mode || "ANNUAL";
  const monthsMap = useMemo(
    () => Object.fromEntries(monthlyLocal.map((m) => [m.month, m.kwh])) as Record<number, number>,
    [monthlyLocal]
  );

  const annualFromEngine =
    consumptionMode === "PDL" && energyEngine != null && Number.isFinite(energyEngine.annual_kwh)
      ? energyEngine.annual_kwh
      : null;
  const annualCalculated =
    consumptionMode === "ANNUAL"
      ? draft.consumption_annual_kwh ?? 0
      : consumptionMode === "MONTHLY"
        ? draft.consumption_annual_calculated_kwh ?? 0
        : annualFromEngine;

  const actuelV2View = useMemo(
    () => ensureActuelV2FromApi(draft.equipement_actuel_params, draft.equipement_actuel ?? null),
    [draft.equipement_actuel_params, draft.equipement_actuel]
  );
  const avenirV2View = useMemo(
    () => ensureAvenirV2FromApi(draft.equipements_a_venir),
    [draft.equipements_a_venir]
  );
  const actuelGroups = useMemo(
    () => buildOrderedEquipmentGroups(actuelV2View.items),
    [actuelV2View.items]
  );
  const avenirGroups = useMemo(
    () => buildOrderedEquipmentGroups(avenirV2View.items),
    [avenirV2View.items]
  );

  const resetCreate = useCallback(() => {
    setMeterName("");
    setDraft(emptyDraft());
    setMonthlyLocal(defaultMonths());
    setEnergyEngine(null);
    setEnergyFileName(null);
    setEnergyError(null);
    setDetailError(null);
    setSaveError(null);
    setEquipmentKindPicker(null);
  }, []);

  useEffect(() => {
    if (!open) return;

    if (mode === "create") {
      resetCreate();
      setDetailLoading(false);
      return;
    }

    if (mode !== "edit" || !meterId) return;

    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    setSaveError(null);

    void (async () => {
      try {
        const res = await apiFetch(`${apiBase}/api/leads/${leadId}/meters/${meterId}`);
        if (cancelled) return;
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          const msg =
            (errBody as { error?: string }).error || `Chargement compteur (${res.status})`;
          setDetailError(msg);
          return;
        }
        const json = (await res.json()) as {
          meter?: Record<string, unknown>;
          consumption_monthly?: { month: number; kwh: number }[];
        };
        if (cancelled || !json.meter) {
          if (!cancelled) setDetailError("Réponse compteur invalide");
          return;
        }
        const m = json.meter;
        setMeterName(String(m.name ?? ""));
        setDraft((prev) => ({
          ...prev,
          ...applyMeterRowToLeadSnapshot(m),
        }));
        setMonthlyLocal(
          Array.isArray(json.consumption_monthly) && json.consumption_monthly.length > 0
            ? json.consumption_monthly
            : defaultMonths()
        );
        setEnergyEngine(parseEnergyEngineFromProfile(m.energy_profile));
        setEnergyFileName(null);
        setEnergyError(null);
      } catch (e) {
        if (!cancelled) {
          setDetailError(e instanceof Error ? e.message : "Erreur réseau");
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, mode, meterId, leadId, apiBase, resetCreate]);

  const handleEnedisAuth = () => {
    window.open(`${apiBase}/api/enedis/connect`, "_blank", "noopener,noreferrer");
  };

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setEnergyError(null);
    setEnergyLoading(true);

    try {
      let csvContent = "";

      if (file.name.toLowerCase().endsWith(".csv")) {
        csvContent = await file.text();
      } else if (file.name.toLowerCase().endsWith(".zip")) {
        const zip = await JSZip.loadAsync(file);
        const csvFiles = Object.keys(zip.files).filter((name) =>
          name.toLowerCase().endsWith(".csv")
        );
        const loadCurveFile = csvFiles.find((name) =>
          name.toLowerCase().includes("loadcurve")
        );

        if (!loadCurveFile) {
          setEnergyError("Aucun loadcurve.csv trouvé dans le ZIP");
          setEnergyLoading(false);
          return;
        }

        csvContent = await zip.files[loadCurveFile].async("text");
        setEnergyFileName(loadCurveFile);
      } else {
        setEnergyError("Format non supporté");
        setEnergyLoading(false);
        return;
      }

      const res = await apiFetch(`${apiBase}/api/energy/compute-from-csv`, {
        method: "POST",
        body: JSON.stringify({
          leadId,
          loadCurveCsv: csvContent,
          params: {
            puissance_kva: draft.meter_power_kva,
            reseau_type: (draft.grid_type || "mono").toLowerCase() === "tri" ? "tri" : "mono",
          },
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg =
          typeof (errBody as { error?: string }).error === "string"
            ? (errBody as { error: string }).error
            : "Erreur import fichier";
        throw new Error(msg);
      }

      const payload = (await res.json()) as EnergyEngineResult;
      const next: EnergyEngineResult = {
        annual_kwh: payload.annual_kwh,
        hourly: payload.hourly,
        debug: payload.debug,
      };
      setEnergyEngine(next);
      patchDraft({ energy_profile: { engine: next } });
      if (!file.name.toLowerCase().endsWith(".zip")) {
        setEnergyFileName(file.name);
      }
    } catch (err) {
      setEnergyError(err instanceof Error ? err.message : "Erreur import fichier");
    }

    setEnergyLoading(false);
  };

  /** Uniquement état local — la suppression réelle part au clic « Enregistrer » (pas de PATCH silencieux). */
  const handleDeleteEnergyProfile = () => {
    setEnergyEngine(null);
    patchDraft({ energy_profile: null });
    setEnergyFileName(null);
    setEnergyError(null);
  };

  const addEquipmentItem = (
    target: "actuel" | "avenir",
    spec: { kind: EquipmentKind; pac_type?: "air_eau" | "air_air" }
  ) => {
    const item = createDefaultEquipmentItem(
      spec.kind,
      spec.kind === "pac" ? { pac_type: spec.pac_type } : undefined
    );
    if (target === "actuel") {
      const cur = ensureActuelV2FromApi(draft.equipement_actuel_params, draft.equipement_actuel ?? null);
      const key = equipmentGroupKey(item);
      let insertAt = cur.items.length;
      for (let i = cur.items.length - 1; i >= 0; i--) {
        if (equipmentGroupKey(cur.items[i]) === key) {
          insertAt = i + 1;
          break;
        }
      }
      const nextItems = [...cur.items.slice(0, insertAt), item, ...cur.items.slice(insertAt)];
      const next: EquipmentV2 = { schemaVersion: 2, items: nextItems };
      patchDraft({
        equipement_actuel: legacyActuelStringFromItems(next.items),
        equipement_actuel_params: next as unknown as EquipementActuelParams,
      });
    } else {
      const cur = ensureAvenirV2FromApi(draft.equipements_a_venir);
      const key = equipmentGroupKey(item);
      let insertAt = cur.items.length;
      for (let i = cur.items.length - 1; i >= 0; i--) {
        if (equipmentGroupKey(cur.items[i]) === key) {
          insertAt = i + 1;
          break;
        }
      }
      const nextItems = [...cur.items.slice(0, insertAt), item, ...cur.items.slice(insertAt)];
      const next: EquipmentV2 = { schemaVersion: 2, items: nextItems };
      patchDraft({
        equipements_a_venir: next as unknown as EquipementsAVenir,
      });
    }
    setEquipmentKindPicker(null);
  };

  const addEquipmentUnit = (target: "actuel" | "avenir", template: EquipmentItem) => {
    addEquipmentItem(target, {
      kind: template.kind,
      pac_type: template.kind === "pac" ? (template.pac_type === "air_air" ? "air_air" : "air_eau") : undefined,
    });
  };

  const updateActuelItemById = (id: string, item: EquipmentItem) => {
    const cur = ensureActuelV2FromApi(draft.equipement_actuel_params, draft.equipement_actuel ?? null);
    const idx = cur.items.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const items = [...cur.items];
    items[idx] = item;
    const next: EquipmentV2 = { schemaVersion: 2, items };
    patchDraft({
      equipement_actuel: legacyActuelStringFromItems(next.items),
      equipement_actuel_params: next as unknown as EquipementActuelParams,
    });
  };

  const removeActuelItemById = (id: string) => {
    const cur = ensureActuelV2FromApi(draft.equipement_actuel_params, draft.equipement_actuel ?? null);
    const next: EquipmentV2 = {
      schemaVersion: 2,
      items: cur.items.filter((x) => x.id !== id),
    };
    patchDraft({
      equipement_actuel: legacyActuelStringFromItems(next.items),
      equipement_actuel_params: next as unknown as EquipementActuelParams,
    });
  };

  const removeActuelGroup = (groupItems: EquipmentItem[]) => {
    const drop = new Set(groupItems.map((x) => x.id));
    const cur = ensureActuelV2FromApi(draft.equipement_actuel_params, draft.equipement_actuel ?? null);
    const next: EquipmentV2 = {
      schemaVersion: 2,
      items: cur.items.filter((x) => !drop.has(x.id)),
    };
    patchDraft({
      equipement_actuel: legacyActuelStringFromItems(next.items),
      equipement_actuel_params: next as unknown as EquipementActuelParams,
    });
  };

  const updateAvenirItemById = (id: string, item: EquipmentItem) => {
    const cur = ensureAvenirV2FromApi(draft.equipements_a_venir);
    const idx = cur.items.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const items = [...cur.items];
    items[idx] = item;
    const next: EquipmentV2 = { schemaVersion: 2, items };
    patchDraft({
      equipements_a_venir: next as unknown as EquipementsAVenir,
    });
  };

  const removeAvenirItemById = (id: string) => {
    const cur = ensureAvenirV2FromApi(draft.equipements_a_venir);
    const next: EquipmentV2 = {
      schemaVersion: 2,
      items: cur.items.filter((x) => x.id !== id),
    };
    patchDraft({
      equipements_a_venir: next as unknown as EquipementsAVenir,
    });
  };

  const removeAvenirGroup = (groupItems: EquipmentItem[]) => {
    const drop = new Set(groupItems.map((x) => x.id));
    const cur = ensureAvenirV2FromApi(draft.equipements_a_venir);
    const next: EquipmentV2 = {
      schemaVersion: 2,
      items: cur.items.filter((x) => !drop.has(x.id)),
    };
    patchDraft({
      equipements_a_venir: next as unknown as EquipementsAVenir,
    });
  };

  const handleSave = async () => {
    setSaveError(null);
    const nameTrim = meterName.trim();
    const resolvedName = nameTrim || `Compteur ${nextMeterOrdinal}`;

    const energy_profile =
      energyEngine != null ? { engine: energyEngine } : draft.energy_profile ?? null;

    const snapshot: OverviewLeadSnapshot = {
      ...draft,
      energy_profile,
    };

    const payload = buildMeterAutosavePayload(snapshot, resolvedName, monthlyLocal);

    setSaving(true);
    try {
      if (mode === "create") {
        const resPost = await apiFetch(`${apiBase}/api/leads/${leadId}/meters`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: resolvedName }),
        });
        if (!resPost.ok) {
          const err = await resPost.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error || `Création (HTTP ${resPost.status})`);
        }
        const created = (await resPost.json()) as { id: string };
        if (!created?.id) throw new Error("Réponse création invalide");

        const resPatch = await apiFetch(`${apiBase}/api/leads/${leadId}/meters/${created.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!resPatch.ok) {
          const err = await resPatch.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error || `Mise à jour (HTTP ${resPatch.status})`);
        }
        onSaveSuccess({ meterId: created.id, created: true });
      } else {
        if (!meterId) throw new Error("Compteur manquant");
        const resPatch = await apiFetch(`${apiBase}/api/leads/${leadId}/meters/${meterId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!resPatch.ok) {
          const err = await resPatch.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error || `Mise à jour (HTTP ${resPatch.status})`);
        }
        onSaveSuccess({ meterId, created: false });
      }
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  const ready = mode === "create" || (!detailLoading && !detailError);
  const title = mode === "create" ? "Nouveau compteur" : "Modifier le compteur";

  return (
    <ModalShell
      open={open}
      onClose={() => !saving && onClose()}
      title={title}
      size="xl"
      closeOnBackdropClick={!saving}
      panelClassName="crm-lead-meter-modal-panel"
      bodyClassName="crm-lead-meter-modal-body"
      footer={
        <div className="crm-lead-meter-modal__footer">
          <button
            type="button"
            className="sn-btn sn-btn-ghost"
            disabled={saving}
            onClick={onClose}
          >
            Annuler
          </button>
          <button
            type="button"
            className="sn-btn sn-btn-primary"
            disabled={saving || !ready}
            onClick={() => void handleSave()}
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      }
    >
      {detailLoading ? (
        <p className="crm-lead-meter-modal__status">Chargement du compteur…</p>
      ) : null}
      {detailError ? (
        <p className="crm-lead-meter-modal__error" role="alert">
          {detailError}
        </p>
      ) : null}
      {saveError ? (
        <p className="crm-lead-meter-modal__error" role="alert">
          {saveError}
        </p>
      ) : null}

      {ready ? (
        <div className="crm-lead-meter-modal__form">
          <div className="crm-lead-field crm-lead-field--meter-name">
            <label htmlFor="lead-meter-modal-name">Nom du compteur</label>
            <input
              id="lead-meter-modal-name"
              className="sn-input"
              value={meterName}
              onChange={(e) => setMeterName(e.target.value)}
              placeholder={
                mode === "create"
                  ? `Ex. Compteur ${nextMeterOrdinal}`
                  : "Ex. Maison principale"
              }
              autoComplete="off"
            />
          </div>

          <h3 className="crm-lead-meter-modal__h3">Consommation</h3>
          <div className="crm-lead-field">
            <label>Mode de conso</label>
            <select
              className="sn-input"
              value={consumptionMode}
              onChange={(e) =>
                patchDraft({
                  consumption_mode: e.target.value as "ANNUAL" | "MONTHLY" | "PDL",
                })
              }
            >
              <option value="ANNUAL">Annuel</option>
              <option value="MONTHLY">Mensuel</option>
              <option value="PDL">PDL</option>
            </select>
          </div>
          {consumptionMode === "ANNUAL" && (
            <div className="crm-lead-field">
              <label>kWh annuel</label>
              <input
                className="sn-input"
                type="number"
                min={0}
                value={draft.consumption_annual_kwh ?? ""}
                onChange={(e) =>
                  patchDraft({
                    consumption_annual_kwh:
                      e.target.value === "" ? undefined : parseInt(e.target.value, 10),
                  })
                }
              />
            </div>
          )}
          {consumptionMode === "MONTHLY" && (
            <MonthlyConsumptionGrid
              monthsMap={monthsMap}
              onMonthsChange={setMonthlyLocal}
            />
          )}
          {consumptionMode === "PDL" && (
            <>
              {(() => {
                const annual = energyEngine?.annual_kwh;
                return energyEngine ? (
                  <div className="crm-lead-energy-status crm-lead-energy-status-ok">
                    {`Profil chargé (moteur)${annual != null && Number.isFinite(annual) ? ` • ${formatEnergyKwhPerYear(annual)}` : ""}`}
                  </div>
                ) : (
                  <div className="crm-lead-energy-status crm-lead-energy-status-empty">
                    Aucun profil importé
                  </div>
                );
              })()}
              <div className="energy-pdl-actions crm-lead-pdl-actions">
                <button type="button" className="sn-btn sn-btn-outline-gold" onClick={handleEnedisAuth}>
                  Connexion Enedis
                </button>
                <button
                  type="button"
                  className="sn-btn sn-btn-outline-gold"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Importer un CSV
                </button>
                {energyEngine ? (
                  <button
                    type="button"
                    className="sn-btn sn-btn-ghost"
                    style={{
                      border: "1px solid var(--error)",
                      color: "var(--error)",
                    }}
                    onClick={handleDeleteEnergyProfile}
                  >
                    Supprimer le profil énergie
                  </button>
                ) : null}
                <input
                  type="file"
                  accept=".csv,.zip"
                  ref={fileInputRef}
                  style={{ display: "none" }}
                  onChange={handleCsvUpload}
                />
              </div>
              {energyLoading ? <div className="sn-energy-loader">Chargement...</div> : null}
              {energyFileName && !energyLoading ? (
                <div className="sn-energy-file">
                  <span
                    className="sn-energy-file-name"
                    onClick={() => fileInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(ev) => ev.key === "Enter" && fileInputRef.current?.click()}
                  >
                    {energyFileName}
                  </span>
                  <button
                    type="button"
                    className="sn-energy-file-delete"
                    onClick={() => {
                      setEnergyFileName(null);
                      setEnergyError(null);
                      setEnergyEngine(null);
                      patchDraft({ energy_profile: null });
                    }}
                    aria-label="Supprimer le fichier"
                  >
                    ✕
                  </button>
                </div>
              ) : null}
              {energyError ? <div className="sn-energy-error">{energyError}</div> : null}
              <div className="crm-lead-field">
                <label>PDL / PRM</label>
                <input
                  className="sn-input"
                  value={draft.consumption_pdl ?? ""}
                  onChange={(e) =>
                    patchDraft({ consumption_pdl: e.target.value || undefined })
                  }
                  placeholder="Référence point de livraison"
                />
              </div>
            </>
          )}

          <div className="crm-lead-overview-subblock">
            <h3 className="crm-lead-overview-subheading">Réseau électrique, contrat et équipement</h3>
            <div className="crm-lead-fields">
              <div className="crm-lead-field">
                <label>HP/HC</label>
                <select
                  className="sn-input"
                  value={draft.hp_hc ? "yes" : "no"}
                  onChange={(e) => patchDraft({ hp_hc: e.target.value === "yes" })}
                >
                  <option value="no">Non</option>
                  <option value="yes">Oui</option>
                </select>
              </div>
              <div className="crm-lead-field">
                <label>Fournisseur</label>
                <input
                  className="sn-input"
                  value={draft.supplier_name ?? ""}
                  onChange={(e) => patchDraft({ supplier_name: e.target.value || undefined })}
                />
              </div>
              <div className="crm-lead-field">
                <label>Profil de consommation</label>
                <select
                  className="sn-input"
                  value={draft.consumption_profile ?? ""}
                  onChange={(e) =>
                    patchDraft({ consumption_profile: e.target.value || undefined })
                  }
                >
                  {CONSUMPTION_PROFILE_OPTIONS.map((o) => (
                    <option key={o.value || "_"} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="crm-lead-field">
                <label>Type de contrat</label>
                <select
                  className="sn-input"
                  value={draft.tariff_type ?? ""}
                  onChange={(e) => patchDraft({ tariff_type: e.target.value || undefined })}
                >
                  {TARIFF_TYPE_OPTIONS.map((o) => (
                    <option key={o.value || "_"} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="crm-lead-field">
                <label>Type de réseau</label>
                <select
                  className="sn-input"
                  value={draft.grid_type ?? ""}
                  onChange={(e) => patchDraft({ grid_type: e.target.value || undefined })}
                >
                  {GRID_TYPE_OPTIONS.map((o) => (
                    <option key={o.value || "_"} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="crm-lead-field">
                <label>Puissance compteur (kVA)</label>
                <input
                  className="sn-input"
                  type="number"
                  min={0}
                  step={0.1}
                  value={draft.meter_power_kva ?? ""}
                  onChange={(e) =>
                    patchDraft({
                      meter_power_kva:
                        e.target.value === "" ? undefined : parseFloat(e.target.value),
                    })
                  }
                />
              </div>
            </div>
          </div>

          <div className="crm-lead-field">
            <label>Conso annuelle calculée</label>
            <input
              className="sn-input"
              readOnly
              value={
                annualCalculated != null && Number.isFinite(annualCalculated)
                  ? formatEnergyKwh(annualCalculated)
                  : "—"
              }
            />
          </div>

          <h3 className="crm-lead-meter-modal__h3">Équipements énergétiques</h3>
          <p className="crm-lead-equipment-section-lede">
            Décrivez ce qui est déjà installé et ce que le foyer pourrait ajouter — utile pour le profil
            de charge et les études.
          </p>

          <div className="crm-lead-overview-subblock crm-lead-equipment-block crm-lead-equipment-block--actuel">
            <header className="crm-lead-equipment-block__header">
              <span className="crm-lead-equipment-block__eyebrow">Aujourd’hui</span>
              <h3 className="crm-lead-equipment-block__title">Déjà en place au foyer</h3>
            </header>
            <div className="crm-lead-equipment-toolbar">
              <button
                type="button"
                className="sn-btn sn-btn-outline-gold sn-btn-sm"
                onClick={() =>
                  setEquipmentKindPicker((p) => (p === "actuel" ? null : "actuel"))
                }
              >
                Ajouter un équipement
              </button>
            </div>
            {equipmentKindPicker === "actuel" ? (
              <div className="crm-lead-equipment-kind-picker" role="group" aria-label="Type d'équipement">
                {EQUIPMENT_ADD_CHOICES.map((c) => (
                  <button
                    key={`${c.kind}-${c.pac_type ?? ""}`}
                    type="button"
                    className="crm-lead-equipment-kind-btn"
                    onClick={() =>
                      addEquipmentItem("actuel", {
                        kind: c.kind,
                        pac_type: c.pac_type,
                      })
                    }
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="crm-lead-equipment-grid">
              {actuelGroups.map((g: { key: string; items: EquipmentItem[] }) => (
                <EquipmentCard
                  key={g.key}
                  items={g.items}
                  context="actuel"
                  onChangeItem={updateActuelItemById}
                  onRemoveItem={removeActuelItemById}
                  onAddUnit={() => addEquipmentUnit("actuel", g.items[0])}
                  onRemoveGroup={() => removeActuelGroup(g.items)}
                />
              ))}
            </div>
            {actuelV2View.items.length === 0 ? (
              <p className="crm-lead-equipment-empty">Aucun équipement renseigné pour l’instant.</p>
            ) : null}
          </div>

          <div className="crm-lead-overview-subblock crm-lead-equipment-block crm-lead-equipment-block--avenir">
            <header className="crm-lead-equipment-block__header">
              <span className="crm-lead-equipment-block__eyebrow">Projection</span>
              <h3 className="crm-lead-equipment-block__title">Envisagé ou à installer</h3>
            </header>
            <div className="crm-lead-equipment-toolbar">
              <button
                type="button"
                className="sn-btn sn-btn-outline-gold sn-btn-sm"
                onClick={() =>
                  setEquipmentKindPicker((p) => (p === "avenir" ? null : "avenir"))
                }
              >
                Ajouter un équipement
              </button>
            </div>
            {equipmentKindPicker === "avenir" ? (
              <div
                className="crm-lead-equipment-kind-picker"
                role="group"
                aria-label="Type d'équipement à venir"
              >
                {EQUIPMENT_ADD_CHOICES.map((c) => (
                  <button
                    key={`avenir-${c.kind}-${c.pac_type ?? ""}`}
                    type="button"
                    className="crm-lead-equipment-kind-btn"
                    onClick={() =>
                      addEquipmentItem("avenir", {
                        kind: c.kind,
                        pac_type: c.pac_type,
                      })
                    }
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="crm-lead-equipment-grid">
              {avenirGroups.map((g: { key: string; items: EquipmentItem[] }) => (
                <EquipmentCard
                  key={g.key}
                  items={g.items}
                  context="avenir"
                  onChangeItem={updateAvenirItemById}
                  onRemoveItem={removeAvenirItemById}
                  onAddUnit={() => addEquipmentUnit("avenir", g.items[0])}
                  onRemoveGroup={() => removeAvenirGroup(g.items)}
                />
              ))}
            </div>
            {avenirV2View.items.length === 0 ? (
              <p className="crm-lead-equipment-empty">Aucun projet d’équipement renseigné.</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </ModalShell>
  );
}
