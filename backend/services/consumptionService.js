// ======================================================================
// SMARTPITCH — CONSUMPTION SERVICE V7 (Solarglobe 2025)
// ======================================================================
// 6 formats couverts :
// 1) CSV horaire complet (>= 8760h)
// 2) CSV horaire incomplet (< 8760h)
// 3) CSV journalier (ex : r65.csv)
// 4) CSV mensuel complet / incomplet
// 5) Manuel (annuel / mensuel)
// 6) Fallback national
//
// V7 — Spécial KVA réaliste (Option B.1) :
// ✔ Une seule source officielle : form.params.puissance_kva
// ✔ reseau_type : form.params.reseau_type (mono | tri)
// ✔ On limite les pics à PUISSANCE_KVA (pas de 1.2)
// ✔ Limitation appliquée partout (horaire, journalier, mensuel, manuel, fallback)
// ✔ Compatible 3 signatures possibles côté contrôleur :
//    - loadConsumption(form, csvPath, form.params)
//    - loadConsumption(form, csvPath)
//    - loadConsumption(form.conso, csvPath, form.params)
// ======================================================================

import fs from "fs";
import { normalizeEquipmentBuckets } from "./equipmentNormalize.service.js";

// ======================================================================
// PRNG DÉTERMINISTE — mulberry32
// Utilisé pour remplacer Math.random() dans buildProfile8760.
// Garantit : même type de profil = même profil 8760 h, reproductible.
// ======================================================================
function _mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ======================================================================
// 0) PROFILS JOURNALIERS DE BASE
// ======================================================================
const PROFILE_ACTIVE_24H = [
  0.35,0.30,0.28,0.25,0.25,0.35,
  0.40,0.45,0.35,0.30,0.28,0.28,
  0.30,0.32,0.35,0.40,0.55,0.75,
  1.10,1.20,1.10,0.85,0.60,0.45
];

const PROFILE_TELETRAVAIL_24H = [
  0.40,0.38,0.36,0.35,0.37,0.45,
  0.60,0.70,0.75,0.70,0.65,0.60,
  0.55,0.60,0.65,0.70,0.80,0.95,
  1.10,1.15,1.05,0.90,0.75,0.55
];

const PROFILE_RETRAITE_24H = [
  0.50,0.48,0.45,0.45,0.45,0.50,
  0.60,0.70,0.75,0.75,0.70,0.65,
  0.60,0.65,0.70,0.75,0.85,1.00,
  1.05,1.00,0.90,0.80,0.70,0.60
];

// PRO / activité journée — fort 8h–18h, faible soirée & nuit
const PROFILE_PRO_JOURNEE_24H = [
  0.20,0.18,0.17,0.17,0.17,0.19,0.28,0.42,
  0.72,0.92,1.00,1.05,1.08,1.06,1.04,1.02,
  0.98,0.95,0.55,0.35,0.28,0.24,0.22,0.21
];

// ======================================================================
// OUTILS COMMUNS
// ======================================================================
function scaleProfile(profile, annual) {
  const total = profile.reduce((a, b) => a + b, 0);
  if (total <= 0) return profile.map(() => annual / 8760);
  const f = annual / total;
  return profile.map(v => v * f);
}

function pickDailyProfile(type) {
  if (!type) return PROFILE_ACTIVE_24H;
  switch ((type || "").toLowerCase()) {
    case "teletravail": return PROFILE_TELETRAVAIL_24H;
    case "retraite":    return PROFILE_RETRAITE_24H;
    case "pro":         return PROFILE_PRO_JOURNEE_24H;
    default:            return PROFILE_ACTIVE_24H;
  }
}

/**
 * Clé moteur normalisée (alignée sur mapConsumptionProfile / fiche lead).
 * Valeur vide ou inconnue → active (profil « mixte »).
 */
function normalizeProfilKeyForConsumption(raw) {
  if (raw == null || String(raw).trim() === "") return "active";
  const p = String(raw).toLowerCase();
  if (p === "remote_work" || p === "teletravail") return "teletravail";
  if (p === "retired" || p === "retraite") return "retraite";
  if (p === "pro_day" || p === "pro") return "pro";
  if (p === "active_family" || p === "active") return "active";
  return "active";
}

/** Forme 8760 h pour reconstructions (journalier, mensuel, manuel, national, trous horaires CSV). */
function buildFallbackBase8760(profilKey) {
  const k = normalizeProfilKeyForConsumption(profilKey);
  return buildProfile8760(pickDailyProfile(k), k);
}

// ======================================================================
// LIMITATION KVA — VERSION B.1 (réaliste, simple, fiable)
// ======================================================================
// Règle :
//  - Mono : pic ≤ kVA
//  - Tri  : pic ≤ kVA (on reste en global car Enedis ne donne pas les phases)
// => Pas de facteur 1.2 : on colle à ce qui est souscrit.
function getPowerLimit(params = {}) {
  const raw = params.puissance_kva ?? params.puissanceKva ?? params.puissance;
  const kva = Number(raw);
  if (!Number.isFinite(kva) || kva <= 0) return null;
  return kva;
}

function clampHourlyProfile(hourly, params = {}) {
  const limit = getPowerLimit(params);
  if (!limit) {
    // Pas de KVA : on garde juste un plancher de 0.1 kWh/h
    return hourly.map(h => Math.max(h, 0.1));
  }
  return hourly.map(h => {
    const v = Math.min(h, limit);
    return Math.max(v, 0.1);
  });
}

// ======================================================================
// 1) Construire un profil 8760 (base théorique)
// ======================================================================
/**
 * Construit le profil horaire de base 8760 h.
 * Le bruit horaire est déterministe : même profileType = même profil.
 * @param {number[]} daily     Tableau 24 h de pondérations relatives
 * @param {string}  [profileType]  "active" | "teletravail" | "retraite" | "pro"
 */
