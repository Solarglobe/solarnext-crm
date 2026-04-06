/**
 * Assertions d’invariants pour résultats near shading 3D — utilisables par tous les tests hardening.
 * Ne modifie pas le moteur runtime (pas d’overhead prod).
 */

import { expect } from "vitest";
import type { NearShadingAnnualAggregate, NearShadingTimeStepResult } from "../../types/near-shading-3d";

const EPS = 1e-9;

export function assertTimestepRatios(step: NearShadingTimeStepResult): void {
  if (step.totalSamples === 0) {
    expect(step.shadedSamples).toBe(0);
    expect(step.globalShadedFraction).toBe(0);
    return;
  }
  const r = step.shadedSamples / step.totalSamples;
  expect(Number.isFinite(r)).toBe(true);
  expect(r).toBeGreaterThanOrEqual(0);
  expect(r).toBeLessThanOrEqual(1);
  expect(Math.abs(step.globalShadedFraction - r)).toBeLessThanOrEqual(EPS + 1e-12);
  for (const pr of step.panelResults) {
    expect(pr.shadingRatio).toBeGreaterThanOrEqual(0);
    expect(pr.shadingRatio).toBeLessThanOrEqual(1);
    expect(pr.shadedSampleCount).toBeLessThanOrEqual(pr.totalSampleCount);
  }
}

export function assertAnnualAggregateInvariants(a: NearShadingAnnualAggregate): void {
  expect(Number.isFinite(a.meanShadedFraction)).toBe(true);
  expect(a.meanShadedFraction).toBeGreaterThanOrEqual(0);
  expect(a.meanShadedFraction).toBeLessThanOrEqual(1);
  expect(Number.isFinite(a.minShadedFraction)).toBe(true);
  expect(Number.isFinite(a.maxShadedFraction)).toBe(true);
  expect(a.minShadedFraction).toBeLessThanOrEqual(a.meanShadedFraction);
  expect(a.meanShadedFraction).toBeLessThanOrEqual(a.maxShadedFraction);
  expect(Number.isFinite(a.nearShadingLossProxy)).toBe(true);
  expect(Math.abs(a.nearShadingLossProxy - (1 - a.meanShadedFraction))).toBeLessThanOrEqual(1e-9);
}
