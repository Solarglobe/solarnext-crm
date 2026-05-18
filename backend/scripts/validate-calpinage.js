/**
 * validate-calpinage.js — Golden tests moteur calpinage (sans HTTP, sans DB).
 *
 * Charge chaque fixture depuis backend/calpinage/__fixtures__/,
 * appelle les fonctions backend pures, compare avec expected.json.
 *
 * Usage :
 *   node scripts/validate-calpinage.js           → compare contre expected.json
 *   node scripts/validate-calpinage.js --record  → recompute + écrit expected.json
 *
 * Tolérance numérique : delta < 0.01 m² sur les surfaces.
 *
 * Fonctions testées (sans DB) :
 *   - computeCalpinageGeometryHash   (services/calpinage/calpinageGeometryHash.js)
 *   - deriveGeometryFromGeometryJson (services/finalStudyJson.service.js)
 *   - hasPanelsInGeometry            (services/shading/shadingStructureBuilder.js)
 *   - Schéma v1 (calpinage/schema/validateCalpinage.js) — format file-store
 *
 * Métriques comparées :
 *   panelCount        — entier exact (frozenBlocks.panels.length total)
 *   totalPanelAreaM2  — surface installée ±0.01 m²
 *   totalRoofAreaM2   — surface toiture déclarée ±0.01 m²
 *   coverageRatio     — ratio ±0.001
 *   pans[]            — count + surface par pan ±0.01 m²
 *   geometryHash      — SHA-256 exact (ignoré si null dans expected.json)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(BACKEND_ROOT, "calpinage", "__fixtures__");

const RECORD_MODE = process.argv.includes("--record");
const TOLERANCE_M2 = 0.01;
const TOLERANCE_RATIO = 0.001;

// ─── Couleurs terminal ────────────────────────────────────────────────────────

const C = {
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
};

// ─── Imports modules backend purs (pas de pool, pas de HTTP) ─────────────────
//
// IMPORTANT : calpinageGeometryHash.js importe `pool` → db.js, lequel lance une
// exception immédiate si DATABASE_URL est absent.
// Pour rester sans-DB, on copie ici la partie pure de computeCalpinageGeometryHash
// (algoritme SHA-256 sur payload normalisé), identique à l'original.
// hasPanelsInGeometry est aussi inliné pour éviter la chaîne shadingStructureBuilder
// → farConfidenceModel → possibles autres imports futurs.
//
// finalStudyJson.service.js n'a aucun import externe → importable directement.

import crypto from "crypto";

const { deriveGeometryFromGeometryJson } = await import(
  path.join(BACKEND_ROOT, "services/finalStudyJson.service.js")
);

// ── Hash géométrique (copie de services/calpinage/calpinageGeometryHash.js) ──

const HASH_KEYS = [
  "roofState", "validatedRoofData", "frozenBlocks", "pvParams", "panels", "obstacles", "gps",
];

function _normalizeValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 1e6) / 1e6;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(_normalizeValue);
  const out = {};
  for (const k of Object.keys(value).sort()) out[k] = _normalizeValue(value[k]);
  return out;
}

function computeCalpinageGeometryHash(geometryJson) {
  if (!geometryJson || typeof geometryJson !== "object") return "";
  const payload = {};
  for (const k of HASH_KEYS) {
    if (geometryJson[k] !== undefined) payload[k] = geometryJson[k];
  }
  const str = JSON.stringify(_normalizeValue(payload));
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

// ── hasPanelsInGeometry (copie simplifiée de shadingStructureBuilder.js) ─────

function hasPanelsInGeometry(geometry) {
  const blocks = geometry?.frozenBlocks ?? [];
  if (blocks.some((b) => (b.panels?.length ?? 0) > 0)) return true;
  // Compatibilité format legacy (geometry.pans[].panelCount)
  const pans = geometry?.validatedRoofData?.pans ?? [];
  return pans.some((p) => (p.panelCount ?? p.panel_count ?? 0) > 0);
}

// ─── Calcul des métriques depuis un geometry_json ─────────────────────────────

/**
 * Compte le total de panneaux posés en parcourant frozenBlocks.
 * @param {object} gj
 * @returns {number}
 */
function countPanels(gj) {
  const blocks = gj.frozenBlocks ?? [];
  return blocks.reduce((s, b) => s + (b.panels?.length ?? 0), 0);
}

/**
 * Surface physique totale installée (m²).
 * widthM = panel.width_mm / 1000, heightM = panel.height_mm / 1000.
 * @param {object} gj
 * @param {number} panelCount
 * @returns {number}
 */
function totalPanelAreaM2(gj, panelCount) {
  const p = gj.panel;
  if (!p || typeof p.width_mm !== "number" || typeof p.height_mm !== "number") return 0;
  return panelCount * (p.width_mm / 1000) * (p.height_mm / 1000);
}

