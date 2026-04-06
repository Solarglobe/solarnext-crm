/**
 * CP-DSM-PDF-006 — Builder HTML 1 page "Masque d'ombrage"
 * Réutilise buildHorizonMaskPageHtml, enveloppe dans document complet.
 */

import { buildHorizonMaskPageHtml } from "./dsmHorizonMaskPageBuilder.js";

const PAGE_CSS = `
  @page { size: A4; margin: 12mm; }
  :root { --ink: #111; --muted: #6b7280; --brand: #C39847; --bg: #fff; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; color: var(--ink); background: var(--bg); }
  .page { padding: 12px; min-height: 250mm; }
  .page-header { margin-bottom: 12px; border-bottom: 2px solid var(--brand); padding-bottom: 8px; }
  .page-header h1 { margin: 0 0 4px; font-size: 18px; font-weight: 700; }
  .page-header .subtitle { font-size: 12px; color: var(--muted); }
  .diagram-block { width: 100%; margin: 12px 0; background: #f8f9fa; border-radius: 8px; overflow: hidden; }
  .polar-diagram, .horizon-cartesian-chart, .horizon-premium-chart { width: 100%; height: auto; max-height: 340px; display: block; }
  .diagram-placeholder { padding: 40px; text-align: center; color: var(--muted); }
  .info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 16px; margin: 12px 0; font-size: 11px; }
  .info-item { display: flex; flex-direction: column; gap: 2px; }
  .info-item .label { color: var(--muted); font-size: 10px; text-transform: uppercase; }
  .info-item .value { font-weight: 600; }
  .legend-block { margin-top: 12px; font-size: 11px; }
  .legend-title { font-weight: 700; margin-bottom: 4px; }
  .legend-curves, .legend-shadow, .legend-horizon, .legend-hours, .legend-bands { color: var(--muted); }
  .legend-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 2px; vertical-align: middle; }
  .pedagogical-block { margin-top: 16px; padding: 12px; background: #f1f5f9; border-radius: 6px; border-left: 4px solid var(--brand); font-size: 11px; }
  .pedagogical-title { font-weight: 700; margin-bottom: 8px; color: var(--ink); }
  .pedagogical-text { margin: 0 0 6px; color: var(--muted); line-height: 1.4; }
  .pedagogical-text:last-child { margin-bottom: 0; }
  .directional-section { margin-top: 20px; padding-top: 16px; border-top: 1px solid #e5e7eb; }
  .directional-title { margin: 0 0 10px; font-size: 14px; font-weight: 700; color: var(--ink); }
  .diagram-block-radar { display: flex; justify-content: center; align-items: center; }
  .horizon-directional-radar { width: 200px; height: 200px; }
`;

/**
 * Construit le HTML complet 1 page pour le PDF Masque d'ombrage.
 * @param {object} data - Sortie de getHorizonMaskPdfData
 * @returns {string} HTML
 */
export function buildHorizonMaskSinglePageHtml(data) {
  const page1 = buildHorizonMaskPageHtml(data);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <title>Masque d'horizon technique</title>
  <style>${PAGE_CSS}</style>
</head>
<body>
  ${page1}
</body>
</html>`;
}
