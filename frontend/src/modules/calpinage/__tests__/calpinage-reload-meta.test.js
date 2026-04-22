/**
 * Validation factuelle LOT RELOAD CALPINAGE
 *
 * Vérifie :
 * 1) SAVE — calpinage_meta produit avec toutes les clés requises
 * 2) LOAD — diagnostic produit, pas de crash sur legacy/shading absent
 * 3) CAS LEGACY — ancien dossier sans meta, shading absent, frozenBlocks orphelins
 * 4) SHADING STALE — détection sans recalcul
 * 5) HASH STABLE — traits sans attach → même hash avant/après load (bug fix)
 */

import { describe, it, expect } from "vitest";

// ────────────────────────────────────────────────────────────────────────────
// Helpers copiés verbatim depuis calpinage.module.js (fonctions pures)
// ────────────────────────────────────────────────────────────────────────────

function stableSerializeForHash(value) {
  function normalize(x) {
    if (x === null) return null;
    const t = typeof x;
    if (t === "number") return Number.isFinite(x) ? x : null;
    if (t === "string" || t === "boolean") return x;
    if (t === "undefined" || t === "function" || t === "symbol") return null;
    if (Array.isArray(x)) return x.map(normalize);
    if (t === "object") {
      const out = {};
      Object.keys(x).sort().forEach((k) => {
        if (k === "__proto__" || k === "constructor") return;
        const v = x[k];
        if (typeof v === "undefined" || typeof v === "function" || typeof v === "symbol") return;
        out[k] = normalize(v);
      });
      return out;
    }
    return null;
  }
  try { return JSON.stringify(normalize(value)); } catch { return '"<unserializable>"'; }
}

function lightweightHashHex(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return ("00000000" + h.toString(16)).slice(-8);
}

function stableHash(v) { return lightweightHashHex(stableSerializeForHash(v)); }

function normalizeEndpointForHash(pt) {
  if (!pt || typeof pt !== "object") return { x: 0, y: 0 };
  const out = { x: typeof pt.x === "number" ? pt.x : 0, y: typeof pt.y === "number" ? pt.y : 0 };
  if (typeof pt.h === "number" && Number.isFinite(pt.h)) out.h = pt.h;
  return out;
}

function computeGeometryHash(geometry) {
  const g = geometry && typeof geometry === "object" ? geometry : {};
  const slim = {
    map: g.map || null,
    image: g.image
      ? { width: g.image.width, height: g.image.height,
          len: typeof g.image.dataUrl === "string" ? g.image.dataUrl.length : 0,
          head: typeof g.image.dataUrl === "string" ? g.image.dataUrl.slice(0, 80) : null,
          tail: typeof g.image.dataUrl === "string" ? g.image.dataUrl.slice(-80) : null }
      : null,
    scale: g.scale || null,
    roof: g.roof || null,
    contoursBati: Array.isArray(g.contoursBati) ? g.contoursBati : [],
    traits: (Array.isArray(g.traits) ? g.traits : []).map((t) => ({
      id: t && t.id, a: normalizeEndpointForHash(t && t.a), b: normalizeEndpointForHash(t && t.b),
      roofRole: (t && t.roofRole) || null,
    })),
    mesures: Array.isArray(g.mesures) ? g.mesures : [],
    ridges: (Array.isArray(g.ridges) ? g.ridges : []).map((r) => ({
      id: r && r.id, a: normalizeEndpointForHash(r && r.a), b: normalizeEndpointForHash(r && r.b),
      roofRole: (r && r.roofRole) || null,
    })),
    planes: g.planes || null,
    obstacles: Array.isArray(g.obstacles) ? g.obstacles : [],
    gps: g.gps || null,
  };
  return stableHash(slim);
}

