/**
 * Nom de fichier PDF étude : Etude-Scenario[-XkWc][-NBatterie(s)].pdf
 * (Windows / Mac / navigateurs — sans nom client : le téléchargement CRM se fait
 * depuis la fiche lead et le portail client est déjà propre au client.)
 */

export function slugify(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9]/g, "");
}

export function mapScenarioName(id) {
  switch (id) {
    case "BASE":
      return "SansBatterie";
    case "BATTERY_PHYSICAL":
      return "BatteriePhysique";
    case "BATTERY_VIRTUAL":
      return "BatterieVirtuelle";
    case "BATTERY_HYBRID":
      return "Hybride";
    default:
      return "Scenario";
  }
}

/** 12 → "12kWc" ; 12.5 → "12-5kWc" ; invalide → null (segment omis). */
function formatKwcSegment(kwc) {
  const n = Number(kwc);
  if (!Number.isFinite(n) || n <= 0) return null;
  const s = n % 1 === 0 ? String(Math.round(n)) : String(n).replace(".", "-");
  return `${s}kWc`;
}

/**
 * Extrait puissance + nb de batteries depuis un selected_scenario_snapshot
 * (persisté ou éphémère) pour le nommage du PDF.
 * @param {object|null|undefined} snapshot
 * @returns {{ kwc: number|null, batteryUnits: number|null }}
 */
export function extractPdfNameFactsFromSnapshot(snapshot) {
  const s = snapshot && typeof snapshot === "object" ? snapshot : {};
  // Garde null/"" AVANT Number() : Number(null) === 0 passerait Number.isFinite.
  const toNumOrNull = (v) =>
    v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;
  const kwc = toNumOrNull(s.installation?.puissance_kwc ?? s.hardware?.kwc ?? null);
  const batteryUnits = toNumOrNull(s.equipment?.batterie?.unites ?? null);
  return { kwc, batteryUnits };
}

/**
 * Nom de fichier PDF étude.
 * Exemples : Etude-Hybride-12kWc-1Batterie.pdf · Etude-SansBatterie-9kWc.pdf
 * Le segment batteries n'apparaît que pour les scénarios avec batterie physique
 * (BATTERY_PHYSICAL / BATTERY_HYBRID) ; fallback 1 si le nombre est inconnu
 * (anciens snapshots sans equipment.batterie.unites).
 * @param {string|null|undefined} selectedScenarioId
 * @param {{ kwc?: number|null, batteryUnits?: number|null }} [opts]
 * @returns {string} nom de fichier .pdf
 */
export function buildStudyPdfFileName(selectedScenarioId, opts = {}) {
  const parts = ["Etude", mapScenarioName(selectedScenarioId)];
  const kwcSeg = formatKwcSegment(opts.kwc);
  if (kwcSeg) parts.push(kwcSeg);
  const isPhysicalLike =
    selectedScenarioId === "BATTERY_PHYSICAL" || selectedScenarioId === "BATTERY_HYBRID";
  if (isPhysicalLike) {
    const n = Number(opts.batteryUnits);
    const units = Number.isFinite(n) && n >= 1 ? Math.round(n) : 1;
    parts.push(`${units}Batterie${units > 1 ? "s" : ""}`);
  }
  let name = `${parts.join("-")}.pdf`;
  if (name.length > 200) {
    name = `${name.slice(0, 196)}.pdf`;
  }
  return name;
}