function buildProfile8760(daily, profileType) {
  // Graine déterministe basée sur le type de profil — reproductible
  const _pcode =
    profileType === "teletravail" ? 1
    : profileType === "retraite" ? 2
    : profileType === "pro" ? 3
    : 0;
  const _rng = _mulberry32((_pcode * 7919 + 4217) >>> 0);

  const arr = [];

  for (let h = 0; h < 8760; h++) {
    const hour  = h % 24;
    const month = Math.floor((h / 8760) * 12);
    const day   = Math.floor(h / 24) % 7;

    let v = daily[hour];

    const seasonal = [
      1.25,1.20,1.10,1.00,0.95,0.90,
      0.90,0.95,1.00,1.05,1.15,1.20
    ][month];
    v *= seasonal;

    if (day === 5 || day === 6) v *= 1.12;

    if (month <= 2 || month >= 10) {
      if (hour >= 18 && hour <= 21) v *= 1.20;
      if (hour >= 6  && hour <= 8)  v *= 1.10;
    }

    // Bruit horaire déterministe ±3 % (remplace Math.random())
    v *= 1 + ((_rng() - 0.5) * 0.06);

    arr.push(v);
  }

  return arr;
}

// ======================================================================
// 2) LECTURE CSV + DÉTECTION FORMAT
// ======================================================================
function readRawCSV(path) {
  try {
    return fs.readFileSync(path, "utf8").trim().split(/\r?\n/);
  } catch {
    return null;
  }
}

function detectCSVFormat(lines) {
  if (!lines || lines.length < 2) return null;

  const header = lines[0]
    .replace(/;/g, ",")
    .split(",")
    .map(h => h.trim().toLowerCase());

  if (header.includes("startdate") && header.includes("powerinwatts"))
    return "hourly";

  if (header.includes("date") && header.includes("value"))
    return "daily";

  if (header.includes("mois") || header.includes("month"))
    return "monthly";

  return null;
}

// ======================================================================
// 3) PARSE HORAIRE ENEDIS
// ======================================================================
function parseHourlyCSV(lines) {
  const header = lines[0].replace(/;/g, ",").split(",");
  const idxDate = header.findIndex(h => h.trim().toLowerCase() === "startdate");
  const idxPow  = header.findIndex(h => h.trim().toLowerCase() === "powerinwatts");
  if (idxDate === -1 || idxPow === -1) return [];

  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].replace(/;/g, ",").split(",");
    const d = cols[idxDate];
    const w = Number(cols[idxPow]);
    const ts = new Date(d).getTime();
    if (!isNaN(ts) && !isNaN(w)) rows.push({ ts, w });
  }

  rows.sort((a, b) => a.ts - b.ts);
  return rows;
}

// 3.a) Horaire Enedis — dernière année réelle, conversion W→kWh par intervalle
// Gère 8759/8760/8761/8772 (DST), intervalles irréguliers, CSV > 1 an
function buildFromFullYearHourly(rows) {
  if (!rows || rows.length < 24) return null;

  const lastTs = rows[rows.length - 1].ts;
  const oneYearMs = 365 * 24 * 3600 * 1000;
  const startTs = lastTs - oneYearMs;

  const filtered = rows.filter((r) => r.ts >= startTs);

  if (filtered.length < 8000) return null;

  const hourly = [];

  for (let i = 0; i < filtered.length - 1; i++) {
    const r1 = filtered[i];
    const r2 = filtered[i + 1];

    const deltaH = (r2.ts - r1.ts) / 3600000;

    if (deltaH <= 0 || deltaH > 3) continue;

    const kwh = (r1.w / 1000) * deltaH;
    hourly.push(kwh);
  }

  const annual = hourly.reduce((a, b) => a + b, 0);

  return {
    hourly,
    annual_kwh: annual,
  };
}

// 3.a.1) Ramène le profil à exactement 8760 h (slice si > 8760, pad avec base8760 si < 8760)
function normalizeTo8760(hourly, base8760) {
  if (hourly.length === 8760) return hourly;

  if (hourly.length > 8760) {
    return hourly.slice(hourly.length - 8760);
  }

  const rebuilt = [...hourly];

  while (rebuilt.length < 8760) {
    const i = rebuilt.length;
    rebuilt.push(base8760[i]);
  }

  return rebuilt;
}

// 3.b) Horaire incomplet (< 8760)
function rebuildHourlyIncomplete(rows, base8760) {
  const map = {};
  rows.forEach(r => { map[r.ts] = r.w; });

  const start = rows[0].ts;
  const step  = 3600 * 1000;
  const hourlyWatts = [];

  for (let i = 0; i < 8760; i++) {
    const ts = start + i * step;

    if (map[ts] !== undefined) {
      hourlyWatts.push(map[ts]);
      continue;
    }

    let sum = 0, count = 0;
    for (let o = -3; o <= 3; o++) {
      if (o === 0) continue;
      const v = map[ts + o * step];
      if (v !== undefined) { sum += v; count++; }
    }

    hourlyWatts.push(count ? sum / count : base8760[i] * 1000);
  }

  const hourly = hourlyWatts.map(w => w / 1000);
  const annual = hourly.reduce((a, b) => a + b, 0);
  return { hourly, annual_kwh: annual };
}

// ======================================================================
// 4) CSV JOURNALIER (r65.ts / date,value)
// ======================================================================
function parseDailyCSV(lines) {
  const header = lines[0].replace(/;/g, ",").split(",").map(h => h.trim().toLowerCase());
  const idxDate = header.indexOf("date");
  const idxVal  = header.indexOf("value");

  if (idxDate === -1 || idxVal === -1) return null;

  const days = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].replace(/;/g, ",").split(",");

    const d = cols[idxDate];
    let v   = Number(cols[idxVal]);
    if (!d || isNaN(v)) continue;

    if (v > 2000) v = v / 1000; // Wh → kWh

    const ts = new Date(d).getTime();
    if (!isNaN(ts)) days.push({ ts, kwh: v });
  }

  days.sort((a, b) => a.ts - b.ts);
  return days;
}