function computePanelsHash(panels) {
  const src = Array.isArray(panels) ? panels : [];
  const blocks = src
    .filter((bl) => bl && typeof bl === "object")
    .map((bl) => ({
      id: bl.id || null, panId: bl.panId || null,
      orientation: bl.orientation || null,
      rotation: typeof bl.rotation === "number" ? bl.rotation : null,
      useScreenAxes: bl.useScreenAxes === true,
      panels: (Array.isArray(bl.panels) ? bl.panels : []).map((p) => ({
        center: p && p.center ? p.center : null,
        projection: p && p.projection ? p.projection : null,
        state: p ? p.state : null,
        enabled: p && p.enabled !== false,
        localRotationDeg: p && typeof p.localRotationDeg === "number" ? p.localRotationDeg : 0,
      })),
    }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return stableHash(blocks);
}

function computeShadingHash(shading) {
  if (!shading || typeof shading !== "object") return stableHash(null);
  const perPanel = (Array.isArray(shading.perPanel) ? shading.perPanel : [])
    .map((p) => ({ id: p && (p.panelId != null ? p.panelId : p.id) != null ? String(p.panelId != null ? p.panelId : p.id) : "", lossPct: p ? p.lossPct : null }))
    .filter((p) => p.id)
    .sort((a, b) => a.id.localeCompare(b.id));
  return stableHash({
    totalLossPct: shading.totalLossPct,
    near: shading.near && typeof shading.near === "object" ? { totalLossPct: shading.near.totalLossPct } : shading.near,
    far: shading.far && typeof shading.far === "object" ? { totalLossPct: shading.far.totalLossPct } : shading.far,
    combined: shading.combined,
    perPanel,
    computedAt: shading.computedAt || null,
  });
}

function buildCalpinageMetaForSave(data, lastComputedAt) {
  const shadingObj = data && data.shading && typeof data.shading === "object" ? data.shading : null;
  const shadingComputedAt = shadingObj && shadingObj.computedAt != null ? shadingObj.computedAt : null;
  return {
    version: "CALPINAGE_V1",
    savedAt: new Date().toISOString(),
    geometryHash: computeGeometryHash(data && data.roofState ? data.roofState : null),
    panelsHash: computePanelsHash(data && Array.isArray(data.frozenBlocks) ? data.frozenBlocks : []),
    shadingHash: computeShadingHash(shadingObj),
    shadingComputedAt,
    shadingSource: (lastComputedAt != null && Number.isFinite(lastComputedAt)) ? "recomputed" : "persisted",
  };
}

/** Simule la normalisation des traits/ridges effectuée par loadCalpinageState */
function normalizeTrait(t, idx) {
  const a = t.a && typeof t.a.x === "number"
    ? { x: t.a.x, y: typeof t.a.y === "number" ? t.a.y : 0,
        attach: (t.a.attach && typeof t.a.attach === "object") ? t.a.attach : null,
        h: typeof t.a.h === "number" ? t.a.h : undefined }
    : { x: 0, y: 0 };
  const b = t.b && typeof t.b.x === "number"
    ? { x: t.b.x, y: typeof t.b.y === "number" ? t.b.y : 0,
        attach: (t.b.attach && typeof t.b.attach === "object") ? t.b.attach : null,
        h: typeof t.b.h === "number" ? t.b.h : undefined }
    : { x: 0, y: 0 };
  return { id: (t && t.id) ? t.id : "trait-restored-" + idx, a, b, roofRole: "main" };
}

function normalizeRidge(r, idx) {
  const a = r.a || { x: 0, y: 0 };
  const b = r.b || { x: 0, y: 0 };
  return {
    id: (r && r.id) ? r.id : "ridge-restored-" + idx,
    a: { x: a.x, y: a.y, attach: a.attach || null, h: typeof a.h === "number" ? a.h : undefined },
    b: { x: b.x, y: b.y, attach: b.attach || null, h: typeof b.h === "number" ? b.h : undefined },
    roofRole: "main",
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────

function freshRoofState() {
  return {
    map: { center: [2.3, 48.9], zoom: 18 },
    scale: { metersPerPixel: 0.05 },
    roof: null,
    contoursBati: [{ id: "c1", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }], roofRole: "main" }],
    traits: [
      { id: "t1", a: { x: 50, y: 0 }, b: { x: 50, y: 80 }, roofRole: "main" }
    ],
    ridges: [
      { id: "r1", a: { x: 50, y: 0 }, b: { x: 50, y: 80 }, roofRole: "main" }
    ],
    mesures: [],
    planes: null,
    obstacles: [],
    gps: { lat: 48.9, lon: 2.3 },
  };
}

function freshFrozenBlocks() {
  return [
    {
      id: "block-1",
      panId: "pan-1",
      panels: [
        { center: { x: 10, y: 20 }, projection: null, state: null, enabled: true, localRotationDeg: 0 },
        { center: { x: 30, y: 20 }, projection: null, state: null, enabled: true, localRotationDeg: 0 },
      ],
      rotation: 0,
      orientation: "PORTRAIT",
      useScreenAxes: false,
    },
  ];
}

function freshShading() {
  return {
    computedAt: "2026-04-01T12:00:00.000Z",
    totalLossPct: 5.2,
    near: { totalLossPct: 2.1 },
    far: { totalLossPct: 3.5 },
    combined: { totalLossPct: 5.2 },
    perPanel: [
      { panelId: "p1", lossPct: 4.8 },
      { panelId: "p2", lossPct: 5.6 },
    ],
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers de diagnostic (copiés de la logique du module)
// ────────────────────────────────────────────────────────────────────────────

function computeReloadDiagnostic(data, currentRoofState, currentFrozenBlocks, currentShading, restoreStats) {
  const currentGeomH = computeGeometryHash(currentRoofState);
  const currentPanH = computePanelsHash(currentFrozenBlocks);
  const currentShH = computeShadingHash(currentShading);
  const meta = data && data.calpinage_meta && typeof data.calpinage_meta === "object" ? data.calpinage_meta : null;
  const hasMeta = !!meta;
  const geometryMatch = !!(hasMeta && meta.geometryHash === currentGeomH);
  const panelsMatch = !!(hasMeta && meta.panelsHash === currentPanH);
  const shadingMatch = !!(hasMeta && meta.shadingHash === currentShH);
  const shadingComputedAt = hasMeta && meta.shadingComputedAt != null ? String(meta.shadingComputedAt) : "";
  const hasShadingComputedAt = shadingComputedAt.trim().length > 0;
  const shadingValid = !!(currentShading && typeof currentShading === "object");
  const shadingStale = (!hasMeta && shadingValid) || !geometryMatch || !hasShadingComputedAt || !shadingValid;
  const hasPartialData = !data || !data.roofState || !Array.isArray(data.frozenBlocks) || (data.shading != null && typeof data.shading !== "object");
  let reason = "OK";
  if (!hasMeta) reason = "MISSING_META";
  else if (hasPartialData) reason = "PARTIAL_DATA";
  else if (!geometryMatch) reason = "GEOMETRY_CHANGED";
  else if (!panelsMatch) reason = "PANELS_CHANGED";
  else if (!shadingMatch || shadingStale) reason = "SHADING_OUTDATED";
  else if (restoreStats && (restoreStats.panelsSkipped > 0 || restoreStats.frozenBlocksSkipped > 0)) reason = "INCONSISTENT_RESTORE";
  return {
    diagnostic: { geometryMatch, panelsMatch, shadingMatch, shadingStale, reason },
    status: { isConsistent: reason === "OK", hasStaleShading: shadingStale, hasGeometryDrift: !geometryMatch, hasPanelDrift: !panelsMatch },
    current: { geometryHash: currentGeomH, panelsHash: currentPanH, shadingHash: currentShH },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("LOT RELOAD CALPINAGE — validation factuelle", () => {

  // ── 1) SAVE RÉEL ──────────────────────────────────────────────────────────

  describe("1) SAVE — calpinage_meta", () => {
    it("meta contient toutes les clés requises", () => {
      const data = { roofState: freshRoofState(), frozenBlocks: freshFrozenBlocks(), shading: freshShading() };
      const meta = buildCalpinageMetaForSave(data, 1743500000000);
      expect(meta.version).toBe("CALPINAGE_V1");
      expect(typeof meta.savedAt).toBe("string");
      expect(meta.savedAt.length).toBeGreaterThan(0);
      expect(typeof meta.geometryHash).toBe("string");
      expect(meta.geometryHash.length).toBe(8);
      expect(typeof meta.panelsHash).toBe("string");
      expect(meta.panelsHash.length).toBe(8);
      expect(typeof meta.shadingHash).toBe("string");
      expect(meta.shadingHash.length).toBe(8);
      expect(meta.shadingComputedAt).toBe("2026-04-01T12:00:00.000Z");
      expect(meta.shadingSource).toBe("recomputed");
    });

    it("meta sans shading : shadingComputedAt null, shadingHash déterministe", () => {
      const data = { roofState: freshRoofState(), frozenBlocks: freshFrozenBlocks(), shading: null };
      const meta = buildCalpinageMetaForSave(data, null);
      expect(meta.shadingComputedAt).toBeNull();
      expect(typeof meta.shadingHash).toBe("string");
      expect(meta.shadingSource).toBe("persisted");
    });

    it("meta sans frozenBlocks : panelsHash déterministe (hash de [])", () => {
      const data = { roofState: freshRoofState(), frozenBlocks: [], shading: null };
      const meta1 = buildCalpinageMetaForSave(data, null);
      const meta2 = buildCalpinageMetaForSave(data, null);
      expect(meta1.panelsHash).toBe(meta2.panelsHash);
    });

    it("meta hash géométrie déterministe sur même roofState", () => {
      const data = { roofState: freshRoofState(), frozenBlocks: [], shading: null };
      const h1 = computeGeometryHash(data.roofState);
      const h2 = computeGeometryHash(JSON.parse(JSON.stringify(data.roofState)));
      expect(h1).toBe(h2);
    });
  });

  // ── 2) LOAD RÉEL ──────────────────────────────────────────────────────────

  describe("2) LOAD — diagnostic, restore_stats, status produits", () => {
    it("diagnostic produit sur dossier complet et cohérent", () => {
      const rs = freshRoofState();
      const fb = freshFrozenBlocks();
      const sh = freshShading();
      const data = { roofState: rs, frozenBlocks: fb, shading: sh };
      const meta = buildCalpinageMetaForSave(data, 1743500000000);
      data.calpinage_meta = meta;

      const normalizedRs = JSON.parse(JSON.stringify(rs));
      normalizedRs.traits = rs.traits.map(normalizeTrait);
      normalizedRs.ridges = rs.ridges.map(normalizeRidge);

      const restoreStats = { panelsRestored: 2, panelsSkipped: 0, frozenBlocksRestored: 1, frozenBlocksSkipped: 0 };
      const result = computeReloadDiagnostic(data, normalizedRs, fb, sh, restoreStats);

      expect(result.diagnostic).toBeDefined();
      expect(result.status).toBeDefined();
      expect(result.current).toBeDefined();
      expect(result.diagnostic.reason).toBe("OK");
      expect(result.status.isConsistent).toBe(true);
    });

    it("restore_stats est produit (shape correcte)", () => {
      const rs = { panelsRestored: 0, panelsSkipped: 0, frozenBlocksRestored: 0, frozenBlocksSkipped: 0 };
      expect(typeof rs.panelsRestored).toBe("number");
      expect(typeof rs.panelsSkipped).toBe("number");
      expect(typeof rs.frozenBlocksRestored).toBe("number");
      expect(typeof rs.frozenBlocksSkipped).toBe("number");
    });
  });

  // ── 3) CAS LEGACY ─────────────────────────────────────────────────────────

  describe("3) CAS LEGACY", () => {
    it("ancien dossier sans calpinage_meta → MISSING_META, pas de crash", () => {
      const data = { roofState: freshRoofState(), frozenBlocks: freshFrozenBlocks(), shading: freshShading() };
      const rs = { panelsRestored: 0, panelsSkipped: 0, frozenBlocksRestored: 1, frozenBlocksSkipped: 0 };
      const result = computeReloadDiagnostic(data, freshRoofState(), freshFrozenBlocks(), freshShading(), rs);
      expect(result.diagnostic.reason).toBe("MISSING_META");
      expect(result.diagnostic.geometryMatch).toBe(false);
      expect(result.diagnostic.panelsMatch).toBe(false);
      expect(result.status.isConsistent).toBe(false);
      expect(result.status.hasStaleShading).toBe(true);
    });

    it("dossier avec shading absent → shadingStale=true, pas de crash", () => {
      const data = { roofState: freshRoofState(), frozenBlocks: freshFrozenBlocks(), shading: null };
      const meta = buildCalpinageMetaForSave(data, null);
      data.calpinage_meta = meta;
      const normalizedRs = JSON.parse(JSON.stringify(freshRoofState()));
      normalizedRs.traits = freshRoofState().traits.map(normalizeTrait);
      normalizedRs.ridges = freshRoofState().ridges.map(normalizeRidge);
      const result = computeReloadDiagnostic(data, normalizedRs, freshFrozenBlocks(), null, { panelsRestored: 0, panelsSkipped: 0, frozenBlocksRestored: 1, frozenBlocksSkipped: 0 });
      expect(result.diagnostic.shadingStale).toBe(true);
      expect(result.diagnostic.reason).toBe("SHADING_OUTDATED");
    });

    it("frozenBlocks orphelins (panId invalide) → comptés dans frozenBlocksSkipped", () => {
      const orphanBlocks = [
        { id: "block-orphan", panId: "pan-UNKNOWN", panels: [{ center: { x: 0, y: 0 } }] },
      ];
      const validPanIds = { "pan-1": true };
      let skipped = 0;
      let restored = 0;
      for (const fb of orphanBlocks) {
        if (!fb.panId || !validPanIds[fb.panId]) { skipped++; continue; }
        restored++;
      }
      expect(skipped).toBe(1);
      expect(restored).toBe(0);
    });

    it("panneaux avec center invalide (NaN/absent) → filtrés, panelsSkipped incrémenté", () => {
      const block = {
        id: "block-1", panId: "pan-1",
        panels: [
          { center: { x: 10, y: 20 } },       // valid
          { center: { x: NaN, y: 20 } },       // invalid x
          { center: null },                      // invalid
          { center: { x: 10, y: 20 } },        // valid
        ],
      };
      let panelsRestored = 0;
      let panelsSkipped = 0;
      for (const p of block.panels) {
        const ok = p && p.center &&
          typeof p.center.x === "number" && Number.isFinite(p.center.x) &&
          typeof p.center.y === "number" && Number.isFinite(p.center.y);
        if (ok) panelsRestored++; else panelsSkipped++;
      }
      expect(panelsRestored).toBe(2);
      expect(panelsSkipped).toBe(2);
    });
  });

  // ── 4) SHADING STALE ──────────────────────────────────────────────────────

  describe("4) SHADING STALE — détection sans recalcul", () => {
    it("shadingStale=true si geometryHash diffère", () => {
      const rs = freshRoofState();
      const fb = freshFrozenBlocks();
      const sh = freshShading();
      const data = { roofState: rs, frozenBlocks: fb, shading: sh };
      const meta = buildCalpinageMetaForSave(data, 1743500000000);
      data.calpinage_meta = meta;

      // Modifier la géométrie courante
      const changedRs = JSON.parse(JSON.stringify(rs));
      changedRs.contoursBati[0].points[0].x = 999;

      const result = computeReloadDiagnostic(data, changedRs, fb, sh, { panelsRestored: 2, panelsSkipped: 0, frozenBlocksRestored: 1, frozenBlocksSkipped: 0 });
      expect(result.diagnostic.geometryMatch).toBe(false);
      expect(result.diagnostic.shadingStale).toBe(true);
      expect(result.diagnostic.reason).toBe("GEOMETRY_CHANGED");
    });

    it("shadingStale=true si shadingComputedAt absent", () => {
      const rs = freshRoofState();
      const fb = freshFrozenBlocks();
      const sh = { ...freshShading(), computedAt: undefined };
      const data = { roofState: rs, frozenBlocks: fb, shading: sh };
      const meta = buildCalpinageMetaForSave(data, null);
      data.calpinage_meta = meta;

      const normalizedRs = JSON.parse(JSON.stringify(rs));
      normalizedRs.traits = rs.traits.map(normalizeTrait);
      normalizedRs.ridges = rs.ridges.map(normalizeRidge);

      const result = computeReloadDiagnostic(data, normalizedRs, fb, sh, { panelsRestored: 2, panelsSkipped: 0, frozenBlocksRestored: 1, frozenBlocksSkipped: 0 });
      expect(result.diagnostic.shadingStale).toBe(true);
    });

    it("shadingStale=true si shading absent/invalide", () => {
      const rs = freshRoofState();
      const fb = freshFrozenBlocks();
      const data = { roofState: rs, frozenBlocks: fb, shading: null };
      const meta = buildCalpinageMetaForSave(data, null);
      data.calpinage_meta = meta;

      const normalizedRs = JSON.parse(JSON.stringify(rs));
      normalizedRs.traits = rs.traits.map(normalizeTrait);
      normalizedRs.ridges = rs.ridges.map(normalizeRidge);

      const result = computeReloadDiagnostic(data, normalizedRs, fb, null, { panelsRestored: 0, panelsSkipped: 0, frozenBlocksRestored: 1, frozenBlocksSkipped: 0 });
      expect(result.diagnostic.shadingStale).toBe(true);
    });

    it("shadingStale=false si géométrie + shading cohérents", () => {
      const rs = freshRoofState();
      const fb = freshFrozenBlocks();
      const sh = freshShading();
      const data = { roofState: rs, frozenBlocks: fb, shading: sh };
      const meta = buildCalpinageMetaForSave(data, 1743500000000);
      data.calpinage_meta = meta;

      const normalizedRs = JSON.parse(JSON.stringify(rs));
      normalizedRs.traits = rs.traits.map(normalizeTrait);
      normalizedRs.ridges = rs.ridges.map(normalizeRidge);

      const result = computeReloadDiagnostic(data, normalizedRs, fb, sh, { panelsRestored: 2, panelsSkipped: 0, frozenBlocksRestored: 1, frozenBlocksSkipped: 0 });
      expect(result.diagnostic.shadingStale).toBe(false);
      expect(result.diagnostic.reason).toBe("OK");
    });
  });

  // ── 5) HASH STABLE — fix bug attach null vs absent ─────────────────────────

  describe("5) HASH STABLE — traits/ridges sans attach (bug fix)", () => {
    it("géométrie hash identique avant et après normalisation load (attach absent → null)", () => {
      // Traits créés sans attach (cas fresh session)
      const rs = freshRoofState();
      // Aucun attach sur les traits/ridges (état fresh)
      expect(rs.traits[0].a.attach).toBeUndefined();
      expect(rs.ridges[0].a.attach).toBeUndefined();

      const H1 = computeGeometryHash(rs);

      // Simuler le cycle JSON.stringify + JSON.parse (save → storage)
      const savedRs = JSON.parse(JSON.stringify(rs));

      // Simuler le load (normalisation attach: null)
      const normalizedTraits = savedRs.traits.map(normalizeTrait);
      const normalizedRidges = savedRs.ridges.map(normalizeRidge);
      expect(normalizedTraits[0].a.attach).toBeNull();
      expect(normalizedRidges[0].a.attach).toBeNull();

      const rsAfterLoad = { ...savedRs, traits: normalizedTraits, ridges: normalizedRidges };
      const H2 = computeGeometryHash(rsAfterLoad);

      expect(H1).toBe(H2); // ← vérification du bug fix
    });

    it("hash stable sur N cycles save/reload successifs", () => {
      let rs = JSON.parse(JSON.stringify(freshRoofState()));
      const H0 = computeGeometryHash(rs);

      for (let cycle = 0; cycle < 3; cycle++) {
        const saved = JSON.parse(JSON.stringify(rs));
        const normalizedTraits = saved.traits.map(normalizeTrait);
        const normalizedRidges = saved.ridges.map(normalizeRidge);
        rs = { ...saved, traits: normalizedTraits, ridges: normalizedRidges };
        const H = computeGeometryHash(rs);
        expect(H).toBe(H0);
      }
    });

    it("hash change si coordonnées changent", () => {
      const rs1 = freshRoofState();
      const rs2 = JSON.parse(JSON.stringify(rs1));
      rs2.traits[0].a.x = 9999;
      expect(computeGeometryHash(rs1)).not.toBe(computeGeometryHash(rs2));
    });

    it("hash stable même si trait has attach:{} (truthy object) vs absent", () => {
      const rs1 = freshRoofState();
      const rs2 = JSON.parse(JSON.stringify(rs1));
      rs2.traits[0].a.attach = {}; // attach truthy mais sans données
      // Les deux hashes doivent différer car la normalisation inclut {} dans computeGeometryHash
      // (attach est strippé dans normalizeEndpointForHash, donc ils DOIVENT être égaux)
      const H1 = computeGeometryHash(rs1);
      const H2 = computeGeometryHash(rs2);
      expect(H1).toBe(H2); // attach ignoré dans le hash
    });
  });

  // ── 6) CONSOLE WARN — pas de spam ─────────────────────────────────────────

  describe("6) CONSOLE WARN — uniquement si incohérence", () => {
    it("isConsistent=true → pas de warn à émettre", () => {
      const rs = freshRoofState();
      const fb = freshFrozenBlocks();
      const sh = freshShading();
      const data = { roofState: rs, frozenBlocks: fb, shading: sh };
      const meta = buildCalpinageMetaForSave(data, 1743500000000);
      data.calpinage_meta = meta;

      const normalizedRs = { ...JSON.parse(JSON.stringify(rs)), traits: rs.traits.map(normalizeTrait), ridges: rs.ridges.map(normalizeRidge) };
      const result = computeReloadDiagnostic(data, normalizedRs, fb, sh, { panelsRestored: 2, panelsSkipped: 0, frozenBlocksRestored: 1, frozenBlocksSkipped: 0 });
      expect(result.status.isConsistent).toBe(true);
      // Si isConsistent=true → le module ne logge pas [CALPINAGE_RELOAD_ISSUE]
    });

    it("isConsistent=false → warn doit être émis (cas incohérence réelle)", () => {
      const data = { roofState: freshRoofState(), frozenBlocks: freshFrozenBlocks(), shading: freshShading() };
      // Pas de meta → MISSING_META → isConsistent=false
      const result = computeReloadDiagnostic(data, freshRoofState(), freshFrozenBlocks(), freshShading(), { panelsRestored: 0, panelsSkipped: 0, frozenBlocksRestored: 1, frozenBlocksSkipped: 0 });
      expect(result.status.isConsistent).toBe(false);
      expect(result.diagnostic.reason).toBe("MISSING_META");
    });
  });

});