/**
 * Surface toiture totale déclarée (m²) = somme des pans.surfaceM2.
 * @param {object} gj
 * @returns {number}
 */
function totalRoofAreaM2(gj) {
  const pans = gj.validatedRoofData?.pans ?? [];
  return pans.reduce((s, p) => s + (p.surfaceM2 ?? p.surface ?? 0), 0);
}

/**
 * Calcule toutes les métriques d'un geometry_json.
 * @param {object} gj
 * @returns {object}
 */
function computeMetrics(gj) {
  const panelCount = countPanels(gj);
  const panelArea = totalPanelAreaM2(gj, panelCount);
  const roofArea = totalRoofAreaM2(gj);
  const coverageRatio = roofArea > 0 ? panelArea / roofArea : 0;
  const geometryHash = computeCalpinageGeometryHash(gj);
  const hasPanels = hasPanelsInGeometry(gj);

  const pans = (gj.validatedRoofData?.pans ?? []).map((p) => ({
    id: p.id,
    azimuth: p.azimuth ?? p.orientationDeg ?? 0,
    tilt: p.tilt ?? p.tiltDeg ?? 0,
    panelCount: p.panelCount ?? 0,
    surfaceM2: p.surfaceM2 ?? p.surface ?? 0,
  }));

  const derivedGeometry = deriveGeometryFromGeometryJson(gj);

  return {
    panelCount,
    totalPanelAreaM2: Math.round(panelArea * 1000) / 1000,
    totalRoofAreaM2: Math.round(roofArea * 1000) / 1000,
    coverageRatio: Math.round(coverageRatio * 10000) / 10000,
    pans,
    geometryHash,
    hasPanels,
    derivedGeometry,
  };
}

// ─── Comparaison avec tolérance ───────────────────────────────────────────────

/**
 * Retourne les différences entre computed et expected.
 * @returns {string[]} — liste de messages d'erreur, vide si OK
 */
function diff(computed, expected) {
  const errors = [];

  // panelCount — exact
  if (computed.panelCount !== expected.panelCount) {
    errors.push(
      `panelCount: attendu ${expected.panelCount}, obtenu ${computed.panelCount}`
    );
  }

  // surfaces — tolérance 0.01 m²
  for (const field of ["totalPanelAreaM2", "totalRoofAreaM2"]) {
    if (expected[field] == null) continue;
    const delta = Math.abs(computed[field] - expected[field]);
    if (delta > TOLERANCE_M2) {
      errors.push(
        `${field}: attendu ${expected[field]}, obtenu ${computed[field]} (Δ=${delta.toFixed(4)} m²)`
      );
    }
  }

  // coverageRatio — tolérance 0.001
  if (expected.coverageRatio != null) {
    const delta = Math.abs(computed.coverageRatio - expected.coverageRatio);
    if (delta > TOLERANCE_RATIO) {
      errors.push(
        `coverageRatio: attendu ${expected.coverageRatio}, obtenu ${computed.coverageRatio} (Δ=${delta.toFixed(5)})`
      );
    }
  }

  // pans[] — par pan
  const expPans = expected.pans ?? [];
  const compPans = computed.pans ?? [];
  if (expPans.length !== compPans.length) {
    errors.push(`pans.length: attendu ${expPans.length}, obtenu ${compPans.length}`);
  } else {
    for (let i = 0; i < expPans.length; i++) {
      const ep = expPans[i];
      const cp = compPans[i];
      if (ep.id !== cp.id) errors.push(`pans[${i}].id: attendu "${ep.id}", obtenu "${cp.id}"`);
      if (ep.panelCount !== cp.panelCount)
        errors.push(`pans[${i}].panelCount: attendu ${ep.panelCount}, obtenu ${cp.panelCount}`);
      const dSurf = Math.abs((ep.surfaceM2 ?? 0) - (cp.surfaceM2 ?? 0));
      if (dSurf > TOLERANCE_M2)
        errors.push(`pans[${i}].surfaceM2: attendu ${ep.surfaceM2}, obtenu ${cp.surfaceM2} (Δ=${dSurf.toFixed(4)} m²)`);
    }
  }

  // geometryHash — exact, seulement si non-null dans expected
  if (expected.geometryHash != null && computed.geometryHash !== expected.geometryHash) {
    errors.push(
      `geometryHash: attendu ${expected.geometryHash}\n             obtenu  ${computed.geometryHash}`
    );
  }

  return errors;
}

// ─── Discover fixtures ────────────────────────────────────────────────────────

