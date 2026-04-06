/**
 * Garde-fous : libellés et microcopy PDF Analyse d'ombrage (parcours client).
 * Aucun calcul — vérifie la présence des formulations commerciales stables.
 * Enchaîné par npm run test:shading:lock
 */

import assert from "assert";
import { buildPage2Content, buildDsmShadingPdfIntroHtml, buildDsmAnalysisHtml } from "../pdf/dsmAnalysisHtmlBuilder.js";

const minimalData = {
  address: "1 rue Test",
  date: "2026-03-30",
  installation: {},
  geometry: { frozenBlocks: [] },
  shading: {
    near: { totalLossPct: 2 },
    far: { totalLossPct: 1.5 },
    combined: { totalLossPct: 3.2 },
    perPanel: [],
    shadingQuality: { score: 70, grade: "B" },
  },
};

function testPage2HasCommercialLabels() {
  const html = buildPage2Content(minimalData);
  assert.ok(html.includes("Impact global estimé"), "carte KPI : impact global");
  assert.ok(html.includes("Obstacles à proximité"), "carte KPI : proche");
  assert.ok(html.includes("Relief / horizon lointain"), "carte KPI : lointain");
  assert.ok(html.includes("Score d’exposition estimé"), "carte KPI : score exposition (honnête vs indice générique)");
  assert.ok(html.includes("Modules les plus exposés"), "titre tableau modules");
  assert.ok(html.includes("Perte modélisée (estim.)"), "colonne tableau : perte modélisée");
  assert.ok(html.includes("Lecture en trois niveaux"), "pédagogie near / far / global");
  assert.ok(html.includes("synthèse officielle"), "lien sémantique devis / PDF");
  assert.ok(html.includes("modèle logiciel"), "intro : nature estimation");
}

function testIntroHelperExported() {
  const intro = buildDsmShadingPdfIntroHtml();
  assert.ok(intro.includes('class="page-intro"'));
  assert.ok(intro.includes("non nulle est courante"));
}

function testStandaloneHtmlIncludesHints() {
  const full = buildDsmAnalysisHtml(minimalData);
  assert.ok(full.includes(".stat-hint"), "styles stat-hint présents");
  assert.ok(full.includes("Synthèse retenue par l’étude"), "microcopy sous KPI global (transparence)");
  assert.ok(full.includes("repère visuel"), "note heatmap : pas mesure ponctuelle");
}

testPage2HasCommercialLabels();
testIntroHelperExported();
testStandaloneHtmlIncludesHints();

console.log("\n--- dsm-pdf-commercial-copy OK ---\n");
