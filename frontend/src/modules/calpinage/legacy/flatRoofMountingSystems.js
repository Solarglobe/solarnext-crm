/**
 * flatRoofMountingSystems.js — Catalogue des systèmes de pose toiture plate (LOT A — V1).
 *
 * Module ES pur (aucune dépendance window.*), importable depuis le legacy JS
 * (flatRoofConfig.js) ET depuis React (Phase3Sidebar.tsx).
 *
 * Périmètre V1 validé le 02/07/2026 (cf. ANALYSE_MATERIEL_POSE_TOIT_PLAT_K2_ENSTALL_2026-07-02.md) :
 *   - 4 systèmes sud simple actifs (K2 S-Dome 6 / S-Dome 6.15 / TiltUp Vento, ESDEC FlatFix Fusion) ;
 *   - 2 systèmes est-ouest PRÉSENTS MAIS DÉSACTIVÉS (enabled:false) tant que le moteur de
 *     production ne gère pas deux azimuts sur un même pan (Lot C, audit dédié requis) ;
 *   - le lestage n'est JAMAIS calculé ici : rappel + lien calculateur fabricant uniquement.
 *
 * defaultRowSpacingCm : défauts prudents V1 (le Lot B apportera les modes
 * FIXED_SYSTEM / FLEXIBLE / CALCULATED anti-ombrage). Valeurs éditables ici sans migration :
 * la config appliquée est re-normalisée à chaque patch, et le snapshot persisté fige
 * les valeurs réellement utilisées par l'étude.
 */

// ── Types d'implantation ──────────────────────────────────────────────────────

export const MOUNTING_ARRANGEMENTS = Object.freeze({
  SOUTH_SINGLE: "SOUTH_SINGLE",
  EAST_WEST_DUAL: "EAST_WEST_DUAL",
});

/** Motif du blocage est-ouest — affiché tel quel dans l'UI. */
export const EAST_WEST_UNAVAILABLE_REASON =
  "Est-ouest : indisponible pour le calcul de production (deux azimuts sur un même pan non gérés — Lot C).";

const BALLAST_NOTE_K2 =
  "Lestage non calculé par SolarNext — dimensionnement obligatoire via K2 Base (vérifier la charge admissible de la toiture).";
const BALLAST_NOTE_ESDEC =
  "Lestage non calculé par SolarNext — dimensionnement obligatoire via l'Enstall Calculator (vérifier la charge admissible de la toiture).";

/**
 * @typedef {Object} FlatRoofMountingSystem
 * @property {string} id                    Identifiant stable (persisté dans flatRoofConfig)
 * @property {"K2 Systems"|"ESDEC (Enstall)"} brand
 * @property {string} label                 Libellé complet (sélecteur + devis/PDF)
 * @property {string} arrangement           MOUNTING_ARRANGEMENTS.*
 * @property {boolean} enabled              false = visible mais non sélectionnable (E-O)
 * @property {string|null} unavailableReason
 * @property {number[]} tiltOptionsDeg      Inclinaisons proposées (1 seule = imposée)
 * @property {number} defaultTiltDeg
 * @property {("portrait"|"landscape")[]} orientationOptions (1 seule = imposée)
 * @property {"portrait"|"landscape"} defaultOrientation
 * @property {number} defaultRowSpacingCm   Inter-rangées V1 (Lot B : modes fabricant/libre/calculé)
 * @property {number} defaultSetbackRoofEdgeCm
 * @property {number} defaultSetbackObstacleCm
 * @property {{minLenMm:number|null,maxLenMm:number|null,minWidMm:number|null,maxWidMm:number|null,minThickMm:number|null,maxThickMm:number|null}|null} panelLimits
 * @property {{okMaxDeg:number,warnMaxDeg:number,warnMessage:string,blockMessage:string}} slopeRules
 * @property {string} ballastNote
 * @property {string} calculatorUrl         Outil fabricant (dimensionnement/lestage officiel)
 * @property {string} calculatorLabel
 * @property {string[]} quoteNotes          Mentions devis/PDF (ETN, B ROOF t3…)
 */

