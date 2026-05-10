/**
 * Phase 5 — tests de migration calpinageSchemaV2.
 *
 * Cas couverts :
 *   1. V1 → V2 (bump version, hashes inchangés)
 *   2. Meta absente → recalcul V2
 *   3. V2 déjà présente → no-op
 *   4. frozenBlocks absent → normalisé []
 *   5. Coordonnées {x,y} → {xPx,yPx}
 *   6. Type guards isCalpinageMetaV1 / V2 / Any
 *   7. buildCalpinageMetaForExport → retourne V2
 *   8. computeReloadDiagnostic accepte V2 (ne retourne plus NO_CALPINAGE_META_LEGACY)
 */

import { describe, it, expect } from "vitest";
import {
  applyCalpinageV2MigrationIfNeeded,
  isCalpinageMetaV1,
  isCalpinageMetaV2,
  isCalpinageMetaAny,
} from "../calpinageSchemaV2";
import {
  buildCalpinageMetaForExport,
  computeReloadDiagnostic,
  computeGeometryHashFromRoofState,
  computePanelsHashFromFrozenBlocks,
  computeShadingHash,
} from "../integrity/calpinageReloadIntegrity";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeV1Meta(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    savedAt: "2025-01-01T00:00:00.000Z",
    geometryHash: "aabbccdd",
    panelsHash: "11223344",
    shadingHash: "deadbeef",
    shadingComputedAt: "2025-01-01T00:00:00.000Z",
    shadingSource: "persisted",
    shadingValid: true,
    version: "CALPINAGE_V1",
    ...overrides,
  };
}

