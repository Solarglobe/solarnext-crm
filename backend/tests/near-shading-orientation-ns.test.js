/**
 * NEAR-NS-FIX — Régression orientation Nord/Sud du raycast near.
 *
 * Le raycast near travaille en pixels image (polygonPx, +y = bas = Sud sur capture nord-up),
 * mais les vecteurs soleil sont géographiques (dy = Nord). geoSunDirToImagePixelDir convertit
 * l'un vers l'autre. Sans cette conversion, l'axe Nord/Sud était inversé : un obstacle au SUD
 * (qui ombre réellement dans l'hémisphère nord) était ignoré et un obstacle au NORD comptait à tort.
 *
 * Script node autonome (même style que near-shading-physics-invariants.test.js).
 */
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { geoSunDirToImagePixelDir, readNorthAngleDeg } from "../services/shading/calpinageShading.service.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nearShadingCore = require(path.join(__dirname, "../../shared/shading/nearShadingCore.cjs"));
const { computeNearShading, computeSunVector } = nearShadingCore;

let passed = 0, failed = 0;
const ok = (l) => { console.log("✅ " + l); passed++; };
const ko = (l, m) => { console.log("❌ " + l + " — " + m); failed++; };

// Panneau ~20x10 px autour de (100,100). Obstacles 5 m, mpp 0.1 (ombre longue).
const panel = { id: "P1", polygonPx: [{x:90,y:95},{x:110,y:95},{x:110,y:105},{x:90,y:105}] };
const obsSouth = { id: "south", polygonPx: [{x:85,y:175},{x:115,y:175},{x:115,y:195},{x:85,y:195}], heightM: 5 };
const obsNorth = { id: "north", polygonPx: [{x:85,y:5},{x:115,y:5},{x:115,y:25},{x:85,y:25}], heightM: 5 };
const mpp = 0.1;

// Soleil plein Sud (azimut 180), élévation 30° — hémisphère nord.
const sunGeo = computeSunVector(180, 30);
const sunPx = geoSunDirToImagePixelDir(sunGeo, 0); // capture nord-up

const lossSouth = computeNearShading({ panels:[panel], obstacles:[obsSouth], sunVectors:[sunPx], useZLocal:false, metersPerPixel:mpp }).totalLossPct;
const lossNorth = computeNearShading({ panels:[panel], obstacles:[obsNorth], sunVectors:[sunPx], useZLocal:false, metersPerPixel:mpp }).totalLossPct;

if (lossSouth > 50) ok(`obstacle SUD ombre le panneau (loss=${lossSouth.toFixed(1)}%)`);
else ko("obstacle SUD devrait ombrer", `loss=${lossSouth.toFixed(1)}%`);

if (lossNorth < 1) ok(`obstacle NORD n'ombre pas (loss=${lossNorth.toFixed(1)}%)`);
else ko("obstacle NORD ne devrait pas ombrer", `loss=${lossNorth.toFixed(1)}%`);

// Sans conversion (bug historique) : l'inverse doit se produire — garde-fou anti-régression.
const lossSouthRaw = computeNearShading({ panels:[panel], obstacles:[obsSouth], sunVectors:[sunGeo], useZLocal:false, metersPerPixel:mpp }).totalLossPct;
if (lossSouthRaw < 1) ok("garde-fou : vecteur géo brut ignore l'obstacle sud (prouve l'inversion d'origine)");
else ko("garde-fou inversion", `attendu ~0 avec vecteur brut, obtenu ${lossSouthRaw.toFixed(1)}%`);

// readNorthAngleDeg : lectures défensives
if (readNorthAngleDeg(null) === 0) ok("readNorthAngleDeg(null) = 0");
else ko("readNorthAngleDeg(null)", "≠ 0");
if (readNorthAngleDeg({ roofState: { north: { angleDeg: 12 } } }) === 12) ok("readNorthAngleDeg lit roofState.north.angleDeg");
else ko("readNorthAngleDeg roofState.north", "≠ 12");

console.log(`\n--- RÉSUMÉ NS ---\nPassed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