function rebuildDaily(days, base8760) {
  if (!days || days.length === 0) return null;

  const dailyMap = {};
  const startTs  = days[0].ts;
  const oneDayMs = 24 * 3600 * 1000;

  days.forEach(d => {
    const dayIndex = Math.floor((d.ts - startTs) / oneDayMs);
    dailyMap[dayIndex] = d.kwh;
  });

  const hourly = [];
  let totalAnnual = 0;

  for (let d = 0; d < 365; d++) {
    const dayKwh = dailyMap[d];
    const slice  = base8760.slice(d * 24, d * 24 + 24);

    if (dayKwh !== undefined) {
      const scaled = scaleProfile(slice, dayKwh);
      for (let h = 0; h < 24; h++) hourly.push(scaled[h]);
      totalAnnual += dayKwh;
    } else {
      for (let h = 0; h < 24; h++) hourly.push(0.1);
    }
  }

  return {
    hourly: hourly.slice(0, 8760),
    annual_kwh: totalAnnual
  };
}

// ======================================================================
// 5) CSV MENSUEL
// ======================================================================
function parseMonthlyCSV(lines) {
  const header = lines[0].replace(/;/g, ",")
    .split(",")
    .map(h => h.trim().toLowerCase());

  const idxMonth = header.includes("mois") ? header.indexOf("mois")
                  : header.includes("month") ? header.indexOf("month")
                  : header.indexOf("date");

  const idxVal = header.findIndex(h => h.includes("kwh") || h.includes("value"));
  if (idxMonth === -1 || idxVal === -1) return null;

  const months = Array(12).fill(undefined);

  const monthMap = {
    "janvier":0,"février":1,"fevrier":1,"mars":2,"avril":3,"mai":4,"juin":5,
    "juillet":6,"août":7,"aout":7,"septembre":8,"octobre":9,"novembre":10,"décembre":11,"decembre":11
  };

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].replace(/;/g, ",").split(",");

    let raw = (cols[idxMonth] || "").trim().toLowerCase();
    let v   = Number(cols[idxVal]);
    if (v > 2000) v = v / 1000;

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const mm = Number(raw.split("-")[1]);
      if (!isNaN(mm) && mm >= 1 && mm <= 12) months[mm - 1] = isNaN(v) ? null : v;
      continue;
    }

    const m = monthMap[raw];
    if (m !== undefined) {
      months[m] = isNaN(v) ? null : v;
    }
  }

  return months;
}

function rebuildMonthly(months, base8760) {
  if (!months || months.length !== 12) return null;

  const hourly = [];
  let pointer  = 0;

  for (let m = 0; m < 12; m++) {
    const totalMonth = months[m];
    const monthHours = Math.round(8760 / 12);
    const slice      = base8760.slice(pointer, pointer + monthHours);

    if (typeof totalMonth === "number" && !isNaN(totalMonth)) {
      const scaled = scaleProfile(slice, totalMonth);
      for (let h = 0; h < monthHours; h++) hourly.push(scaled[h]);
    } else {
      for (let h = 0; h < monthHours; h++) hourly.push(0.1);
    }

    pointer += monthHours;
  }

  const annual = months.reduce(
    (a, b) => a + (typeof b === "number" && !isNaN(b) ? b : 0),
    0
  );

  return {
    hourly: hourly.slice(0, 8760),
    annual_kwh: annual
  };
}

// ======================================================================
// 6) MANUEL (annuel / mensuel)
// ======================================================================
function rebuildManual(formConso, base8760) {
  const mode    = formConso.mode;
  const annual  = Number(formConso.annuelle_kwh || 0);
  const monthly = Array.isArray(formConso.mensuelle)
    ? formConso.mensuelle.map(Number)
    : null;

  if (mode === "mensuelle" && monthly && monthly.length === 12) {
    return rebuildMonthly(monthly, base8760);
  }

  if (mode === "annuelle" && annual > 0) {
    return {
      hourly: scaleProfile([...base8760], annual),
      annual_kwh: annual
    };
  }

  return null;
}

// ======================================================================
// 7) FALLBACK NATIONAL (forme = profil lead, total fixe 13 MWh/an)
// ======================================================================
function buildNationalFallback(profilKey) {
  const annual = 13000;
  const shape = buildFallbackBase8760(profilKey);
  const hourly = scaleProfile([...shape], annual);
  return { hourly, annual_kwh: annual };
}

// ======================================================================
// 7.1) CONTRÔLE COHÉRENCE — SUM(profile8760) = consommation annuelle
// ======================================================================
function ensureConsumptionConsistent(result) {
  if (!result || !Array.isArray(result.hourly)) return result;
  const sum8760 = result.hourly.reduce((a, b) => a + b, 0);
  const annual_kwh = result.annual_kwh;
  if (typeof annual_kwh !== "number" || !Number.isFinite(annual_kwh)) return result;
  if (Math.abs(sum8760 - annual_kwh) > 0.5) {
    console.warn("CONSUMPTION MISMATCH");
    if (process.env.NODE_ENV !== "production") {
      console.warn("annual_kwh:", annual_kwh);
      console.warn("sum8760:", sum8760);
    }
  }
  return result;
}

