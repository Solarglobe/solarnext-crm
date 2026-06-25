import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const calcControllerPath = path.resolve("backend/controllers/calc.controller.js");
const scenarioComparisonPath = path.resolve("frontend/src/components/study/ScenarioComparisonTable.tsx");

test("scénarios batterie: n'utilisent pas la courbe pilotée par défaut", () => {
  const source = fs.readFileSync(calcControllerPath, "utf8");

  assert.match(source, /function resolveRawScenarioConsumptionHourly\(ctx\)/);
  assert.doesNotMatch(
    source,
    /const\s+consoHourly(?:Virtual|Hybrid)?\s*=\s*ctx\.conso_p_pilotee\s*\|\|/,
    "les scénarios batterie doivent partir de la consommation client brute, pas de la conso pilotée"
  );
  assert.doesNotMatch(
    source,
    /scenario_uses_piloted_profile\s*=\s*Array\.isArray\(ctx\.conso_p_pilotee\)/,
    "un scénario batterie ne doit pas être marqué piloté par défaut"
  );
});

test("batterie virtuelle: pas de capacité physique utilisée comme capacité virtuelle", () => {
  const source = fs.readFileSync(calcControllerPath, "utf8");

  assert.doesNotMatch(
    source,
    /ctx\.battery_input\?\.enabled[\s\S]{0,220}vbConfig\.capacity_kwh\s*=\s*physCap/,
    "la batterie virtuelle doit avoir sa propre capacité contractuelle, pas hériter de la batterie physique"
  );
  assert.match(
    source,
    /hybrid_virtual_battery_unbounded_disabled/,
    "l'hybride doit bloquer la capacité virtuelle auto/unbounded sans validation explicite"
  );
});

test("comparatif scénarios: pas de recalcul optimiste du virtuel côté front", () => {
  const source = fs.readFileSync(scenarioComparisonPath, "utf8");

  assert.doesNotMatch(
    source,
    /fallbackStabilizedImport/,
    "le front ne doit pas inventer un import stabilisé virtuel si le backend ne le fournit pas"
  );
  assert.match(
    source,
    /baseGrossSurplusKwh/,
    "les vieux snapshots doivent afficher le surplus brut depuis la base, pas le surplus post-batterie"
  );
});
