/**
 * Tests de parite — computePanelsHashFromFrozenBlocks (P0.4 + P0.4-b)
 */

import { describe, expect, it } from "vitest";
import { computePanelsHashFromFrozenBlocks } from "../calpinageReloadIntegrity";

function legacyStableSerialize(value: unknown): string {
  function normalize(x: unknown): unknown {
    if (x === null) return null;
    const t = typeof x;
    if (t === "number") return Number.isFinite(x as number) ? x : null;
    if (t === "string" || t === "boolean") return x;
    if (t === "undefined" || t === "function" || t === "symbol") return null;
    if (Array.isArray(x)) return (x as unknown[]).map(normalize);
    if (t === "object") {
      const out: Record<string, unknown> = {};
      Object.keys(x as object)
        .sort()
        .forEach((k) => {
          if (k === "__proto__" || k === "constructor") return;
          const v = (x as Record<string, unknown>)[k];
          if (typeof v === "undefined" || typeof v === "function" || typeof v === "symbol") return;
          out[k] = normalize(v);
        });
      return out;
    }
    return null;
  }
  return JSON.stringify(normalize(value)) ?? '"<unserializable>"';
}

function legacyHashHex(str: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return ("00000000" + h.toString(16)).slice(-8);
}

function legacyComputePanelsHash(frozenBlocks: unknown[]): string {
  const src = Array.isArray(frozenBlocks) ? frozenBlocks : [];
  const blocks = src
    .filter((bl) => bl && typeof bl === "object")
    .map((bl) => {
      const b = bl as Record<string, unknown>;
      const rows = Array.isArray(b.panels) ? (b.panels as unknown[]) : [];
      return {
        id: b.id || null,
        panId: b.panId || null,
        orientation: b.orientation || null,
        rotation: typeof b.rotation === "number" ? b.rotation : null,
        useScreenAxes: b.useScreenAxes === true,
        panels: rows.map((p) => {
          const q = p as Record<string, unknown>;
          return {
            center: q.center && typeof q.center === "object" ? q.center : null,
            projection: q.projection && typeof q.projection === "object" ? q.projection : null,
            state: q.state ?? null,
            enabled: !!(q && q.enabled !== false),
            localRotationDeg: typeof q.localRotationDeg === "number" ? q.localRotationDeg : 0,
          };
        }),
      };
    })
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return legacyHashHex(legacyStableSerialize(blocks));
}

function makeBlock(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "block-1",
    panId: "pan-1",
    orientation: "PORTRAIT",
    rotation: 0,
    useScreenAxes: false,
    panels: [
      {
        center: { x: 100, y: 200 },
        projection: { slopeAxis: { x: 0, y: 1 }, perpAxis: { x: 1, y: 0 } },
        state: "placed",
        enabled: true,
        localRotationDeg: 0,
      },
    ],
    ...overrides,
  };
}

