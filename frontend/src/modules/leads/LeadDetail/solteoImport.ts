/**
 * Import multi-fichiers Solteo/Switchgrid — collecte côté client (ZIP ou multi-sélection)
 * et types de la réponse POST /api/energy/import-solteo.
 * R65 → conso annuelle ; loadcurve → profil horaire normalisé ; C68 → contrat ; PDF → archive.
 */

import JSZip from "jszip";

export interface SolteoFiles {
  loadCurveCsv?: string;
  c68Json?: string;
  r65Json?: string;
  r65Csv?: string;
  dailyCsv?: string;
  monthlyCsv?: string;
  consentPdfBase64?: string;
}

export interface SolteoContract {
  pdl?: string | null;
  etat_contractuel?: string | null;
  segment?: string | null;
  adresse_installation?: string | null;
  code_postal?: string | null;
  commune?: string | null;
  titulaire?: string | null;
  compteur_linky?: boolean;
  tension_livraison?: string | null;
  puissance_raccordement_kva?: number | null;
  puissance_souscrite_kva?: number | null;
  tariff_type?: string | null;
  plage_hc?: string | null;
  futures_plages_hc?: string | null;
  phase_detection?: string | null;
  grid_type_auto?: string | null;
}

export interface SolteoImportResponse {
  annual_kwh: number | null;
  annual_kwh_source: string;
  annual_kwh_source_label: string;
  hourly: number[] | null;
  engine_consumption_source?: string | null;
  energy_profile?: unknown;
  contract?: SolteoContract | null;
  lead_updates?: Record<string, unknown>;
  import_debug?: Record<string, unknown> & { warnings?: string[]; reused_files?: string[] };
}

export interface ManualHpHcImportOptions {
  elec_price_hp_eur_kwh: number;
  elec_price_hc_eur_kwh: number;
  hp_periods: { start: string; end: string }[];
  off_peak_periods: { start: string; end: string }[];
  plage_hc: string;
}

export interface ManualHpHcImportDraft {
  priceHp: string | number | null | undefined;
  priceHc: string | number | null | undefined;
  hpStart: string;
  hpEnd: string;
  hcStart: string;
  hcEnd: string;
}

function normalizeCsvProbe(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function looksLikeEnedisDailyConsumptionCsv(text: string): boolean {
  const header = normalizeCsvProbe(text.slice(0, 600));
  return header.includes("date") && header.includes("consommation") && header.includes("kwh");
}

function parsePriceInput(value: string | number | null | undefined, label: string): number {
  const normalized = typeof value === "string" ? value.trim().replace(",", ".") : value;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0 || n >= 2) {
    throw new Error(`${label} invalide (attendu entre 0 et 2 €/kWh)`);
  }
  return n;
}

