/**
 * CP-LEAD-V3 — useLeadDetail
 * Hook maître : toute la logique métier de la fiche lead/client.
 * LeadDetail.tsx ne conserve que le JSX (routeur d'onglets + layout).
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate, useBlocker, useSearchParams } from "react-router-dom";
import { apiFetch, getAuthToken } from "../../services/api";
import { createAddress, type AutocompleteSuggestion } from "../../services/address.service";
import {
  fetchLeadsMeta,
  archiveLead,
  unarchiveLead,
  revertLeadToLead,
  type LeadsMeta,
} from "../../services/leads.service";
import { fetchMailAccounts } from "../../services/mailApi";
import {
  fetchActivities,
  createActivity,
  updateActivity,
  deleteActivity,
  type Activity,
  type CreateActivityPayload,
} from "../../services/activities.service";
import { normalizeEntityDocument, type Document } from "../../components/DocumentUploader";
import {
  fetchStudiesByLeadId,
  createStudy,
  duplicateStudy,
  patchStudyTitle,
  type Study,
} from "../../services/studies.service";
import { fetchQuotesByLeadId, type Quote } from "../../services/quotes.service";
import { fetchMissionsByClientId, type Mission } from "../../services/missions.service";
import {
  buildDpRefusedPatch,
  ACTIVITY_TAG_DP_RETRY_LATER,
  type DPRefusedChoice,
} from "../../modules/leads/dpRefusedStatus";
import { isLeadDpFolderAccessible } from "../../modules/leads/LeadDetail/constants";
import type { LeadTabId, EnergyEngineResult, OverviewLead } from "../../modules/leads/LeadDetail";
import type { LeadMeterListItem } from "../../modules/leads/LeadDetail/LeadMetersBar";
import { annualKwhForCard } from "../../modules/leads/LeadDetail/LeadMetersBar";
import {
  buildLeadPatch,
  buildConsumptionPayload,
  applyMeterRowToLeadSnapshot,
} from "../../modules/leads/LeadDetail/overviewSave";
import type {
  EquipementActuelParams,
  EquipementsAVenir,
} from "../../modules/leads/LeadDetail/equipmentPilotageHelpers";
import type { EquipmentV2 } from "../../modules/leads/LeadDetail/equipmentTypes";
import { normalizeLeadEquipmentFields } from "../../modules/leads/LeadDetail/equipmentV2Normalize";
import {
  isLowConfidencePrecision,
  type AddressPickTier,
} from "../../modules/leads/LeadDetail/addressFallback";
import { getCrmApiBase } from "../../config/crmApiBase";
import { useSuperAdminReadOnly } from "../../contexts/OrganizationContext";
import { useUndoAction } from "../useUndoAction";

const API_BASE = getCrmApiBase();

// ——— Types ———

type MetersLoadPhase = "idle" | "loading" | "ready" | "error";
type MeterDetailPhase = "idle" | "loading" | "ready" | "error";

export interface Lead {
  id: string;
  civility?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  contact_first_name?: string;
  contact_last_name?: string;
  siret?: string | null;
  birth_date?: string | null;
  email?: string;
  phone?: string;
  phone_mobile?: string;
  phone_landline?: string;
  address?: string;
  source_id?: string;
  source_name?: string;
  source_slug?: string | null;
  lead_source?: string;
  stage_id: string;
  status?: string;
  archived_at?: string | null;
  lost_reason?: string | null;
  project_status?: string;
  client_id?: string;
  site_address_id?: string;
  billing_address_id?: string;
  assigned_user_id?: string;
  customer_type?: "PERSON" | "PRO";
  notes?: string;
  energy_profile?: unknown;
  created_at: string;
  updated_at: string;
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
  equipement_actuel?: string | null;
  equipement_actuel_params?: EquipementActuelParams | EquipmentV2 | null;
  equipements_a_venir?: EquipementsAVenir | EquipmentV2 | null;
  property_type?: string;
  household_size?: number;
  construction_year?: number;
  insulation_level?: string;
  roof_type?: string;
  frame_type?: string;
  stage_name?: string;
  rgpd_consent?: boolean;
  rgpd_consent_at?: string | null;
  marketing_opt_in?: boolean;
  marketing_opt_in_at?: string | null;
  mairie_id?: string | null;
  mairie_account_status?: "none" | "to_create" | "created" | null;
  mairie_name?: string | null;
  mairie_postal_code?: string | null;
  mairie_city?: string | null;
  mairie_portal_url?: string | null;
  mairie_portal_type?: "online" | "email" | "paper" | null;
  mairie_account_email?: string | null;
  mairie_bitwarden_ref?: string | null;
}

interface Stage {
  id: string;
  name: string;
  code?: string;
  position?: number;
  is_closed?: boolean;
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

export interface LeadDetailData {
  lead: Lead;
  stage: Stage | null;
  stages: Stage[];
  site_address: SiteAddress | null;
  billing_address: SiteAddress | null;
  consumption_monthly?: { month: number; kwh: number }[];
}

// ——— Utilitaires internes ———

export function showCalcErrorToast(message: string) {
  const toast = document.createElement("div");
  toast.className = "crm-lead-toast crm-lead-toast--error";
  toast.textContent = message;
  toast.setAttribute("role", "alert");
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

export function showLeadSuccessToast(message: string) {
  const toast = document.createElement("div");
  toast.className = "crm-lead-toast crm-lead-toast--success";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

export function buildEnergyMetersSectionSummary(
  phase: MetersLoadPhase,
  list: LeadMeterListItem[],
  fetchErr: string | null
): string {
  if (phase === "loading") return "Chargement des compteurs…";
  if (phase === "error") return fetchErr || "Compteurs indisponibles";
  if (list.length === 0) return "Aucun compteur enregistré";
  if (list.length === 1) {
    const m = list[0];
    const a = annualKwhForCard(m);
    const kwhS =
      a != null && Number.isFinite(Number(a))
        ? `${Number(a).toLocaleString("fr-FR")} kWh/an`
        : "— kWh/an";
    return `${m.name?.trim() || "Compteur"} · ${kwhS}`;
  }
  return `${list.length} compteurs`;
}

export function parseEnergyEngineFromProfile(ep: unknown): EnergyEngineResult | null {
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
    return { annual_kwh: e.annual_kwh, hourly: e.hourly.slice(0, 8760), debug: e.debug };
  }
  if (
    typeof o.summary?.annual_kwh === "number" &&
    Number.isFinite(o.summary.annual_kwh) &&
    Array.isArray(o.hourly) &&
    o.hourly.length >= 8760
  ) {
    return { annual_kwh: o.summary.annual_kwh, hourly: o.hourly.slice(0, 8760) };
  }
  return null;
}

// ——— Hook principal ———

export function useLeadDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // ——— Data ———
  const [data, setData] = useState<LeadDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ——— UI state ———
  const _initialTab = (searchParams.get("tab") as LeadTabId | null) ?? "overview";
  const [activeTab, setActiveTab] = useState<LeadTabId>(_initialTab);
  const [stageChanging, setStageChanging] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);

  // ——— Activities / Notes ———
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [addNotesFormOpen, setAddNotesFormOpen] = useState(false);
  const [addActivityType, setAddActivityType] = useState<"NOTE" | "CALL" | "MEETING" | "EMAIL">("NOTE");
  const [addActivityTitle, setAddActivityTitle] = useState("");
  const [addActivityContent, setAddActivityContent] = useState("");
  const [addActivitySaving, setAddActivitySaving] = useState(false);
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  // ——— Address ———
  const [addressInput, setAddressInput] = useState("");
  const [geoValidationModalOpen, setGeoValidationModalOpen] = useState(false);

  // ——— Meta ———
  const [users, setUsers] = useState<{ id: string; email?: string }[]>([]);
  const [leadSources, setLeadSources] = useState<LeadsMeta["sources"]>([]);

  // ——— Documents ———
  const [documents, setDocuments] = useState<Document[]>([]);
  const [clientDocuments, setClientDocuments] = useState<Document[]>([]);

  // ——— Studies / Quotes / Missions ———
  const [studies, setStudies] = useState<Study[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [studiesLoading, setStudiesLoading] = useState(false);
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [createStudyLoading, setCreateStudyLoading] = useState(false);
  const [clientMissions, setClientMissions] = useState<Mission[]>([]);
  const [clientMissionsLoading, setClientMissionsLoading] = useState(false);
  const [createMissionModalOpen, setCreateMissionModalOpen] = useState(false);
  const [calcLoading, setCalcLoading] = useState(false);
  const [calcSummary, setCalcSummary] = useState<Record<string, unknown> | null>(null);
  const [studyTitleModalStudy, setStudyTitleModalStudy] = useState<Study | null>(null);
  const [studyTitleDraft, setStudyTitleDraft] = useState("");
  const [studyTitleSaving, setStudyTitleSaving] = useState(false);
  const [studyDuplicateBusy, setStudyDuplicateBusy] = useState(false);

  // ——— Energy ———
  const [energyEngine, setEnergyEngine] = useState<EnergyEngineResult | null>(null);
  const [energyProfileSuccessMessage, setEnergyProfileSuccessMessage] = useState<string | null>(null);

  // ——— Archive / Revert ———
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [revertConfirmOpen, setRevertConfirmOpen] = useState(false);
  const [revertSaving, setRevertSaving] = useState(false);

  // ——— Autosave ———
  const [formLead, setFormLead] = useState<Lead | null>(null);
  const [overviewDirty, setOverviewDirty] = useState(false);
  const [monthlyLocal, setMonthlyLocal] = useState<{ month: number; kwh: number }[]>([]);
  const formLeadRef = useRef<Lead | null>(null);
  const monthlyLocalRef = useRef<{ month: number; kwh: number }[]>([]);
  const [saveSyncState, setSaveSyncState] = useState<"idle" | "pending" | "saving" | "saved" | "error">("idle");
  const autosaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAutosaveInFlightRef = useRef(false);
  const overviewSavePromiseRef = useRef<Promise<boolean> | null>(null);
  const editedDuringAutosaveRef = useRef(false);
  const monthlyGridEditingRef = useRef(false);
  const lastOverviewEditKindRef = useRef<"form" | "monthly">("form");
  const saveSyncStateRef = useRef(saveSyncState);

  // ——— Sticky header ———
  const headerZoneRef = useRef<HTMLDivElement>(null);
  const [leadStickyBarVisible, setLeadStickyBarVisible] = useState(false);

  // ——— Meters ———
  const [metersLoadPhase, setMetersLoadPhase] = useState<MetersLoadPhase>("idle");
  const [metersList, setMetersList] = useState<LeadMeterListItem[]>([]);
  const [metersFetchError, setMetersFetchError] = useState<string | null>(null);
  const metersFetchErrorRef = useRef<string | null>(null);
  const [meterDetailPhase, setMeterDetailPhase] = useState<MeterDetailPhase>("idle");
  const [meterDetailError, setMeterDetailError] = useState<string | null>(null);
  const [selectedMeterId, setSelectedMeterId] = useState<string | null>(null);
  const [metersBusy, setMetersBusy] = useState(false);
  const [meterModalOpen, setMeterModalOpen] = useState(false);
  const [meterModalMode, setMeterModalMode] = useState<"create" | "edit" | null>(null);
  const [meterModalMeterId, setMeterModalMeterId] = useState<string | null>(null);
  const metersLoadPhaseRef = useRef<MetersLoadPhase>("idle");
  const metersListRef = useRef<LeadMeterListItem[]>([]);
  const meterDetailPhaseRef = useRef<MeterDetailPhase>("idle");
  const meterDetailErrorRef = useRef<string | null>(null);
  const latestDataLeadRef = useRef<Lead | null>(null);
  const latestConsumptionMonthlyRef = useRef<{ month: number; kwh: number }[]>([]);
  const meterIdToRestoreAfterFetchRef = useRef<string | null>(null);
  const selectedMeterIdRef = useRef<string | null>(null);

  // ——— Project / DP ———
  const [confirmProjectOpen, setConfirmProjectOpen] = useState(false);
  const [pendingProjectStatus, setPendingProjectStatus] = useState<string | null>(null);
  const [dpRefusedOpen, setDpRefusedOpen] = useState(false);
  const [dpRefusedBusy, setDpRefusedBusy] = useState(false);

  const { scheduleUndo, activeToast } = useUndoAction();
  const isReadOnly = useSuperAdminReadOnly();

  // ——— Ref-sync effects ———
  useEffect(() => { formLeadRef.current = formLead; }, [formLead]);
  useEffect(() => { monthlyLocalRef.current = monthlyLocal; }, [monthlyLocal]);
  useEffect(() => { saveSyncStateRef.current = saveSyncState; }, [saveSyncState]);
  useEffect(() => { metersLoadPhaseRef.current = metersLoadPhase; }, [metersLoadPhase]);
  useEffect(() => { metersListRef.current = metersList; }, [metersList]);
  useEffect(() => { meterDetailPhaseRef.current = meterDetailPhase; }, [meterDetailPhase]);
  useEffect(() => { meterDetailErrorRef.current = meterDetailError; }, [meterDetailError]);
  useEffect(() => { metersFetchErrorRef.current = metersFetchError; }, [metersFetchError]);
  useEffect(() => { selectedMeterIdRef.current = selectedMeterId; }, [selectedMeterId]);

  // ——— Meta fetch ———
  useEffect(() => {
    fetchLeadsMeta()
      .then((m) => { setUsers(m.users || []); setLeadSources(m.sources || []); })
      .catch(() => { setUsers([]); setLeadSources([]); });
  }, []);

  // ——— Reset meter modal on id change ———
  useEffect(() => {
    setMeterModalOpen(false);
    setMeterModalMode(null);
    setMeterModalMeterId(null);
  }, [id]);

  // ——— fetchLead ———
  const fetchLead = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    meterIdToRestoreAfterFetchRef.current = selectedMeterIdRef.current;
    setMetersLoadPhase("loading");
    setMetersFetchError(null);
    setMetersList([]);
    setMeterDetailPhase("idle");
    setMeterDetailError(null);
    setSelectedMeterId(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/leads/${id}`);
      if (res.status === 404) {
        setError("Lead non trouvé");
        setData(null);
        meterIdToRestoreAfterFetchRef.current = null;
        setMetersLoadPhase("idle");
        setMetersFetchError(null);
        setMetersList([]);
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
      }
      const json = await res.json();
      const payload: LeadDetailData | null =
        json && typeof json === "object" && json.lead
          ? (json as LeadDetailData)
          : json && typeof json === "object" && json.data && typeof json.data === "object" && (json.data as { lead?: unknown }).lead
            ? (json.data as LeadDetailData)
            : null;
      if (!payload || !payload.lead || typeof payload.lead !== "object") {
        throw new Error("Réponse API invalide: objet lead manquant");
      }
      setData({
        ...payload,
        consumption_monthly: Array.isArray(payload.consumption_monthly) ? payload.consumption_monthly : [],
      });
      const leadNorm = normalizeLeadEquipmentFields({ ...(payload.lead as Lead) } as Lead);
      const monthly = Array.isArray(payload.consumption_monthly) ? payload.consumption_monthly : [];
      setFormLead(leadNorm);
      setMonthlyLocal(monthly);
      latestDataLeadRef.current = leadNorm;
      latestConsumptionMonthlyRef.current = monthly;
      setOverviewDirty(false);
      setEnergyEngine(parseEnergyEngineFromProfile(payload.lead?.energy_profile));

      void (async () => {
        try {
          const mRes = await apiFetch(`${API_BASE}/api/leads/${id}/meters`);
          if (!mRes.ok) {
            const errBody = await mRes.json().catch(() => ({}));
            const msg = (errBody as { error?: string }).error || `Impossible de charger les compteurs (${mRes.status})`;
            setMetersLoadPhase("error");
            setMetersFetchError(msg);
            setMetersList([]);
            return;
          }
          const list = (await mRes.json()) as LeadMeterListItem[];
          if (!Array.isArray(list)) {
            setMetersLoadPhase("error");
            setMetersFetchError("Réponse compteurs invalide");
            setMetersList([]);
            return;
          }
          setMetersList(list);
          setMetersLoadPhase("ready");
          setMetersFetchError(null);
          const restore = meterIdToRestoreAfterFetchRef.current;
          meterIdToRestoreAfterFetchRef.current = null;
          setSelectedMeterId(() => {
            if (restore && list.some((x) => x.id === restore)) return restore;
            return list.find((x) => x.is_default)?.id ?? list[0]?.id ?? null;
          });
        } catch (e) {
          setMetersLoadPhase("error");
          setMetersFetchError(e instanceof Error ? e.message : "Erreur réseau (compteurs)");
          setMetersList([]);
        }
      })();

      if (payload.site_address?.formatted_address) {
        setAddressInput(payload.site_address.formatted_address);
      } else if (payload.site_address?.address_line1) {
        const parts = [
          payload.site_address.address_line1,
          payload.site_address.address_line2,
          payload.site_address.postal_code,
          payload.site_address.city,
        ].filter(Boolean);
        setAddressInput(parts.join(", "));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setData(null);
      meterIdToRestoreAfterFetchRef.current = null;
      setMetersLoadPhase("idle");
      setMetersFetchError(null);
      setMetersList([]);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchLead(); }, [fetchLead]);

  // ——— Meter detail fetch ———
  useEffect(() => {
    if (meterModalOpen) return;
    if (!id || !selectedMeterId) {
      setMeterDetailPhase("idle");
      setMeterDetailError(null);
      return;
    }
    if (metersLoadPhase !== "ready" || !metersList.some((m) => m.id === selectedMeterId)) {
      setMeterDetailPhase(metersLoadPhase === "loading" ? "loading" : "idle");
      setMeterDetailError(null);
      return;
    }
    let cancelled = false;
    setMeterDetailPhase("loading");
    setMeterDetailError(null);
    void (async () => {
      const revertToLeadSnapshot = () => {
        const base = latestDataLeadRef.current;
        if (base) {
          setFormLead(base);
          setMonthlyLocal([...latestConsumptionMonthlyRef.current]);
          setEnergyEngine(parseEnergyEngineFromProfile(base.energy_profile));
        }
      };
      try {
        const res = await apiFetch(`${API_BASE}/api/leads/${id}/meters/${selectedMeterId}`);
        if (cancelled) return;
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          const msg = (errBody as { error?: string }).error || `Détail compteur indisponible (${res.status})`;
          setMeterDetailPhase("error");
          setMeterDetailError(msg);
          revertToLeadSnapshot();
          return;
        }
        const json = (await res.json()) as {
          meter?: Record<string, unknown>;
          consumption_monthly?: { month: number; kwh: number }[];
        };
        if (cancelled) return;
        if (!json.meter) {
          setMeterDetailPhase("error");
          setMeterDetailError("Réponse compteur invalide");
          revertToLeadSnapshot();
          return;
        }
        const m = json.meter;
        setFormLead((prev) =>
          prev ? normalizeLeadEquipmentFields({ ...prev, ...applyMeterRowToLeadSnapshot(m) } as Lead) : null
        );
        setMonthlyLocal(Array.isArray(json.consumption_monthly) ? json.consumption_monthly : []);
        setEnergyEngine(parseEnergyEngineFromProfile(m.energy_profile));
        setMeterDetailPhase("ready");
        setMeterDetailError(null);
      } catch (e) {
        if (!cancelled) {
          setMeterDetailPhase("error");
          setMeterDetailError(e instanceof Error ? e.message : "Erreur réseau");
          revertToLeadSnapshot();
        }
      }
    })();
    return () => { cancelled = true; };
  }, [id, selectedMeterId, metersLoadPhase, metersList, meterModalOpen]);

  // ——— Documents ———
  const fetchLeadDocuments = useCallback(async () => {
    if (!id || !getAuthToken()) return;
    try {
      const res = await apiFetch(`${API_BASE}/api/documents/lead/${id}`);
      if (res.ok) {
        const raw = await res.json();
        setDocuments(Array.isArray(raw) ? raw.map((row: unknown) => normalizeEntityDocument(row as Record<string, unknown>)) : []);
      } else setDocuments([]);
    } catch { setDocuments([]); }
  }, [id]);

  const fetchClientDocuments = useCallback(async () => {
    const clientId = data?.lead?.client_id;
    if (!clientId || !getAuthToken()) { setClientDocuments([]); return; }
    try {
      const res = await apiFetch(`${API_BASE}/api/documents/client/${clientId}`);
      if (res.ok) {
        const raw = await res.json();
        setClientDocuments(Array.isArray(raw) ? raw.map((row: unknown) => normalizeEntityDocument(row as Record<string, unknown>)) : []);
      } else setClientDocuments([]);
    } catch { setClientDocuments([]); }
  }, [data?.lead?.client_id]);

  const fetchDocuments = useCallback(async () => {
    await fetchLeadDocuments();
    await fetchClientDocuments();
  }, [fetchLeadDocuments, fetchClientDocuments]);

  useEffect(() => { if (data?.lead?.id) void fetchLeadDocuments(); }, [data?.lead?.id, fetchLeadDocuments]);
  useEffect(() => { void fetchClientDocuments(); }, [fetchClientDocuments]);

  // ——— Studies / Quotes ———
  const fetchStudies = useCallback(async () => {
    if (!id) return;
    setStudiesLoading(true);
    try { const list = await fetchStudiesByLeadId(id); setStudies(list); }
    catch { setStudies([]); }
    finally { setStudiesLoading(false); }
  }, [id]);

  const fetchQuotes = useCallback(async () => {
    if (!id) return;
    setQuotesLoading(true);
    try { const list = await fetchQuotesByLeadId(id); setQuotes(list); }
    catch { setQuotes([]); }
    finally { setQuotesLoading(false); }
  }, [id]);

  const fetchClientMissions = useCallback(async () => {
    const cid = data?.lead?.client_id;
    if (!cid) return;
    setClientMissionsLoading(true);
    try { const list = await fetchMissionsByClientId(cid); setClientMissions(list); }
    catch { setClientMissions([]); }
    finally { setClientMissionsLoading(false); }
  }, [data?.lead?.client_id]);

  const loadActivities = useCallback(async () => {
    if (!id) return;
    setActivitiesLoading(true);
    try { const { items } = await fetchActivities(id, { limit: 100 }); setActivities(items); }
    catch { setActivities([]); }
    finally { setActivitiesLoading(false); }
  }, [id]);

  useEffect(() => { if (data?.lead?.id) loadActivities(); }, [data?.lead?.id, loadActivities]);
  useEffect(() => { if (id) fetchStudies(); }, [id, fetchStudies]);
  useEffect(() => { if (id) void fetchQuotes(); }, [id, fetchQuotes]);
  useEffect(() => {
    if (activeTab !== "financial" || !id) return;
    void fetchQuotes();
    void fetchStudies();
  }, [activeTab, id, fetchQuotes, fetchStudies]);
  useEffect(() => {
    if (data?.lead?.status === "CLIENT" && data?.lead?.client_id) fetchClientMissions();
  }, [data?.lead?.status, data?.lead?.client_id, fetchClientMissions]);

  // ——— Sticky bar IntersectionObserver ———
  useEffect(() => {
    const el = headerZoneRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setLeadStickyBarVisible(!entry.isIntersecting),
      { threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [data?.lead?.id]);

  // ——— Autosave core ———
  const mergeLeadRowIntoState = useCallback((row: Record<string, unknown>) => {
    setData((prev) => {
      if (!prev) return prev;
      const merged = { ...prev.lead, ...row } as Lead;
      const leadNorm = normalizeLeadEquipmentFields(merged);
      const st = prev.stages.find((s) => s.id === leadNorm.stage_id);
      return {
        ...prev,
        lead: {
          ...leadNorm,
          stage_name: (row.stage_name as string | undefined) ?? st?.name ?? prev.lead.stage_name,
        },
        stage: st ?? prev.stage,
      };
    });
    setFormLead((fl) => fl ? normalizeLeadEquipmentFields({ ...fl, ...row } as Lead) : null);
  }, []);

  const patchLeadSilent = useCallback(async (payload: Partial<Lead>) => {
    if (!id) return;
    const res = await apiFetch(`${API_BASE}/api/leads/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || "Erreur mise à jour");
    }
    const row = (await res.json()) as Record<string, unknown>;
    mergeLeadRowIntoState(row);
  }, [id, mergeLeadRowIntoState]);

  const patchConsumptionSilent = useCallback(async (payload: Record<string, unknown>) => {
    if (!id) return;
    const res = await apiFetch(`${API_BASE}/api/leads/${id}/consumption`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || "Erreur conso");
    }
    const row = (await res.json()) as Record<string, unknown> & {
      consumption_monthly?: { month: number; kwh: number }[];
    };
    setData((prev) => {
      if (!prev) return prev;
      const merged = { ...prev.lead, ...row } as Lead;
      const leadNorm = normalizeLeadEquipmentFields(merged);
      const st = prev.stages.find((s) => s.id === leadNorm.stage_id);
      return {
        ...prev,
        lead: { ...leadNorm, stage_name: st?.name ?? prev.lead.stage_name },
        consumption_monthly: row.consumption_monthly ?? prev.consumption_monthly,
        stage: st ?? prev.stage,
      };
    });
    setFormLead((fl) => fl ? normalizeLeadEquipmentFields({ ...fl, ...row } as Lead) : null);
    if (row.consumption_monthly && row.consumption_monthly.length > 0 && !monthlyGridEditingRef.current) {
      setMonthlyLocal(row.consumption_monthly);
    }
  }, [id]);

  const patchMeterSilent = useCallback(async (meterId: string, payload: Record<string, unknown>) => {
    if (!id) return;
    const res = await apiFetch(`${API_BASE}/api/leads/${id}/meters/${meterId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || "Erreur compteur");
    }
    const row = (await res.json()) as {
      id: string; name: string; is_default: boolean;
      meter_power_kva?: number | null; grid_type?: string | null;
      consumption_mode?: string | null; consumption_annual_kwh?: number | null;
      consumption_annual_calculated_kwh?: number | null; consumption_pdl?: string | null;
      consumption_monthly?: { month: number; kwh: number }[];
      meter_detail?: Record<string, unknown> & { is_default?: boolean };
    };
    setMetersList((prev) =>
      prev.map((m) => {
        if (m.id === meterId) {
          return {
            ...m, name: row.name, is_default: row.is_default,
            meter_power_kva: row.meter_power_kva ?? null,
            grid_type: row.grid_type ?? m.grid_type ?? null,
            consumption_mode: row.consumption_mode ?? m.consumption_mode ?? null,
            consumption_annual_kwh: row.consumption_annual_kwh ?? null,
            consumption_annual_calculated_kwh: row.consumption_annual_calculated_kwh ?? m.consumption_annual_calculated_kwh ?? null,
            consumption_pdl: row.consumption_pdl ?? null,
          };
        }
        return row.is_default ? { ...m, is_default: false } : m;
      })
    );
    const detail = (row.meter_detail ?? row) as Record<string, unknown> & { is_default?: boolean };
    const isSelected = selectedMeterIdRef.current === meterId;
    if (isSelected) {
      setFormLead((fl) =>
        fl ? normalizeLeadEquipmentFields({ ...fl, ...applyMeterRowToLeadSnapshot(detail) } as Lead) : null
      );
      if (row.consumption_monthly !== undefined && !monthlyGridEditingRef.current) {
        setMonthlyLocal(row.consumption_monthly);
      }
    }
    if (detail.is_default === true) {
      setData((prev) => {
        if (!prev) return prev;
        const merged = { ...prev.lead, ...applyMeterRowToLeadSnapshot(detail) } as Lead;
        const leadNorm = normalizeLeadEquipmentFields(merged);
        const st = prev.stages.find((s) => s.id === leadNorm.stage_id);
        return {
          ...prev,
          lead: { ...leadNorm, stage_name: st?.name ?? prev.lead.stage_name },
          consumption_monthly:
            row.consumption_monthly !== undefined ? row.consumption_monthly : prev.consumption_monthly,
          stage: st ?? prev.stage,
        };
      });
    }
  }, [id]);

  const performOverviewSave = useCallback(async (): Promise<boolean> => {
    if (isReadOnly) return false;
    if (!id) return false;
    const fl = formLeadRef.current;
    if (!fl) return false;
    const existing = overviewSavePromiseRef.current;
    if (existing) return existing;
    const promise = (async (): Promise<boolean> => {
      isAutosaveInFlightRef.current = true;
      setSaveSyncState("saving");
      try {
        const mPhase = metersLoadPhaseRef.current;
        const list = metersListRef.current;
        const hasMeters = list.length > 0;
        const canSaveEnergyLegacy = mPhase === "ready" && !hasMeters;
        await patchLeadSilent(buildLeadPatch(fl, { omitEnergyProfile: hasMeters }) as Partial<Lead>);
        if (canSaveEnergyLegacy) {
          await patchConsumptionSilent(buildConsumptionPayload(fl, monthlyLocalRef.current));
        } else if (!hasMeters) {
          throw new Error(
            mPhase === "loading"
              ? "Sauvegarde consommation impossible : compteurs en cours de chargement."
              : mPhase === "error"
                ? metersFetchErrorRef.current || "Sauvegarde consommation impossible : impossible de charger les compteurs."
                : "Sauvegarde consommation impossible : compteurs non disponibles."
          );
        }
        if (editedDuringAutosaveRef.current) {
          editedDuringAutosaveRef.current = false;
          setOverviewDirty(true);
          setSaveSyncState("pending");
        } else {
          setOverviewDirty(false);
          setSaveSyncState("saved");
          if (savedIdleTimerRef.current) clearTimeout(savedIdleTimerRef.current);
          savedIdleTimerRef.current = setTimeout(() => setSaveSyncState("idle"), 2200);
        }
        return true;
      } catch {
        setSaveSyncState("error");
        return false;
      } finally {
        isAutosaveInFlightRef.current = false;
        overviewSavePromiseRef.current = null;
      }
    })();
    overviewSavePromiseRef.current = promise;
    return promise;
  }, [isReadOnly, id, patchLeadSilent, patchConsumptionSilent]);

  const flushOverviewSave = useCallback(async (): Promise<boolean> => {
    if (isReadOnly) return true;
    if (autosaveDebounceRef.current) {
      clearTimeout(autosaveDebounceRef.current);
      autosaveDebounceRef.current = null;
    }
    if (!overviewDirty || !formLeadRef.current) return true;
    return performOverviewSave();
  }, [isReadOnly, overviewDirty, performOverviewSave]);

  const scheduleOverviewAutosave = useCallback((delayMs: number) => {
    if (isReadOnly) return;
    if (autosaveDebounceRef.current) clearTimeout(autosaveDebounceRef.current);
    setSaveSyncState((prev) => {
      if (prev === "saving") return prev;
      return prev === "pending" ? prev : "pending";
    });
    autosaveDebounceRef.current = setTimeout(() => {
      autosaveDebounceRef.current = null;
      if (saveSyncStateRef.current === "saving" || isAutosaveInFlightRef.current) return;
      void performOverviewSave();
    }, delayMs);
  }, [isReadOnly, performOverviewSave]);

  // Autosave trigger effect
  useEffect(() => {
    if (isReadOnly) return;
    if (!overviewDirty || !formLead) return;
    if (saveSyncState === "saving") return;
    const delayMs = lastOverviewEditKindRef.current === "monthly" ? 2400 : 1300;
    scheduleOverviewAutosave(delayMs);
    return () => {
      if (autosaveDebounceRef.current) clearTimeout(autosaveDebounceRef.current);
    };
  }, [isReadOnly, overviewDirty, formLead, monthlyLocal, saveSyncState, scheduleOverviewAutosave]);

  // Navigation blocker
  const navigationBlocked = saveSyncState === "error";
  const blocker = useBlocker(navigationBlocked);
  useEffect(() => {
    if (blocker.state === "blocked") {
      const ok = window.confirm("La dernière sauvegarde a échoué. Quitter cette page quand même ?");
      if (ok) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker, blocker.state]);
  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      if (saveSyncState === "error") { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [saveSyncState]);

  // ——— Form handlers ———
  const handleFormLeadChange = useCallback((patch: Partial<OverviewLead>) => {
    if (isReadOnly) return;
    lastOverviewEditKindRef.current = "form";
    if (isAutosaveInFlightRef.current) editedDuringAutosaveRef.current = true;
    setFormLead((prev) => (prev ? ({ ...prev, ...patch } as Lead) : null));
    setOverviewDirty(true);
  }, [isReadOnly]);

  const handleMonthlyLocalChange = useCallback((months: { month: number; kwh: number }[]) => {
    if (isReadOnly) return;
    lastOverviewEditKindRef.current = "monthly";
    if (isAutosaveInFlightRef.current) editedDuringAutosaveRef.current = true;
    setMonthlyLocal(months);
    setOverviewDirty(true);
  }, [isReadOnly]);

  const setMonthlyGridEditing = useCallback((editing: boolean) => {
    monthlyGridEditingRef.current = editing;
  }, []);

  const handleEnergyEngineChange = useCallback((engine: EnergyEngineResult | null) => {
    if (isReadOnly) return;
    lastOverviewEditKindRef.current = "form";
    if (isAutosaveInFlightRef.current) editedDuringAutosaveRef.current = true;
    setEnergyEngine(engine);
    setFormLead((prev) =>
      prev ? { ...prev, energy_profile: engine ? { engine } : null } : null
    );
    setOverviewDirty(true);
  }, [isReadOnly]);

  // ——— Tab change ———
  const handleLeadTabChange = useCallback(async (tab: LeadTabId) => {
    if (activeTab === "overview" && tab !== "overview") {
      const ok = await flushOverviewSave();
      if (!ok) return;
    }
    setActiveTab(tab);
  }, [activeTab, flushOverviewSave]);

  // ——— Meter handlers ———
  const handleOpenMeterCreateModal = useCallback(async () => {
    if (isReadOnly) return;
    if (!id) return;
    const flushed = await flushOverviewSave();
    if (!flushed) {
      setError("Impossible d'enregistrer les modifications avant d'ouvrir la création de compteur. Corrigez l'erreur ou réessayez.");
      return;
    }
    setError(null);
    setMeterModalMode("create");
    setMeterModalMeterId(null);
    setMeterModalOpen(true);
  }, [isReadOnly, id, flushOverviewSave]);

  const handleOpenMeterEditModal = useCallback(async (meterId: string) => {
    if (isReadOnly) return;
    if (!id) return;
    const flushed = await flushOverviewSave();
    if (!flushed) {
      setError("Impossible d'enregistrer les modifications avant d'ouvrir le compteur. Corrigez l'erreur ou réessayez.");
      return;
    }
    setError(null);
    setSelectedMeterId(meterId);
    setMeterModalMode("edit");
    setMeterModalMeterId(meterId);
    setMeterModalOpen(true);
  }, [isReadOnly, id, flushOverviewSave]);

  const handleMeterModalClose = useCallback(() => {
    setMeterModalOpen(false);
    setMeterModalMode(null);
    setMeterModalMeterId(null);
  }, []);

  const handleMeterSaveSuccess = useCallback(async (result: { meterId: string }) => {
    setSelectedMeterId(result.meterId);
    if (!id) return;
    try {
      const mRes = await apiFetch(`${API_BASE}/api/leads/${id}/meters`);
      if (mRes.ok) {
        const list = (await mRes.json()) as LeadMeterListItem[];
        if (Array.isArray(list)) {
          setMetersList(list);
          setMetersLoadPhase("ready");
          setMetersFetchError(null);
        }
      }
    } catch { /* ignore */ }
    await fetchLead();
  }, [id, fetchLead]);

  const handleSetDefaultMeter = useCallback(async (meterId: string) => {
    if (isReadOnly) return;
    if (!id) return;
    const ok = await flushOverviewSave();
    if (!ok) return;
    setMetersBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/leads/${id}/meters/${meterId}/set-default`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Erreur");
      }
      await fetchLead();
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur"); }
    finally { setMetersBusy(false); }
  }, [isReadOnly, id, flushOverviewSave, fetchLead]);

  const handleDeleteMeter = useCallback(async (meterId: string) => {
    if (isReadOnly) return;
    if (!id) return;
    const ok = await flushOverviewSave();
    if (!ok) return;
    setMetersBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/leads/${id}/meters/${meterId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Suppression impossible");
      }
      await fetchLead();
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur"); }
    finally { setMetersBusy(false); }
  }, [isReadOnly, id, flushOverviewSave, fetchLead]);

  const handleDeleteEnergyProfile = useCallback(async () => {
    if (isReadOnly) return;
    if (!id) return;
    const mid = selectedMeterIdRef.current;
    const meters = metersLoadPhaseRef.current === "ready" ? metersListRef.current : [];
    const current = meters.find((m) => m.id === mid);
    const isDefault = current?.is_default === true;
    if (mid && !isDefault) {
      try {
        await patchMeterSilent(mid, { energy_profile: null });
        setEnergyEngine(null);
        setEnergyProfileSuccessMessage("Profil énergie supprimé");
        window.setTimeout(() => setEnergyProfileSuccessMessage(null), 3000);
      } catch { /* ignore */ }
      return;
    }
    const res = await apiFetch(`${API_BASE}/api/leads/${id}/energy-profile`, { method: "DELETE" });
    if (!res.ok) return;
    const body = await res.json().catch(() => ({})) as { success?: boolean };
    if (body.success) {
      setEnergyEngine(null);
      setFormLead((fl) => (fl ? { ...fl, energy_profile: null } : null));
      setData((prev) =>
        prev ? { ...prev, lead: { ...prev.lead, energy_profile: null } } : prev
      );
      setEnergyProfileSuccessMessage("Profil énergie supprimé");
      window.setTimeout(() => setEnergyProfileSuccessMessage(null), 3000);
    }
  }, [isReadOnly, id, patchMeterSilent]);

  // ——— Archive / Revert ———
  const handleArchiveLeadRequest = useCallback(() => {
    if (isReadOnly) return;
    setArchiveConfirmOpen(true);
  }, [isReadOnly]);

  const performArchiveLead = useCallback(async () => {
    if (isReadOnly) return;
    if (!id) return;
    setArchiveConfirmOpen(false);
    setError(null);
    try { await archiveLead(id); showLeadSuccessToast("Lead archivé"); navigate("/leads"); }
    catch (e) { setError(e instanceof Error ? e.message : "Erreur"); }
  }, [isReadOnly, id, navigate]);

  const handleUnarchiveLead = useCallback(async () => {
    if (isReadOnly) return;
    if (!id) return;
    if (!window.confirm("Restaurer ce lead dans le pipeline ?")) return;
    setError(null);
    try { await unarchiveLead(id); await fetchLead(); showLeadSuccessToast("Lead restauré"); }
    catch (e) { setError(e instanceof Error ? e.message : "Erreur"); }
  }, [isReadOnly, id, fetchLead]);

  const performRevertToLead = useCallback(async () => {
    if (isReadOnly || !id) return;
    setRevertSaving(true);
    setError(null);
    try {
      await revertLeadToLead(id);
      setRevertConfirmOpen(false);
      showLeadSuccessToast("Dossier remis en lead — visible dans l'onglet Leads.");
      await fetchLead();
      setTimeout(() => navigate("/leads"), 600);
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur"); }
    finally { setRevertSaving(false); }
  }, [isReadOnly, id, fetchLead, navigate]);

  // ——— Status / Stage / Project ———
  const handleStatusChange = useCallback(async (newStatus: string) => {
    if (isReadOnly) return;
    if (!id || !data || newStatus === data.lead.status) return;
    if (newStatus === "CLIENT") {
      setError("Le statut « client » est appliqué automatiquement lorsque le dossier est placé sur l'étape « Signé » du pipeline. Un devis accepté seul ne suffit pas.");
      return;
    }
    const flushed = await flushOverviewSave();
    if (!flushed) return;
    setStatusSaving(true);
    setError(null);
    try { await patchLeadSilent({ status: newStatus }); showLeadSuccessToast("Statut mis à jour."); await fetchLead(); }
    catch (e) { setError(e instanceof Error ? e.message : "Erreur"); }
    finally { setStatusSaving(false); }
  }, [isReadOnly, id, data, flushOverviewSave, patchLeadSilent, fetchLead]);

  const handleStageChange = useCallback(async (stageId: string) => {
    if (isReadOnly) return;
    if (!id || !data || data.lead.stage_id === stageId) return;
    const flushed = await flushOverviewSave();
    if (!flushed) return;
    setStageChanging(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/leads/${id}/stage`, {
        method: "PATCH",
        body: JSON.stringify({ stageId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Erreur stage");
      }
      await fetchLead();
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur"); }
    finally { setStageChanging(false); }
  }, [isReadOnly, id, data, flushOverviewSave, fetchLead]);

  const handleProjectStatusIntent = useCallback(async (next: string) => {
    if (isReadOnly) return;
    if (!id || !data) return;
    const current = String(formLeadRef.current?.project_status ?? data.lead.project_status ?? "SIGNE").trim();
    if (next === current) return;
    if (next === "DP_REFUSED") { setDpRefusedOpen(true); return; }
    const flushed = await flushOverviewSave();
    if (!flushed) return;
    setPendingProjectStatus(next);
    setConfirmProjectOpen(true);
  }, [isReadOnly, id, data, flushOverviewSave]);

  const confirmProjectApply = useCallback(async () => {
    if (isReadOnly) return;
    if (!pendingProjectStatus || !id || !data) return;
    const prev = String(formLeadRef.current?.project_status ?? data.lead.project_status ?? "SIGNE");
    const next = pendingProjectStatus;
    setConfirmProjectOpen(false);
    setPendingProjectStatus(null);
    setError(null);
    try {
      await scheduleUndo({
        previousState: prev,
        execute: async () => { await patchLeadSilent({ project_status: next }); },
        rollback: async () => { await patchLeadSilent({ project_status: prev }); },
        message: "Statut projet mis à jour",
      });
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur"); }
  }, [isReadOnly, pendingProjectStatus, id, data, scheduleUndo, patchLeadSilent]);

  const handleDpRefusedChoose = useCallback(async (choice: DPRefusedChoice) => {
    if (isReadOnly) return;
    if (!id || !data) return;
    setDpRefusedBusy(true);
    setError(null);
    try {
      const flushed = await flushOverviewSave();
      if (!flushed) return;
      const snap = {
        status: data.lead.status,
        project_status: data.lead.project_status ?? null,
        lost_reason: data.lead.lost_reason ?? null,
      };
      const patch = buildDpRefusedPatch(choice);
      await scheduleUndo({
        previousState: snap,
        execute: async () => {
          await patchLeadSilent(patch as Partial<Lead>);
          if (choice === "attente") {
            await createActivity(id, {
              type: "NOTE",
              title: "DP refusé — mise en attente",
              content: "Tag DP_RETRY_LATER — suivi différé.",
              payload: { tag: ACTIVITY_TAG_DP_RETRY_LATER },
            });
          }
        },
        rollback: async () => {
          await patchLeadSilent({
            status: snap.status,
            project_status: snap.project_status ?? "SIGNE",
            lost_reason: snap.lost_reason,
          } as Partial<Lead>);
        },
        message: choice === "perdu" ? "Dossier classé en perdu" : "Statut mis à jour",
      });
      setDpRefusedOpen(false);
      showLeadSuccessToast(
        choice === "perdu" ? "Dossier classé en perdu" : "Mise à jour — retour vers la liste Leads"
      );
      window.setTimeout(() => navigate("/leads"), 1600);
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur"); }
    finally { setDpRefusedBusy(false); }
  }, [isReadOnly, id, data, flushOverviewSave, scheduleUndo, patchLeadSilent, navigate]);

  // ——— Address ———
  const handleAddressSelect = useCallback(async (
    s: AutocompleteSuggestion,
    pickTier: AddressPickTier = "normal"
  ) => {
    if (isReadOnly) return;
    try {
      const geo_source: string =
        pickTier === "normal" ? "autocomplete_pick"
          : pickTier === "fallback_street" ? "autocomplete_fallback_street"
            : "autocomplete_fallback_city";
      const payload = {
        address_line1: s.components?.address_line1 || s.label,
        address_line2: s.components?.address_line2 ?? undefined,
        postal_code: s.components?.postal_code ?? undefined,
        city: s.components?.city ?? undefined,
        country_code: s.components?.country_code || "FR",
        formatted_address: s.label,
        lat: s.lat ?? undefined,
        lon: s.lon ?? undefined,
        geo_provider: s.provider || "BAN",
        geo_place_id: s.place_id,
        geo_source,
        geo_precision_level: s.precision_level ?? undefined,
        geo_confidence: s.confidence ?? undefined,
      };
      const created = await createAddress(payload);
      await patchLeadSilent({ site_address_id: created.id });
      setAddressInput(s.label);
      await fetchLead();
      const mustOpenGeoModal =
        s.lat == null || s.lon == null ||
        pickTier === "fallback_street" || pickTier === "fallback_city" ||
        isLowConfidencePrecision(s.precision_level);
      if (mustOpenGeoModal) setGeoValidationModalOpen(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur création adresse"); }
  }, [isReadOnly, patchLeadSilent, fetchLead]);

  const handleManualMapPlacement = useCallback(async () => {
    if (isReadOnly) return;
    if (!id) return;
    setError(null);
    try {
      const text = addressInput.trim() || "Adresse à préciser";
      const created = await createAddress({
        formatted_address: text,
        address_line1: text,
        country_code: "FR",
        geo_source: "manual_map_pending",
        lat: null,
        lon: null,
      });
      await patchLeadSilent({ site_address_id: created.id });
      await fetchLead();
      setGeoValidationModalOpen(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur création adresse"); }
  }, [isReadOnly, id, addressInput, patchLeadSilent, fetchLead]);

  // ——— Activities ———
  const handleAddActivity = useCallback(async () => {
    if (isReadOnly) return;
    if (!id) return;
    if (addActivityType === "NOTE" && !addActivityContent.trim()) return;
    setAddActivitySaving(true);
    setError(null);
    try {
      const payload: CreateActivityPayload = {
        type: addActivityType,
        title: addActivityTitle.trim() || undefined,
        content: addActivityContent.trim() || undefined,
      };
      await createActivity(id, payload);
      setAddNotesFormOpen(false);
      setAddActivityTitle("");
      setAddActivityContent("");
      await loadActivities();
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur"); }
    finally { setAddActivitySaving(false); }
  }, [isReadOnly, id, addActivityType, addActivityContent, addActivityTitle, loadActivities]);

  const handleEditActivity = useCallback(async (activityId: string) => {
    if (isReadOnly) return;
    if (!editContent.trim()) return;
    setError(null);
    try {
      await updateActivity(activityId, { content: editContent.trim() });
      setEditingActivityId(null);
      setEditContent("");
      await loadActivities();
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur"); }
  }, [isReadOnly, editContent, loadActivities]);

  const handleDeleteActivity = useCallback(async (activityId: string) => {
    if (isReadOnly) return;
    if (!window.confirm("Supprimer cette note ?")) return;
    setError(null);
    try { await deleteActivity(activityId); await loadActivities(); }
    catch (e) { setError(e instanceof Error ? e.message : "Erreur"); }
  }, [isReadOnly, loadActivities]);

  // ——— Studies ———
  const handleCreateStudy = useCallback(async () => {
    if (isReadOnly) return;
    if (!id) return;
    setCreateStudyLoading(true);
    setError(null);
    try {
      const result = await createStudy({
        lead_id: id,
        ...(selectedMeterId ? { selected_meter_id: selectedMeterId } : {}),
      });
      const studyIdNew = result.study?.id;
      const versionId = result.versions?.[0]?.id;
      if (!studyIdNew || !versionId) {
        setError("Réponse serveur : étude ou version manquante");
        return;
      }
      void fetchStudies();
      navigate(`/studies/${studyIdNew}/versions/${versionId}/calpinage`);
    } catch (e) { setError(e instanceof Error ? e.message : "Impossible de créer l'étude"); }
    finally { setCreateStudyLoading(false); }
  }, [isReadOnly, id, selectedMeterId, fetchStudies, navigate]);

  const getLatestStudyVersion = useCallback(async (studyId: string): Promise<{ versionNumber: number } | null> => {
    const res = await apiFetch(`${API_BASE}/api/studies/${studyId}`);
    if (!res.ok) return null;
    const json = await res.json();
    const versions = json.versions || [];
    if (versions.length === 0) return null;
    const last = versions[versions.length - 1];
    return { versionNumber: last.version_number };
  }, []);

  const handleRunCalc = useCallback(async () => {
    if (isReadOnly) return;
    const latest = studies[0];
    if (!latest) { setError("Créez d'abord une étude avec le bouton « Créer étude »."); return; }
    setCalcLoading(true);
    setError(null);
    setCalcSummary(null);
    try {
      const ver = await getLatestStudyVersion(latest.id);
      if (!ver) { setError("Aucune version disponible pour cette étude"); return; }
      let calcBody: string | undefined;
      if (typeof window !== "undefined") {
        const snapFn = (window as Window & { __SOLARNEXT_GET_UI_SHADING_SNAPSHOT__?: () => unknown }).__SOLARNEXT_GET_UI_SHADING_SNAPSHOT__;
        if (typeof snapFn === "function") {
          try {
            const snap = snapFn();
            if (snap && typeof snap === "object") calcBody = JSON.stringify({ shading_ui_snapshot: snap });
          } catch { /* ignore */ }
        }
      }
      const res = await apiFetch(
        `${API_BASE}/api/studies/${latest.id}/versions/${ver.versionNumber}/calc`,
        { method: "POST", ...(calcBody ? { body: calcBody } : {}) }
      );
      const text = await res.text();
      let json: Record<string, unknown> = {};
      try { json = text ? JSON.parse(text) : {}; }
      catch { json = { error: text || `Erreur ${res.status}` }; }
      if (!res.ok) {
        const errMsg = (json.error as string) || `Erreur ${res.status}`;
        const code = json.code as string | undefined;
        const displayMsg =
          code === "CALPINAGE_REQUIRED" || errMsg.includes("Calpinage requis") || errMsg.includes("CALPINAGE_REQUIRED")
            ? "Calpinage requis : réalisez d'abord le calpinage sur le plan."
            : code ? `[${code}] ${errMsg}` : errMsg;
        setError(displayMsg);
        showCalcErrorToast(displayMsg);
        return;
      }
      if (json.ok && json.summary && typeof json.summary === "object" && json.summary !== null) {
        setCalcSummary(json.summary as Record<string, unknown>);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur calcul";
      setError(msg);
      showCalcErrorToast(msg);
    } finally { setCalcLoading(false); }
  }, [isReadOnly, studies, getLatestStudyVersion]);

  const handleOpenStudyCalpinage = useCallback((study: Study) => {
    const vid = study.latest_version_id;
    if (!vid) { setError("Aucune version disponible pour cette étude."); return; }
    navigate(`/studies/${study.id}/versions/${vid}/calpinage`);
  }, [navigate]);

  const handleOpenStudyQuoteBuilder = useCallback((study: Study) => {
    const vid = study.latest_version_id;
    if (!vid) { setError("Aucune version disponible pour cette étude."); return; }
    navigate(`/studies/${study.id}/versions/${vid}/quote-builder`);
  }, [navigate]);

  const handleSaveStudyTitle = useCallback(async () => {
    if (isReadOnly) return;
    if (!studyTitleModalStudy) return;
    const t = studyTitleDraft.trim();
    if (!t) { setError("Le nom de l'étude ne peut pas être vide."); return; }
    setStudyTitleSaving(true);
    setError(null);
    try { await patchStudyTitle(studyTitleModalStudy.id, t); setStudyTitleModalStudy(null); await fetchStudies(); }
    catch (e) { setError(e instanceof Error ? e.message : "Erreur"); }
    finally { setStudyTitleSaving(false); }
  }, [isReadOnly, studyTitleModalStudy, studyTitleDraft, fetchStudies]);

  const handleCreateStudyDuplicateFromTitleModal = useCallback(async () => {
    if (isReadOnly) return;
    if (!studyTitleModalStudy) return;
    const t = studyTitleDraft.trim();
    if (!t) { setError("Indiquez un nom pour la nouvelle étude (copie)."); return; }
    setStudyDuplicateBusy(true);
    setError(null);
    try { await duplicateStudy(studyTitleModalStudy.id, { title: t }); setStudyTitleModalStudy(null); await fetchStudies(); }
    catch (e) { setError(e instanceof Error ? e.message : "Erreur"); }
    finally { setStudyDuplicateBusy(false); }
  }, [isReadOnly, studyTitleModalStudy, studyTitleDraft, fetchStudies]);

  // ——— Email ———
  const openComposeForLeadEmail = useCallback(async (email: string, leadId: string) => {
    const addr = email.trim();
    if (!addr || !leadId) return;
    try {
      const accounts = await fetchMailAccounts();
      if (accounts.length > 0) {
        navigate("/mail", {
          state: { mailComposePrefill: { crmLeadId: leadId, composePresentation: "overlay" } },
        });
      } else { window.location.href = `mailto:${encodeURIComponent(addr)}`; }
    } catch { window.location.href = `mailto:${encodeURIComponent(addr)}`; }
  }, [navigate]);

  // ——— Computed values ———
  const displayLead = formLead ?? data?.lead;
  const fullName =
    displayLead?.full_name?.trim() ||
    (displayLead && [displayLead.first_name, displayLead.last_name].filter(Boolean).join(" ").trim());
  const commercialEmail = users.find((u) => u.id === displayLead?.assigned_user_id)?.email ?? "";
  const notes = activities.filter((a) => a.type === "NOTE");
  const historyItems = activities.filter((a) => a.type !== "NOTE");
  const isArchived = data?.lead?.status === "ARCHIVED" || Boolean(data?.lead?.archived_at);
  const isClient = data?.lead?.status === "CLIENT";
  const isLead = !isClient && !isArchived;
  const headerTypeStatus: "LEAD" | "CLIENT" = isClient ? "CLIENT" : "LEAD";
  const showEnergyConsoBody = false;
  const energySectionSummary = buildEnergyMetersSectionSummary(metersLoadPhase, metersList, metersFetchError);
  const metersBarMeters = metersLoadPhase === "loading" ? null : metersList;
  const dpFolderAccessible = displayLead ? isLeadDpFolderAccessible(displayLead) : false;

  return {
    // Core
    id, data, loading, error, setError, fetchLead,
    // UI
    activeTab, setActiveTab, handleLeadTabChange,
    stageChanging, statusSaving,
    // Meta
    users, leadSources,
    // Autosave
    formLead, setFormLead, monthlyLocal, setMonthlyLocal,
    saveSyncState, overviewDirty,
    handleFormLeadChange, handleMonthlyLocalChange, setMonthlyGridEditing, handleEnergyEngineChange,
    performOverviewSave, flushOverviewSave,
    // Energy
    energyEngine, energyProfileSuccessMessage,
    handleDeleteEnergyProfile,
    // Meters
    metersLoadPhase, metersList, metersFetchError, meterDetailPhase, meterDetailError,
    selectedMeterId, setSelectedMeterId, metersBusy,
    meterModalOpen, meterModalMode, meterModalMeterId,
    handleOpenMeterCreateModal, handleOpenMeterEditModal,
    handleMeterModalClose, handleMeterSaveSuccess,
    handleSetDefaultMeter, handleDeleteMeter,
    // Activities
    activities, activitiesLoading, notes, historyItems,
    addNotesFormOpen, setAddNotesFormOpen,
    addActivityType, setAddActivityType,
    addActivityTitle, setAddActivityTitle,
    addActivityContent, setAddActivityContent,
    addActivitySaving,
    editingActivityId, setEditingActivityId,
    editContent, setEditContent,
    handleAddActivity, handleEditActivity, handleDeleteActivity,
    // Documents
    documents, clientDocuments, fetchDocuments,
    // Studies
    studies, studiesLoading, fetchStudies,
    quotes, quotesLoading, fetchQuotes,
    createStudyLoading, calcLoading, calcSummary,
    studyTitleModalStudy, setStudyTitleModalStudy,
    studyTitleDraft, setStudyTitleDraft,
    studyTitleSaving, studyDuplicateBusy,
    handleCreateStudy, handleRunCalc,
    handleOpenStudyCalpinage, handleOpenStudyQuoteBuilder,
    handleSaveStudyTitle, handleCreateStudyDuplicateFromTitleModal,
    // Missions
    clientMissions, setClientMissions, clientMissionsLoading, fetchClientMissions,
    createMissionModalOpen, setCreateMissionModalOpen,
    // Archive / Revert
    archiveConfirmOpen, setArchiveConfirmOpen,
    revertConfirmOpen, setRevertConfirmOpen, revertSaving,
    handleArchiveLeadRequest, performArchiveLead, handleUnarchiveLead, performRevertToLead,
    // Status / Stage / Project
    handleStatusChange, handleStageChange,
    handleProjectStatusIntent, confirmProjectApply,
    confirmProjectOpen, setConfirmProjectOpen, pendingProjectStatus, setPendingProjectStatus,
    // DP
    dpRefusedOpen, setDpRefusedOpen, dpRefusedBusy, handleDpRefusedChoose,
    // Address
    addressInput, setAddressInput, geoValidationModalOpen, setGeoValidationModalOpen,
    handleAddressSelect, handleManualMapPlacement,
    // Email
    openComposeForLeadEmail,
    // Computed
    displayLead, fullName, commercialEmail,
    isArchived, isClient, isLead, headerTypeStatus,
    showEnergyConsoBody, energySectionSummary, metersBarMeters, dpFolderAccessible,
    // Refs for JSX
    headerZoneRef, leadStickyBarVisible,
    // Undo
    activeToast,
    // Guard
    isReadOnly,
  };
}