function makeLoadedData(metaOverride?: Record<string, unknown> | null): Record<string, unknown> {
  return {
    schemaVersion: "v2",
    roofState: { map: null, scale: null, roof: null, gps: null },
    frozenBlocks: [],
    shading: null,
    ...(metaOverride !== undefined
      ? { calpinage_meta: metaOverride === null ? undefined : metaOverride }
      : { calpinage_meta: makeV1Meta() }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cas 1 : V1 → V2
// ─────────────────────────────────────────────────────────────────────────────
describe("Cas 1 — V1 → V2", () => {
  it("bump version CALPINAGE_V1 → CALPINAGE_V2", () => {
    const data = makeLoadedData();
    const result = applyCalpinageV2MigrationIfNeeded(data, "s1", "v1", "{}");
    expect(result.migrated).toBe(true);
    const meta = data.calpinage_meta as Record<string, unknown>;
    expect(meta.version).toBe("CALPINAGE_V2");
  });

  it("hashes inchangés après bump", () => {
    const data = makeLoadedData();
    const before = { ...(data.calpinage_meta as Record<string, unknown>) };
    applyCalpinageV2MigrationIfNeeded(data, "s1", "v1", "{}");
    const after = data.calpinage_meta as Record<string, unknown>;
    expect(after.geometryHash).toBe(before.geometryHash);
    expect(after.panelsHash).toBe(before.panelsHash);
    expect(after.shadingHash).toBe(before.shadingHash);
  });

  it("backup écrit si rawJson fourni", () => {
    const data = makeLoadedData();
    const result = applyCalpinageV2MigrationIfNeeded(data, "s1", "v1", '{"raw":true}');
    expect(result.backupWritten).toBe(true);
  });

  it("backup non écrit si rawJson absent", () => {
    const data = makeLoadedData();
    const result = applyCalpinageV2MigrationIfNeeded(data, "s1", "v1");
    // rawJson undefined → pas de backup
    expect(result.backupWritten).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cas 2 : meta absente → recalcul V2
// ─────────────────────────────────────────────────────────────────────────────
describe("Cas 2 — meta absente → recalcul", () => {
  it("produit meta V2 avec hashes non vides", () => {
    const data: Record<string, unknown> = {
      schemaVersion: "v2",
      roofState: { roof: null },
      frozenBlocks: [],
      shading: null,
    };
    const result = applyCalpinageV2MigrationIfNeeded(data);
    expect(result.migrated).toBe(true);
    const meta = data.calpinage_meta as Record<string, unknown>;
    expect(meta.version).toBe("CALPINAGE_V2");
    expect(typeof meta.geometryHash).toBe("string");
    expect((meta.geometryHash as string).length).toBeGreaterThan(0);
  });

  it("shadingSource = 'none' si shading null", () => {
    const data: Record<string, unknown> = { roofState: null };
    applyCalpinageV2MigrationIfNeeded(data);
    const meta = data.calpinage_meta as Record<string, unknown>;
    expect(meta.shadingSource).toBe("none");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cas 3 : V2 déjà présente → no-op
// ─────────────────────────────────────────────────────────────────────────────
describe("Cas 3 — V2 déjà présente", () => {
  it("retourne migrated=false", () => {
    const data = makeLoadedData(makeV1Meta({ version: "CALPINAGE_V2" }));
    const result = applyCalpinageV2MigrationIfNeeded(data);
    expect(result.migrated).toBe(false);
    expect(result.backupWritten).toBe(false);
  });

  it("ne modifie pas la meta existante", () => {
    const v2meta = makeV1Meta({ version: "CALPINAGE_V2" });
    const data = makeLoadedData(v2meta);
    applyCalpinageV2MigrationIfNeeded(data);
    expect(data.calpinage_meta).toStrictEqual(v2meta);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cas 4 : frozenBlocks absent → normalisé []
// ─────────────────────────────────────────────────────────────────────────────
describe("Cas 4 — frozenBlocks absent", () => {
  it("initialise frozenBlocks à []", () => {
    const data: Record<string, unknown> = { roofState: null };
    applyCalpinageV2MigrationIfNeeded(data);
    expect(Array.isArray(data.frozenBlocks)).toBe(true);
    expect((data.frozenBlocks as unknown[]).length).toBe(0);
  });

  it("ne supprime pas un frozenBlocks déjà présent", () => {
    const data = makeLoadedData();
    (data.frozenBlocks as unknown[]).push({ id: "b1", panels: [] });
    applyCalpinageV2MigrationIfNeeded(data);
    expect((data.frozenBlocks as unknown[]).length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cas 5 : coordonnées {x,y} → {xPx,yPx}
// ─────────────────────────────────────────────────────────────────────────────
describe("Cas 5 — normalisation coordonnées", () => {
  it("center {x,y} → {xPx,yPx}", () => {
    const data: Record<string, unknown> = {
      frozenBlocks: [
        {
          id: "b1",
          panels: [{ center: { x: 42, y: 17 }, state: "ok", enabled: true }],
        },
      ],
    };
    applyCalpinageV2MigrationIfNeeded(data);
    const panel = ((data.frozenBlocks as unknown[])[0] as Record<string, unknown>)
      .panels as Record<string, unknown>[];
    const center = panel[0].center as Record<string, unknown>;
    expect(center.xPx).toBe(42);
    expect(center.yPx).toBe(17);
  });

  it("center déjà {xPx,yPx} → inchangé", () => {
    const data: Record<string, unknown> = {
      frozenBlocks: [
        {
          id: "b1",
          panels: [{ center: { xPx: 10, yPx: 20 }, state: "ok" }],
        },
      ],
    };
    applyCalpinageV2MigrationIfNeeded(data);
    const panel = ((data.frozenBlocks as unknown[])[0] as Record<string, unknown>)
      .panels as Record<string, unknown>[];
    const center = panel[0].center as Record<string, unknown>;
    expect(center.xPx).toBe(10);
    expect(center.yPx).toBe(20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cas 6 : type guards
// ─────────────────────────────────────────────────────────────────────────────
describe("Cas 6 — type guards", () => {
  it("isCalpinageMetaV1 reconnaît V1", () => {
    expect(isCalpinageMetaV1(makeV1Meta())).toBe(true);
  });

  it("isCalpinageMetaV1 rejette V2", () => {
    expect(isCalpinageMetaV1(makeV1Meta({ version: "CALPINAGE_V2" }))).toBe(false);
  });

  it("isCalpinageMetaV2 reconnaît V2", () => {
    expect(isCalpinageMetaV2(makeV1Meta({ version: "CALPINAGE_V2" }))).toBe(true);
  });

  it("isCalpinageMetaAny reconnaît V1 et V2", () => {
    expect(isCalpinageMetaAny(makeV1Meta())).toBe(true);
    expect(isCalpinageMetaAny(makeV1Meta({ version: "CALPINAGE_V2" }))).toBe(true);
  });

  it("isCalpinageMetaAny rejette version inconnue", () => {
    expect(isCalpinageMetaAny(makeV1Meta({ version: "CALPINAGE_V3" }))).toBe(false);
    expect(isCalpinageMetaAny(null)).toBe(false);
    expect(isCalpinageMetaAny(undefined)).toBe(false);
    expect(isCalpinageMetaAny("string")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cas 7 : buildCalpinageMetaForExport → V2
// ─────────────────────────────────────────────────────────────────────────────
describe("Cas 7 — buildCalpinageMetaForExport retourne V2", () => {
  it("version === CALPINAGE_V2", () => {
    const meta = buildCalpinageMetaForExport(
      { roofState: null, frozenBlocks: [], shading: null },
      { savedAt: new Date().toISOString() }
    );
    expect(meta.version).toBe("CALPINAGE_V2");
  });

  it("hashes sont des strings non vides", () => {
    const meta = buildCalpinageMetaForExport(
      { roofState: null, frozenBlocks: [], shading: null },
      { savedAt: new Date().toISOString() }
    );
    expect(meta.geometryHash.length).toBeGreaterThan(0);
    expect(meta.panelsHash.length).toBeGreaterThan(0);
    expect(meta.shadingHash.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cas 8 : computeReloadDiagnostic accepte V2
// ─────────────────────────────────────────────────────────────────────────────
describe("Cas 8 — computeReloadDiagnostic accepte meta V2", () => {
  it("ne retourne pas NO_CALPINAGE_META_LEGACY pour une meta V2 valide", () => {
    const exportObj = { roofState: { map: null, scale: null, roof: null, gps: null }, frozenBlocks: [], shading: null };
    const meta = buildCalpinageMetaForExport(exportObj, { savedAt: new Date().toISOString() });

    const loadedData: Record<string, unknown> = { ...exportObj, calpinage_meta: meta };
    const liveState = { roof: {}, shading: { normalized: null, lastAbortReason: null, lastComputedAt: null } };

    // @ts-expect-error window.pvPlacementEngine not available in test env — patch getFrozenBlocks
    globalThis.window = { pvPlacementEngine: { getFrozenBlocks: () => [], getActiveBlock: () => null } };

    const { diagnostic } = computeReloadDiagnostic(loadedData, liveState);
    expect(diagnostic.reason).not.toBe("NO_CALPINAGE_META_LEGACY");
  });

  it("retourne NO_CALPINAGE_META_LEGACY si meta absente", () => {
    const loadedData: Record<string, unknown> = { roofState: null };
    const liveState = { roof: {} };
    const { diagnostic } = computeReloadDiagnostic(loadedData, liveState);
    expect(diagnostic.reason).toBe("NO_CALPINAGE_META_LEGACY");
  });
});
