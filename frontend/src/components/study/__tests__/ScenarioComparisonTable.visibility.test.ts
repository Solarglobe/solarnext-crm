/**
 * PHASE 1 — Colonnes de scénarios dynamiques & optionnelles.
 * Teste le helper pur computeVisibleColumns :
 *   - « Sans batterie » (BASE) toujours visible ;
 *   - une carte n'apparaît que si son actif est présent ;
 *   - un scénario absent (null) est masqué (pas de colonne, pas de badge « missing ») ;
 *   - un scénario présent mais _skipped (actif choisi mais incomplet) reste visible ;
 *   - GARDE-FOU ANTI-DÉCALAGE : l'index d'origine est conservé (BASE + Virtuel → 2, pas 1).
 */

import { describe, it, expect } from "vitest";
import { computeVisibleColumns } from "../ScenarioComparisonTable";
import type { ScenarioV2 } from "../ScenarioComparisonTable";

const S = (id: string, extra: Record<string, unknown> = {}): ScenarioV2 =>
  ({ id, ...extra } as unknown as ScenarioV2);

describe("computeVisibleColumns — Phase 1 colonnes dynamiques", () => {
  it("BASE seul → 1 colonne", () => {
    const cols = computeVisibleColumns([S("BASE"), null, null, null]);
    expect(cols.map((c) => c.id)).toEqual(["BASE"]);
    expect(cols.map((c) => c.originalIndex)).toEqual([0]);
  });

  it("BASE + Physique → 2 colonnes (index d'origine 0 et 1)", () => {
    const cols = computeVisibleColumns([S("BASE"), S("BATTERY_PHYSICAL"), null, null]);
    expect(cols.map((c) => c.id)).toEqual(["BASE", "BATTERY_PHYSICAL"]);
    expect(cols.map((c) => c.originalIndex)).toEqual([0, 1]);
  });

  it("BASE + Virtuel → Virtuel garde son index d'origine 2 (ANTI-DÉCALAGE)", () => {
    // Tableau complet : [BASE, null(physique), VIRTUEL, null(hybride)]
    const cols = computeVisibleColumns([S("BASE"), null, S("BATTERY_VIRTUAL"), null]);
    expect(cols.map((c) => c.id)).toEqual(["BASE", "BATTERY_VIRTUAL"]);
    // POINT CRITIQUE : l'index d'origine du virtuel doit être 2, jamais 1.
    expect(cols.map((c) => c.originalIndex)).toEqual([0, 2]);
  });

  it("BASE + Physique + Virtuel + Hybride → 4 colonnes (index 0..3)", () => {
    const cols = computeVisibleColumns([
      S("BASE"),
      S("BATTERY_PHYSICAL"),
      S("BATTERY_VIRTUAL"),
      S("BATTERY_HYBRID"),
    ]);
    expect(cols.map((c) => c.id)).toEqual([
      "BASE",
      "BATTERY_PHYSICAL",
      "BATTERY_VIRTUAL",
      "BATTERY_HYBRID",
    ]);
    expect(cols.map((c) => c.originalIndex)).toEqual([0, 1, 2, 3]);
  });

  it("un scénario présent mais _skipped (actif choisi mais incomplet) reste visible", () => {
    const cols = computeVisibleColumns([
      S("BASE"),
      S("BATTERY_PHYSICAL", { _skipped: true }),
      null,
      null,
    ]);
    expect(cols.map((c) => c.id)).toEqual(["BASE", "BATTERY_PHYSICAL"]);
    expect(cols[1].scenario).not.toBeNull();
  });

  it("un scénario non choisi (null) ne crée aucune colonne (pas de badge « missing »)", () => {
    const cols = computeVisibleColumns([S("BASE"), null, S("BATTERY_VIRTUAL"), null]);
    // Ni la physique ni l'hybride ne doivent apparaître.
    expect(cols.some((c) => c.id === "BATTERY_PHYSICAL")).toBe(false);
    expect(cols.some((c) => c.id === "BATTERY_HYBRID")).toBe(false);
  });

  it("BASE reste présent même si null (jamais masqué)", () => {
    const cols = computeVisibleColumns([null, null, null, null]);
    expect(cols.map((c) => c.id)).toEqual(["BASE"]);
  });
});
