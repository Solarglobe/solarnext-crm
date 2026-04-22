/**
 * HTML imprimable A4 — plan (image optionnelle), cadre 3D, tableaux énergie + BOM.
 */

import type { RoofOutputsBundleV1 } from "./roofModelOutputsV1Types";

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type CalpinageOutputsV1HtmlContext = Readonly<{
  /** Data URL PNG plan si disponible (sinon placeholder). */
  planImageDataUrl?: string | null;
  /** Capture Three.js ou screenshot outil 3D. */
  view3dImageDataUrl?: string | null;
}>;

export function buildCalpinageOutputsV1Html(bundle: RoofOutputsBundleV1, ctx: CalpinageOutputsV1HtmlContext = {}): string {
  const planSrc = ctx.planImageDataUrl ?? bundle.pdf.view3dImageDataUrl ?? "";
  const view3d = ctx.view3dImageDataUrl ?? bundle.pdf.view3dImageDataUrl ?? "";

  const energyRows = `
    <tr><td>Puissance totale</td><td>${esc(String(bundle.energy.totalPowerKwc.toFixed(3)))} kWc</td></tr>
    <tr><td>Nombre de modules</td><td>${esc(String(bundle.energy.panelCount))}</td></tr>
    <tr><td>Production annuelle (estim.)</td><td>${
      bundle.energy.annualProductionKwhAc != null
        ? esc(String(Math.round(bundle.energy.annualProductionKwhAc))) + " kWh/an"
        : "—"
    }</td></tr>
    <tr><td>Rendement spécifique</td><td>${
      bundle.energy.specificYieldKwhPerKwc != null
        ? esc(String(Math.round(bundle.energy.specificYieldKwhPerKwc))) + " kWh/kWc/an"
        : "—"
    }</td></tr>
    <tr><td>Pertes ombrage (si connues)</td><td>${
      bundle.energy.totalLossPct != null ? esc(String(bundle.energy.totalLossPct)) + " %" : "—"
    }</td></tr>
    <tr><td>Source production</td><td>${esc(bundle.energy.source)}</td></tr>
  `;

  const bomRows = bundle.bom.items
    .map(
      (it) =>
        `<tr><td>${esc(it.code)}</td><td>${esc(it.label)}</td><td>${esc(String(it.quantity))}</td><td>${esc(it.unit)}</td></tr>`,
    )
    .join("");

  const assumptions = bundle.bom.assumptions.map((a) => `<li>${esc(a)}</li>`).join("");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <title>${esc(bundle.pdf.title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; font-size: 11pt; color: #111; margin: 0; padding: 12mm; }
    h1 { font-size: 16pt; margin: 0 0 4mm; }
    h2 { font-size: 12pt; margin: 8mm 0 3mm; border-bottom: 1px solid #ccc; padding-bottom: 2mm; }
    .page-break { page-break-after: always; }
    .img-box { border: 1px solid #ddd; min-height: 120mm; display: flex; align-items: center; justify-content: center; background: #fafafa; }
    .img-box img { max-width: 100%; max-height: 115mm; object-fit: contain; }
    table { width: 100%; border-collapse: collapse; margin-top: 2mm; }
    th, td { border: 1px solid #ddd; padding: 2mm 3mm; text-align: left; }
    th { background: #f0f0f0; }
    .muted { color: #555; font-size: 9pt; margin-top: 2mm; }
    ul { margin: 2mm 0 0 5mm; }
  </style>
</head>
<body>
  <h1>${esc(bundle.pdf.title)}</h1>
  ${bundle.pdf.subtitle ? `<p class="muted">${esc(bundle.pdf.subtitle)}</p>` : ""}
  <p class="muted">Généré le ${esc(bundle.updatedAtIso)} — document interne / chiffrage indicatif.</p>

  <h2>1. Plan de pose (snapshot)</h2>
  <div class="img-box">
    ${
      planSrc
        ? `<img src="${planSrc}" alt="Plan"/>`
        : `<span class="muted">Aucune image — lancer la capture layout (layout_snapshot) ou coller une data URL.</span>`
    }
  </div>

  <div class="page-break"></div>

  <h2>2. Vue 3D (référence)</h2>
  <div class="img-box">
    ${
      view3d
        ? `<img src="${view3d}" alt="Vue 3D"/>`
        : `<span class="muted">Capture 3D optionnelle — exporter depuis le viewer canonique ou joindre une image ultérieurement.</span>`
    }
  </div>

  <div class="page-break"></div>

  <h2>3. Synthèse énergétique</h2>
  <table>
    <thead><tr><th>Indicateur</th><th>Valeur</th></tr></thead>
    <tbody>${energyRows}</tbody>
  </table>

  <h2>4. BOM — Rails &amp; fixations (estimation)</h2>
  <p class="muted">Linéaire rail total ≈ ${esc(String(bundle.bom.totalRailLinearM))} m · Équivalent barres de ${esc("5,8")} m : ${esc(
    String(bundle.bom.railStockPiecesOf5m8),
  )} pièces.</p>
  <table>
    <thead><tr><th>Code</th><th>Désignation</th><th>Qté</th><th>Unité</th></tr></thead>
    <tbody>${bomRows}</tbody>
  </table>
  <h2>Hypothèses</h2>
  <ul>${assumptions}</ul>
</body>
</html>`;
}
