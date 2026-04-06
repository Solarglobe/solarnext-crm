/**
 * CP-DSM-PDF-004 — Builder HTML pour PDF Analyse Ombres
 * Génère une page HTML complète à partir des données backend.
 * Légende : jaune (modérée), orange (significative), rouge (importante).
 */

import { resolveShadingTotalLossPct } from "../services/shading/resolveShadingTotalLossPct.js";

/**
 * Paragraphe d’accroche commercial / pédagogique — inchangé côté calculs, uniquement lecture.
 * @returns {string} fragment HTML
 */
export function buildDsmShadingPdfIntroHtml() {
  return `<p class="page-intro">Les pourcentages ci-dessous estiment une <strong>baisse annuelle moyenne</strong> de production photovoltaïque (modèle logiciel, pas une mesure physique sur site), liée à l’environnement : obstacles près du toit et relief à l’horizon. Ils sont alignés sur votre étude technique ; une valeur non nulle est courante.</p><p class="page-intro"><strong>Lecture en trois niveaux :</strong> obstacles à proximité (impact local sur le toit), relief / horizon lointain (environnement plus large), impact global estimé (synthèse officielle retenue — même référence que le devis lorsque le pourcentage y est affiché).</p>`;
}

/**
 * Grille KPI shading — texte unique pour page 2 et HTML standalone (transparence produit).
 * @param {{ totalLoss: number|null, nearLoss: number, farLossStr: string, score: number, grade: string }} p
 */
function buildDsmShadingStatCardsFragment(p) {
  const { totalLoss, nearLoss, farLossStr, score, grade } = p;
  return `
      <div class="stat-card">
        <div class="stat-label">Impact global estimé</div>
        <div class="stat-value">${formatPct(totalLoss)}</div>
        <div class="stat-hint">Synthèse retenue par l’étude (proche + lointain). Estimation annuelle modèle, ordre de grandeur comparable entre projets.</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Obstacles à proximité</div>
        <div class="stat-value">${formatPct(nearLoss)}</div>
        <div class="stat-hint">Composante « proche » : obstacles sur ou immédiatement autour du plan de pose.</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Relief / horizon lointain</div>
        <div class="stat-value">${farLossStr}</div>
        <div class="stat-hint">Composante « lointain » : masque d’horizon (indisponible si la localisation est incomplète).</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Score d’exposition estimé</div>
        <div class="stat-value">${score} / 100</div>
        <div class="stat-hint">Indicateur 0–100 issu du modèle d’ombrage / exposition — aide à la comparaison, pas une garantie de production.</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Appréciation du relief</div>
        <div class="stat-value">${escapeHtml(grade)}</div>
        <div class="stat-hint">Qualité de lecture des données terrain utilisées pour le lointain (fiabilité des données, pas la perte en %).</div>
      </div>`;
}

/** Note sous le schéma heatmap — lecture honnête des couleurs. */
function buildDsmShadingHeatmapNoteHtml() {
  return `<p class="page-intro page-heatmap-note">Les couleurs sur le schéma indiquent une perte <em>modélisée</em> par module (repère visuel) ; ce n’est pas un relevé ponctuel sur toiture.</p>`;
}

/**
 * lossPct → couleur fill SVG (aligné roofHeatmap)
 * < 3: pas d'overlay (gris clair pour visibilité)
 * 3–7: jaune
 * 7–12: orange
 * >= 12: rouge
 */
function lossToFillColor(lossPct) {
  if (typeof lossPct !== "number" || isNaN(lossPct) || lossPct < 3) {
    return "rgba(200, 200, 200, 0.3)";
  }
  if (lossPct < 7) return "rgba(255, 255, 0, 0.5)";
  if (lossPct < 12) return "rgba(255, 165, 0, 0.55)";
  return "rgba(255, 80, 80, 0.6)";
}

/**
 * Extrait les panneaux avec polygon et lossPct depuis geometry + perPanel.
 * Garde-fous : geometry, frozenBlocks, panneaux mal formés (skip silencieux).
 */