function normalizeTimeInput(value: string, label: string): string {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2})(?:[:hH]?(\d{2}))?$/);
  if (!match) throw new Error(`${label} invalide (format HH:MM)`);
  const h = Number(match[1]);
  const m = match[2] == null ? 0 : Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 24 || m < 0 || m > 59 || (h === 24 && m !== 0)) {
    throw new Error(`${label} invalide (format HH:MM)`);
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function labelTime(value: string): string {
  const [h, m] = value.split(":");
  return `${Number(h)}H${m === "00" ? "" : m}`;
}

export function buildManualHpHcImportOptions(draft: ManualHpHcImportDraft): ManualHpHcImportOptions {
  const hpStart = normalizeTimeInput(draft.hpStart, "Début HP");
  const hpEnd = normalizeTimeInput(draft.hpEnd, "Fin HP");
  const hcStart = normalizeTimeInput(draft.hcStart, "Début HC");
  const hcEnd = normalizeTimeInput(draft.hcEnd, "Fin HC");
  if (hpStart === hpEnd) throw new Error("La plage HP ne peut pas être vide");
  if (hcStart === hcEnd) throw new Error("La plage HC ne peut pas être vide");
  return {
    elec_price_hp_eur_kwh: parsePriceInput(draft.priceHp, "Prix HP"),
    elec_price_hc_eur_kwh: parsePriceInput(draft.priceHc, "Prix HC"),
    hp_periods: [{ start: hpStart, end: hpEnd }],
    off_peak_periods: [{ start: hcStart, end: hcEnd }],
    plage_hc: `HC (${labelTime(hcStart)}-${labelTime(hcEnd)})`,
  };
}

/** Ligne « Contrat : HP/HC (HC 22H30-6H30) — 18 kVA — 230/400 V » depuis le bloc contract. */
export function contractSummaryLabel(c?: SolteoContract | null): string | null {
  if (!c) return null;
  const tarifBase =
    c.tariff_type === "hp_hc" ? "HP/HC" : c.tariff_type === "tempo" ? "Tempo" : c.tariff_type === "base" ? "Base" : null;
  // LOT1-HC-WINDOW : fenêtre HC réelle Enedis visible dans la fiche compteur.
  const hcWindow = c.tariff_type === "hp_hc" && c.plage_hc ? c.plage_hc.replace(/^HC\s*/i, "").trim() : null;
  const tarif = tarifBase && hcWindow ? `${tarifBase} ${hcWindow}` : tarifBase;
  const parts = [
    tarif,
    c.puissance_souscrite_kva != null ? `${c.puissance_souscrite_kva} kVA` : null,
    c.tension_livraison ?? null,
  ].filter(Boolean);
  return parts.length ? parts.join(" — ") : null;
}

function assignByNameOrContent(collected: SolteoFiles, lowerName: string, text: string) {
  if (lowerName.includes("loadcurve")) {
    collected.loadCurveCsv = text;
    return;
  }
  if (lowerName.includes("c68")) {
    collected.c68Json = text;
    return;
  }
  if (lowerName.includes("r65") && lowerName.endsWith(".json")) {
    collected.r65Json = text;
    return;
  }
  if (lowerName.includes("r65") && lowerName.endsWith(".csv")) {
    collected.r65Csv = text;
    return;
  }
  if (lowerName.endsWith(".csv") && (lowerName.includes("mensuel") || lowerName.includes("month"))) {
    collected.monthlyCsv = text;
    return;
  }
  if (lowerName.endsWith(".csv") && (lowerName.includes("quotidien") || lowerName.includes("daily"))) {
    collected.dailyCsv = text;
    return;
  }
  if (
    lowerName.endsWith(".csv") &&
    (lowerName.includes("annuel") || lowerName.includes("annuelle")) &&
    looksLikeEnedisDailyConsumptionCsv(text)
  ) {
    collected.dailyCsv = text;
    return;
  }
  // Détection par contenu (fichiers renommés, « Heures été inclus canicule.csv », etc.)
  if (lowerName.endsWith(".csv")) {
    const header = normalizeCsvProbe(text.slice(0, 600));
    if (header.includes("powerinwatts")) collected.loadCurveCsv = collected.loadCurveCsv ?? text;
    else if (looksLikeEnedisDailyConsumptionCsv(text)) collected.dailyCsv = collected.dailyCsv ?? text;
    else if (header.includes("date") && header.includes("value")) collected.dailyCsv = collected.dailyCsv ?? text;
    return;
  }
  if (lowerName.endsWith(".json")) {
    if (text.includes("situationContractuelle") || text.includes("donneesGenerales")) {
      collected.c68Json = collected.c68Json ?? text;
    } else if (text.includes("grandeurMetier") || text.includes("\"grandeur\"")) {
      collected.r65Json = collected.r65Json ?? text;
    }
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/**
 * Collecte les fichiers Solteo depuis une sélection (fichiers directs et/ou ZIP).
 * @returns fichiers classés + noms reconnus (affichage).
 */
export async function collectSolteoFiles(fileList: File[]): Promise<{ files: SolteoFiles; names: string[] }> {
  const collected: SolteoFiles = {};
  const names: string[] = [];

  for (const file of fileList) {
    const n = file.name.toLowerCase();
    if (n.endsWith(".zip")) {
      const zip = await JSZip.loadAsync(file);
      for (const entryName of Object.keys(zip.files)) {
        const entry = zip.files[entryName];
        if (entry.dir) continue;
        const en = entryName.toLowerCase();
        if (en.endsWith(".pdf") && en.includes("consent")) {
          collected.consentPdfBase64 = await entry.async("base64");
          names.push(entryName);
        } else if (en.endsWith(".csv") || en.endsWith(".json")) {
          const before = JSON.stringify(Object.keys(collected));
          assignByNameOrContent(collected, en, await entry.async("text"));
          if (JSON.stringify(Object.keys(collected)) !== before) names.push(entryName);
        }
      }
    } else if (n.endsWith(".pdf") && n.includes("consent")) {
      collected.consentPdfBase64 = await fileToBase64(file);
      names.push(file.name);
    } else if (n.endsWith(".csv") || n.endsWith(".json")) {
      const before = JSON.stringify(Object.keys(collected));
      assignByNameOrContent(collected, n, await file.text());
      if (JSON.stringify(Object.keys(collected)) !== before) names.push(file.name);
    }
  }

  return { files: collected, names };
}

/** True si la sélection dépasse le cas historique « loadcurve seul » → route import-solteo. */
export function isMultiFileImport(files: SolteoFiles): boolean {
  return Boolean(
    files.c68Json || files.r65Json || files.r65Csv || files.dailyCsv || files.monthlyCsv || files.consentPdfBase64
  );
}