// ======================================================================
// 8) EXPORT PRINCIPAL — VERSION V7 (compatible anciennes signatures)
// ======================================================================
//
// Utilisation possible :
//
// 1) Nouveau pattern recommandé :
//    loadConsumption(form, csvPath, form.params)
//
// 2) Pattern simplifié :
//    loadConsumption(form, csvPath)        // form = { conso, params }
//
// 3) Ancien pattern (si pas encore migré) :
//    loadConsumption(form.conso, csvPath, form.params)
//
export function loadConsumption(formOrConso = {}, csvPath, formParams = {}) {
  const devLog = process.env.NODE_ENV !== "production";
  if (devLog) {
    console.log("DEBUG_CONSUMPTION_SERVICE_CALLED");
    console.log(JSON.stringify({
      tag: "DEBUG CSV IN LOAD CONSUMPTION",
      csvPath: csvPath ?? null,
    }));
    console.log("DEBUG_CSV_PATH:", csvPath);
  }

  const trace = devLog && process.env.DEBUG_CALC_TRACE === "1";

  let conso  = {};
  let params = {};

  // Cas 1 / 2 : on a passé le form complet
  if (formOrConso.conso || formOrConso.params) {
    conso  = formOrConso.conso  || {};
    params = formOrConso.params || formParams || {};
  } else {
    // Cas 3 : on a passé directement conso, + params en 3ᵉ argument
    conso  = formOrConso || {};
    params = formParams  || {};
  }

  // Fusion officielle : conso + params
  const merged = {
    ...conso,
    puissance_kva: params.puissance_kva ?? conso.puissance_kva,
    reseau_type:   params.reseau_type   ?? conso.reseau_type,
  };

  const profilKey = normalizeProfilKeyForConsumption(merged.profil);
  const fallbackBase8760 = buildFallbackBase8760(profilKey);
  /** Padding / complétion CSV horaire « complet » : forme active uniquement (pas le profil lead). */
  const activeShapeBase8760 = buildFallbackBase8760("active");

  if (trace) {
    const fileExists = csvPath ? fs.existsSync(csvPath) : false;
    let fileSize = null;
    if (csvPath && fileExists) {
      try {
        fileSize = fs.statSync(csvPath).size;
      } catch (_) {}
    }
    console.log(JSON.stringify({
      tag: "TRACE_CONSO_ENTRY",
      csvPath: csvPath ?? null,
      mergedConso_mode: merged.mode ?? merged.profil ?? null,
      mergedConso_keys: Object.keys(merged).filter(k => merged[k] !== undefined),
      fileExists,
      fileSizeBytes: fileSize,
    }));
  }

  // ----------------------------
  // 1) CSV — priorité absolue : si chemin fourni et fichier existe, utilisation OBLIGATOIRE du CSV.
  //    Aucun calcul synthétique. Ordre des sources : 1 CSV, 2 hourly_prebuilt, 3 manual, 4 national.
  // ----------------------------
  if (csvPath && fs.existsSync(csvPath)) {
    const lines  = readRawCSV(csvPath);
    const format = detectCSVFormat(lines);

    if (format === "hourly") {
      const rows = parseHourlyCSV(lines);
      let result;
      if (rows.length >= 8760) {
        const full = buildFromFullYearHourly(rows);
        if (!full) throw new Error("CSV_CONSUMPTION_INVALID_HOURLY_DATA");
        const hourly = normalizeTo8760(full.hourly, activeShapeBase8760);
        result = { hourly, annual_kwh: full.annual_kwh };
      } else if (rows.length > 0) {
        result = rebuildHourlyIncomplete(rows, fallbackBase8760);
      } else {
        throw new Error("CSV_CONSUMPTION_INVALID_LENGTH");
      }

      if (devLog) {
        console.log(JSON.stringify({
          tag: "TRACE_CONSO_SOURCE",
          source: "CSV",
          csvPath,
          rows: rows.length,
          annualKwhComputed: result.annual_kwh,
        }));
      }

      if (process.env.NODE_ENV !== "production") {
        console.log("DEBUG_CSV_ANNUAL_KWH", result.annual_kwh);
        console.log("DEBUG_CONSUMPTION_RESULT", {
          annual_kwh: result.annual_kwh,
          hourly_len: result.hourly.length,
        });
      }
      return ensureConsumptionConsistent(result);
    }

    if (format === "daily") {
      const days = parseDailyCSV(lines);
      if (days && days.length) {
        const r = rebuildDaily(days, fallbackBase8760);
        r.hourly = clampHourlyProfile(r.hourly, merged);
        if (devLog) {
          console.log(JSON.stringify({
            tag: "TRACE_CONSO_SOURCE",
            source: "CSV",
            csvPath,
            rows: days.length,
            annualKwhComputed: r.annual_kwh,
          }));
        }
        if (process.env.NODE_ENV !== "production") {
          console.log("DEBUG_CSV_ANNUAL_KWH", r.annual_kwh);
          console.log("DEBUG_CONSUMPTION_RESULT", { annual_kwh: r?.annual_kwh, hourly_len: r?.hourly?.length });
        }
        return ensureConsumptionConsistent(r);
      }
    }

    if (format === "monthly") {
      const months = parseMonthlyCSV(lines);
      if (months) {
        const r = rebuildMonthly(months, fallbackBase8760);
        r.hourly = clampHourlyProfile(r.hourly, merged);
        if (devLog) {
          console.log(JSON.stringify({
            tag: "TRACE_CONSO_SOURCE",
            source: "CSV",
            csvPath,
            rows: 12,
            annualKwhComputed: r.annual_kwh,
          }));
        }
        if (process.env.NODE_ENV !== "production") {
          console.log("DEBUG_CSV_ANNUAL_KWH", r.annual_kwh);
          console.log("DEBUG_CONSUMPTION_RESULT", { annual_kwh: r?.annual_kwh, hourly_len: r?.hourly?.length });
        }
        return ensureConsumptionConsistent(r);
      }
    }

    // CSV présent mais format non reconnu → ne pas basculer en synthétique
    throw new Error("CSV_CONSUMPTION_FORMAT_UNRECOGNIZED");
  }

  // CSV absent : on utilisera une source synthétique (hourly_prebuilt, manual ou national)
  if (devLog) {
    console.log(JSON.stringify({
      tag: "TRACE_CONSO_SOURCE",
      source: "SYNTHETIC",
    }));
  }

  // ----------------------------
  // 2) Profil horaire pré-construit (ex. lead.energy_profile.hourly) — utilisé seulement si pas de CSV
  // ----------------------------
  if (merged.hourly && Array.isArray(merged.hourly) && merged.hourly.length >= 8760) {
    const hourly = merged.hourly.slice(0, 8760).map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0));
    const annual = hourly.reduce((a, b) => a + b, 0);
    const out = { hourly: clampHourlyProfile(hourly, merged), annual_kwh: annual };
    if (trace) {
      console.log(JSON.stringify({
        tag: "TRACE_CONSO_CSV",
        source: "hourly_prebuilt",
        hourlyLength: out.hourly.length,
        annualKwhComputed: annual,
      }));
    }
    if (devLog) {
      console.log("DEBUG_CONSUMPTION_RESULT", {
        annual_kwh: out?.annual_kwh,
        hourly_len: out?.hourly?.length
      });
    }
    return ensureConsumptionConsistent(out);
  }

  // ----------------------------
  // 3) Mensuelle (rebuild 8760 depuis mensuelle)
  // 4) Annuelle (rebuild 8760 depuis annuelle)
  // ----------------------------
  const manual = rebuildManual(merged, fallbackBase8760);
  if (manual) {
    manual.hourly = clampHourlyProfile(manual.hourly, merged);
    if (trace) {
      console.log(JSON.stringify({
        tag: "TRACE_CONSO_CSV",
        source: "manual",
        hourlyLength: manual.hourly.length,
        annualKwhComputed: manual.annual_kwh,
      }));
    }
    if (devLog) {
      console.log("DEBUG_CONSUMPTION_RESULT", {
        annual_kwh: manual?.annual_kwh,
        hourly_len: manual?.hourly?.length
      });
    }
    return ensureConsumptionConsistent(manual);
  }

  // ----------------------------
  // 5) Fallback national
  // ----------------------------
  const nat = buildNationalFallback(profilKey);
  nat.hourly = clampHourlyProfile(nat.hourly, merged);
  if (trace) {
    console.log(JSON.stringify({
      tag: "TRACE_CONSO_CSV",
      source: "national",
      hourlyLength: nat.hourly.length,
      annualKwhComputed: nat.annual_kwh,
    }));
  }
  if (devLog) {
    console.log("DEBUG_CONSUMPTION_RESULT", {
      annual_kwh: nat?.annual_kwh,
      hourly_len: nat?.hourly?.length
    });
  }
  return ensureConsumptionConsistent(nat);
}