function extractPanelsWithLoss(geometry, perPanel) {
  const lossMap = new Map();
  if (Array.isArray(perPanel)) {
    for (const p of perPanel) {
      const id = p.panelId ?? p.id;
      if (id != null) {
        const loss = typeof p.lossPct === "number" && !isNaN(p.lossPct) ? p.lossPct : 0;
        lossMap.set(String(id), loss);
      }
    }
  }

  const panels = [];
  const blocks =
    geometry && Array.isArray(geometry.frozenBlocks) ? geometry.frozenBlocks : [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const blockPanels = Array.isArray(block.panels) ? block.panels : [];
    for (const p of blockPanels) {
      if (!p || typeof p !== "object") continue;
      const poly = p.polygonPx || p.polygon || p.points || p.projection?.points;
      if (!Array.isArray(poly) || poly.length < 3) continue;
      const panelId = p.id ?? `p-${panels.length}`;
      const lossPct = lossMap.get(String(panelId)) ?? 0;
      let points;
      try {
        points = poly.map((pt) => ({
          x: pt != null && typeof pt.x === "number" && !isNaN(pt.x) ? pt.x : 0,
          y: pt != null && typeof pt.y === "number" && !isNaN(pt.y) ? pt.y : 0,
        }));
      } catch (_) {
        continue;
      }
      panels.push({ panelId: String(panelId), lossPct, points });
    }
  }
  return panels;
}

/**
 * Calcule la bounding box et le viewBox SVG.
 */
function computeViewBox(panels) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of panels) {
    for (const pt of p.points) {
      minX = Math.min(minX, pt.x);
      minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x);
      maxY = Math.max(maxY, pt.y);
    }
  }
  const pad = 20;
  const w = Math.max(1, maxX - minX + pad * 2);
  const h = Math.max(1, maxY - minY + pad * 2);
  return {
    viewBox: `${minX - pad} ${minY - pad} ${w} ${h}`,
    width: w,
    height: h,
    minX: minX - pad,
    minY: minY - pad,
  };
}

/**
 * Génère le SVG heatmap (calpinage + overlay).
 */
function buildHeatmapSvg(geometry, perPanel) {
  const panels = extractPanelsWithLoss(geometry, perPanel);
  if (panels.length === 0) {
    return '<div class="heatmap-placeholder">Aucun panneau</div>';
  }

  const { viewBox } = computeViewBox(panels);
  const aspectRatio = 16 / 10;

  const polygons = panels
    .map((p) => {
      const fill = lossToFillColor(p.lossPct);
      const pts = p.points.map((pt) => `${pt.x},${pt.y}`).join(" ");
      return `<polygon points="${pts}" fill="${fill}" stroke="#333" stroke-width="0.5"/>`;
    })
    .join("\n");

  return `
    <svg class="heatmap-svg" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">
      ${polygons}
    </svg>
  `;
}

/**
 * Top 5 panneaux triés par lossPct desc.
 */
function getTop5Panels(perPanel) {
  if (!Array.isArray(perPanel) || perPanel.length === 0) return [];
  return [...perPanel]
    .filter((p) => typeof (p.lossPct ?? p.loss) === "number")
    .map((p) => ({
      panelId: String(p.panelId ?? p.id ?? "—"),
      lossPct: Number(p.lossPct ?? p.loss ?? 0),
    }))
    .sort((a, b) => b.lossPct - a.lossPct)
    .slice(0, 5);
}

/**
 * Construit le contenu de la Page 2 (Analyse énergétique) — section uniquement.
 * CP-DSM-PDF-005 : pour assemblage PDF 2 pages.
 */
