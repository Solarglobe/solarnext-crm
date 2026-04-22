import { test } from "node:test";
import assert from "node:assert/strict";
import { getDpPdfFileName, normalizeDpPieceKey } from "../constants/dpPdfFileNames.js";

test("normalizeDpPieceKey — DP1 → dp1", () => {
  assert.equal(normalizeDpPieceKey("DP1"), "dp1");
  assert.equal(normalizeDpPieceKey("mandat"), "mandat");
});

test("getDpPdfFileName — suffixe leadId", () => {
  const lid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  assert.equal(getDpPdfFileName("dp1", lid), `dp1-plan-de-situation-${lid}.pdf`);
  assert.equal(getDpPdfFileName("cerfa", lid), `cerfa-${lid}.pdf`);
});

test("getDpPdfFileName — sans lead (téléchargement brut)", () => {
  assert.equal(getDpPdfFileName("dp2", ""), "dp2-plan-de-masse.pdf");
});
