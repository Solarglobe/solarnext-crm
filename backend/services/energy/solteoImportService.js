/**
 * Import multi-fichiers Solteo / Switchgrid / Enedis — parsing + priorité métier conso annuelle.
 *
 * Fichiers gérés :
 * - c68.json  : données techniques & contractuelles Enedis (PDL, kVA, tension, HP/HC, Linky…)
 * - r65.json  : mesures d'énergie quotidiennes (grandeur CONS/EA, unité Wh)
 * - r65.csv   : relevés quotidiens `date,value` (Wh)
 * - loadcurve.csv : courbe de charge horaire (profil, PAS la référence annuelle si R65 complet)
 * - mensuel / quotidien CSV optionnels (contrôle croisé / fallback)
 *
 * Priorité conso annuelle : R65_DAILY_365 > MONTHLY_12 > R65_DAILY_PARTIAL_ANNUALIZED (>330 j)
 * > CSV_HOURLY_FULL_YEAR > CSV_HOURLY_PARTIAL_REBUILT > MANUAL.
 * Règle clé : R65 complet + courbe partielle → annuel = R65, profil horaire = courbe
 * reconstruite puis NORMALISÉE pour totaliser exactement l'annuel R65.
 */

const DAY_MS = 24 * 3600 * 1000;

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

