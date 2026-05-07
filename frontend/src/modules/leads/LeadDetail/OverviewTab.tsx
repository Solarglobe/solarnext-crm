/**
 * CP-LEAD-V2 — Onglet Vue générale
 * Identité/contact, adresse, bien/foyer, maison & toiture, consommation, suivi client
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useSuperAdminReadOnly } from "../../../contexts/OrganizationContext";
import {
  fetchClientById,
  patchClient,
  type Client,
} from "../../../services/clients.service";
import {
  geoAutocomplete,
  type AutocompleteSuggestion,
} from "../../../services/address.service";
import {
  filterExploitableSuggestions,
  parseFrenchAddressParts,
  qualityUiFromSite,
  type AddressPickTier,
  type AddressQualityUi,
} from "./addressFallback";
import JSZip from "jszip";
import { apiFetch } from "../../../services/api";
import GeoValidationModal from "../../../components/GeoValidationModal";
import type { Study } from "../../../services/studies.service";
import type { Activity } from "../../../services/activities.service";
import { OverviewCardSection } from "./OverviewCardSection";
import type { Lead as LeadRow, LeadsMeta } from "../../../services/leads.service";
import { getCrmApiBase } from "../../../config/crmApiBase";
import LeadClientPortalSection from "./LeadClientPortalSection";
import {
  formatEnergyKwh,
  formatEnergyKwhPerYear,
  formatPowerKva,
} from "./leadEnergyFormat";
import LeadQuickSummary from "./LeadQuickSummary";
import LeadMairieSection from "./LeadMairieSection";
import type { EquipementActuelParams, EquipementsAVenir } from "./equipmentPilotageHelpers";
import type { EquipmentItem, EquipmentKind, EquipmentV2 } from "./equipmentTypes";
import {
  buildEquipmentV2SectionSummary,
  createDefaultEquipmentItem,
  ensureActuelV2FromApi,
  ensureAvenirV2FromApi,
  legacyActuelStringFromItems,
} from "./equipmentV2Normalize";
import { buildOrderedEquipmentGroups, equipmentGroupKey } from "./equipmentGrouping";
import EquipmentCard from "./EquipmentCard";
import MonthlyConsumptionGrid from "./MonthlyConsumptionGrid";
import {
  CONSUMPTION_PROFILE_OPTIONS,
  GRID_TYPE_OPTIONS,
  TARIFF_TYPE_OPTIONS,
} from "./meterFormOptions";
import PillPicker from "./PillPicker";
import CustomSelect from "./CustomSelect";

/** Choix d’ajout : 1 entrée = 1 groupe ou 1 ligne dans un groupe existant. */
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

/** Études + activités — pour le bandeau résumé (page fiche) */
export interface LeadOverviewSummaryProps {
  studies: Study[];
  activities: Activity[];
}

function formatLastActivityPreview(activities: Activity[] | null | undefined): {
  label: string;
  at: string;
} | null {
  if (!Array.isArray(activities) || activities.length === 0) return null;
  const sorted = [...activities].sort(
    (a, b) =>
      new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
  );
  const a = sorted[0];
  const typeLabels: Partial<Record<Activity["type"], string>> = {
    NOTE: "Note",
    CALL: "Appel",
    MEETING: "Rendez-vous",
    EMAIL: "E-mail",
    STATUS_CHANGE: "Statut",
    STAGE_CHANGE: "Étape",
    ADDRESS_VERIFIED: "Adresse",
    PROJECT_STATUS_CHANGE: "Projet",
    DEVIS_SIGNE: "Devis",
    INSTALLATION_TERMINEE: "Installation",
  };
  const label = typeLabels[a.type] ?? a.type;
  const at = new Date(a.occurred_at).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return { label, at };
}

const CIVILITY_OPTIONS = [
  { value: "", label: "—" },
  { value: "M", label: "M." },
  { value: "Mme", label: "Mme" },
  { value: "Mlle", label: "Mlle" },
];
const CUSTOMER_TYPE_OPTIONS = [
  { value: "PERSON", label: "Particulier" },
  { value: "PRO", label: "Pro" },
];
const PROPERTY_TYPE_OPTIONS = [
  { value: "", label: "—" },
  { value: "house", label: "Maison individuelle" },
  { value: "semi_detached", label: "Pavillon jumelé" },
  { value: "collective", label: "Collectif" },
  { value: "commercial", label: "Bâtiment pro" },
];
const INSULATION_OPTIONS = [
  { value: "", label: "—" },
  { value: "standard", label: "Standard" },
  { value: "good", label: "Bonne" },
  { value: "poor", label: "Mauvaise" },
];
const ROOF_TYPE_OPTIONS = [
  { value: "", label: "—" },
  { value: "tile", label: "Tuile" },
  { value: "slate", label: "Ardoise" },
  { value: "flat", label: "Terrasse" },
  { value: "metal", label: "Bac acier" },
];
const FRAME_TYPE_OPTIONS = [
  { value: "", label: "—" },
  { value: "traditional", label: "Traditionnelle" },
  { value: "truss", label: "Fermette" },
  { value: "metal", label: "Métallique" },
  { value: "concrete", label: "Béton" },
];
function labelFromOptions(options: { value: string; label: string }[], value: string | undefined): string | null {
  const o = options.find((x) => x.value === (value ?? ""));
  const lab = o?.label?.trim();
  if (!lab || lab === "—") return null;
  return lab;
}

function buildBienFoyerSummary(propertyType: string | undefined, householdSize: number | undefined): string | null {
  const pt = labelFromOptions(PROPERTY_TYPE_OPTIONS, propertyType);
  const hs = householdSize;
  const parts: string[] = [];
  if (pt) parts.push(pt);
  if (hs != null && hs > 0) parts.push(`${hs} pers.`);
  return parts.length ? parts.join(" • ") : null;
}

function buildMaisonToitureSummary(
  roofType: string | undefined,
  frameType: string | undefined
): string | null {
  const roof = labelFromOptions(ROOF_TYPE_OPTIONS, roofType);
  const frame = labelFromOptions(FRAME_TYPE_OPTIONS, frameType);
  const parts: string[] = [];
  if (roof) parts.push(roof);
  if (frame) parts.push(frame);
  return parts.length ? parts.join(" • ") : null;
}

function buildAddressOverviewSummary(
  siteAddr: { city?: string } | null,
  addressQualityUi: AddressQualityUi,
  isGeoVerified: boolean
): string | null {
  if (!siteAddr) return null;
  if (isGeoVerified) return "Emplacement validé (parcelle)";
  const city = siteAddr.city?.trim();
  if (addressQualityUi === "validated") return "Validé (parcelle)";
  if (addressQualityUi === "exact" || addressQualityUi === "pending_manual") {
    return city ? `${city} — à confirmer sur carte` : "À confirmer sur carte";
  }
  if (addressQualityUi === "approx_street" || addressQualityUi === "approx_city") {
    return city ? `${city} — position approximative` : "Position approximative";
  }
  return city || null;
}

function buildConsommationSummary(annualKwh: number | null | undefined, meterKva: number | undefined | null): string | null {
  const kwhPart =
    annualKwh != null && Number.isFinite(annualKwh) ? formatEnergyKwh(annualKwh) : "—";
  const kvaPart =
    meterKva != null && Number.isFinite(meterKva) ? formatPowerKva(meterKva) : null;
  const bits: string[] = [];
  if (kwhPart !== "—") bits.push(kwhPart);
  if (kvaPart && kvaPart !== "—") bits.push(kvaPart);
  return bits.length ? bits.join(" • ") : null;
}

function formatConsentDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "—";
  }
}

function ConsentToggle({
  label,
  checked,
  disabled,
  savedAt,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  savedAt?: string | null;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`lead-consent-toggle${checked ? " lead-consent-toggle--on" : ""}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="lead-consent-toggle__control" aria-hidden />
      <span className="lead-consent-toggle__text">
        <span className="lead-consent-toggle__label">{label}</span>
        <span className="lead-consent-toggle__date">{formatConsentDate(savedAt)}</span>
      </span>
    </label>
  );
}

function ClientTableConsentSection({
  clientId,
  readOnly,
}: {
  clientId: string;
  readOnly: boolean;
}) {
  const [row, setRow] = useState<Client | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    fetchClientById(clientId)
      .then((r) => {
        if (!cancelled) setRow(r);
      })
      .catch((e: Error) => {
        if (!cancelled) setErr(e?.message || "Erreur");
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const patch = async (body: Partial<Client>) => {
    if (readOnly) return;
    setBusy(true);
    try {
      const next = await patchClient(clientId, body);
      setRow(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lead-consent-source" data-consent-source="client">
      <div className="lead-consent-source__head">
        <span className="lead-consent-source__title">Client</span>
        {row?.client_number ? <span className="lead-consent-source__ref">N° {row.client_number}</span> : null}
      </div>
      {err ? <p className="crm-lead-warning">{err}</p> : null}
      {!row && !err ? <p className="sn-muted">Chargement…</p> : null}
      {row ? (
        <div className="lead-consent-actions">
          <ConsentToggle
            label="RGPD"
            checked={Boolean(row.rgpd_consent)}
            disabled={readOnly || busy}
            savedAt={row.rgpd_consent_at}
            onChange={(checked) => void patch({ rgpd_consent: checked })}
          />
          <ConsentToggle
            label="Marketing"
            checked={Boolean(row.marketing_opt_in)}
            disabled={readOnly || busy}
            savedAt={row.marketing_opt_in_at}
            onChange={(checked) => void patch({ marketing_opt_in: checked })}
          />
        </div>
      ) : null}
    </div>
  );
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debouncedValue;
}

export interface OverviewLead {
  id?: string;
  civility?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  /** PRO : nom de l'entreprise — devient le full_name pivot */
  company_name?: string;
  /** PRO : contact physique au sein de l'entreprise */
  contact_first_name?: string;
  contact_last_name?: string;
  /** PRO : numéro SIRET (14 chiffres) */
  siret?: string | null;
  customer_type?: "PERSON" | "PRO";
  /** ISO YYYY-MM-DD — mandat de représentation DP */
  birth_date?: string | null;
  email?: string;
  phone?: string;
  phone_mobile?: string;
  phone_landline?: string;
  address?: string;
  source_id?: string;
  /** Exposé par l’API détail pour affichage ; la sélection reste sur source_id */
  source_slug?: string | null;
  status?: string;
  consumption_mode?: "ANNUAL" | "MONTHLY" | "PDL";
  consumption_annual_kwh?: number;
  consumption_annual_calculated_kwh?: number;
  consumption_pdl?: string;
  hp_hc?: boolean;
  supplier_name?: string;
  consumption_profile?: string;
  tariff_type?: string;
  grid_type?: string;
  meter_power_kva?: number;
  property_type?: string;
  household_size?: number;
  construction_year?: number;
  insulation_level?: string;
  roof_type?: string;
  frame_type?: string;
  assigned_user_id?: string;
  site_address_id?: string;
  /** Stocké côté API : { engine: { annual_kwh, hourly, debug? } } (conso moteur) */
  energy_profile?: Record<string, unknown> | unknown | null;
  equipement_actuel?: string | null;
  equipement_actuel_params?: EquipementActuelParams | EquipmentV2 | null;
  equipements_a_venir?: EquipementsAVenir | EquipmentV2 | null;
  rgpd_consent?: boolean;
  rgpd_consent_at?: string | null;
  marketing_opt_in?: boolean;
  marketing_opt_in_at?: string | null;
  client_id?: string;
  mairie_id?: string | null;
  mairie_name?: string | null;
  mairie_postal_code?: string | null;
  mairie_city?: string | null;
  mairie_portal_url?: string | null;
  mairie_portal_type?: string | null;
  mairie_account_status?: string | null;
  mairie_account_email?: string | null;
  mairie_bitwarden_ref?: string | null;
}

interface SiteAddress {
  id: string;
  address_line1?: string;
  address_line2?: string;
  postal_code?: string;
  city?: string;
  country_code?: string;
  formatted_address?: string;
  lat?: number;
  lon?: number;
  geo_precision_level?: string;
  geo_source?: string;
  is_geo_verified?: boolean;
}

/** Normalise pour comparer saisie / adresse enregistrée (évite réouverture intempestive de l’autocomplete). */
function normalizeAddressKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[,;]/g, " ")
    .replace(/\s+/g, " ");
}

function debouncedMatchesSavedSiteAddress(debounced: string, site: SiteAddress | null): boolean {
  if (!site?.id) return false;
  const d = normalizeAddressKey(debounced);
  if (!d) return false;
  if (site.formatted_address && normalizeAddressKey(site.formatted_address) === d) return true;
  const parts = [site.address_line1, site.postal_code, site.city].filter(Boolean).join(" ");
  if (parts.length >= 5 && normalizeAddressKey(parts) === d) return true;
  return false;
}

type AddressSuggestionWithTier = AutocompleteSuggestion & { pickTier?: AddressPickTier };

type AddressFallbackHint =
  | { kind: "street_city"; message: string; queryUsed: string }
  | { kind: "city_only"; message: string; queryUsed: string };

/** Conso moteur (loadConsumption + sum hourly) — aligné sur calculateSmartpitch */
export interface EnergyEngineResult {
  annual_kwh: number;
  hourly: number[];
  debug?: { service_annual_kwh?: number; sum_hourly?: number };
}

interface OverviewTabProps {
  lead: OverviewLead;
  siteAddress: SiteAddress | null;
  addressInput: string;
  setAddressInput: (v: string) => void;
  consumptionMonthly: { month: number; kwh: number }[];
  users: { id: string; email?: string }[];
  leadSources: LeadsMeta["sources"];
  /** Brouillon — aucun PATCH */
  onLeadChange: (p: Partial<OverviewLead>) => void;
  onMonthlyConsumptionChange: (months: { month: number; kwh: number }[]) => void;
  /** Focus dans la grille 12 mois (évite d’écraser la saisie au retour API). */
  onMonthlyGridEditingChange?: (editing: boolean) => void;
  /** Sortie de la grille mensuelle — flush autosave (ex. changement d’onglet évité ici par le parent). */
  onFlushOverviewSave?: () => void;
  geoValidationModalOpen: boolean;
  onOpenGeoValidation: () => void;
  onGeoValidationModalClose: () => void;
  onAddressSelect: (s: AutocompleteSuggestion, pickTier?: AddressPickTier) => Promise<void>;
  /** Secours : création adresse sans GPS + ouverture carte (NIVEAU D) */
  onManualMapPlacement?: () => Promise<void>;
  onGeoValidationSuccess: () => void;
  /** Conso moteur PDL (CSV) — même source que le calcul */
  energyEngine?: EnergyEngineResult | null;
  onEnergyEngineChange?: (engine: EnergyEngineResult | null) => void;
  /** Supprime le profil énergie côté serveur et remet à null (après succès) */
  onDeleteEnergyProfile?: () => Promise<void>;
  /** Message de succès après suppression (ex. "Profil énergie supprimé") */
  energyProfileSuccessMessage?: string | null;
  /** Base URL API (`VITE_API_URL` via `getCrmApiBase`) pour Auth Enedis et import CSV */
  apiBase?: string;
  /** Études / activités — pour le bandeau résumé (optionnel) */
  leadOverview?: LeadOverviewSummaryProps | null;
  /** Barre multi-compteurs (liste + actions) — au-dessus du bloc conso */
  metersBar?: React.ReactNode;
  /** Nom du compteur sélectionné (édition locale, autosave côté parent) */
  meterName?: string;
  onMeterNameChange?: (name: string) => void;
  /** Si false : liste vide de compteurs — masque mode conso / PDL / réseau (mutuellement exclusif avec l’état vide). */
  showEnergyConsoBody?: boolean;
  /** Résumé carte quand le corps conso est masqué (chargement / erreur compteur). */
  energyConsoBlockedSummary?: string;
  /** Si true : équipements édités via la modal compteur (évite double saisie / autosave). */
  hasMeters?: boolean;
  /** Vue seule (ex. super-admin lecture) */
  readOnly?: boolean;
}

const API_BASE = getCrmApiBase();

export default function OverviewTab({
  lead,
  siteAddress,
  addressInput,
  setAddressInput,
  consumptionMonthly,
  users,
  leadSources = [],
  onLeadChange,
  onMonthlyConsumptionChange,
  onMonthlyGridEditingChange,
  onFlushOverviewSave,
  geoValidationModalOpen,
  onOpenGeoValidation,
  onGeoValidationModalClose,
  onAddressSelect,
  onManualMapPlacement,
  onGeoValidationSuccess,
  energyEngine = null,
  onEnergyEngineChange,
  onDeleteEnergyProfile,
  energyProfileSuccessMessage = null,
  apiBase = API_BASE,
  leadOverview = null,
  metersBar = null,
  meterName,
  onMeterNameChange,
  showEnergyConsoBody = true,
  energyConsoBlockedSummary,
  hasMeters = false,
  readOnly = false,
}: OverviewTabProps) {
  const readOnlySuper = useSuperAdminReadOnly();
  const overviewStudies = Array.isArray(leadOverview?.studies)
    ? leadOverview.studies
    : [];
  const overviewActivities = Array.isArray(leadOverview?.activities)
    ? leadOverview.activities
    : [];

  const addressWrapRef = useRef<HTMLDivElement>(null);
  /** Évite de remplacer la liste de suggestions pendant qu’une sélection est en cours (A1). */
  const addressSelectInFlightRef = useRef(false);
  /** Saisie normalisée « verrouillée » après pick ou alignée sur le site — pas de liste tant qu’elle ne change pas. */
  const addressAutocompleteLockedKeyRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [addressSuggestions, setAddressSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [energyFileName, setEnergyFileName] = useState<string | null>(null);
  const [energyLoading, setEnergyLoading] = useState(false);
  const [energyError, setEnergyError] = useState<string | null>(null);
  const [energyDeleteLoading, setEnergyDeleteLoading] = useState(false);
  /** Sélecteur de type après « + Ajouter un équipement » */
  const [equipmentKindPicker, setEquipmentKindPicker] = useState<
    null | "actuel" | "avenir"
  >(null);
  /** Résumé accordion « Page de suivi client » (lien généré dans la session). */
  const [clientPortalLinkActive, setClientPortalLinkActive] = useState(false);

  useEffect(() => {
    setClientPortalLinkActive(false);
  }, [lead.id]);

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

      if (!lead?.id) {
        setEnergyError("Lead non enregistré — enregistrez le dossier avant d’importer un CSV");
        setEnergyLoading(false);
        return;
      }

      const res = await apiFetch(`${apiBase}/api/energy/compute-from-csv`, {
        method: "POST",
        body: JSON.stringify({
          leadId: lead.id,
          loadCurveCsv: csvContent,
          params: {
            puissance_kva: lead.meter_power_kva,
            reseau_type: (lead.grid_type || "mono").toLowerCase() === "tri" ? "tri" : "mono",
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
      onEnergyEngineChange?.({
        annual_kwh: payload.annual_kwh,
        hourly: payload.hourly,
        debug: payload.debug,
      });
      if (!file.name.toLowerCase().endsWith(".zip")) {
        setEnergyFileName(file.name);
      }
    } catch (e) {
      setEnergyError(e instanceof Error ? e.message : "Erreur import fichier");
    }

    setEnergyLoading(false);
  };
  const [addressSuggestionsOpen, setAddressSuggestionsOpen] = useState(false);
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressFallbackHint, setAddressFallbackHint] = useState<AddressFallbackHint | null>(null);
  const [addressDeadEnd, setAddressDeadEnd] = useState(false);
  const [manualMapBusy, setManualMapBusy] = useState(false);
  const debouncedAddress = useDebounce(addressInput, 300);

  /** Aligne le verrou sur l’adresse site quand le champ reflète déjà l’enregistrement (chargement ou après save). */
  useEffect(() => {
    if (!siteAddress?.formatted_address) return;
    const fin = normalizeAddressKey(siteAddress.formatted_address);
    const ain = normalizeAddressKey(addressInput);
    if (fin === ain) {
      addressAutocompleteLockedKeyRef.current = fin;
    }
  }, [siteAddress?.id, siteAddress?.formatted_address, addressInput]);

  useEffect(() => {
    const closeSuggestions = (e: MouseEvent) => {
      if (addressSelectInFlightRef.current) return;
      if (addressWrapRef.current && !addressWrapRef.current.contains(e.target as Node)) {
        setAddressSuggestionsOpen(false);
      }
    };
    document.addEventListener("click", closeSuggestions);
    return () => {
      document.removeEventListener("click", closeSuggestions);
    };
  }, []);

  useEffect(() => {
    if (!debouncedAddress || debouncedAddress.length < 3) {
      addressAutocompleteLockedKeyRef.current = null;
      setAddressSuggestions([]);
      setAddressSuggestionsOpen(false);
      setAddressFallbackHint(null);
      setAddressDeadEnd(false);
      return;
    }
    const debouncedKey = normalizeAddressKey(debouncedAddress);
    if (addressAutocompleteLockedKeyRef.current != null && debouncedKey !== addressAutocompleteLockedKeyRef.current) {
      addressAutocompleteLockedKeyRef.current = null;
    }
    if (debouncedMatchesSavedSiteAddress(debouncedAddress, siteAddress)) {
      setAddressSuggestions([]);
      setAddressSuggestionsOpen(false);
      setAddressFallbackHint(null);
      setAddressDeadEnd(false);
      return;
    }
    if (
      addressAutocompleteLockedKeyRef.current != null &&
      debouncedKey === addressAutocompleteLockedKeyRef.current
    ) {
      setAddressSuggestions([]);
      setAddressSuggestionsOpen(false);
      setAddressFallbackHint(null);
      setAddressDeadEnd(false);
      return;
    }
    let cancelled = false;
    setAddressLoading(true);
    setAddressDeadEnd(false);
    setAddressFallbackHint(null);

    (async () => {
      try {
        const rA = await geoAutocomplete(debouncedAddress, { limit: 8 });
        let list: AddressSuggestionWithTier[] = filterExploitableSuggestions(
          rA.suggestions || []
        ).map((s) => ({ ...s, pickTier: "normal" as const }));

        let hint: AddressFallbackHint | null = null;
        const parsed = parseFrenchAddressParts(debouncedAddress);

        if (list.length === 0 && parsed.queryStreetCity) {
          const qB = parsed.queryStreetCity.trim();
          if (qB.length >= 3 && qB.toLowerCase() !== debouncedAddress.trim().toLowerCase()) {
            const rB = await geoAutocomplete(qB, { limit: 8 });
            const bList = filterExploitableSuggestions(rB.suggestions || []);
            if (bList.length > 0) {
              list = bList.map((s) => ({ ...s, pickTier: "fallback_street" as const }));
              hint = {
                kind: "street_city",
                queryUsed: qB,
                message:
                  "Adresse exacte introuvable. Sélectionnez une proposition « rue + ville » ci-dessous, puis confirmez le bâtiment sur la carte.",
              };
            }
          }
        }

        if (list.length === 0 && parsed.queryCityOnly) {
          const qC = parsed.queryCityOnly.trim();
          if (qC.length >= 2) {
            const rC = await geoAutocomplete(qC, { limit: 8 });
            const cList = filterExploitableSuggestions(rC.suggestions || []);
            if (cList.length > 0) {
              list = cList.map((s) => ({ ...s, pickTier: "fallback_city" as const }));
              hint = {
                kind: "city_only",
                queryUsed: qC,
                message:
                  "Rue et ville introuvables automatiquement. Choisissez la commune ci-dessous, puis placez précisément le bien sur la carte.",
              };
            }
          }
        }

        if (!cancelled) {
          if (addressSelectInFlightRef.current) {
            setAddressLoading(false);
            return;
          }
          const keyNow = normalizeAddressKey(debouncedAddress);
          if (addressAutocompleteLockedKeyRef.current != null && keyNow === addressAutocompleteLockedKeyRef.current) {
            setAddressSuggestions([]);
            setAddressSuggestionsOpen(false);
            setAddressFallbackHint(null);
            setAddressDeadEnd(false);
            setAddressLoading(false);
            return;
          }
          if (debouncedMatchesSavedSiteAddress(debouncedAddress, siteAddress)) {
            setAddressSuggestions([]);
            setAddressSuggestionsOpen(false);
            setAddressFallbackHint(null);
            setAddressDeadEnd(false);
            setAddressLoading(false);
            return;
          }
          setAddressSuggestions(list);
          setAddressFallbackHint(hint);
          setAddressDeadEnd(list.length === 0);
          setAddressSuggestionsOpen(list.length > 0);
        }
      } catch {
        if (!cancelled) {
          if (!addressSelectInFlightRef.current) {
            setAddressSuggestions([]);
            setAddressDeadEnd(true);
            setAddressSuggestionsOpen(false);
          }
        }
      } finally {
        if (!cancelled) setAddressLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [debouncedAddress, siteAddress]);

  const handleAddressSuggestionPick = useCallback(
    (s: AddressSuggestionWithTier, tier: AddressPickTier) => {
      if (addressSelectInFlightRef.current) return;
      addressSelectInFlightRef.current = true;
      addressAutocompleteLockedKeyRef.current = normalizeAddressKey(s.label);
      setAddressSuggestionsOpen(false);
      setAddressSuggestions([]);   // vide la liste immédiatement pour éviter la réouverture
      void Promise.resolve(onAddressSelect(s, tier)).finally(() => {
        // Délai 800 ms > debounce 300 ms + appel API : le flag reste vrai le temps que
        // l'effet de debounce se déclenche et vérifie la ref, évitant la réouverture.
        setTimeout(() => {
          addressSelectInFlightRef.current = false;
        }, 800);
      });
    },
    [onAddressSelect]
  );

  const consumptionMode = lead.consumption_mode || "ANNUAL";
  const monthsMap = Object.fromEntries(consumptionMonthly.map((m) => [m.month, m.kwh]));
  const annualFromEngine =
    consumptionMode === "PDL" && energyEngine != null && Number.isFinite(energyEngine.annual_kwh)
      ? energyEngine.annual_kwh
      : null;
  const annualCalculated =
    consumptionMode === "ANNUAL"
      ? lead.consumption_annual_kwh ?? 0
      : consumptionMode === "MONTHLY"
        ? lead.consumption_annual_calculated_kwh ?? 0
        : annualFromEngine;
  const siteAddr = siteAddress;
  const isGeoVerified = siteAddr?.is_geo_verified === true;
  const hasLatLon = siteAddr?.lat != null && siteAddr?.lon != null;
  const addressQualityUi = qualityUiFromSite({
    isGeoVerified,
    geoPrecisionLevel: siteAddr?.geo_precision_level,
    hasLatLon,
    geoSource: siteAddr?.geo_source,
  });

  const addressOverviewSummary = buildAddressOverviewSummary(siteAddr, addressQualityUi, isGeoVerified);
  const bienFoyerSummary = buildBienFoyerSummary(lead.property_type, lead.household_size);
  const maisonToitureSummary = buildMaisonToitureSummary(lead.roof_type, lead.frame_type);
  const actuelV2View = useMemo(
    () => ensureActuelV2FromApi(lead.equipement_actuel_params, lead.equipement_actuel ?? null),
    [lead.equipement_actuel_params, lead.equipement_actuel]
  );
  const avenirV2View = useMemo(
    () => ensureAvenirV2FromApi(lead.equipements_a_venir),
    [lead.equipements_a_venir]
  );
  const actuelGroups = useMemo(
    () => buildOrderedEquipmentGroups(actuelV2View.items),
    [actuelV2View.items]
  );
  const avenirGroups = useMemo(
    () => buildOrderedEquipmentGroups(avenirV2View.items),
    [avenirV2View.items]
  );
  const equipmentSummary = buildEquipmentV2SectionSummary(actuelV2View, avenirV2View);
  const consommationSummary = buildConsommationSummary(annualCalculated, lead.meter_power_kva);

  const addEquipmentItem = (
    target: "actuel" | "avenir",
    spec: { kind: EquipmentKind; pac_type?: "air_eau" | "air_air" }
  ) => {
    const item = createDefaultEquipmentItem(
      spec.kind,
      spec.kind === "pac" ? { pac_type: spec.pac_type } : undefined
    );
    if (target === "actuel") {
      const cur = ensureActuelV2FromApi(lead.equipement_actuel_params, lead.equipement_actuel ?? null);
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
      onLeadChange({
        equipement_actuel: legacyActuelStringFromItems(next.items),
        equipement_actuel_params: next as unknown as OverviewLead["equipement_actuel_params"],
      });
    } else {
      const cur = ensureAvenirV2FromApi(lead.equipements_a_venir);
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
      onLeadChange({
        equipements_a_venir: next as unknown as OverviewLead["equipements_a_venir"],
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
    const cur = ensureActuelV2FromApi(lead.equipement_actuel_params, lead.equipement_actuel ?? null);
    const idx = cur.items.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const items = [...cur.items];
    items[idx] = item;
    const next: EquipmentV2 = { schemaVersion: 2, items };
    onLeadChange({
      equipement_actuel: legacyActuelStringFromItems(next.items),
      equipement_actuel_params: next as unknown as OverviewLead["equipement_actuel_params"],
    });
  };

  const removeActuelItemById = (id: string) => {
    const cur = ensureActuelV2FromApi(lead.equipement_actuel_params, lead.equipement_actuel ?? null);
    const next: EquipmentV2 = {
      schemaVersion: 2,
      items: cur.items.filter((x) => x.id !== id),
    };
    onLeadChange({
      equipement_actuel: legacyActuelStringFromItems(next.items),
      equipement_actuel_params: next as unknown as OverviewLead["equipement_actuel_params"],
    });
  };

  const removeActuelGroup = (groupItems: EquipmentItem[]) => {
    const drop = new Set(groupItems.map((x) => x.id));
    const cur = ensureActuelV2FromApi(lead.equipement_actuel_params, lead.equipement_actuel ?? null);
    const next: EquipmentV2 = {
      schemaVersion: 2,
      items: cur.items.filter((x) => !drop.has(x.id)),
    };
    onLeadChange({
      equipement_actuel: legacyActuelStringFromItems(next.items),
      equipement_actuel_params: next as unknown as OverviewLead["equipement_actuel_params"],
    });
  };

  const updateAvenirItemById = (id: string, item: EquipmentItem) => {
    const cur = ensureAvenirV2FromApi(lead.equipements_a_venir);
    const idx = cur.items.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const items = [...cur.items];
    items[idx] = item;
    const next: EquipmentV2 = { schemaVersion: 2, items };
    onLeadChange({
      equipements_a_venir: next as unknown as OverviewLead["equipements_a_venir"],
    });
  };

  const removeAvenirItemById = (id: string) => {
    const cur = ensureAvenirV2FromApi(lead.equipements_a_venir);
    const next: EquipmentV2 = {
      schemaVersion: 2,
      items: cur.items.filter((x) => x.id !== id),
    };
    onLeadChange({
      equipements_a_venir: next as unknown as OverviewLead["equipements_a_venir"],
    });
  };

  const removeAvenirGroup = (groupItems: EquipmentItem[]) => {
    const drop = new Set(groupItems.map((x) => x.id));
    const cur = ensureAvenirV2FromApi(lead.equipements_a_venir);
    const next: EquipmentV2 = {
      schemaVersion: 2,
      items: cur.items.filter((x) => !drop.has(x.id)),
    };
    onLeadChange({
      equipements_a_venir: next as unknown as OverviewLead["equipements_a_venir"],
    });
  };

  const identitySummary =
    lead.phone_mobile?.trim() ||
    lead.phone_landline?.trim() ||
    lead.phone?.trim() ||
    null;

  const addressValidated =
    addressQualityUi === "validated" || isGeoVerified;
  const hasSiteAddress = Boolean(siteAddr?.id);
  const lastActivityPreview = formatLastActivityPreview(overviewActivities);

  return (
    <div className="crm-lead-overview">
      <div className="crm-lead-overview-top">
        <LeadQuickSummary
          lead={lead}
          hasSiteAddress={hasSiteAddress}
          addressValidated={addressValidated}
          annualKwh={
            annualCalculated != null && Number.isFinite(annualCalculated)
              ? annualCalculated
              : null
          }
          studiesCount={overviewStudies.length}
          lastActivity={lastActivityPreview}
        />
        {lead.id ? (
          <LeadMairieSection
            lead={{
              id: lead.id,
              mairie_id: lead.mairie_id,
              mairie_name: lead.mairie_name,
              mairie_postal_code: lead.mairie_postal_code,
              mairie_city: lead.mairie_city,
              mairie_portal_url: lead.mairie_portal_url,
              mairie_portal_type: lead.mairie_portal_type as LeadRow["mairie_portal_type"],
              mairie_account_status: lead.mairie_account_status as LeadRow["mairie_account_status"],
              mairie_account_email: lead.mairie_account_email,
            }}
          />
        ) : null}
        <section className="lead-consent-strip" aria-label="Consentements">
          <div className="lead-consent-strip__label">
            <span className="lead-consent-strip__eyebrow">Consentements</span>
            <span className="lead-consent-strip__hint">RGPD et marketing</span>
          </div>
          <div className="lead-consent-strip__sources">
            <div className="lead-consent-source">
              <div className="lead-consent-source__head">
                <span className="lead-consent-source__title">Lead</span>
              </div>
              <div className="lead-consent-actions">
                <ConsentToggle
                  label="RGPD"
                  checked={Boolean(lead.rgpd_consent)}
                  disabled={readOnlySuper}
                  savedAt={lead.rgpd_consent_at}
                  onChange={(checked) => onLeadChange({ rgpd_consent: checked })}
                />
                <ConsentToggle
                  label="Marketing"
                  checked={Boolean(lead.marketing_opt_in)}
                  disabled={readOnlySuper}
                  savedAt={lead.marketing_opt_in_at}
                  onChange={(checked) => onLeadChange({ marketing_opt_in: checked })}
                />
              </div>
            </div>
            {lead.client_id ? (
              <ClientTableConsentSection clientId={lead.client_id} readOnly={readOnlySuper} />
            ) : null}
          </div>
        </section>
      </div>
      <div className="crm-lead-overview-surface">
      <div className="lead-overview-grid">
      <div className="lead-overview-grid-col lead-overview-grid-col--main">
      <OverviewCardSection index={1} title="Identité et contact" defaultOpen summary={identitySummary || undefined}>
        <div className="crm-lead-fields">

          {/* Sélecteur type — toujours en tête de section */}
          <div className="crm-lead-field">
            <label>Type de client</label>
            <div className="crm-lead-type-toggle">
              {CUSTOMER_TYPE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`crm-lead-type-btn${(lead.customer_type ?? "PERSON") === o.value ? " active" : ""}`}
                  onClick={() => {
                    const newType = o.value as "PERSON" | "PRO";
                    // Recalcule full_name lors du changement de type
                    const newFullName = newType === "PRO"
                      ? (lead.company_name ?? "").trim() || undefined
                      : [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim() || undefined;
                    onLeadChange({ customer_type: newType, full_name: newFullName });
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {(lead.customer_type ?? "PERSON") === "PERSON" ? (
            /* ——— MODE PARTICULIER ——— */
            <>
              <div className="crm-lead-identity-row">
                <div className="crm-lead-field">
                  <label>Civilité</label>
                  <PillPicker
                    options={CIVILITY_OPTIONS}
                    value={lead.civility ?? ""}
                    onChange={(v) => onLeadChange({ civility: v })}
                  />
                </div>
                <div className="crm-lead-field">
                  <label>Nom complet</label>
                  <input
                    className="sn-input"
                    value={lead.full_name ?? ""}
                    onChange={(e) => onLeadChange({ full_name: e.target.value })}
                    placeholder="Nom complet"
                  />
                </div>
              </div>
            </>
          ) : (
            /* ——— MODE PROFESSIONNEL ——— */
            <>
              <div className="crm-lead-field crm-lead-field-full">
                <label>Nom de l'entreprise</label>
                <input
                  className="sn-input"
                  value={lead.company_name ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    // Sync full_name = company_name pour les PRO
                    onLeadChange({ company_name: v, full_name: v.trim() || undefined });
                  }}
                  placeholder="Raison sociale…"
                />
              </div>
              <div className="crm-lead-identity-row">
                <div className="crm-lead-field">
                  <label>Prénom du contact</label>
                  <input
                    className="sn-input"
                    value={lead.contact_first_name ?? ""}
                    onChange={(e) => onLeadChange({ contact_first_name: e.target.value })}
                    placeholder="Prénom"
                  />
                </div>
                <div className="crm-lead-field">
                  <label>Nom du contact</label>
                  <input
                    className="sn-input"
                    value={lead.contact_last_name ?? ""}
                    onChange={(e) => onLeadChange({ contact_last_name: e.target.value })}
                    placeholder="Nom"
                  />
                </div>
              </div>
              <div className="crm-lead-field">
                <label>SIRET</label>
                <input
                  className="sn-input"
                  value={lead.siret ?? ""}
                  onChange={(e) => onLeadChange({ siret: e.target.value || undefined })}
                  placeholder="14 chiffres"
                  maxLength={14}
                  inputMode="numeric"
                />
              </div>
            </>
          )}

          <div className="crm-lead-field">
            <label>Téléphone portable</label>
            <input
              className="sn-input"
              type="tel"
              value={lead.phone_mobile ?? ""}
              onChange={(e) => onLeadChange({ phone_mobile: e.target.value })}
              placeholder="06…"
            />
          </div>
          <div className="crm-lead-field">
            <label>Email</label>
            <input
              className="sn-input"
              type="email"
              value={lead.email ?? ""}
              onChange={(e) => onLeadChange({ email: e.target.value })}
              placeholder="email@…"
            />
          </div>
          <div className="crm-lead-field">
            <label>Téléphone fixe</label>
            <input
              className="sn-input"
              type="tel"
              value={lead.phone_landline ?? lead.phone ?? ""}
              onChange={(e) => onLeadChange({ phone_landline: e.target.value })}
              placeholder="01…"
            />
          </div>
          <div className="crm-lead-identity-row crm-lead-identity-row--advisor-source">
            <div className="crm-lead-field">
              <label htmlFor="lead-assigned-user">Conseiller commercial</label>
              <CustomSelect
                id="lead-assigned-user"
                options={[
                  { value: "", label: "—" },
                  ...users.map((u) => ({ value: u.id, label: u.email || u.id })),
                ]}
                value={lead.assigned_user_id ?? ""}
                onChange={(v) => onLeadChange({ assigned_user_id: v || undefined })}
              />
            </div>
            <div className="crm-lead-field">
              <label
                htmlFor="lead-source-acquisition"
                title="Permet d'analyser la performance des canaux d'acquisition."
              >
                Source du lead
              </label>
              <CustomSelect
                id="lead-source-acquisition"
                options={[
                  ...(leadSources.length === 0 ? [{ value: "", label: "—" }] : []),
                  ...leadSources.map((s) => ({ value: s.id, label: s.name })),
                ]}
                value={lead.source_id ?? leadSources[0]?.id ?? ""}
                onChange={(v) => onLeadChange({ source_id: v || undefined })}
              />
            </div>
          </div>

          <div className="crm-lead-field crm-lead-field-full" style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(0,0,0,.08)" }}>
            <h4 className="crm-lead-subsection-title" style={{ margin: "0 0 6px", fontSize: "0.95rem", fontWeight: 600 }}>
              Mandat de représentation (DP)
            </h4>
            <p className="crm-lead-hint" style={{ margin: "0 0 8px", fontSize: "0.85rem", opacity: 0.85 }}>
              Ces informations alimentent le PDF mandat (déclaration préalable).
            </p>
            <label htmlFor="lead-birth-date">Date de naissance</label>
            <input
              id="lead-birth-date"
              className="sn-input"
              type="date"
              value={
                lead.birth_date
                  ? String(lead.birth_date).slice(0, 10)
                  : ""
              }
              onChange={(e) =>
                onLeadChange({
                  birth_date: e.target.value ? e.target.value : null,
                })
              }
            />
          </div>
        </div>
      </OverviewCardSection>

      <OverviewCardSection
        index={2}
        title={lead.customer_type === "PRO" ? "Adresse du siège social" : "Adresse et localisation"}
        defaultOpen
        summary={addressOverviewSummary || undefined}
        sectionClassName="crm-lead-overview-section--address-autocomplete"
      >
        <div ref={addressWrapRef} className="crm-lead-field crm-lead-field-full">
          <label>{lead.customer_type === "PRO" ? "Adresse du siège" : "Adresse complète"}</label>
          {/* Wrapper relatif limité à l'input : le dropdown se positionne juste en dessous */}
          <div style={{ position: "relative" }}>
            <input
              className="sn-input"
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              onFocus={() => addressSuggestions.length > 0 && setAddressSuggestionsOpen(true)}
              onBlur={(e) => {
                const next = e.relatedTarget as Node | null;
                if (next && addressWrapRef.current?.contains(next)) return;
                setAddressSuggestionsOpen(false);
              }}
              placeholder="Rechercher une adresse…"
              autoComplete="off"
            />
            {addressSuggestionsOpen && addressSuggestions.length > 0 && (
              <ul className="crm-lead-address-suggestions">
                {addressSuggestions.map((s, idx) => (
                  <li
                    key={`${s.place_id}-${idx}`}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      handleAddressSuggestionPick(
                        s as AddressSuggestionWithTier,
                        (s as AddressSuggestionWithTier).pickTier ?? "normal"
                      );
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleAddressSuggestionPick(
                        s as AddressSuggestionWithTier,
                        (s as AddressSuggestionWithTier).pickTier ?? "normal"
                      );
                    }}
                  >
                    {s.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="crm-lead-address-hint">
            Saisissez au moins 3 caractères puis choisissez une proposition. Si rien ne correspond, le système
            propose automatiquement une recherche « rue + ville » puis « ville seule ».
          </p>
          {addressLoading && <span className="crm-lead-address-loading">Recherche…</span>}
          {addressFallbackHint && (
            <div className="crm-lead-address-fallback-banner" role="status">
              {addressFallbackHint.message}
              {addressFallbackHint.queryUsed ? (
                <span className="crm-lead-address-fallback-query"> Requête : « {addressFallbackHint.queryUsed} »</span>
              ) : null}
            </div>
          )}
          {!addressLoading &&
            addressDeadEnd &&
            debouncedAddress.length >= 3 &&
            !siteAddr &&
            onManualMapPlacement &&
            lead?.id && (
              <div className="crm-lead-address-deadend">
                <p>
                  Adresse introuvable automatiquement. Essayez une saisie plus simple (ville, rue + ville) ou
                  positionnez le bien sur la carte.
                </p>
                {(() => {
                  const p = parseFrenchAddressParts(debouncedAddress);
                  return (
                    <div className="crm-lead-address-quick-chips">
                      {p.queryStreetCity && p.queryStreetCity.toLowerCase() !== debouncedAddress.trim().toLowerCase() ? (
                        <button
                          type="button"
                          className="sn-btn sn-btn-ghost sn-btn-sm"
                          onClick={() => setAddressInput(p.queryStreetCity!)}
                        >
                          Réessayer avec : {p.queryStreetCity}
                        </button>
                      ) : null}
                      {p.cityGuess && p.cityGuess.toLowerCase() !== debouncedAddress.trim().toLowerCase() ? (
                        <button
                          type="button"
                          className="sn-btn sn-btn-ghost sn-btn-sm"
                          onClick={() => setAddressInput(p.cityGuess!)}
                        >
                          Utiliser la ville : {p.cityGuess}
                        </button>
                      ) : null}
                    </div>
                  );
                })()}
                <button
                  type="button"
                  className="sn-btn sn-btn-outline-gold"
                  disabled={manualMapBusy}
                  onClick={async () => {
                    setManualMapBusy(true);
                    try {
                      await onManualMapPlacement();
                    } finally {
                      setManualMapBusy(false);
                    }
                  }}
                >
                  {manualMapBusy ? "Ouverture…" : "Positionner le bien sur la carte"}
                </button>
              </div>
            )}
        </div>
        {siteAddr && (
          <>
            <div className="crm-lead-address-quality-row" aria-live="polite">
              <span className="crm-lead-address-quality-label">Précision géolocalisation</span>
              <span
                className={
                  addressQualityUi === "validated"
                    ? "sn-badge sn-badge-success"
                    : addressQualityUi === "exact"
                      ? "sn-badge sn-badge-info"
                      : addressQualityUi === "approx_street" || addressQualityUi === "approx_city"
                        ? "sn-badge sn-badge-warn"
                        : "sn-badge sn-badge-neutral"
                }
              >
                {addressQualityUi === "validated" && "Validé (parcelle)"}
                {addressQualityUi === "exact" && "Numéro — à confirmer sur carte recommandé"}
                {addressQualityUi === "approx_street" && "Approximatif (rue) — confirmer sur carte"}
                {addressQualityUi === "approx_city" && "Position approximative — placer le bien sur la carte"}
                {addressQualityUi === "pending_manual" && "GPS à confirmer sur carte"}
              </span>
            </div>
            <div className="crm-lead-fields">
              <div className="crm-lead-field">
                <label>Adresse</label>
                <input
                  className="sn-input"
                  readOnly
                  value={[siteAddr.address_line1, siteAddr.address_line2].filter(Boolean).join(", ") || "—"}
                />
              </div>
              <div className="crm-lead-field">
                <label>Code postal</label>
                <input className="sn-input" readOnly value={siteAddr.postal_code || "—"} />
              </div>
              <div className="crm-lead-field">
                <label>Ville</label>
                <input className="sn-input" readOnly value={siteAddr.city || "—"} />
              </div>
              <div className="crm-lead-field">
                <label>Pays</label>
                <input className="sn-input" readOnly value={siteAddr.country_code || "FR"} />
              </div>
              <div className="crm-lead-field">
                <label>Latitude</label>
                <input className="sn-input" readOnly value={siteAddr.lat ?? "—"} />
              </div>
              <div className="crm-lead-field">
                <label>Longitude</label>
                <input className="sn-input" readOnly value={siteAddr.lon ?? "—"} />
              </div>
            </div>
            {!isGeoVerified && siteAddr.id && (
              <>
                {addressQualityUi === "approx_street" && (
                  <p className="crm-lead-warning">
                    Adresse trouvée approximativement au niveau rue — veuillez confirmer l&apos;emplacement exact du
                    bâtiment sur la carte.
                  </p>
                )}
                {addressQualityUi === "approx_city" && (
                  <p className="crm-lead-warning">
                    Position approximative — veuillez placer précisément le bien sur la carte.
                  </p>
                )}
                {(addressQualityUi === "exact" || addressQualityUi === "pending_manual") && (
                  <p className="crm-lead-warning">
                    {addressQualityUi === "pending_manual"
                      ? "Aucune coordonnée fiable tant que vous n’avez pas validé le point sur la carte."
                      : "Adresse non validée au niveau bâtiment. Validez l’emplacement sur Géoportail pour activer PVGIS, ombrage et calpinage."}
                  </p>
                )}
                <button
                  type="button"
                  className="sn-btn sn-btn-outline-gold"
                  onClick={onOpenGeoValidation}
                >
                  Valider l&apos;emplacement sur Géoportail
                </button>
              </>
            )}
            {isGeoVerified && (
              <p className="crm-lead-success">Emplacement validé sur parcelle cadastrale</p>
            )}
          </>
        )}
      </OverviewCardSection>

      <OverviewCardSection
        index={5}
        title="Consommation et énergie"
        defaultOpen
        summary={
          showEnergyConsoBody
            ? consommationSummary || undefined
            : energyConsoBlockedSummary ?? "Compteurs"
        }
      >
        {metersBar}
        {showEnergyConsoBody && meterName !== undefined && onMeterNameChange ? (
          <div className="crm-lead-field crm-lead-field--meter-name">
            <label htmlFor="crm-lead-meter-name">Nom du compteur</label>
            <input
              id="crm-lead-meter-name"
              className="sn-input"
              value={meterName}
              onChange={(e) => onMeterNameChange(e.target.value)}
              placeholder="Ex. Maison principale"
              autoComplete="off"
            />
          </div>
        ) : null}
        {showEnergyConsoBody ? (
          <>
        <div className="crm-lead-field crm-lead-field-full">
          <label>Mode de conso</label>
          <PillPicker
            options={[
              { value: "ANNUAL", label: "Annuel" },
              { value: "MONTHLY", label: "Mensuel" },
              { value: "PDL", label: "PDL" },
            ]}
            value={consumptionMode}
            onChange={(v) => { if (v) onLeadChange({ consumption_mode: v as "ANNUAL" | "MONTHLY" | "PDL" }); }}
            allowDeselect={false}
          />
        </div>
        {consumptionMode === "ANNUAL" && (
          <div className="crm-lead-field">
            <label>kWh annuel</label>
            <input
              className="sn-input"
              type="number"
              min={0}
              value={lead.consumption_annual_kwh ?? ""}
              onChange={(e) =>
                onLeadChange({
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
            onMonthsChange={onMonthlyConsumptionChange}
            onGridEditingChange={onMonthlyGridEditingChange}
            onGridSectionLeave={onFlushOverviewSave}
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
              <button
                type="button"
                className="sn-btn sn-btn-outline-gold"
                onClick={handleEnedisAuth}
              >
                Connexion Enedis
              </button>
              <button
                type="button"
                className="sn-btn sn-btn-outline-gold"
                onClick={() => fileInputRef.current?.click()}
              >
                Importer un CSV
              </button>
              {energyEngine && onDeleteEnergyProfile && (
                <button
                  type="button"
                  className="sn-btn sn-btn-ghost"
                  style={{
                    border: "1px solid var(--error)",
                    color: "var(--error)",
                  }}
                  disabled={energyDeleteLoading}
                  onClick={async () => {
                    setEnergyDeleteLoading(true);
                    try {
                      await onDeleteEnergyProfile();
                      setEnergyFileName(null);
                      setEnergyError(null);
                    } finally {
                      setEnergyDeleteLoading(false);
                    }
                  }}
                >
                  {energyDeleteLoading ? "Suppression…" : "Supprimer le profil énergie"}
                </button>
              )}
              {energyProfileSuccessMessage && (
                <div className="crm-lead-energy-msg-success">
                  {energyProfileSuccessMessage}
                </div>
              )}
              <input
                type="file"
                accept=".csv,.zip"
                ref={fileInputRef}
                style={{ display: "none" }}
                onChange={handleCsvUpload}
              />
            </div>
            {energyLoading && (
              <div className="sn-energy-loader">
                Chargement...
              </div>
            )}
            {energyFileName && !energyLoading && (
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
                    onEnergyEngineChange?.(null);
                  }}
                  aria-label="Supprimer le fichier"
                >
                  ✕
                </button>
              </div>
            )}
            {energyError && (
              <div className="sn-energy-error">
                {energyError}
              </div>
            )}
            <div className="crm-lead-field">
              <label>PDL</label>
              <input
                className="sn-input"
                value={lead.consumption_pdl ?? ""}
                onChange={(e) =>
                  onLeadChange({ consumption_pdl: e.target.value || undefined })
                }
                placeholder="Import Enedis plus tard"
              />
            </div>
          </>
        )}
        <div className="crm-lead-overview-subblock">
          <h3 className="crm-lead-overview-subheading">Réseau électrique, contrat et équipement</h3>
          <div className="crm-lead-fields">
            <div className="crm-lead-field">
              <label>HP/HC</label>
              <PillPicker
                options={[
                  { value: "no", label: "Non" },
                  { value: "yes", label: "Oui" },
                ]}
                value={lead.hp_hc ? "yes" : "no"}
                onChange={(v) => onLeadChange({ hp_hc: v === "yes" })}
                allowDeselect={false}
              />
            </div>
            <div className="crm-lead-field">
              <label>Fournisseur</label>
              <input
                className="sn-input"
                value={lead.supplier_name ?? ""}
                onChange={(e) => onLeadChange({ supplier_name: e.target.value || undefined })}
              />
            </div>
            <div className="crm-lead-field crm-lead-field-full">
              <label>Profil de consommation</label>
              <PillPicker
                options={CONSUMPTION_PROFILE_OPTIONS}
                value={lead.consumption_profile ?? ""}
                onChange={(v) => onLeadChange({ consumption_profile: v })}
              />
            </div>
            <div className="crm-lead-field crm-lead-field-full">
              <label>Type de contrat</label>
              <PillPicker
                options={TARIFF_TYPE_OPTIONS}
                value={lead.tariff_type ?? ""}
                onChange={(v) => onLeadChange({ tariff_type: v })}
              />
            </div>
            <div className="crm-lead-field crm-lead-field-full">
              <label>Type de réseau</label>
              <PillPicker
                options={GRID_TYPE_OPTIONS}
                value={lead.grid_type ?? ""}
                onChange={(v) => onLeadChange({ grid_type: v })}
              />
            </div>
            <div className="crm-lead-field">
              <label>Puissance compteur (kVA)</label>
              <input
                className="sn-input"
                type="number"
                min={0}
                step={0.1}
                value={lead.meter_power_kva ?? ""}
                onChange={(e) =>
                  onLeadChange({
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
          </>
        ) : null}
      </OverviewCardSection>
      </div>
      <div className="lead-overview-grid-col lead-overview-grid-col--side">
      <OverviewCardSection
        index={3}
        title="Bien et foyer"
        defaultOpen={false}
        summary={bienFoyerSummary || undefined}
      >
        <div className="crm-lead-fields" style={{ gridTemplateColumns: "1fr auto" }}>
          <div className="crm-lead-field">
            <label>Type de bien</label>
            <PillPicker
              options={PROPERTY_TYPE_OPTIONS}
              value={lead.property_type ?? ""}
              onChange={(v) => onLeadChange({ property_type: v })}
            />
          </div>
          <div className="crm-lead-field">
            <label className="crm-lead-label-nowrap">Personnes au foyer</label>
            <input
              className="sn-input"
              type="number"
              min={0}
              value={lead.household_size ?? ""}
              onChange={(e) =>
                onLeadChange({
                  household_size: e.target.value === "" ? undefined : parseInt(e.target.value, 10),
                })
              }
              placeholder="—"
              style={{ width: 80 }}
            />
          </div>
        </div>
      </OverviewCardSection>

      <OverviewCardSection
        index={4}
        title="Maison et toiture"
        defaultOpen={false}
        summary={maisonToitureSummary || undefined}
      >
        <div className="crm-lead-fields" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="crm-lead-field">
            <label>Année de construction</label>
            <input
              className="sn-input"
              type="number"
              min={1800}
              max={2100}
              value={lead.construction_year ?? ""}
              onChange={(e) =>
                onLeadChange({
                  construction_year:
                    e.target.value === "" ? undefined : parseInt(e.target.value, 10),
                })
              }
              placeholder="—"
            />
          </div>
          <div className="crm-lead-field">
            <label>Isolation</label>
            <PillPicker
              options={INSULATION_OPTIONS}
              value={lead.insulation_level ?? ""}
              onChange={(v) => onLeadChange({ insulation_level: v })}
            />
          </div>
          <div className="crm-lead-field">
            <label>Type de toiture</label>
            <PillPicker
              options={ROOF_TYPE_OPTIONS}
              value={lead.roof_type ?? ""}
              onChange={(v) => onLeadChange({ roof_type: v })}
            />
          </div>
          <div className="crm-lead-field">
            <label>Charpente</label>
            <PillPicker
              options={FRAME_TYPE_OPTIONS}
              value={lead.frame_type ?? ""}
              onChange={(v) => onLeadChange({ frame_type: v })}
            />
          </div>
        </div>
      </OverviewCardSection>

      <OverviewCardSection
        index={6}
        title="Page de suivi client"
        defaultOpen={false}
        summary={clientPortalLinkActive ? "🔗 Lien actif" : undefined}
        sectionClassName="crm-lead-overview-section--client-portal"
      >
        {lead.id ? (
          <LeadClientPortalSection
            leadId={lead.id}
            apiBase={apiBase}
            embedded
            onLinkStateChange={setClientPortalLinkActive}
          />
        ) : (
          <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>
            Enregistrez le dossier pour générer un lien de suivi.
          </p>
        )}
      </OverviewCardSection>

      {!hasMeters ? (
      <OverviewCardSection
        index={7}
        title="Équipements énergétiques"
        defaultOpen={false}
        summary={equipmentSummary || undefined}
      >
        <p className="crm-lead-equipment-section-lede">
          Décrivez ce qui est déjà installé pour affiner le profil de consommation, puis ce que le
          foyer pourrait ajouter pour dimensionner la projection.
        </p>

        <div className="crm-lead-overview-subblock crm-lead-equipment-block crm-lead-equipment-block--actuel">
          <header className="crm-lead-equipment-block__header">
            <span className="crm-lead-equipment-block__eyebrow">Aujourd’hui</span>
            <h3 className="crm-lead-equipment-block__title">Déjà en place au foyer</h3>
            <p className="crm-lead-equipment-block__lede">
              Utile surtout sans courbe horaire Enedis : ces équipements aident à reconstituer une
              forme de courbe crédible pour le foyer actuel.
            </p>
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
          {equipmentKindPicker === "actuel" && (
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
          )}
          <div className="crm-lead-equipment-grid">
            {actuelGroups.map((g) => (
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
          {actuelV2View.items.length === 0 && (
            <p className="crm-lead-equipment-empty">Aucun équipement renseigné pour l’instant.</p>
          )}
        </div>

        <div className="crm-lead-overview-subblock crm-lead-equipment-block crm-lead-equipment-block--avenir">
          <header className="crm-lead-equipment-block__header">
            <span className="crm-lead-equipment-block__eyebrow">Projection</span>
            <h3 className="crm-lead-equipment-block__title">Envisagé ou à installer</h3>
            <p className="crm-lead-equipment-block__lede">
              Ajoute une consommation et une forme horaire supplémentaires dans l’étude — y compris
              lorsqu’une courbe Enedis est déjà chargée.
            </p>
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
          {equipmentKindPicker === "avenir" && (
            <div className="crm-lead-equipment-kind-picker" role="group" aria-label="Type d'équipement à venir">
              {EQUIPMENT_ADD_CHOICES.map((c) => (
                <button
                  key={`${c.kind}-${c.pac_type ?? ""}`}
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
          )}
          <div className="crm-lead-equipment-grid">
            {avenirGroups.map((g) => (
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
          {avenirV2View.items.length === 0 && (
            <p className="crm-lead-equipment-empty">Aucun projet d’équipement renseigné.</p>
          )}
        </div>
      </OverviewCardSection>
      ) : null}
      </div>
      </div>
      </div>

      {geoValidationModalOpen && siteAddr?.id && (
        <GeoValidationModal
          addressId={siteAddr.id}
          lat={siteAddr.lat ?? undefined}
          lon={siteAddr.lon ?? undefined}
          onClose={onGeoValidationModalClose}
          onSuccess={onGeoValidationSuccess}
        />
      )}
    </div>
  );
}
