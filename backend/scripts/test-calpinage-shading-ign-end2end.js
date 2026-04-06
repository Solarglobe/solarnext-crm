/**
 * CP-FAR-IGN-04 — Test end-to-end calpinage shading avec IGN RGE ALTI.
 * Vérifie far.source = IGN_RGE_ALTI, totalLossPct cohérent, monthly si présent.
 * Exit 0 si PASS, 1 sinon.
 */

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { computeCalpinageShading } from "../services/shading/calpinageShading.service.js";
import { buildStructuredShading, hasPanelsInGeometry } from "../services/shading/shadingStructureBuilder.js";
import { normalizeCalpinageShading } from "../services/calpinage/calpinageShadingNormalizer.js";
import { getIgnDsmDataDir } from "../services/horizon/providers/ign/ignRgeAltiConfig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LAT = 48.8566;
const LON = 2.3522;
const TOL_LOSS = 0.5;
const TOL_ANNUAL = 0.02;

process.env.HORIZON_DSM_ENABLED = "true";
process.env.DSM_ENABLE = "true";
process.env.DSM_PROVIDER_TYPE = "IGN_RGE_ALTI";

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

async function ensureIndexBboxes() {
  const dataDir = getIgnDsmDataDir();
  const indexPath = path.join(dataDir, "index.json");
  if (!fs.existsSync(indexPath)) {
    console.error("FAIL: index.json absent. Exécuter: npm run build-ign-index-bboxes");
    process.exit(1);
  }
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  if (index.tiles && index.tiles.length > 0 && index.tiles[0].bboxLambert93) return index;
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, "build-ign-index-bboxes.js")], {
      cwd: path.join(__dirname, ".."),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`build-ign-index-bboxes exit ${code}: ${err}`));
    });
  });
  return JSON.parse(fs.readFileSync(indexPath, "utf8"));
}

const panel = {
  id: "p1",
  polygon: [
    { x: 50, y: 50 },
    { x: 60, y: 50 },
    { x: 60, y: 60 },
    { x: 50, y: 60 },
  ],
};

async function main() {
  await ensureIndexBboxes();

  const result = await computeCalpinageShading({
    lat: LAT,
    lon: LON,
    panels: [panel],
    obstacles: [],
    options: { __testReturnMonthly: true },
  });

  assert(result != null, "computeCalpinageShading result non null");
  assert(typeof result.farLossPct === "number", "farLossPct number");
  assert(result.farLossPct >= 0, "farLossPct >= 0");
  if (result.farLossPct > 0) {
    console.log("farLossPct:", result.farLossPct.toFixed(3));
  }

  const provider = result.farMetadata?.dataCoverage?.provider ?? result.farMetadata?.source;
  assert(provider === "IGN_RGE_ALTI", `horizonMask provider = IGN_RGE_ALTI, got ${provider}`);

  const geometry = { frozenBlocks: [{ panels: [panel] }] };
  const hasPanels = hasPanelsInGeometry(geometry);
  const rawShading = buildStructuredShading(result, true, hasPanels, {});
  assert(rawShading.far?.source === "IGN_RGE_ALTI", `structured far.source = IGN_RGE_ALTI, got ${rawShading.far?.source}`);

  const meta = result.farMetadata
    ? { step_deg: result.farMetadata.step_deg, resolution_m: result.farMetadata.resolution_m, algorithm: result.farMetadata.meta?.algorithm }
    : {};
  const normalized = normalizeCalpinageShading(rawShading, meta);
  assert(normalized.far?.source === "IGN_RGE_ALTI", `normalized far.source = IGN_RGE_ALTI, got ${normalized.far?.source}`);

  const totalLossPct = result.totalLossPct;
  const combinedTotal = rawShading.combined?.totalLossPct ?? rawShading.totalLossPct;
  assert(Math.abs(combinedTotal - totalLossPct) <= TOL_LOSS, `combined.totalLossPct ≈ totalLossPct (diff <= ${TOL_LOSS}), got ${combinedTotal} vs ${totalLossPct}`);

  if (result.__testMonthly && result.__testMonthly.monthlyBaselineEnergy && result.__testMonthly.monthlyFarNearEnergy) {
    const baseline = result.__testMonthly.monthlyBaselineEnergy.reduce((a, b) => a + b, 0);
    const after = result.__testMonthly.monthlyFarNearEnergy.reduce((a, b) => a + b, 0);
    const expectedAfter = baseline * (1 - totalLossPct / 100);
    const ratio = baseline > 0 ? after / baseline : 0;
    const expectedRatio = 1 - totalLossPct / 100;
    assert(
      Math.abs(ratio - expectedRatio) <= TOL_ANNUAL,
      `monthly: annualAfter/baseline ≈ (1-totalLossPct/100), got ${ratio.toFixed(4)} vs expected ${expectedRatio.toFixed(4)}`
    );
  }

  console.log("");
  console.log("CP-FAR-IGN-04 PASS");
  console.log("FAR SOURCE: IGN_RGE_ALTI");
  console.log("TOTAL LOSS:", totalLossPct.toFixed(3));
  console.log("VERDICT: 🟢 PASS");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