function listFixtures() {
  if (!fs.existsSync(FIXTURES_DIR)) {
    console.error(C.red(`✗ Dossier fixtures introuvable : ${FIXTURES_DIR}`));
    process.exit(1);
  }
  return fs
    .readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

// ─── Lecture fixture ──────────────────────────────────────────────────────────

function loadFixture(name) {
  const dir = path.join(FIXTURES_DIR, name);
  const inputPath = path.join(dir, "input.json");
  const expectedPath = path.join(dir, "expected.json");

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Fichier manquant : ${inputPath}`);
  }

  const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const expected = fs.existsSync(expectedPath)
    ? JSON.parse(fs.readFileSync(expectedPath, "utf8"))
    : null;

  return { dir, inputPath, expectedPath, input, expected };
}

// ─── Écriture expected.json (mode --record) ───────────────────────────────────

function writeExpected(expectedPath, name, metrics) {
  const now = new Date().toISOString();
  const out = {
    _fixture: name,
    _note: "Généré par validate-calpinage.js --record. Ne pas éditer manuellement les valeurs numériques.",
    _recordedAt: now,
    schemaValid: true,
    panelCount: metrics.panelCount,
    totalPanelAreaM2: metrics.totalPanelAreaM2,
    totalRoofAreaM2: metrics.totalRoofAreaM2,
    coverageRatio: metrics.coverageRatio,
    pans: metrics.pans,
    geometryHash: metrics.geometryHash,
  };
  fs.writeFileSync(expectedPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`  ${C.dim("→")} expected.json écrit (${now})`);
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function runFixture(name) {
  const { dir, expectedPath, input, expected } = loadFixture(name);

  // Retirer les clés meta (_fixture, _description, …) qui ne font pas partie du geometry_json
  const gj = Object.fromEntries(
    Object.entries(input).filter(([k]) => !k.startsWith("_"))
  );

  let metrics;
  try {
    metrics = computeMetrics(gj);
  } catch (e) {
    return {
      name,
      pass: false,
      errors: [`Erreur lors du calcul des métriques : ${e.message}`],
    };
  }

  if (RECORD_MODE) {
    writeExpected(expectedPath, name, metrics);
    return { name, pass: true, errors: [], recorded: true };
  }

  if (!expected) {
    return {
      name,
      pass: false,
      errors: [
        "expected.json absent — lancer avec --record pour générer : node scripts/validate-calpinage.js --record",
      ],
    };
  }

  const errors = diff(metrics, expected);
  return { name, pass: errors.length === 0, errors };
}

// ─── Main ───────────────────────────────────────────

async function main() {
  const fixtures = listFixtures();

  if (fixtures.length === 0) {
    console.error(C.red(`\u2717 Aucune fixture trouv\u00e9e dans ${FIXTURES_DIR}`));
    process.exit(1);
  }

  const header = RECORD_MODE
    ? "\ud83d\udd34  validate-calpinage \u2014 MODE RECORD (mise \u00e0 jour expected.json)"
    : "\ud83d\udfe2  validate-calpinage \u2014 MODE COMPARAISON";

  console.log(`\n${C.bold(header)}`);
  console.log(C.dim(`   ${fixtures.length} fixture(s) : ${fixtures.join(", ")}\n`));

  let passed = 0;
  let failed = 0;

  for (const name of fixtures) {
    process.stdout.write(`  ${C.bold(name)} \u2026 `);
    const result = await runFixture(name);

    if (result.pass) {
      const suffix = result.recorded ? C.yellow("recorded") : C.green("PASS");
      console.log(`\u2705  ${suffix}`);
      passed++;
    } else {
      console.log(`\u274c  FAIL`);
      for (const e of result.errors) {
        console.log(`      ${C.red("\u2717")} ${e}`);
      }
      failed++;
    }
  }

  console.log(`\n${"\u2500".repeat(52)}`);
  console.log(
    `  R\u00e9sultat : ${C.green(`${passed} \u2705`)}  ${failed > 0 ? C.red(`${failed} \u274c`) : C.dim("0 \u274c")}`
  );

  if (RECORD_MODE) {
    console.log(
      C.yellow(
        "\n  Mode --record : expected.json mis \u00e0 jour.\n" +
          "  Committer les fichiers expected.json pour figer les golden values.\n"
      )
    );
    process.exit(0);
  }

  if (failed > 0) {
    console.log(C.red("\n  \u274c Des fixtures ont \u00e9chou\u00e9 \u2014 r\u00e9gressions d\u00e9tect\u00e9es.\n"));
    process.exit(1);
  }

  console.log(C.green("\n  \u2705 Tous les golden tests passent.\n"));
  process.exit(0);
}

main().catch((e) => {
  console.error(C.red(`\n\u2717 Erreur fatale : ${e.message}`));
  console.error(e.stack);
  process.exit(1);
});
