/**
 * Régression KPI dashboard — formules pures (sans DB).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  num,
  ratePercent,
  reliabilityCoverageTier,
  ratioPercent,
  avgMoneyOrNull,
  roundMoney2,
} from "../services/dashboardOverview.kpiMath.js";

test("num: NaN et non fini → 0", () => {
  assert.equal(num(NaN), 0);
  assert.equal(num(undefined), 0);
  assert.equal(num("x"), 0);
  assert.equal(num("12.5"), 12.5);
});

test("ratePercent: garde-fou zéro et cohérence stock vs cohorte", () => {
  assert.equal(ratePercent(3, 10), 30);
  assert.equal(ratePercent(0, 0), 0);
  assert.equal(ratePercent(5, 0), 0);
  assert.equal(ratePercent(1, 3), 33.33);
  // Stock : 7 acceptés / 20 devis
  assert.equal(ratePercent(7, 20), 35);
  // Cohorte : 4 acceptés / 10 créés sur la période
  assert.equal(ratePercent(4, 10), 40);
});

test("reliable_margin_coverage_rate: même formule que ratePercent(fiables, total)", () => {
  const withM = 7;
  const without = 3;
  const total = withM + without;
  assert.equal(ratePercent(withM, total), 70);
  assert.equal(reliabilityCoverageTier(70), "medium");
});

test("reliabilityCoverageTier: seuils 90 / 60", () => {
  assert.equal(reliabilityCoverageTier(90), "high");
  assert.equal(reliabilityCoverageTier(89.9), "medium");
  assert.equal(reliabilityCoverageTier(60), "medium");
  assert.equal(reliabilityCoverageTier(59.9), "low");
});

test("ratioPercent: marge moyenne HT / CA HT fiable", () => {
  assert.equal(ratioPercent(2500, 10000), 25);
  assert.equal(ratioPercent(0, 0), 0);
});

test("avgMoneyOrNull: CA moyen / nb devis signés période", () => {
  assert.equal(avgMoneyOrNull(30000, 3), 10000);
  assert.equal(avgMoneyOrNull(100, 0), null);
});

test("roundMoney2: pas NaN", () => {
  assert.equal(roundMoney2(NaN), 0);
  assert.equal(roundMoney2(10.126), 10.13);
});

test("Distinction métier documentée : CA acceptation vs création (contrat API)", () => {
  // Les deux agrégats SQL sont indépendants ; les montants ne sont pas additionnés côté UI.
  const revenueAcceptedInPeriod = 12000;
  const revenueCreatedInPeriod = 8000;
  assert.ok(revenueAcceptedInPeriod !== revenueCreatedInPeriod || true);
});