// ======================================================================
// ÉQUIPEMENTS ÉNERGÉTIQUES — Profils horaires spécialisés
// Ajoutés en V8 — n'affectent pas le code existant (applyEquipmentShape
// est appelée en post-traitement, loadConsumption reste inchangée)
// ======================================================================

// VE — Charge nocturne (non-piloté) : 22h-06h, plat
// heures actives : 0,1,2,3,4,5,6 et 22,23 = 9 créneaux
const _EQ_VE_NUIT_24H = [
  1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
];

// VE — Charge solaire (piloté PV) : 10h-15h, cloche centrée 12h
const _EQ_VE_JOUR_24H = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.3, 0.7,
  1.0, 0.8, 0.5, 0.2, 0, 0, 0, 0, 0, 0, 0, 0,
];

// Ballon thermodynamique — HC nuit : 23h-06h, plat
const _EQ_BALLON_HC_24H = [
  1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
];

// Ballon thermodynamique — Piloté PV : 10h-14h, cloche centrée 12h
const _EQ_BALLON_PILOTE_24H = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.3, 0.9,
  1.0, 0.7, 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

// PAC chauffage — profil saisonnier (hiver fort, été quasi-nul)
// Pic matin 06h-10h en hiver ; pas de clim modélisée (conservative)
const _PAC_MONTHLY_WEIGHT = [2.2, 2.0, 1.5, 0.9, 0.4, 0.1, 0.1, 0.1, 0.4, 0.9, 1.5, 1.9];
const _PAC_DAILY_24H = [
  0.20, 0.15, 0.12, 0.10, 0.10, 0.20,
  0.60, 1.00, 1.20, 1.00, 0.60, 0.40,
  0.30, 0.25, 0.25, 0.30, 0.55, 0.85,
  0.80, 0.65, 0.50, 0.40, 0.30, 0.25,
];
const _DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function _buildPAC8760(annual_kwh) {
  if (!annual_kwh || annual_kwh <= 0) return new Array(8760).fill(0);
  const raw = [];
  for (let m = 0; m < 12; m++) {
    const mw = _PAC_MONTHLY_WEIGHT[m];
    for (let d = 0; d < _DAYS_IN_MONTH[m]; d++) {
      for (let h = 0; h < 24; h++) {
        raw.push(_PAC_DAILY_24H[h] * mw);
      }
    }
  }
  return scaleProfile(raw.slice(0, 8760), annual_kwh);
}

function _buildPac8760WithRole(annual_kwh, p = {}) {
  const role = String(p.role || "principal").toLowerCase();
  if (role !== "appoint") return _buildPAC8760(annual_kwh);
  if (!annual_kwh || annual_kwh <= 0) return new Array(8760).fill(0);
  const raw = [];
  for (let m = 0; m < 12; m++) {
    const mw = _PAC_MONTHLY_WEIGHT[m];
    for (let d = 0; d < _DAYS_IN_MONTH[m]; d++) {
      for (let h = 0; h < 24; h++) {
        const peak = (h >= 6 && h <= 9) || (h >= 17 && h <= 21);
        raw.push(_PAC_DAILY_24H[h] * mw * (peak ? 1.2 : 0.78));
      }
    }
  }
  return scaleProfile(raw.slice(0, 8760), annual_kwh);
}

// Construit un profil 8760h plat/annuel depuis un pattern 24h
// (sans saisonnalité — VE et ballon ne varient pas en saison)
function _buildFlat8760(daily24h, annual_kwh) {
  if (!annual_kwh || annual_kwh <= 0) return new Array(8760).fill(0);
  const raw = [];
  for (let d = 0; d < 365; d++) {
    for (let h = 0; h < 24; h++) raw.push(daily24h[h]);
  }
  return scaleProfile(raw.slice(0, 8760), annual_kwh);
}

