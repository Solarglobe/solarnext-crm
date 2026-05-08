/**
 * Tests de parité — computePanelsHashFromFrozenBlocks (P0.4)
 *
 * Objectif : garantir que la fonction TS produit exactement le même hash que
 * la legacy `computePanelsHash` de `calpinage.module.js` sur les mêmes données.
 *
 * La fonction legacy est réimplémentée inline ci-dessous (copiée fidèlement),
 * ce qui permet de valider la parité sans dépendance sur le legacy bundlé.
 *
 * Les 4 cas critiques testés (corrections P0.4) :
 *   1. `rotation` absent (undefined) → doit se comporter comme `null` dans les deux
 *   2. `id` / `panId` absents (undefined) → doit se comporter comme `null` dans les deux
 *   3. `orientation` minuscule ("portrait") → les deux conservent la valeur as-is (pas de normalisation casse)
 *   4. `orientation` mixte (legacy "PORTRAIT") → pas de régression sur le cas nominal
 */

import { describe, expect, it } from "vitest";
import { computePanelsHashFromFrozenBlocks } from "../calpinageReloadIntegrity";

// ─── Réimplémentation inline de la legacy computePanelsHash ──────────────────
// Source : calpinage.module.js, fonction computePanelsHash (ligne ~7695)
// Reproduite ici pour comparaison de parité sans importer le bundle legacy.

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

// ─── Fixtures ─────────────────────────────────────────────────────────────────

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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("computePanelsHashFromFrozenBlocks — parité avec legacy computePanelsHash (P0.4)", () => {
  it("CAS NOMINAL — bloc PORTRAIT complet : hash TS === hash legacy", () => {
    const blocks = [makeBlock()];
    const tsHash = computePanelsHashFromFrozenBlocks(blocks);
    const legHash = legacyComputePanelsHash(blocks);
    expect(tsHash).toBe(legHash);
  });

  it("CAS NOMINAL — bloc PAYSAGE complet : hash TS === hash legacy", () => {
    const blocks = [makeBlock({ orientation: "PAYSAGE", rotation: 90 })];
    const tsHash = computePanelsHashFromFrozenBlocks(blocks);
    const legHash = legacyComputePanelsHash(blocks);
    expect(tsHash).toBe(legHash);
  });

  it("CAS CRITIQUE 1 — rotation absente (undefined) : hash TS === hash legacy", () => {
    const blocks = [makeBlock({ rotation: undefined })];
    const tsHash = computePanelsHashFromFrozenBlocks(blocks);
    const legHash = legacyComputePanelsHash(blocks);
    expect(tsHash).toBe(legHash);
  });

  it("CAS CRITIQUE 2 — id absent (undefined) : hash TS === hash legacy", () => {
    const blocks = [makeBlock({ id: undefined, panId: undefined })];
    const tsHash = computePanelsHashFromFrozenBlocks(blocks);
    const legHash = legacyComputePanelsHash(blocks);
    expect(tsHash).toBe(legHash);
  });

  it("CAS CRITIQUE 2b — id chaîne vide : hash TS === hash legacy", () => {
    const blocks = [makeBlock({ id: "", panId: "" })];
    const tsHash = computePanelsHashFromFrozenBlocks(blocks);
    const legHash = legacyComputePanelsHash(blocks);
    expect(tsHash).toBe(legHash);
  });

  it("CAS CRITIQUE 3 — orientation minuscule 'portrait' : hash TS === hash legacy (conservation as-is)", () => {
    // Cas historique : études sauvegardées avant normalisation dans buildGeometryForExport.
    // Le hash legacy était calculé sur "portrait" → le hash TS doit produire la même valeur.
    const blocks = [makeBlock({ orientation: "portrait" })];
    const tsHash = computePanelsHashFromFrozenBlocks(blocks);
    const legHash = legacyComputePanelsHash(blocks);
    expect(tsHash).toBe(legHash);
  });

  it("CAS CRITIQUE 3b — orientation 'landscape' : hash TS === hash legacy", () => {
    const blocks = [makeBlock({ orientation: "landscape" })];
    const tsHash = computePanelsHashFromFrozenBlocks(blocks);
    const legHash = legacyComputePanelsHash(blocks);
    expect(tsHash).toBe(legHash);
  });

  it("CAS CRITIQUE 3c — 'portrait' et 'PORTRAIT' produisent des hashes DIFFÉRENTS (attendu)", () => {
    // Garantit que la fonction ne normalise PAS la casse (comportement corrigé P0.4).
    // Si les deux produisaient le même hash, une étude avec hash("portrait") en référence
    // ne pourrait pas détecter de vrai drift si les blocs passent à "PORTRAIT" en mémoire.
    const blocksLower = [makeBlock({ orientation: "portrait" })];
    const blocksUpper = [makeBlock({ orientation: "PORTRAIT" })];
    const hashLower = computePanelsHashFromFrozenBlocks(blocksLower);
    const hashUpper = computePanelsHashFromFrozenBlocks(blocksUpper);
    expect(hashLower).not.toBe(hashUpper);
  });

  it("CAS CRITIQUE 4 — orientation null : hash TS === hash legacy", () => {
    const blocks = [makeBlock({ orientation: null })];
    const tsHash = computePanelsHashFromFrozenBlocks(blocks);
    const legHash = legacyComputePanelsHash(blocks);
    expect(tsHash).toBe(legHash);
  });

  it("MULTI-BLOCS — tri par id stable : même ordre → même hash", () => {
    const blocks = [
      makeBlock({ id: "block-b", panId: "pan-2", orientation: "PAYSAGE" }),
      makeBlock({ id: "block-a", panId: "pan-1", orientation: "PORTRAIT" }),
    ];
    const blocksReversed = [...blocks].reverse();
    const hash1 = computePanelsHashFromFrozenBlocks(blocks);
    const hash2 = computePanelsHashFromFrozenBlocks(blocksReversed);
    expect(hash1).toBe(hash2);
  });

  it("MULTI-BLOCS — parité legacy sur ensemble trié", () => {
    const blocks = [
      makeBlock({ id: "block-b", panId: "pan-2", orientation: "PAYSAGE" }),
      makeBlock({ id: "block-a", panId: "pan-1", orientation: "PORTRAIT", rotation: 45 }),
    ];
    const tsHash = computePanelsHashFromFrozenBlocks(blocks);
    const legHash = legacyComputePanelsHash(blocks);
    expect(tsHash).toBe(legHash);
  });

  it("LISTE VIDE — hash stable", () => {
    const tsHash = computePanelsHashFromFrozenBlocks([]);
    const legHash = legacyComputePanelsHash([]);
    expect(tsHash).toBe(legHash);
  });

  it("PANEL enabled=false — conservé as-is dans les deux", () => {
    const blocks = [
      makeBlock({
        panels: [
          { center: { x: 50, y: 50 }, projection: null, state: "placed", enabled: false, localRotationDeg: 0 },
        ],
      }),
    ];
    const tsHash = computePanelsHashFromFrozenBlocks(blocks);
    const legHash = legacyComputePanelsHash(blocks);
    expect(tsHash).toBe(legHash);
  });

  it("PANEL localRotationDeg absent — normalisé 0 dans les deux", () => {
    const block = makeBlock();
    (block.panels as Record<string, unknown>[])[0] = {
      center: { x: 100, y: 200 },
      projection: null,
      state: "placed",
      enabled: true,
      // localRotationDeg intentionnellement absent
    };
    const blocks = [block];
    const tsHash = computePanelsHashFromFrozenBlocks(blocks);
    const legHash = legacyComputePanelsHash(blocks);
    expect(tsHash).toBe(legHash);
  });
});