function toObj(input) {
  if (input == null) return null;
  if (typeof input === "object") return input;
  if (typeof input === "string" && input.trim()) {
    try {
      return JSON.parse(input);
    } catch {
      return null;
    }
  }
  return null;
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** 'YYYY-MM-DD' → ms UTC minuit. */
function dateToTs(d) {
  const ts = Date.parse(`${d}T00:00:00.000Z`);
  return Number.isFinite(ts) ? ts : null;
}

// ----------------------------------------------------------------------
// C68 — données techniques & contractuelles
// ----------------------------------------------------------------------

/**
 * Détection phase — PRUDENTE :
 * - 230/400 V + souscrite > 12 kVA → triphasé sûr (mono > 12 kVA n'existe pas en BT France)
 * - 230/400 V seul → « triphasé probable », grid_type NON forcé
 * - 230 V seul → monophasé
 * - sinon inconnu
 */
export function detectPhase({ tension, souscriteKva }) {
  const t = String(tension || "").toLowerCase().replace(/\s/g, "");
  const has400 = t.includes("400");
  const monoOnly = /^2[23]0v?$/.test(t);
  const kva = numOrNull(souscriteKva);
  if (has400 && kva != null && kva > 12) {
    return { detection: "triphasé", grid_type_auto: "tri" };
  }
  if (has400) return { detection: "triphasé probable", grid_type_auto: null };
  if (monoOnly) return { detection: "monophasé", grid_type_auto: "mono" };
  return { detection: "inconnu", grid_type_auto: null };
}

/** FTA / calendrier → tariff_type ('hp_hc' | 'tempo' | 'base' | null). Prudent : null si ambigu. */
function detectTariffType({ ftaLibelle, calendrierLibelle }) {
  const s = `${ftaLibelle || ""} ${calendrierLibelle || ""}`.toLowerCase();
  if (s.includes("tempo")) return "tempo";
  if (s.includes("creuse")) return "hp_hc";
  if (s.includes("base")) return "base";
  return null;
}

/**
 * Parse un c68.json Enedis (structure SGE `{ point: {...} }`).
 * @returns {object|null} contrat normalisé, ou null si structure inconnue.
 */
export function parseC68(input) {
  const root = toObj(input);
  const point = root?.point;
  if (!point || typeof point !== "object") return null;

  const dg = point.donneesGenerales ?? {};
  const alim = point.situationAlimentation?.alimentationPrincipale ?? {};
  const comptage = point.situationComptage ?? {};
  const contrat = point.situationContractuelle ?? {};

  const adr = dg.adresseInstallation ?? {};
  const adresseLigne = [adr.numeroEtNomVoie, adr.lieuDit].filter(Boolean).join(", ");

  const souscriteKva = numOrNull(contrat.structureTarifaire?.puissanceSouscriteMax?.valeur);
  const raccordementKva = numOrNull(alim.puissanceRaccordementSoutirage?.valeur);
  const tension = alim.tensionLivraison?.attributes?.code ?? alim.tensionLivraison?.libelle ?? null;

  const ftaLibelle = contrat.structureTarifaire?.formuleTarifaireAcheminement?.libelle ?? null;
  const calendrierLibelle = contrat.structureTarifaire?.calendrierFrn?.libelle ?? null;
  const tariffType = detectTariffType({ ftaLibelle, calendrierLibelle });

  const compteurType = comptage.dispositifComptage?.typeComptage?.attributes?.code ?? null;
  const phase = detectPhase({ tension, souscriteKva });

  // Titulaire : rarement présent (C5) — extraction opportuniste, jamais bloquante
  const titulaire =
    dg.titulaire?.identiteClient?.nomComplet ??
    dg.titulaire?.nom ??
    point.titulaire ??
    null;

  return {
    pdl: point.attributes?.id ?? null,
    etat_contractuel: dg.etatContractuel?.libelle ?? null,
    segment: dg.segment?.libelle ?? null,
    adresse_installation: adresseLigne || null,
    code_postal: adr.codePostal ?? null,
    commune: adr.commune?.libelle ?? null,
    titulaire: typeof titulaire === "string" ? titulaire : null,
    compteur_linky: compteurType === "LINKY",
    compteur_type: compteurType,
    tic_activee: comptage.dispositifComptage?.compteurs?.compteur?.[0]?.ticActivee === "true",
    domaine_tension: alim.domaineTension?.libelle ?? null,
    tension_livraison: tension,
    puissance_raccordement_kva: raccordementKva,
    puissance_souscrite_kva: souscriteKva,
    disjoncteur_calibre: comptage.dispositifComptage?.disjoncteur?.calibre?.libelle ?? null,
    formule_tarifaire_code: contrat.structureTarifaire?.formuleTarifaireAcheminement?.attributes?.code ?? null,
    formule_tarifaire_libelle: ftaLibelle,
    tariff_type: tariffType,
    // Structure réelle SGE : relais sous dispositifComptage, futures plages sous situationComptage
    // (lecture tolérante aux deux emplacements)
    plage_hc:
      comptage.dispositifComptage?.relais?.plageHeuresCreuses ??
      comptage.relais?.plageHeuresCreuses ??
      null,
    futures_plages_hc:
      comptage.futuresPlagesHeuresCreuses?.libelle ??
      point.futuresPlagesHeuresCreuses?.libelle ??
      null,
    phase_detection: phase.detection,
    grid_type_auto: phase.grid_type_auto,
  };
}

// ----------------------------------------------------------------------
// R65 — quotidien (JSON + CSV)
// ----------------------------------------------------------------------

/**
 * Parse r65.json Enedis : { pointId, grandeur: [{ grandeurMetier, grandeurPhysique, unite, points: [{v,d}] }] }.
 * @returns {{ points: {date: string, kwh: number}[], pdl: string|null }|null}
 */
export function parseR65Json(input) {
  const root = toObj(input);
  const grandeurs = Array.isArray(root?.grandeur) ? root.grandeur : null;
  if (!grandeurs) return null;

  const g =
    grandeurs.find((x) => x?.grandeurMetier === "CONS" && x?.grandeurPhysique === "EA") ??
    grandeurs.find((x) => x?.grandeurMetier === "CONS") ??
    grandeurs[0];
  if (!g || !Array.isArray(g.points)) return null;

  const unit = String(g.unite || "Wh").toLowerCase();
  const factor = unit === "kwh" ? 1 : 1 / 1000; // unité EXPLICITE (pas d'heuristique par ligne)

  const byDate = new Map();
  for (const p of g.points) {
    const v = numOrNull(p?.v);
    const d = typeof p?.d === "string" ? p.d.slice(0, 10) : null;
    if (v == null || !d || !dateToTs(d)) continue;
    byDate.set(d, v * factor); // doublon : dernière valeur gagne
  }
  const points = [...byDate.entries()]
    .map(([date, kwh]) => ({ date, kwh }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return points.length ? { points, pdl: root?.pointId ?? null } : null;
}

/**
 * Parse un CSV quotidien `date,value` (r65.csv, Quotidien.csv).
 * Unité par MÉDIANE globale (médiane ≥ 1000 → Wh), pas par ligne — évite qu'un jour
 * d'absence à 1 800 Wh soit lu 1 800 kWh.
 */
export function parseDailyCsv(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const header = lines[0].replace(/;/g, ",").split(",").map((h) => h.trim().toLowerCase());
  const idxDate = header.indexOf("date");
  const idxVal = header.indexOf("value");
  if (idxDate === -1 || idxVal === -1) return null;

  const raw = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].replace(/;/g, ",").split(",");
    const d = (cols[idxDate] || "").trim().slice(0, 10);
    const v = numOrNull(cols[idxVal]);
    if (!d || v == null || !dateToTs(d)) continue;
    raw.push({ date: d, v });
  }
  if (!raw.length) return null;

  const factor = median(raw.map((r) => r.v)) >= 1000 ? 1 / 1000 : 1; // Wh → kWh
  const byDate = new Map();
  for (const r of raw) byDate.set(r.date, r.v * factor);
  const points = [...byDate.entries()]
    .map(([date, kwh]) => ({ date, kwh }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return { points };
}

/**
 * Parse un CSV mensuel (`Mensuel.csv` : mois/month/date + kwh/value).
 * @returns {{ months: Map<string, number> }|null} clés 'YYYY-MM'
 */
export function parseMonthlyCsv(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const header = lines[0].replace(/;/g, ",").split(",").map((h) => h.trim().toLowerCase());
  const idxM = ["mois", "month", "date"].map((k) => header.indexOf(k)).find((i) => i !== -1) ?? -1;
  const idxV = header.findIndex((h) => h.includes("kwh") || h.includes("value"));
  if (idxM === -1 || idxV === -1) return null;

  const raw = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].replace(/;/g, ",").split(",");
    const m = (cols[idxM] || "").trim().slice(0, 7); // 'YYYY-MM'
    const v = numOrNull(cols[idxV]);
    if (!/^\d{4}-\d{2}$/.test(m) || v == null) continue;
    raw.push({ m, v });
  }
  if (!raw.length) return null;
  const factor = median(raw.map((r) => r.v)) >= 100000 ? 1 / 1000 : 1; // Wh mensuel → kWh
  const months = new Map();
  for (const r of raw) months.set(r.m, (months.get(r.m) ?? 0) + r.v * factor);
  return { months };
}

// ----------------------------------------------------------------------
// Agrégats & priorité métier
// ----------------------------------------------------------------------

/**
 * Fenêtre des 365 derniers jours (bornée sur la dernière date) sur des points quotidiens.
 * @param {{date: string, kwh: number}[]} points
 */
export function computeAnnualFromDaily(points) {
  if (!Array.isArray(points) || !points.length) return null;
  const lastTs = dateToTs(points[points.length - 1].date);
  const windowStartTs = lastTs - 364 * DAY_MS;
  let sum = 0;
  let covered = 0;
  let windowStartDate = null;
  for (const p of points) {
    const ts = dateToTs(p.date);
    if (ts == null || ts < windowStartTs) continue;
    if (windowStartDate == null) windowStartDate = p.date;
    sum += p.kwh;
    covered++;
  }
  return {
    total_points: points.length,
    first_date: points[0].date,
    last_date: points[points.length - 1].date,
    window_start: new Date(windowStartTs).toISOString().slice(0, 10),
    window_end: points[points.length - 1].date,
    days_covered: covered,
    sum_kwh: sum,
    complete_365: covered >= 365,
  };
}

/** 12 derniers mois consécutifs complets ? */
export function computeAnnualFromMonthly(monthsMap) {
  if (!(monthsMap instanceof Map) || monthsMap.size === 0) return null;
  const keys = [...monthsMap.keys()].sort();
  const last = keys[keys.length - 1];
  let [y, m] = last.split("-").map(Number);
  const wanted = [];
  for (let i = 0; i < 12; i++) {
    wanted.push(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`);
    m--;
    if (m === 0) { m = 12; y--; }
  }
  const present = wanted.filter((k) => monthsMap.has(k));
  const sum = present.reduce((a, k) => a + monthsMap.get(k), 0);
  return {
    months_present: present.length,
    complete_12: present.length === 12,
    sum_kwh: sum,
    window_start: wanted[wanted.length - 1],
    window_end: last,
  };
}

/**
 * Priorité métier P1→P6 pour la conso annuelle.
 * @param {object} p
 * @param {ReturnType<typeof computeAnnualFromDaily>|null} p.daily
 * @param {ReturnType<typeof computeAnnualFromMonthly>|null} p.monthly
 * @param {{ annual_kwh?: number, engine_consumption_source?: string }|null} p.engine résultat loadConsumption (courbe)
 * @param {number|null} p.manualAnnualKwh valeur lead existante (P6)
 * @returns {{ annual_kwh: number|null, source: string, source_label: string, warnings: string[] }}
 */
export function resolveAnnualPriority({ daily, monthly, engine, manualAnnualKwh }) {
  const warnings = [];

  if (daily?.complete_365) {
    return {
      annual_kwh: daily.sum_kwh,
      source: "R65_DAILY_365",
      source_label: "R65 quotidien — 365 jours",
      warnings,
    };
  }

  if (monthly?.complete_12) {
    return {
      annual_kwh: monthly.sum_kwh,
      source: "MONTHLY_12",
      source_label: "Mensuel — 12 mois",
      warnings,
    };
  }

  if (daily && daily.days_covered > 330) {
    warnings.push(
      `Quotidien partiel : ${daily.days_covered}/365 jours — annualisation prudente (${daily.window_start} → ${daily.window_end})`
    );
    return {
      annual_kwh: (daily.sum_kwh / daily.days_covered) * 365,
      source: "R65_DAILY_PARTIAL_ANNUALIZED",
      source_label: `Quotidien partiel annualisé — ${daily.days_covered} jours`,
      warnings,
    };
  }
  if (daily) {
    warnings.push(
      `Quotidien insuffisant (${daily.days_covered} jours ≤ 330) — non utilisé pour l'annuel`
    );
  }

  if (engine?.engine_consumption_source === "CSV_HOURLY_FULL_YEAR" && Number.isFinite(engine.annual_kwh)) {
    return {
      annual_kwh: engine.annual_kwh,
      source: "CSV_HOURLY_FULL_YEAR",
      source_label: "Courbe de charge complète",
      warnings,
    };
  }

  if (engine?.engine_consumption_source === "CSV_HOURLY_PARTIAL_REBUILT" && Number.isFinite(engine.annual_kwh)) {
    warnings.push("Annuel estimé depuis une courbe horaire partielle reconstruite — pas la source idéale");
    return {
      annual_kwh: engine.annual_kwh,
      source: "CSV_HOURLY_PARTIAL_REBUILT",
      source_label: "CSV horaire partiel reconstruit",
      warnings,
    };
  }

  if (Number.isFinite(Number(manualAnnualKwh)) && Number(manualAnnualKwh) > 0) {
    warnings.push("Aucune donnée Enedis complète — valeur facture / saisie manuelle conservée");
    return {
      annual_kwh: Number(manualAnnualKwh),
      source: "MANUAL",
      source_label: "Facture / saisie manuelle",
      warnings,
    };
  }

  warnings.push("Aucune source de consommation annuelle disponible");
  return { annual_kwh: null, source: "NONE", source_label: "Aucune source", warnings };
}

/**
 * Normalise un profil horaire pour totaliser exactement annual_kwh.
 * @returns {{ hourly: number[], factor: number }}
 */
export function scaleHourlyToAnnual(hourly, annualKwh) {
  const total = Array.isArray(hourly) ? hourly.reduce((a, b) => a + (Number(b) || 0), 0) : 0;
  if (!(total > 0) || !Number.isFinite(annualKwh) || annualKwh <= 0) {
    return { hourly: Array.isArray(hourly) ? hourly.slice() : [], factor: 1 };
  }
  const factor = annualKwh / total;
  return { hourly: hourly.map((v) => (Number(v) || 0) * factor), factor };
}

/** Sommes mensuelles calendaire d'un profil 8760 (janv→déc). */
export function monthlySumsFromHourly(hourly) {
  const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (!Array.isArray(hourly) || hourly.length !== 8760) return null;
  const out = [];
  let cursor = 0;
  for (let m = 0; m < 12; m++) {
    const hours = DAYS[m] * 24;
    let s = 0;
    for (let i = 0; i < hours; i++) s += Number(hourly[cursor + i]) || 0;
    out.push(Math.round(s * 10) / 10);
    cursor += hours;
  }
  return out;
}
