/**
 * Masque horaire HP/HC (8760) pour la ventilation de la restitution batterie virtuelle.
 *
 * Convention de sortie : true (1) = Heure Pleine (HP), false (0) = Heure Creuse (HC).
 * Compatible splitDischargeHpHc(hourlyDischarge, hourlyIsHp) de virtualBatteryP2Finance.service.js.
 *
 * Heures creuses françaises : 8 h/jour, fixées par Enedis (pas par le client).
 * Réforme 2025/2026 : HC réparties (≥5 h nuit 23h–7h, jusqu'à 3 h jour 11h–17h) → géré via off_peak_periods.
 *
 * Défaut quand le contrat n'est pas connu : HC 23:00 → 07:00 (8 h continues), HP le reste.
 * Idéalement, off_peak_periods est configurable par client (deux contrats HP/HC peuvent différer).
 */

export const DEFAULT_OFF_PEAK_PERIODS = [{ start: "23:00", end: "07:00" }];

function toMinutes(hhmm) {
  if (typeof hhmm !== "string") return null;
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 24 || min < 0 || min > 59 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

/** Normalise les plages en intervalles [startMin, endMin) non chevauchant minuit, dans [0,1440). */
function expandPeriods(periods) {
  const out = [];
  for (const p of periods || []) {
    const s = toMinutes(p?.start);
    const e = toMinutes(p?.end);
    if (s == null || e == null || s === e) continue;
    if (s < e) {
      out.push([s, e]);
    } else {
      // plage qui passe minuit (ex. 23:00 → 07:00)
      out.push([s, 1440]);
      out.push([0, e]);
    }
  }
  // Une minute creuse ne doit être comptée qu'une fois si des plages se chevauchent.
  out.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [start, end] of out) {
    const previous = merged[merged.length - 1];
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** Part HC d'une heure [h:00, h+1:00), sans arrondir les bornes des plages. */
function hourOffPeakFraction(hour, intervals) {
  const hs = hour * 60;
  const he = hs + 60;
  let covered = 0;
  for (const [s, e] of intervals) {
    const lo = Math.max(hs, s);
    const hi = Math.min(he, e);
    if (hi > lo) covered += hi - lo;
  }
  return Math.min(60, covered) / 60;
}

/** @returns {number[]} 24 parts HP entre 0 et 1 ; ex. 22h30 début HC → 0.5 à 22h. */
export function buildHourOfDayHpFractions(offPeakPeriods) {
  const periods = Array.isArray(offPeakPeriods) && offPeakPeriods.length ? offPeakPeriods : DEFAULT_OFF_PEAK_PERIODS;
  const intervals = expandPeriods(periods);
  // Garde-fou : si la config est invalide (aucun intervalle), on retombe sur le défaut.
  const safe = intervals.length ? intervals : expandPeriods(DEFAULT_OFF_PEAK_PERIODS);
  return Array.from({ length: 24 }, (_, h) => 1 - hourOffPeakFraction(h, safe));
}

/** Masque historique : conservé pour les consommateurs booléens, pas pour valoriser l'énergie. */
export function buildHourOfDayHpFlags(offPeakPeriods) {
  return buildHourOfDayHpFractions(offPeakPeriods).map((hpFraction) => hpFraction > 0.5);
}

/** @returns {number[]} 8760 parts HP, motif journalier répété. */
export function buildHpHcHourlyFractions(offPeakPeriods) {
  const hp24 = buildHourOfDayHpFractions(offPeakPeriods);
  return Array.from({ length: 8760 }, (_, i) => hp24[i % 24]);
}

/** @returns {boolean[]} 8760 flags (true = HP), motif journalier répété. Heure 0 = minuit 1er janvier. */
export function buildHpHcHourlyMask(offPeakPeriods) {
  const hp24 = buildHourOfDayHpFlags(offPeakPeriods);
  const mask = new Array(8760);
  for (let i = 0; i < 8760; i++) mask[i] = hp24[i % 24];
  return mask;
}

/**
 * LOT1-HC-WINDOW — Parse un libellé Enedis de plages heures creuses (C68 `plageHeuresCreuses`
 * ou `futuresPlagesHeuresCreuses`) vers off_peak_periods [{start:"HH:MM", end:"HH:MM"}].
 *
 * Formats observés (SGE réels) :
 *   "HC (22H30-6H30)"                → [{start:"22:30", end:"06:30"}]
 *   "HC (1H28-6H58;13H58-16H28)"     → 2 plages (réforme 2025/2026, HC de jour)
 *   tolérant : minuscules, espaces, "23H" sans minutes, préfixe quelconque avant "(".
 *
 * @param {string|null|undefined} label
 * @returns {{start: string, end: string}[]|null} null si rien d'exploitable (l'appelant garde le défaut)
 */
export function parseEnedisOffPeakLabel(label) {
  if (typeof label !== "string" || !label.trim()) return null;
  // Contenu entre parenthèses si présent, sinon la chaîne entière (tolérance).
  const m = label.match(/\(([^)]*)\)/);
  const body = (m ? m[1] : label).trim();
  if (!body) return null;

  const out = [];
  for (const rawRange of body.split(";")) {
    const range = rawRange.trim();
    if (!range) continue;
    const rm = range.match(/^(\d{1,2})\s*[Hh:]\s*(\d{0,2})\s*-\s*(\d{1,2})\s*[Hh:]\s*(\d{0,2})$/);
    if (!rm) continue;
    const sh = Number(rm[1]);
    const sm = rm[2] === "" ? 0 : Number(rm[2]);
    const eh = Number(rm[3]);
    const em = rm[4] === "" ? 0 : Number(rm[4]);
    if (![sh, sm, eh, em].every(Number.isFinite)) continue;
    if (sh > 24 || eh > 24 || sm > 59 || em > 59 || (sh === 24 && sm !== 0) || (eh === 24 && em !== 0)) continue;
    const start = `${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}`;
    const end = `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
    if (start === end) continue;
    out.push({ start, end });
  }
  return out.length ? out : null;
}

/** Current imported meter hours only; no future schedule and no assumed window. */
export function resolveKnownCurrentOffPeakPeriods(energyProfile) {
  const validPeriods = (value) => {
    if (!Array.isArray(value) || value.length === 0) return null;
    const time = (raw) => typeof raw === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(raw);
    if (!value.every((period) => time(period?.start) && time(period?.end) && period.start !== period.end)) return null;
    return value.map(({ start, end }) => ({ start, end }));
  };
  const contract = energyProfile?.contract;
  const structured = validPeriods(contract?.off_peak_periods)
    ?? validPeriods(parseEnedisOffPeakLabel(contract?.plage_hc));
  if (structured) return structured;
  // Older form saves retained only engine. Its displayed current contract still
  // contains the imported window, e.g. "HP/HC (22H30-6H30) — 18 kVA — 230/400 V".
  // Anchor on that current-contract format instead of scraping any time range.
  const summary = energyProfile?.engine?.contract_summary;
  const current = typeof summary === "string"
    ? summary.match(/^\s*HP\s*\/\s*HC\s*\(([^)]+)\)(?:\s*[—–-]|\s*$)/i)
    : null;
  return current ? validPeriods(parseEnedisOffPeakLabel(current[1])) : null;
}

/** Résout les plages creuses depuis la config devis/lead/settings, sinon défaut. */
export function resolveOffPeakPeriods(vbInput, ctx) {
  const candidates = [
    vbInput?.off_peak_periods,
    vbInput?.offPeakPeriods,
    ctx?.form?.params?.off_peak_periods,
    ctx?.form?.lead?.off_peak_periods,
    ctx?.settings?.pv?.virtual_battery?.off_peak_periods,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length) return c;
  }
  return resolveKnownCurrentOffPeakPeriods(ctx?.form?.lead?.energy_profile ?? ctx?.lead?.energy_profile ?? ctx?.energy_profile)
    ?? DEFAULT_OFF_PEAK_PERIODS;
}

/** Masque 8760 HP/HC résolu depuis la config (avec défaut 23h→07h). */
export function resolveHpHcHourlyMask(vbInput, ctx) {
  return buildHpHcHourlyMask(resolveOffPeakPeriods(vbInput, ctx));
}

/** Parts HP utilisées pour valoriser les kWh sans arrondir les minutes creuses. */
export function resolveHpHcHourlyFractions(vbInput, ctx) {
  return buildHpHcHourlyFractions(resolveOffPeakPeriods(vbInput, ctx));
}

/** Plages du contrat actuel ; les réglages du futur fournisseur ne modifient jamais la référence. */
export function resolveCurrentOffPeakPeriods(ctx) {
  const candidates = [ctx?.form?.params?.current_off_peak_periods, ctx?.form?.lead?.current_off_peak_periods, ctx?.form?.params?.off_peak_periods, ctx?.form?.lead?.off_peak_periods];
  return candidates.find((periods) => Array.isArray(periods) && periods.length)
    ?? resolveKnownCurrentOffPeakPeriods(ctx?.form?.lead?.energy_profile ?? ctx?.lead?.energy_profile ?? ctx?.energy_profile)
    ?? DEFAULT_OFF_PEAK_PERIODS;
}
