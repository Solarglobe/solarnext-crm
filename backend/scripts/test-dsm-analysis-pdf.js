/**
 * CP-DSM-PDF-004/005 — Tests export PDF Analyse Ombres (2 pages)
 * Usage: cd backend && node scripts/test-dsm-analysis-pdf.js
 *
 * Vérifie :
 * - PDF existe, taille > 50 KB
 * - Contient "Analyse d'ombrage"
 * - Contient "Masque d'horizon" (page 1)
 * - Contient "Impact global estimé" (page 2)
 * - Aucun "undefined" / "NaN"
 * - Stable sur 3 runs
 */

import { buildDsmCombinedHtml } from "../pdf/dsmCombinedHtmlBuilder.js";
import { generateDsmAnalysisPDF } from "../pdf/playwright-dsm-analysis.js";

const RUNS = 3;
const MIN_SIZE_KB = 50;

const mockHorizonMask = [];
for (let i = 0; i <= 360; i += 10) {
  const elev = 5 + 15 * Math.sin((i * Math.PI) / 180) * Math.cos(((i - 180) * Math.PI) / 180);
  mockHorizonMask.push({ az: i, elev: Math.max(0, Math.min(50, elev)) });
}

const mockData = {
  address: "12 rue Example, 75001 Paris",
  date: "24 février 2025",
  lat: 48.8566,
  lon: 2.3522,
  orientationDeg: 180,
  tiltDeg: 30,
  horizonMask: { mask: mockHorizonMask, source: "RELIEF_ONLY" },
  horizonMeta: { source: "RELIEF_ONLY", confidence: 0.85 },
  installation: {
    shading_loss_pct: 8.5,
    shading: {},
  },
  geometry: {
    frozenBlocks: [
      {
        panels: [
          { id: "P1", polygonPx: [{ x: 50, y: 50 }, { x: 80, y: 50 }, { x: 80, y: 80 }, { x: 50, y: 80 }] },
          { id: "P2", polygonPx: [{ x: 90, y: 50 }, { x: 120, y: 50 }, { x: 120, y: 80 }, { x: 90, y: 80 }] },
          { id: "P3", polygonPx: [{ x: 130, y: 50 }, { x: 160, y: 50 }, { x: 160, y: 80 }, { x: 130, y: 80 }] },
          { id: "P7", polygonPx: [{ x: 170, y: 50 }, { x: 200, y: 50 }, { x: 200, y: 80 }, { x: 170, y: 80 }] },
        ],
      },
    ],
  },
  shading: {
    near: { totalLossPct: 4.2 },
    far: { totalLossPct: 3.1 },
    combined: { totalLossPct: 8.5 },
    shadingQuality: { score: 82, grade: "B" },
    perPanel: [
      { panelId: "P1", lossPct: 2.1 },
      { panelId: "P2", lossPct: 5.5 },
      { panelId: "P3", lossPct: 12.88 },
      { panelId: "P7", lossPct: 14.32 },
    ],
  },
};

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function runTest(runIndex) {
  const html = buildDsmCombinedHtml(mockData);

  assert(html.length > 0, "HTML non vide");
  assert(!html.includes("undefined"), "Aucun 'undefined' dans HTML");
  assert(!html.includes("NaN"), "Aucun 'NaN' dans HTML");
  assert(html.includes("Analyse d'ombrage"), "Titre présent");
  assert(html.includes("Masque d'horizon"), "Page 1 (Masque d'horizon) présente");
  assert(html.includes("Impact global estimé"), "Page 2 (impact global) présente");
  assert(html.includes("82"), "Score présent");
  assert(html.includes("8.5"), "TotalLoss présent");
  assert(html.includes("P7"), "perPanel utilisé");

  const pdfBuffer = await generateDsmAnalysisPDF(html);

  assert(Buffer.isBuffer(pdfBuffer), "PDF est un Buffer");
  assert(pdfBuffer.length > MIN_SIZE_KB * 1024, `PDF taille > ${MIN_SIZE_KB} KB`);
  assert(pdfBuffer[0] === 0x25 && pdfBuffer[1] === 0x50, "PDF valide (magic %P)");

  return pdfBuffer.length;
}

(async () => {
  console.log("CP-DSM-PDF-005 — Tests export PDF 2 pages (Masque Horizon + Analyse)\n");

  const sizes = [];
  for (let i = 0; i < RUNS; i++) {
    process.stdout.write(`  Run ${i + 1}/${RUNS}... `);
    const size = await runTest(i);
    sizes.push(size);
    console.log(`OK (${Math.round(size / 1024)} KB)`);
  }

  const min = Math.min(...sizes);
  const max = Math.max(...sizes);
  const stable = max - min < 5000;
  assert(stable, `Stable sur ${RUNS} runs : écart ${max - min} octets`);

  console.log("\n✅ PASS");
  console.log(`   PDF stable sur ${RUNS} runs (écart ${max - min} octets).`);
})().catch((err) => {
  console.error("\n❌ Échec:", err.message);
  process.exit(1);
});