export function buildPage2Content(data) {
  const { address, date, installation, geometry, shading } = data || {};

  const near = shading?.near || {};
  const far = shading?.far || {};
  const combined = shading?.combined || {};
  const sq = shading?.shadingQuality || {};
  const perPanel = shading?.perPanel || [];

  /** Perte totale affichée : même résolution que getOfficial + repli installation (voir resolveShadingTotalLossPct). */
  const totalLoss = resolveShadingTotalLossPct(shading, { installation }) ?? null;
  const nearLoss = Number(near.totalLossPct ?? 0) || 0;
  const farLossStr = formatFarLossPctForPdf(far, sq);
  const score = Number(sq.score ?? 0) || 0;
  const grade = String(sq.grade ?? "—").toUpperCase() || "—";

  const top5 = getTop5Panels(perPanel);
  const heatmapSvg = buildHeatmapSvg(geometry || {}, perPanel);

  return `
    <section class="page a4 page-break">
      <header class="page-header">
        <h1>Analyse d'ombrage – Étude SolarNext</h1>
        <div class="subtitle">${escapeHtml(address)} • ${escapeHtml(date)}</div>
      </header>
      ${buildDsmShadingPdfIntroHtml()}

      <div class="heatmap-block">
        ${heatmapSvg}
      </div>
      ${buildDsmShadingHeatmapNoteHtml()}

      <div class="stats-grid">
        ${buildDsmShadingStatCardsFragment({ totalLoss, nearLoss, farLossStr, score, grade })}
      </div>

      <section class="top-panels">
        <h3>Modules les plus exposés à l’ombrage</h3>
        <p class="page-intro top-panels-note">Référence technique du module ; pourcentages issus du même modèle que l’étude (estimation).</p>
        <table class="panels">
          <thead><tr><th>Module</th><th>Perte modélisée (estim.)</th></tr></thead>
          <tbody>
            ${top5.length > 0 ? top5.map((p) => `<tr><td>${escapeHtml(p.panelId)}</td><td>${formatPct(p.lossPct)}</td></tr>`).join("") : "<tr><td colspan=\"2\">—</td></tr>"}
          </tbody>
        </table>
      </section>

      <section class="legend">
        <div class="legend-item"><span class="legend-color" style="background: rgba(255,255,0,0.5);"></span> Jaune : perte modélisée modérée</div>
        <div class="legend-item"><span class="legend-color" style="background: rgba(255,165,0,0.55);"></span> Orange : perte modélisée significative</div>
        <div class="legend-item"><span class="legend-color" style="background: rgba(255,80,80,0.6);"></span> Rouge : perte modélisée marquée</div>
      </section>
    </section>
  `;
}

/**
 * Construit la page HTML complète pour le PDF (1 page, rétrocompat).
 * @param {object} data - Sortie de getDsmAnalysisData
 * @returns {string} HTML
 */
