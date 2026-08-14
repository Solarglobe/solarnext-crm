import assert from "node:assert/strict";
import test from "node:test";

import {
  DP_DRAFT_SCHEMA_VERSION,
  normalizeDpDraftSchema,
  validateDpDraftJsonShape,
} from "../services/leadDp.service.js";

test("normalizeDpDraftSchema injects the current schemaVersion", () => {
  const draft = normalizeDpDraftSchema({
    meta: {},
    progression: {},
    timestamps: {},
    general: {},
    mandat: {},
    generatedPieces: {},
  });

  assert.equal(draft.schemaVersion, DP_DRAFT_SCHEMA_VERSION);
});

test("normalizeDpDraftSchema rejects unknown top-level keys", () => {
  assert.throws(
    () => normalizeDpDraftSchema({ schemaVersion: DP_DRAFT_SCHEMA_VERSION, legacyDp: {} }),
    /Cle|Cl/
  );
});

test("validateDpDraftJsonShape rejects blob urls", () => {
  assert.throws(
    () =>
      validateDpDraftJsonShape({
        schemaVersion: DP_DRAFT_SCHEMA_VERSION,
        dp1: { image: "blob:https://crm.local/temp" },
      }),
    (err) => err?.code === "DP_DRAFT_BLOB_URL"
  );
});

test("validateDpDraftJsonShape rejects prototype pollution keys", () => {
  const draft = JSON.parse(
    `{"schemaVersion":${DP_DRAFT_SCHEMA_VERSION},"dp2":{"__proto__":{"polluted":true}}}`
  );

  assert.throws(
    () => validateDpDraftJsonShape(draft),
    (err) => err?.code === "DP_DRAFT_SCHEMA_INVALID"
  );
});

test("validateDpDraftJsonShape rejects oversized JSON after asset extraction", () => {
  assert.throws(
    () =>
      validateDpDraftJsonShape({
        schemaVersion: DP_DRAFT_SCHEMA_VERSION,
        dp1: { notes: "x".repeat(5 * 1024 * 1024 + 1) },
      }),
    (err) => err?.code === "DP_DRAFT_TOO_LARGE" || err?.code === "DP_DRAFT_SCHEMA_INVALID"
  );
});
