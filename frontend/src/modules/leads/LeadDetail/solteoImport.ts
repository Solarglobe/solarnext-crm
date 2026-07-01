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
  contract?: SolteoContract | null;
  lead_updates?: Record<string, unknown>;
  import_debug?: Record<string, unknown> & { warnings?: string[]; reused_files?: string[] };
}

/** Ligne « Contrat : HP/HC — 18 kVA — 230/400 V » depuis le bloc contract. */
export function contractSummaryLabel(c?: SolteoContract | null): string | null {
  if (!c) return null;
  const tarif =
    c.tariff_type === "hp_hc" ? "HP/HC" : c.tariff_type === "tempo" ? "Tempo" : c.tariff_type === "base" ? "Base" : null;
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
  // Détection par contenu (fichiers renommés, « Heures été inclus canicule.csv », etc.)
  if (lowerName.endsWith(".csv")) {
    const header = text.slice(0, 300).toLowerCase();
    if (header.includes("powerinwatts")) collected.loadCurveCsv = collected.loadCurveCsv ?? text;
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