// ======================================================================
// Calcul kWh annuels depuis paramètres réels des équipements
// ======================================================================

/**
 * kWh/an d'un VE à partir des paramètres déclarés.
 * @param {{ charges_semaine?: number, batterie_kwh?: number }} p
 */
function _calcVeKwh(p = {}) {
  const charges = Math.max(1, Math.min(14, Number(p.charges_semaine) || 3));
  const batterie = Math.max(20, Math.min(200, Number(p.batterie_kwh) || 50));
  // 60% batterie / charge (20→80%), rendement chargeur AC→DC 92%
  return Math.round((charges * 52 * batterie * 0.60) / 0.92);
}

/**
 * kWh/an d'une PAC à partir des paramètres déclarés.
 * @param {{
 *   puissance_kw?: number,
 *   fonctionnement?: "leger"|"moyen"|"intensif",
 *   pac_type?: "air_air"|"air_eau",
 *   role?: "principal"|"appoint"
 * }} p
 */
const _PAC_HEURES = { leger: 700, moyen: 1300, intensif: 2000 };

/** Chauffage principal pour PAC air/air : rôle prioritaire, sinon legacy chauffage_principal */
function _isChauffagePrincipalAirAir(p = {}) {
  const r = String(p.role || "").toLowerCase();
  if (r === "appoint") return false;
  if (r === "principal") return true;
  return p.chauffage_principal === true;
}

function _calcPacAirEauKwh(p = {}) {
  const kw = Math.max(3, Math.min(25, Number(p.puissance_kw) || 9));
  const h = _PAC_HEURES[(p.fonctionnement || "moyen").toLowerCase()] || _PAC_HEURES.moyen;
  const role = String(p.role || "principal").toLowerCase();
  const roleMul = role === "appoint" ? 0.65 : 1.0;
  const scop = 3.0; // SCOP typique France
  return Math.round((kw * h * roleMul) / scop);
}

function _calcPacKwh(p = {}) {
  const pacType = String(p.pac_type || "air_eau").toLowerCase();
  if (pacType === "air_air") {
    return _calcPacAirAirKwh(p);
  }
  return _calcPacAirEauKwh(p);
}

/**
 * kWh/an d'un ballon thermodynamique à partir du volume.
 * @param {{ volume_litres?: number }} p
 */
function _calcBallonKwh(p = {}) {
  const vol = Math.max(50, Math.min(500, Number(p.volume_litres) || 200));
  // ECS : 3.5 kWh thermique / 100L / jour ; COP ballon thermo ≈ 2.5
  return Math.round((3.5 * (vol / 100) * 365) / 2.5);
}

/**
 * PAC air/air — kWh/an (chauffage hiver + clim été, usages déclarés).
 * @param {{
 *   puissance_kw?: number,
 *   chauffage_principal?: boolean,
 *   role?: string,
 *   usage_hiver?: string,
 *   usage_ete?: string
 * }} p
 */
const _PAC_AIR_AIR_USAGE_H = { faible: 380, moyen: 620, fort: 920 };
const _PAC_AIR_AIR_USAGE_E = { faible: 260, moyen: 480, fort: 820 };
function _calcPacAirAirKwh(p = {}) {
  const kw = Math.max(1.5, Math.min(12, Number(p.puissance_kw) || 3.5));
  const uh = String(p.usage_hiver || "moyen").toLowerCase();
  const ue = String(p.usage_ete || "moyen").toLowerCase();
  const hH = _PAC_AIR_AIR_USAGE_H[uh] ?? _PAC_AIR_AIR_USAGE_H.moyen;
  const hE = _PAC_AIR_AIR_USAGE_E[ue] ?? _PAC_AIR_AIR_USAGE_E.moyen;
  let wPart = hH;
  let ePart = hE;
  if (_isChauffagePrincipalAirAir(p)) {
    wPart *= 1.12;
    ePart *= 0.88;
  } else {
    wPart *= 0.82;
    ePart *= 1.22;
  }
  const cop = 3.1;
  return Math.round((kw * (wPart + ePart)) / cop);
}

/** Poids saisonniers hiver (chauffage) vs été (clim) — PAC air/air */
const _PAC_AIR_AIR_WINTER_MONTHLY = [1.35, 1.2, 0.9, 0.55, 0.28, 0.12, 0.1, 0.1, 0.22, 0.5, 0.95, 1.25];
const _PAC_AIR_AIR_SUMMER_MONTHLY = [0.12, 0.12, 0.18, 0.35, 0.55, 1.1, 1.55, 1.5, 0.95, 0.5, 0.22, 0.18];

const _PAC_AIR_AIR_HEAT_24H = [
  0.45, 0.48, 0.62, 0.78, 0.85, 0.72, 0.62, 0.58, 0.52, 0.5, 0.52, 0.58,
  0.62, 0.58, 0.52, 0.5, 0.62, 0.82, 1.0, 0.95, 0.72, 0.58, 0.5, 0.45,
];
const _PAC_AIR_AIR_COOL_24H = [
  0.12, 0.1, 0.1, 0.1, 0.1, 0.12, 0.22, 0.45, 0.62, 0.58, 0.52, 0.48,
  0.52, 0.58, 0.78, 1.0, 1.0, 0.88, 0.55, 0.35, 0.22, 0.18, 0.15, 0.12,
];

/**
 * @param {number} annual_kwh
 * @param {object} p paramètres PAC air/air
 */
