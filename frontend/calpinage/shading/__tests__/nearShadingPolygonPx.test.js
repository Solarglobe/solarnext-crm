/**
 * Test near shading avec géométrie polygonPx (format envoyé par le frontend).
 * Vérifie que panneaux et obstacles en polygonPx sont bien pris en compte.
 *
 * Scénario : 1 panneau (rectangle polygonPx), 1 obstacle 3 m au sud (polygonPx + heightM = 3)
 * => nearLossPct > 0 (au moins une perte détectée).
 */
const { test } = require("node:test");
const assert = require("node:assert");
const { computeAnnualShadingLoss } = require("../shadingEngine.js");

test("1 panneau polygonPx + 1 obstacle polygonPx 3m au sud → perte near > 0", function () {
  // Convention moteur : x=Est, y=Nord. Azimuth 0°=Nord (dy>0), 180°=Sud (dy<0).
  // Obstacle "au sud" du panneau = plus petit y. Soleil au sud (180°) → rayon (0,-1) depuis le panneau → on croise l'obstacle.
  var panel = {
    id: "p1",
    polygonPx: [
      { x: 100, y: 160 },
      { x: 200, y: 160 },
      { x: 200, y: 220 },
      { x: 100, y: 220 },
    ],
  };
  var obstacle = {
    id: "obs1",
    polygonPx: [
      { x: 100, y: 80 },
      { x: 200, y: 80 },
      { x: 200, y: 130 },
      { x: 100, y: 130 },
    ],
    heightM: 3,
  };

  var result = computeAnnualShadingLoss({
    latDeg: 48.8566,
    lonDeg: 2.3522,
    panels: [panel],
    obstacles: [obstacle],
    roofPans: [],
    config: { year: 2026, stepMinutes: 60, minSunElevationDeg: 3 },
    metersPerPixel: 1,
  });

  assert.ok(result != null, "computeAnnualShadingLoss doit retourner un résultat");
  assert.ok(
    typeof result.annualLossPercent === "number",
    "annualLossPercent doit être un nombre"
  );
  assert.ok(
    result.annualLossPercent > 0,
    "1 panneau + 1 obstacle 3m au sud doit donner une perte near > 0 (obtenu: " +
      result.annualLossPercent + " %)"
  );
  assert.ok(
    Array.isArray(result.panelStats) && result.panelStats.length === 1,
    "panelStats doit contenir 1 panneau"
  );
  assert.ok(
    result.panelStats[0].shadedFractionAvg > 0,
    "shadedFractionAvg du panneau doit être > 0 (obtenu: " +
      result.panelStats[0].shadedFractionAvg + ")"
  );
});