/** @type {FlatRoofMountingSystem[]} */
export const FLAT_ROOF_MOUNTING_SYSTEMS = Object.freeze([
  {
    id: "K2_S_DOME_6",
    brand: "K2 Systems",
    label: "K2 S-Dome 6 — sud 10°",
    arrangement: MOUNTING_ARRANGEMENTS.SOUTH_SINGLE,
    enabled: true,
    unavailableReason: null,
    tiltOptionsDeg: [10],
    defaultTiltDeg: 10,
    orientationOptions: ["landscape"],
    defaultOrientation: "landscape",
    defaultRowSpacingCm: 55,
    defaultSetbackRoofEdgeCm: 60,
    defaultSetbackObstacleCm: 60,
    // Variante LS : modules jusqu'à 2390 × 1170 mm (catalogue K2)
    panelLimits: { minLenMm: null, maxLenMm: 2390, minWidMm: null, maxWidMm: 1170, minThickMm: 30, maxThickMm: 50 },
    slopeRules: {
      okMaxDeg: 3,
      warnMaxDeg: 10,
      warnMessage: "Pente 3° à 10° : ancrage K2 Dome FixPro requis (ou faible réserve de charge) — à valider dans K2 Base.",
      blockMessage: "Pente > 10° : hors domaine S-Dome 6 — validation fabricant obligatoire.",
    },
    ballastNote: BALLAST_NOTE_K2,
    calculatorUrl: "https://base.k2-systems.com/",
    calculatorLabel: "K2 Base",
    quoteNotes: ["Homologation ETN France", "Classement B ROOF (t3)"],
  },
  {
    id: "K2_S_DOME_6_15",
    brand: "K2 Systems",
    label: "K2 S-Dome 6.15 — sud 15°",
    arrangement: MOUNTING_ARRANGEMENTS.SOUTH_SINGLE,
    enabled: true,
    unavailableReason: null,
    tiltOptionsDeg: [15],
    defaultTiltDeg: 15,
    orientationOptions: ["landscape"],
    defaultOrientation: "landscape",
    // 15° → ombre portée plus longue que 10° : défaut prudent V1 (affiné au Lot B)
    defaultRowSpacingCm: 70,
    defaultSetbackRoofEdgeCm: 60,
    defaultSetbackObstacleCm: 60,
    panelLimits: { minLenMm: null, maxLenMm: 2390, minWidMm: null, maxWidMm: 1170, minThickMm: 30, maxThickMm: 50 },
    slopeRules: {
      okMaxDeg: 3,
      warnMaxDeg: 10,
      warnMessage: "Pente 3° à 10° : ancrage K2 Dome FixPro requis — à valider dans K2 Base.",
      blockMessage: "Pente > 10° : hors domaine Dome 6.15 — validation fabricant obligatoire.",
    },
    ballastNote: BALLAST_NOTE_K2,
    calculatorUrl: "https://base.k2-systems.com/",
    calculatorLabel: "K2 Base",
    quoteNotes: ["Homologation ETN France", "Classement B ROOF (t3)"],
  },
  {
    id: "K2_TILTUP_VENTO",
    brand: "K2 Systems",
    label: "K2 TiltUp Vento — sud 20/25/30°",
    arrangement: MOUNTING_ARRANGEMENTS.SOUTH_SINGLE,
    enabled: true,
    unavailableReason: null,
    tiltOptionsDeg: [20, 25, 30],
    defaultTiltDeg: 20,
    orientationOptions: ["portrait", "landscape"],
    defaultOrientation: "landscape",
    // Fortes inclinaisons → inter-rangées large par défaut (anti-ombrage réel au Lot B)
    defaultRowSpacingCm: 110,
    defaultSetbackRoofEdgeCm: 60,
    defaultSetbackObstacleCm: 60,
    panelLimits: null, // grands modules acceptés — pas de limite bloquante documentée V1
    slopeRules: {
      okMaxDeg: 3,
      warnMaxDeg: 5,
      warnMessage: "Pente > 3° : validation K2 requise pour TiltUp Vento (chevalets lestés).",
      blockMessage: "Pente > 5° : hors domaine TiltUp — validation fabricant obligatoire.",
    },
    ballastNote: BALLAST_NOTE_K2,
    calculatorUrl: "https://base.k2-systems.com/",
    calculatorLabel: "K2 Base",
    quoteNotes: ["Homologation ETN France"],
  },
  {
    id: "ESDEC_FLATFIX_FUSION_SUD",
    brand: "ESDEC (Enstall)",
    label: "ESDEC FlatFix Fusion — sud 13°",
    arrangement: MOUNTING_ARRANGEMENTS.SOUTH_SINGLE,
    enabled: true,
    unavailableReason: null,
    tiltOptionsDeg: [13],
    defaultTiltDeg: 13,
    // Fusion standard = paysage (la variante Portrait est un autre produit, petites toitures)
    orientationOptions: ["landscape"],
    defaultOrientation: "landscape",
    defaultRowSpacingCm: 55,
    defaultSetbackRoofEdgeCm: 60,
    defaultSetbackObstacleCm: 60,
    // Spécifications fabricant : L 1550-2190 mm × l 990-1150 mm, cadre 30-50 mm
    panelLimits: { minLenMm: 1550, maxLenMm: 2190, minWidMm: 990, maxWidMm: 1150, minThickMm: 30, maxThickMm: 50 },
    // Règle pente demandée explicitement (Benoit 02/07) : ≤3° OK ; 3-7° alerte forte ; >7° bloquant
    slopeRules: {
      okMaxDeg: 3,
      warnMaxDeg: 7,
      warnMessage: "Pente 3° à 7° : collage des supports ou validation technique ESDEC nécessaire (PVC : dès 2°).",
      blockMessage: "Pente > 7° : hors domaine FlatFix Fusion — bloquant sans validation fabricant.",
    },
    ballastNote: BALLAST_NOTE_ESDEC,
    calculatorUrl: "https://www.esdec.com/en/calculator/",
    calculatorLabel: "Enstall Calculator",
    quoteNotes: ["Champ max 20×20 m", "Découplage thermique membrane"],
  },
  // ── Est-ouest : présents au catalogue, DÉSACTIVÉS tant que la production bi-azimut n'existe pas ──
  {
    id: "K2_D_DOME_6_EO",
    brand: "K2 Systems",
    label: "K2 D-Dome 6 — est-ouest 10° (indisponible)",
    arrangement: MOUNTING_ARRANGEMENTS.EAST_WEST_DUAL,
    enabled: false,
    unavailableReason: EAST_WEST_UNAVAILABLE_REASON,
    tiltOptionsDeg: [10],
    defaultTiltDeg: 10,
    orientationOptions: ["landscape"],
    defaultOrientation: "landscape",
    defaultRowSpacingCm: 30,
    defaultSetbackRoofEdgeCm: 60,
    defaultSetbackObstacleCm: 60,
    panelLimits: { minLenMm: null, maxLenMm: 2390, minWidMm: null, maxWidMm: 1170, minThickMm: 30, maxThickMm: 50 },
    slopeRules: {
      okMaxDeg: 3,
      warnMaxDeg: 10,
      warnMessage: "Pente 3° à 10° : ancrage K2 Dome FixPro requis.",
      blockMessage: "Pente > 10° : hors domaine D-Dome 6.",
    },
    ballastNote: BALLAST_NOTE_K2,
    calculatorUrl: "https://base.k2-systems.com/",
    calculatorLabel: "K2 Base",
    quoteNotes: ["Homologation ETN France", "Classement B ROOF (t3)"],
  },
  {
    id: "ESDEC_FLATFIX_FUSION_EO",
    brand: "ESDEC (Enstall)",
    label: "ESDEC FlatFix Fusion — est-ouest 13° (indisponible)",
    arrangement: MOUNTING_ARRANGEMENTS.EAST_WEST_DUAL,
    enabled: false,
    unavailableReason: EAST_WEST_UNAVAILABLE_REASON,
    tiltOptionsDeg: [13],
    defaultTiltDeg: 13,
    orientationOptions: ["landscape"],
    defaultOrientation: "landscape",
    defaultRowSpacingCm: 30,
    defaultSetbackRoofEdgeCm: 60,
    defaultSetbackObstacleCm: 60,
    panelLimits: { minLenMm: 1550, maxLenMm: 2190, minWidMm: 990, maxWidMm: 1150, minThickMm: 30, maxThickMm: 50 },
    slopeRules: {
      okMaxDeg: 3,
      warnMaxDeg: 7,
      warnMessage: "Pente 3° à 7° : collage / validation ESDEC nécessaire.",
      blockMessage: "Pente > 7° : hors domaine FlatFix Fusion.",
    },
    ballastNote: BALLAST_NOTE_ESDEC,
    calculatorUrl: "https://www.esdec.com/en/calculator/",
    calculatorLabel: "Enstall Calculator",
    quoteNotes: [],
  },
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * @param {unknown} id
 * @returns {FlatRoofMountingSystem|null}
 */
export function getMountingSystemById(id) {
  if (typeof id !== "string" || !id) return null;
  for (const s of FLAT_ROOF_MOUNTING_SYSTEMS) {
    if (s.id === id) return s;
  }
  return null;
}

/**
 * Statut de compatibilité pente toiture / système.
 * @param {FlatRoofMountingSystem} system
 * @param {number|null|undefined} slopeDeg pente réelle du pan (null = inconnue)
 * @returns {{ level: "ok"|"warning"|"blocking"|"unknown", message: string }}
 */
export function resolveSlopeStatusForSystem(system, slopeDeg) {
  if (!system) return { level: "unknown", message: "" };
  // Number(null) === 0 : une pente absente doit rester "inconnue", pas devenir 0° !
  const s = slopeDeg == null || slopeDeg === "" ? NaN : Number(slopeDeg);
  if (!Number.isFinite(s)) {
    return {
      level: "unknown",
      message: `Pente du pan non renseignée — vérifier ≤ ${system.slopeRules.okMaxDeg}° (standard ${system.calculatorLabel}).`,
    };
  }
  if (s <= system.slopeRules.okMaxDeg) {
    return { level: "ok", message: `Pente ${s.toFixed(1)}° : compatible ${system.label}.` };
  }
  if (s <= system.slopeRules.warnMaxDeg) {
    return { level: "warning", message: `Pente ${s.toFixed(1)}° — ${system.slopeRules.warnMessage}` };
  }
  return { level: "blocking", message: `Pente ${s.toFixed(1)}° — ${system.slopeRules.blockMessage}` };
}

/**
 * Compatibilité dimensions panneau / système (V1 : informatif, non bloquant).
 * @param {FlatRoofMountingSystem} system
 * @param {{ lengthMm?: number|null, widthMm?: number|null }|null} panel
 * @returns {{ ok: boolean, message: string|null }}
 */
export function checkPanelCompatibility(system, panel) {
  if (!system || !system.panelLimits || !panel) return { ok: true, message: null };
  const L = Number(panel.lengthMm);
  const W = Number(panel.widthMm);
  const lim = system.panelLimits;
  const issues = [];
  if (Number.isFinite(L)) {
    if (lim.maxLenMm != null && L > lim.maxLenMm) issues.push(`longueur ${L} mm > max ${lim.maxLenMm} mm`);
    if (lim.minLenMm != null && L < lim.minLenMm) issues.push(`longueur ${L} mm < min ${lim.minLenMm} mm`);
  }
  if (Number.isFinite(W)) {
    if (lim.maxWidMm != null && W > lim.maxWidMm) issues.push(`largeur ${W} mm > max ${lim.maxWidMm} mm`);
    if (lim.minWidMm != null && W < lim.minWidMm) issues.push(`largeur ${W} mm < min ${lim.minWidMm} mm`);
  }
  if (issues.length === 0) return { ok: true, message: null };
  return { ok: false, message: `Module hors gabarit ${system.label} : ${issues.join(" ; ")}.` };
}

/**
 * Snapshot persistable du système (figé dans flatRoofConfig → sauvegarde étude → devis/PDF Lot D).
 * @param {FlatRoofMountingSystem} system
 * @param {number} tiltDeg inclinaison réellement retenue
 * @returns {object}
 */
export function buildMountingSystemSnapshot(system, tiltDeg) {
  return {
    id: system.id,
    brand: system.brand,
    label: system.label,
    arrangement: system.arrangement,
    tiltDeg,
    rowSpacingCm: system.defaultRowSpacingCm,
    ballastNote: system.ballastNote,
    calculatorUrl: system.calculatorUrl,
    calculatorLabel: system.calculatorLabel,
    quoteNotes: system.quoteNotes.slice(),
  };
}
