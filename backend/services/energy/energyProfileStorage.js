/**
 * Normalise un profil API (data + summary) vers la forme stockée leads.energy_profile.
 * Structure attendue : { source, uploaded_at, summary: { annual_kwh }, hourly?: number[] }
 * Si hourly absent mais summary présent, le calcul pourra utiliser consumption_monthly / annual_kwh en fallback.
 */

const IS_DEV = process.env.NODE_ENV !== "production";

/**
 * Dérive un tableau 8760 (une valeur par heure) à partir de profile.data.
 * - Si profile a déjà hourly (length >= 8760), le renvoie tel quel.
 * - Si data en 15m (35040 points), agrège par 4 (4 points = 1 h).
 * - Si data en 30m (17520 points), agrège par paires (2 points = 1 h).
 * - Si data en 1h (8760 points), utilise directement.
 * @param {{ data?: Array<{ consumption_kwh?: number }>, hourly?: number[], engine?: { hourly?: number[] } }} profile
 * @returns {number[] | null} 8760 valeurs ou null si impossible
 */
export function deriveHourly8760(profile) {
  const engHourly = profile?.engine?.hourly;
  if (Array.isArray(engHourly) && engHourly.length >= 8760) {
    return engHourly.slice(0, 8760).map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0));
  }
  if (profile.hourly && Array.isArray(profile.hourly) && profile.hourly.length >= 8760) {
    return profile.hourly.slice(0, 8760).map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0));
  }
  const data = profile.data;
  if (!Array.isArray(data)) return null;
  if (data.length >= 8760 * 4) {
    if (IS_DEV) {
      console.warn("[energyProfile] detected 15m interval, aggregating to hourly");
    }
    const hourly = [];
    for (let i = 0; i < 8760; i++) {
      const a = data[4 * i]?.consumption_kwh ?? 0;
      const b = data[4 * i + 1]?.consumption_kwh ?? 0;
      const c = data[4 * i + 2]?.consumption_kwh ?? 0;
      const d = data[4 * i + 3]?.consumption_kwh ?? 0;
      hourly.push(Number(a) + Number(b) + Number(c) + Number(d));
    }
    return hourly.slice(0, 8760);
  }
  if (data.length >= 8760 * 2) {
    const hourly = [];
    for (let i = 0; i < 8760; i++) {
      const a = data[i * 2]?.consumption_kwh ?? 0;
      const b = data[i * 2 + 1]?.consumption_kwh ?? 0;
      hourly.push(Number(a) + Number(b));
    }
    return hourly;
  }
  if (data.length >= 8760) {
    return data.slice(0, 8760).map((p) => Number(p?.consumption_kwh) || 0);
  }
  return null;
}

/**
 * Construit l'objet à enregistrer dans leads.energy_profile.
 * Si summary présent mais pas de hourly ni data dérivable → marque partial: true.
 * @param {object} profile - Réponse buildEnergyProfile (data, summary, source) ou déjà stocké (hourly, summary)
 * @returns {{ source: string, uploaded_at: string, summary: { annual_kwh?: number }, hourly?: number[] | null, partial?: boolean }}
 */
export function buildStoredEnergyProfile(profile) {
  const p = profile || {};
  const hourly = deriveHourly8760(p);
  const summary = p?.summary && typeof p.summary === "object" ? p.summary : {};
  const engineAnnual =
    p?.engine && typeof p.engine === "object" && typeof p.engine.annual_kwh === "number" && Number.isFinite(p.engine.annual_kwh)
      ? p.engine.annual_kwh
      : undefined;
  const annual =
    summary.annual_kwh ??
    engineAnnual ??
    (Array.isArray(hourly) && hourly.length === 8760 ? hourly.reduce((a, b) => a + b, 0) : undefined);
  const hasSummary = summary && typeof summary.annual_kwh === "number";
  const noHourly = !hourly || hourly.length !== 8760;
  const noData = !Array.isArray(p.data) || p.data.length < 8760;
  const partial = Boolean(hasSummary && noHourly && noData);
  if (partial && IS_DEV) {
    console.warn("[energyProfile] partial profile detected (summary without hourly/data)");
  }

  const source =
    p?.engine && typeof p.engine === "object" ? "engine" : p?.source || "switchgrid";

  const out = {
    source,
    uploaded_at: new Date().toISOString(),
    summary: { annual_kwh: annual },
    ...(hourly && hourly.length === 8760 ? { hourly } : {}),
    ...(partial ? { partial: true } : {}),
  };

  if (p?.engine && typeof p.engine === "object" && hourly && hourly.length === 8760) {
    out.engine = {
      annual_kwh: typeof annual === "number" && Number.isFinite(annual) ? annual : hourly.reduce((a, b) => a + b, 0),
      hourly,
    };
  }

  return out;
}
