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
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 24 || min < 0 || min > 59) return null;
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
  return out;
}

/** Une heure [h:00, h+1:00) est HC si ≥ 30 min couvertes par une plage creuse. */
function hourIsOffPeak(hour, intervals) {
  const hs = hour * 60;
  const he = hs + 60;
  let covered = 0;
  for (const [s, e] of intervals) {
    const lo = Math.max(hs, s);
    const hi = Math.min(he, e);
    if (hi > lo) covered += hi - lo;
  }
  return covered >= 30;
}

/** @returns {boolean[]} 24 flags, true = HP (heure pleine), false = HC (heure creuse). */
export function buildHourOfDayHpFlags(offPeakPeriods) {
  const periods = Array.isArray(offPeakPeriods) && offPeakPeriods.length ? offPeakPeriods : DEFAULT_OFF_PEAK_PERIODS;
  const intervals = expandPeriods(periods);
  // Garde-fou : si la config est invalide (aucun intervalle), on retombe sur le défaut.
  const safe = intervals.length ? intervals : expandPeriods(DEFAULT_OFF_PEAK_PERIODS);
  const flags = [];
  for (let h = 0; h < 24; h++) flags.push(!hourIsOffPeak(h, safe));
  return flags;
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
    if (sh > 24 || eh > 24 || sm > 59 || em > 59) continue;
    const start = `${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}`;
    const end = `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
    if (start === end) continue;
    out.push({ start, end });
  }
  return out.length ? out : null;
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
  return DEFAULT_OFF_PEAK_PERIODS;
}

/** Masque 8760 HP/HC résolu depuis la config (avec défaut 23h→07h). */
export function resolveHpHcHourlyMask(vbInput, ctx) {
  return buildHpHcHourlyMask(resolveOffPeakPeriods(vbInput, ctx));
}
