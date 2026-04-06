/**
 * CP-DSM-PDF-005 — Assemblage HTML 2 pages (Masque Horizon + Analyse Énergétique)
 */

import { buildHorizonMaskPageHtml } from "./dsmHorizonMaskPageBuilder.js";
import { buildPage2Content } from "./dsmAnalysisHtmlBuilder.js";

const SHARED_CSS = `
  @page { size: A4; margin: 12mm; }
  :root { --ink: #111; --muted: #6b7280; --brand: #C39847; --bg: #fff; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; color: var(--ink); background: var(--bg); }
  .page { padding: 12px; page-break-after: always; min-height: 250mm; }
  .page:last-child { page-break-after: auto; }
  .page-header { margin-bottom: 12px; border-bottom: 2px solid var(--brand); padding-bottom: 8px; }
  .page-header h1 { margin: 0 0 4px; font-size: 18px; font-weight: 700; }
  .page-header .subtitle { font-size: 12px; color: var(--muted); }
  .page-intro { font-size: 11px; color: var(--muted); line-height: 1.45; margin: 0 0 10px; }
  .diagram-block { width: 100%; margin: 12px 0; background: #f8f9fa; border-radius: 8px; overflow: hidden; }
  .polar-diagram { width: 100%; height: auto; max-height: 260px; display: block; }
  .diagram-placeholder { padding: 40px; text-align: center; color: var(--muted); }
  .info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 16px; margin: 12px 0; font-size: 11px; }
  .info-item { display: flex; flex-direction: column; gap: 2px; }
  .info-item .label { color: var(--muted); font-size: 10px; text-transform: uppercase; }
  .info-item .value { font-weight: 600; }
  .legend-block { margin-top: 12px; font-size: 11px; }
  .legend-title { font-weight: 700; margin-bottom: 4px; }
  .legend-curves, .legend-horizon { color: var(--muted); }
  .legend-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 2px; vertical-align: middle; }
  .heatmap-block { width: 100%; margin: 12px 0; background: #f8f9fa; border-radius: 8px; overflow: hidden; }
  .heatmap-svg { width: 100%; height: auto; max-height: 220px; display: block; }
  .heatmap-placeholder { padding: 40px; text-align: center; color: var(--muted); }
  .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin: 12px 0; }
  .stat-card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; }
  .stat-label { font-size: 10px; color: var(--muted); text-transform: uppercase; }
  .stat-value { font-size: 14px; font-weight: 700; }
  .stat-hint { font-size: 9px; color: var(--muted); line-height: 1.35; margin-top: 5px; }
  .top-panels { margin: 12px 0; }
  .top-panels h3 { font-size: 12px; margin: 0 0 6px; }
  .top-panels-note { margin: 0 0 8px; font-size: 10px; }
  .page-heatmap-note { margin: 8px 0 12px; font-size: 10px; }
  table.panels { width: 100%; border-collapse: collapse; font-size: 11px; }
  table.panels th, table.panels td { padding: 5px 8px; text-align: left; border-bottom: 1px solid #e5e7eb; }
  table.panels th { color: var(--muted); font-weight: 600; }
  .legend { margin-top: 12px; display: flex; gap: 12px; flex-wrap: wrap; align-items: center; font-size: 11px; }
  .legend-item { display: flex; align-items: center; gap: 6px; }
  .legend-color { width: 18px; height: 12px; border-radius: 3px; }
`;

/**
 * Construit le HTML complet 2 pages pour le PDF.
 */
export function buildDsmCombinedHtml(data) {
  const page1 = buildHorizonMaskPageHtml(data);
  const page2 = buildPage2Content(data);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <title>Analyse d'ombrage – Étude SolarNext</title>
  <style>${SHARED_CSS}</style>
</head>
<body>
  ${page1}
  ${page2}
</body>
</html>`;
}