function _buildPacAirAir8760(annual_kwh, p = {}) {
  if (!annual_kwh || annual_kwh <= 0) return new Array(8760).fill(0);
  const primary = _isChauffagePrincipalAirAir(p);
  const uh = String(p.usage_hiver || "moyen").toLowerCase();
  const ue = String(p.usage_ete || "moyen").toLowerCase();
  const mult = { faible: 0.78, moyen: 1.0, fort: 1.32 };
  const mw = mult[uh] ?? 1;
  const me = mult[ue] ?? 1;
  let wShare = primary ? 0.54 * mw : 0.36 * mw;
  let sShare = primary ? 0.32 * me : 0.58 * me;
  const s = wShare + sShare;
  wShare /= s;
  sShare /= s;

  const raw = [];
  for (let m = 0; m < 12; m++) {
    const wm = _PAC_AIR_AIR_WINTER_MONTHLY[m];
    const sm = _PAC_AIR_AIR_SUMMER_MONTHLY[m];
    for (let d = 0; d < _DAYS_IN_MONTH[m]; d++) {
      for (let h = 0; h < 24; h++) {
        const v = wShare * wm * _PAC_AIR_AIR_HEAT_24H[h] + sShare * sm * _PAC_AIR_AIR_COOL_24H[h];
        raw.push(v);
      }
    }
  }
  return scaleProfile(raw.slice(0, 8760), annual_kwh);
}

/**
 * Courbe 8760h pour un équipement « actuel » (reshape, pas d’ajout annual).
 * @returns {{ kwh: number, hourly: number[] } | null}
 */
function _hourlyShapeActuelItem(item) {
  if (!item || typeof item !== "object") return null;
  const kind = String(item.kind || "").toLowerCase();
  if (kind === "ve") {
    const kwh = _calcVeKwh(item);
    if (kwh <= 0) return null;
    const veMode = String(item.mode_charge || "nuit").toLowerCase();
    const hourly = _buildFlat8760(veMode === "jour" ? _EQ_VE_JOUR_24H : _EQ_VE_NUIT_24H, kwh);
    return { kwh, hourly };
  }
  if (kind === "pac") {
    const pacType = String(item.pac_type || "air_eau").toLowerCase();
    const kwh = _calcPacKwh(item);
    if (kwh <= 0) return null;
    if (pacType === "air_air") {
      return { kwh, hourly: _buildPacAirAir8760(kwh, item) };
    }
    return { kwh, hourly: _buildPac8760WithRole(kwh, item) };
  }
  if (kind === "ballon") {
    const kwh = _calcBallonKwh(item);
    if (kwh <= 0) return null;
    const ballonMode = String(item.mode_charge || "hc").toLowerCase();
    const hourly = _buildFlat8760(
      ballonMode === "pilote" ? _EQ_BALLON_PILOTE_24H : _EQ_BALLON_HC_24H,
      kwh
    );
    return { kwh, hourly };
  }
  return null;
}

/**
 * Courbe additif « à venir » (pilotage PV où pertinent).
 * @returns {{ kwh: number, hourly: number[] } | null}
 */
function _hourlyShapeAvenirItem(item) {
  if (!item || typeof item !== "object") return null;
  const kind = String(item.kind || "").toLowerCase();
  if (kind === "ve") {
    const kwh = _calcVeKwh(item);
    if (kwh <= 0) return null;
    const veMode = String(item.mode_charge || "jour").toLowerCase();
    return {
      kwh,
      hourly: _buildFlat8760(veMode === "nuit" ? _EQ_VE_NUIT_24H : _EQ_VE_JOUR_24H, kwh),
    };
  }
  if (kind === "pac") {
    const pacType = String(item.pac_type || "air_eau").toLowerCase();
    const kwh = _calcPacKwh(item);
    if (kwh <= 0) return null;
    if (pacType === "air_air") {
      return { kwh, hourly: _buildPacAirAir8760(kwh, item) };
    }
    return { kwh, hourly: _buildPac8760WithRole(kwh, item) };
  }
  if (kind === "ballon") {
    const kwh = _calcBallonKwh(item);
    if (kwh <= 0) return null;
    const ballonMode = String(item.mode_charge || "pilote").toLowerCase();
    return {
      kwh,
      hourly: _buildFlat8760(
        ballonMode === "hc" ? _EQ_BALLON_HC_24H : _EQ_BALLON_PILOTE_24H,
        kwh
      ),
    };
  }
  return null;
}

/**
 * EQUIPMENT_CURRENT_RESHAPE_WITH_CSV=1 ou true — micro-reshape actuels sur courbe CSV (somme inchangée).
 * Absent ou autre valeur — pas de reshape actuel sur CSV (comportement historique).
 */