export function buildDsmAnalysisHtml(data) {
  const { address, date, installation, geometry, shading } = data || {};

  const near = shading.near || {};
  const far = shading.far || {};
  const combined = shading.combined || {};
  const sq = shading.shadingQuality || {};
  const perPanel = shading.perPanel || [];

  /** Perte totale PDF : même chaîne que `getOfficialGlobalShadingLossPct` (+ repli installation). */
  const totalLoss = resolveShadingTotalLossPct(shading, { installation }) ?? null;
  const nearLoss = Number(near.totalLossPct ?? 0) || 0;
  const farLossStr = formatFarLossPctForPdf(far, sq);
  const score = Number(sq.score ?? 0) || 0;
  const grade = String(sq.grade ?? "—").toUpperCase() || "—";

  const top5 = getTop5Panels(perPanel);
  const heatmapSvg = buildHeatmapSvg(geometry, perPanel);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <title>Analyse d'ombrage – Étude SolarNext</title>
  <style>
    @page { size: A4; margin: 15mm; }
    :root { --ink: #111; --muted: #6b7280; --brand: #C39847; --bg: #fff; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; color: var(--ink); background: var(--bg); }
    .container { max-width: 100%; padding: 12px; }
    .header { margin-bottom: 16px; border-bottom: 2px solid var(--brand); padding-bottom: 12px; }
    .header h1 { margin: 0 0 4px; font-size: 18px; font-weight: 700; }
    .header .subtitle { font-size: 12px; color: var(--muted); }
    .page-intro { font-size: 11px; color: var(--muted); line-height: 1.45; margin: 0 0 12px; }
    .heatmap-block { width: 100%; margin: 12px 0; background: #f8f9fa; border-radius: 8px; overflow: hidden; }
    .heatmap-svg { width: 100%; height: auto; max-height: 280px; display: block; }
    .heatmap-placeholder { padding: 40px; text-align: center; color: var(--muted); }
    .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 12px 0; }
    .stat-card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 12px; }
    .stat-label { font-size: 10px; color: var(--muted); text-transform: uppercase; }
    .stat-value { font-size: 16px; font-weight: 700; }
    .stat-hint { font-size: 9px; color: var(--muted); line-height: 1.35; margin-top: 6px; }
    .top-panels { margin: 12px 0; }
    .top-panels h3 { font-size: 12px; margin: 0 0 8px; }
    .top-panels-note { margin: 0 0 8px; font-size: 10px; }
    .page-heatmap-note { margin: 8px 0 12px; font-size: 10px; }
    table.panels { width: 100%; border-collapse: collapse; font-size: 11px; }
    table.panels th, table.panels td { padding: 6px 8px; text-align: left; border-bottom: 1px solid #e5e7eb; }
    table.panels th { color: var(--muted); font-weight: 600; }
    .legend { margin-top: 16px; display: flex; gap: 16px; flex-wrap: wrap; align-items: center; font-size: 11px; }
    .legend-item { display: flex; align-items: center; gap: 6px; }
    .legend-color { width: 20px; height: 14px; border-radius: 3px; }
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <h1>Analyse d'ombrage – Étude SolarNext</h1>
      <div class="subtitle">${escapeHtml(address)} • ${escapeHtml(date)}</div>
    </header>
    ${buildDsmShadingPdfIntroHtml()}

    <section class="heatmap-block">
      ${heatmapSvg}
    </section>
    ${buildDsmShadingHeatmapNoteHtml()}

    <section class="stats-grid">
      ${buildDsmShadingStatCardsFragment({ totalLoss, nearLoss, farLossStr, score, grade })}
    </section>

    <section class="top-panels">
      <h3>Modules les plus exposés à l’ombrage</h3>
      <p class="page-intro top-panels-note">Référence technique du module ; pourcentages issus du même modèle que l’étude (estimation).</p>
      <table class="panels">
        <thead><tr><th>Module</th><th>Perte modélisée (estim.)</th></tr></thead>
        <tbody>
          ${top5.length > 0 ? top5.map((p) => `<tr><td>${escapeHtml(p.panelId)}</td><td>${formatPct(p.lossPct)}</td></tr>`).join("") : "<tr><td colspan=\"2\">—</td></tr>"}
        </tbody>
      </table>
    </section>

    <section class="legend">
      <div class="legend-item"><span class="legend-color" style="background: rgba(255,255,0,0.5);"></span> Jaune : perte modélisée modérée</div>
      <div class="legend-item"><span class="legend-color" style="background: rgba(255,165,0,0.55);"></span> Orange : perte modélisée significative</div>
      <div class="legend-item"><span class="legend-color" style="background: rgba(255,80,80,0.6);"></span> Rouge : perte modélisée marquée</div>
    </section>
  </div>
</body>
</html>`;
}

function escapeHtml(s) {
  if (s == null) return "";
  const str = String(s);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatPct(n) {
  if (typeof n !== "number" || isNaN(n)) return "—";
  return `${Math.round(n * 100) / 100} %`;
}

/** Far : pas afficher 0 % trompeur si GPS absent / UNAVAILABLE_NO_GPS */
function formatFarLossPctForPdf(far, sq) {
  if (far?.source === "UNAVAILABLE_NO_GPS" || sq?.blockingReason === "missing_gps") {
    return "—";
  }
  const raw = far?.totalLossPct;
  if (raw == null) return "—";
  return formatPct(Number(raw));
}