describe("computePanelsHashFromFrozenBlocks — parite avec legacy computePanelsHash (P0.4+P0.4-b)", () => {
  it("CAS NOMINAL — bloc PORTRAIT complet", () => {
    const blocks = [makeBlock()];
    expect(computePanelsHashFromFrozenBlocks(blocks)).toBe(legacyComputePanelsHash(blocks));
  });

  it("CAS NOMINAL — bloc PAYSAGE complet", () => {
    const blocks = [makeBlock({ orientation: "PAYSAGE", rotation: 90 })];
    expect(computePanelsHashFromFrozenBlocks(blocks)).toBe(legacyComputePanelsHash(blocks));
  });

  it("CAS CRITIQUE 1 — rotation absente (undefined)", () => {
    const blocks = [makeBlock({ rotation: undefined })];
    expect(computePanelsHashFromFrozenBlocks(blocks)).toBe(legacyComputePanelsHash(blocks));
  });

  it("CAS CRITIQUE 2 — id absent (undefined)", () => {
    const blocks = [makeBlock({ id: undefined, panId: undefined })];
    expect(computePanelsHashFromFrozenBlocks(blocks)).toBe(legacyComputePanelsHash(blocks));
  });

  it("CAS CRITIQUE 2b — id chaine vide", () => {
    const blocks = [makeBlock({ id: "", panId: "" })];
    expect(computePanelsHashFromFrozenBlocks(blocks)).toBe(legacyComputePanelsHash(blocks));
  });

  it("CAS CRITIQUE 3 — orientation minuscule 'portrait'", () => {
    const blocks = [makeBlock({ orientation: "portrait" })];
    expect(computePanelsHashFromFrozenBlocks(blocks)).toBe(legacyComputePanelsHash(blocks));
  });

  it("CAS CRITIQUE 3b — orientation 'landscape'", () => {
    const blocks = [makeBlock({ orientation: "landscape" })];
    expect(computePanelsHashFromFrozenBlocks(blocks)).toBe(legacyComputePanelsHash(blocks));
  });

  it("CAS CRITIQUE 3c — 'portrait' et 'PORTRAIT' produisent des hashes DIFFERENTS", () => {
    const hashLower = computePanelsHashFromFrozenBlocks([makeBlock({ orientation: "portrait" })]);
    const hashUpper = computePanelsHashFromFrozenBlocks([makeBlock({ orientation: "PORTRAIT" })]);
    expect(hashLower).not.toBe(hashUpper);
  });

  it("CAS CRITIQUE 4 — orientation null", () => {
    const blocks = [makeBlock({ orientation: null })];
    expect(computePanelsHashFromFrozenBlocks(blocks)).toBe(legacyComputePanelsHash(blocks));
  });

  it("MULTI-BLOCS — tri par id stable", () => {
    const blocks = [
      makeBlock({ id: "block-b", panId: "pan-2", orientation: "PAYSAGE" }),
      makeBlock({ id: "block-a", panId: "pan-1", orientation: "PORTRAIT" }),
    ];
    const blocksReversed = [...blocks].reverse();
    expect(computePanelsHashFromFrozenBlocks(blocks)).toBe(computePanelsHashFromFrozenBlocks(blocksReversed));
  });

  it("MULTI-BLOCS — parite legacy", () => {
    const blocks = [
      makeBlock({ id: "block-b", panId: "pan-2", orientation: "PAYSAGE" }),
      makeBlock({ id: "block-a", panId: "pan-1", orientation: "PORTRAIT", rotation: 45 }),
    ];
    expect(computePanelsHashFromFrozenBlocks(blocks)).toBe(legacyComputePanelsHash(blocks));
  });

  it("LISTE VIDE — hash stable", () => {
    expect(computePanelsHashFromFrozenBlocks([])).toBe(legacyComputePanelsHash([]));
  });

  it("PANEL enabled=false", () => {
    const blocks = [
      makeBlock({
        panels: [
          { center: { x: 50, y: 50 }, projection: null, state: "placed", enabled: false, localRotationDeg: 0 },
        ],
      }),
    ];
    expect(computePanelsHashFromFrozenBlocks(blocks)).toBe(legacyComputePanelsHash(blocks));
  });

  it("PANEL localRotationDeg absent — normalise 0", () => {
    const block = makeBlock();
    (block.panels as Record<string, unknown>[])[0] = {
      center: { x: 100, y: 200 },
      projection: null,
      state: "placed",
      enabled: true,
    };
    const blocks = [block];
    expect(computePanelsHashFromFrozenBlocks(blocks)).toBe(legacyComputePanelsHash(blocks));
  });

  it("P0.4-b — state undefined -> normalise null", () => {
    const block = makeBlock();
    (block.panels as Record<string, unknown>[])[0] = {
      center: { x: 100, y: 200 },
      projection: { slopeAxis: { x: 0, y: 1 }, perpAxis: { x: 1, y: 0 } },
      enabled: true,
      localRotationDeg: 0,
    };
    const blocks = [block];
    expect(computePanelsHashFromFrozenBlocks(blocks)).toBe(legacyComputePanelsHash(blocks));
  });

  it("P0.4-b — center undefined -> normalise null", () => {
    const block = makeBlock();
    (block.panels as Record<string, unknown>[])[0] = {
      projection: { slopeAxis: { x: 0, y: 1 }, perpAxis: { x: 1, y: 0 } },
      state: "placed",
      enabled: true,
      localRotationDeg: 0,
    };
    const blocks = [block];
    expect(computePanelsHashFromFrozenBlocks(blocks)).toBe(legacyComputePanelsHash(blocks));
  });

  it("P0.4-b — projection undefined -> normalise null", () => {
    const block = makeBlock();
    (block.panels as Record<string, unknown>[])[0] = {
      center: { x: 100, y: 200 },
      state: "placed",
      enabled: true,
      localRotationDeg: 0,
    };
    const blocks = [block];
    expect(computePanelsHashFromFrozenBlocks(blocks)).toBe(legacyComputePanelsHash(blocks));
  });

  it("P0.4-b — center/projection/state tous undefined", () => {
    const block = makeBlock();
    (block.panels as Record<string, unknown>[])[0] = { enabled: true, localRotationDeg: 0 };
    const blocks = [block];
    expect(computePanelsHashFromFrozenBlocks(blocks)).toBe(legacyComputePanelsHash(blocks));
  });
});
