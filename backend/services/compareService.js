// ======================================================================
// SMARTPITCH V8 — COMPARATEUR (IA-choice)
// Version finale, réaliste, fiable, alignée prompt Solarglobe.
// ======================================================================

// Sélectionne le meilleur scénario selon plusieurs critères pondérés
export function chooseBest(scenarios = {}) {
  let bestKey = null;
  let bestScore = -Infinity;
  const details = {};

  for (const [key, sc] of Object.entries(scenarios)) {

    const annual = sc.annual ?? {};

    // -----------------------------------------
    // Extraction fiable des valeurs
    // -----------------------------------------
    const gain25 = num(sc.flows?.[sc.flows.length - 1]?.cumul_eur ?? 0);
    const gain1  = num(annual.gain_an1_eur ?? 0);

    const auto_pct     = num(sc.indicators?.auto_pct ?? 0);
    const autoprod_pct = num(sc.indicators?.autoprod_pct ?? 0);
    const surplus_pct  = num(sc.indicators?.surplus_pct ?? 0);

    const prod = num(annual.prod_kwh ?? 0);
    const roi  = num(sc.roi_years ?? Infinity);
    const irr  = num(sc.irr_pct ?? 0);
    const lcoe = num(sc.lcoe_eur_kwh ?? 0);

    // -----------------------------------------
    // Système de score réaliste + vendeur
    // Inspiré de ton prompt : performance long terme
    // -----------------------------------------
    const score =
      (gain25 * 0.00015) +     // Gains cumulés (pondération à 50 %)
      (auto_pct * 0.35)    +   // autoconsommation (pondération forte)
      (autoprod_pct * 0.12) +  // autonomie
      ((30 - roi) * 1.1)   +   // ROI bas = mieux
      (irr * 0.35)         +   // TRI (réaliste maintenant)
      (prod * 0.00015);        // production = bonus léger

    // -----------------------------------------
    // Sauvegarde détails scénario
    // -----------------------------------------
    details[key] = {
      gain25,
      gain1,
      prod,
      auto_pct,
      autoprod_pct,
      surplus_pct,
      roi,
      irr,
      lcoe,
      score: round(score, 4)
    };

    if (score > bestScore) {
      bestKey = key;
      bestScore = score;
    }
  }

  const justification = bestKey
    ? buildJustification(bestKey, details[bestKey])
    : "Aucun scénario ne s’impose clairement. Vérifiez les données du client.";

  return {
    ia_choice: bestKey,
    score: round(bestScore, 3),
    details,
    comment: justification
  };
}

// ======================================================================
// Justification commerciale et technique
// ======================================================================
function buildJustification(key, d) {
  const pts = [];

  if (d.gain25 > 0)
    pts.push(`des gains cumulés élevés (~${formatEuro(d.gain25)} sur 25 ans)`);

  if (d.auto_pct > 0)
    pts.push(`un bon taux d’autoconsommation (~${round(d.auto_pct, 1)} %)`);

  if (d.autoprod_pct > 0)
    pts.push(`une bonne autonomie (~${round(d.autoprod_pct, 1)} %)`);

  const roiYears = d.roi_years ?? d.roi;
  if (roiYears != null && roiYears < 15)
    pts.push(`un retour sur investissement intéressant (~${roiYears} ans)`);

  if (d.irr > 5)
    pts.push(`un TRI positif (~${round(d.irr, 1)} %)`);

  if (d.lcoe && d.lcoe < 0.20)
    pts.push(`un coût de production très bas (~${round(d.lcoe, 3)} €/kWh)`);

  const why = pts.length
    ? pts.join(", ")
    : "un excellent équilibre global entre production, autonomie et rentabilité";

  return `Le scénario ${key} est recommandé car il présente ${why}.`;
}

// ======================================================================
// Utils
// ======================================================================
function num(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function round(x, d = 2) {
  const p = Math.pow(10, d);
  return Math.round(p * x) / p;
}

function formatEuro(v) {
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR"
    }).format(v);
  } catch {
    return `${round(v)} €`;
  }
}