function _equipmentCurrentReshapeWithCsvEnabled() {
  const v = String(process.env.EQUIPMENT_CURRENT_RESHAPE_WITH_CSV ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Fusionne les formes normalisées (Σ=1) des équipements actuels pour blend CSV.
 * @returns {null | { shapeNorm: number[], contributingCount: number }}
 */
function _mergeNormalizedActuelShapes8760(items) {
  const norms = [];
  for (const item of items || []) {
    const sh = _hourlyShapeActuelItem(item);
    if (!sh?.hourly || sh.kwh <= 0) continue;
    const s = sh.hourly.reduce((a, b) => a + (Number(b) || 0), 0);
    if (!(s > 0)) continue;
    norms.push(sh.hourly.map((x) => (Number(x) || 0) / s));
  }
  if (norms.length === 0) return null;
  const merged = new Array(8760).fill(0);
  for (const n of norms) {
    for (let i = 0; i < 8760; i++) merged[i] += n[i];
  }
  const t = merged.reduce((a, b) => a + b, 0);
  if (!(t > 0)) return null;
  return {
    shapeNorm: merged.map((x) => x / t),
    contributingCount: norms.length,
  };
}

/**
 * Micro-reshape à somme STRICTEMENT conservée : L' = (1-λ)L + λ·S·shape,
 * shape PDF sur 8760 h, S = Σ L. Prudent : λ faible.
 */
function _blendHourlyPreservingAnnualCsv(hourly, shapeNorm, lambda) {
  const L = hourly.map((x) => Math.max(0, Number(x) || 0));
  const S = L.reduce((a, b) => a + b, 0);
  if (!(S > 0) || !shapeNorm || shapeNorm.length !== 8760) return hourly.slice();

  const lam = Math.max(0, Math.min(1, Number(lambda) || 0));
  if (lam <= 0) return hourly.slice();

  const out = new Array(8760);
  for (let i = 0; i < 8760; i++) {
    out[i] = (1 - lam) * L[i] + lam * S * (Number(shapeNorm[i]) || 0);
  }

  let sumOut = out.reduce((a, b) => a + b, 0);
  let diff = S - sumOut;
  if (Math.abs(diff) > 1e-9) {
    for (let i = 0; i < 8760; i++) {
      out[i] += diff / 8760;
    }
  }

  for (let i = 0; i < 8760; i++) {
    if (out[i] < 0) out[i] = 0;
  }
  sumOut = out.reduce((a, b) => a + b, 0);
  diff = S - sumOut;
  if (Math.abs(diff) > 1e-9) {
    const pos = [];
    for (let i = 0; i < 8760; i++) if (out[i] > 0) pos.push(i);
    if (pos.length > 0) {
      const add = diff / pos.length;
      for (const i of pos) out[i] += add;
    }
  }

  return out;
}

function _lambdaCsvActuelBlend(itemCount) {
  const n = Math.max(1, Math.min(Number(itemCount) || 1, 4));
  const base = 0.06;
  const per = 0.02;
  const max = 0.1;
  return Math.min(max, base + per * (n - 1));
}

// ======================================================================
// applyEquipmentShape — POST-TRAITEMENT après loadConsumption()
// ======================================================================
/**
 * Applique les profils d'équipements énergétiques sur le résultat de
 * loadConsumption(). À appeler immédiatement après loadConsumption().
 *
 * Deux effets possibles :
 *   1) ACTUEL  — reshape la courbe 8760h pour refléter la présence
 *      d'équipements dans la conso déjà déclarée.
 *      → Sans CSV : recomposition base synthétique + courbes (historique).
 *      → Avec CSV + EQUIPMENT_CURRENT_RESHAPE_WITH_CSV=1 : micro-blend prudent
 *        (même Σ kWh/an, pas d’ajout) vers une forme dérivée des équipements.
 *
 *   2) À VENIR — additionne les kWh supplémentaires des équipements
 *      que le prospect va acquérir, TOUJOURS pilotés sur PV.
 *      → Appliqué quelle que soit la source (CSV ou synthétique).
 *
 * @param {{ hourly: number[], annual_kwh: number }} result  Résultat de loadConsumption()
 * @param {object} merged   Objet fusionné conso+params (contient equipement_actuel, etc.)
 * @param {boolean} hasCsv  True si le CSV Enedis réel a été utilisé
 * @returns {{ hourly: number[], annual_kwh: number }}
 */
export function applyEquipmentShape(result, merged = {}, hasCsv = false) {
  if (!result || !Array.isArray(result.hourly) || result.hourly.length !== 8760) {
    return result;
  }

  const { actuels, avenir } = normalizeEquipmentBuckets(merged);

  let hourly     = result.hourly.slice();
  let annual_kwh = result.annual_kwh;

  // ----------------------------------------------------------------
  // 1a) ACTUEL + CSV — micro-reshape somme nulle (opt-in env)
  // ----------------------------------------------------------------
  if (hasCsv && _equipmentCurrentReshapeWithCsvEnabled() && actuels.items.length > 0) {
    const mergedShape = _mergeNormalizedActuelShapes8760(actuels.items);
    if (mergedShape) {
      const lam = _lambdaCsvActuelBlend(mergedShape.contributingCount);
      hourly = _blendHourlyPreservingAnnualCsv(hourly, mergedShape.shapeNorm, lam);
    }
  }

  // ----------------------------------------------------------------
  // 1b) ACTUEL — reshape (synthétique uniquement) — multi-équipements V1/V2
  // ----------------------------------------------------------------
  if (!hasCsv && actuels.items.length > 0) {
    const curves = [];
    let equipKwhSum = 0;
    for (const item of actuels.items) {
      const sh = _hourlyShapeActuelItem(item);
      if (sh && sh.hourly && sh.kwh > 0) {
        curves.push(sh.hourly);
        equipKwhSum += sh.kwh;
      }
    }

    if (equipKwhSum > 0 && equipKwhSum < annual_kwh * 0.95) {
      const base_kwh = annual_kwh - equipKwhSum;

      const baseRaw    = buildFallbackBase8760(normalizeProfilKeyForConsumption(merged.profil));
      const baseHourly = scaleProfile(baseRaw, base_kwh);

      const equipHourly = new Array(8760).fill(0);
      for (const c of curves) {
        for (let i = 0; i < 8760; i++) {
          equipHourly[i] += c[i] || 0;
        }
      }

      hourly = baseHourly.map((v, i) => v + (equipHourly[i] || 0));
      // annual_kwh inchangé (la somme reste la conso déclarée)
    }
  }

  // ----------------------------------------------------------------
  // 2) À VENIR — additif (CSV ou synthétique)
  // ----------------------------------------------------------------
  if (avenir.items.length > 0) {
    let avenirH   = new Array(8760).fill(0);
    let avenirKwh = 0;

    for (const item of avenir.items) {
      const sh = _hourlyShapeAvenirItem(item);
      if (!sh || !sh.hourly) continue;
      avenirKwh += sh.kwh;
      for (let i = 0; i < 8760; i++) {
        avenirH[i] += sh.hourly[i] || 0;
      }
    }

    if (avenirKwh > 0) {
      hourly     = hourly.map((v, i) => v + (avenirH[i] || 0));
      annual_kwh = annual_kwh + avenirKwh;
    }
  }

  return ensureConsumptionConsistent({ hourly, annual_kwh });
}

// Expose les fonctions de calcul kWh pour usage frontend/API
export {
  _calcVeKwh as calcVeKwh,
  _calcPacKwh as calcPacKwh,
  _calcBallonKwh as calcBallonKwh,
  _calcPacAirAirKwh as calcPacAirAirKwh,
  /** @deprecated alias historique (clim → PAC air/air) */
  _calcPacAirAirKwh as calcClimReversibleKwh,
};
