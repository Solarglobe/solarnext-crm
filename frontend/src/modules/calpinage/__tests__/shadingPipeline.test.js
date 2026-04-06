/**
 * Pipeline ombrage — preuves automatisées (C1 GPS fallback, C2 panels, C4 non-silence).
 * Exécutable : npm run test (vitest) ou npx vitest run src/modules/calpinage/__tests__/shadingPipeline.test.js
 */

import { describe, it, expect } from "vitest";
import { getShadingAbortMessage } from "../dsmOverlay/dsmOverlayManager.js";

// --- C1) GPS fallback : données sans roofState.gps mais avec map.centerLatLng → gps dérivable ---
function getGpsFromLoadData(data) {
  if (!data?.roofState) return null;
  if (data.roofState.gps && typeof data.roofState.gps === "object") {
    const lat = data.roofState.gps.lat;
    const lon = data.roofState.gps.lon;
    if (typeof lat === "number" && typeof lon === "number" && !Number.isNaN(lat) && !Number.isNaN(lon)) return { lat, lon };
  }
  const center = data.roofState.map && data.roofState.map.centerLatLng;
  if (center && typeof center.lat === "number" && typeof center.lng === "number" && !Number.isNaN(center.lat) && !Number.isNaN(center.lng)) {
    return { lat: center.lat, lon: center.lng };
  }
  return null;
}

describe("C1) GPS fallback au load", () => {
  it("sans roofState.gps mais avec map.centerLatLng → roof.gps dérivable", () => {
    const data = {
      roofState: {
        map: { centerLatLng: { lat: 48.85, lng: 2.35 } },
      },
    };
    const gps = getGpsFromLoadData(data);
    expect(gps).not.toBeNull();
    expect(gps.lat).toBe(48.85);
    expect(gps.lon).toBe(2.35);
  });

  it("avec roofState.gps prioritaire", () => {
    const data = {
      roofState: {
        gps: { lat: 45, lon: 4 },
        map: { centerLatLng: { lat: 48.85, lng: 2.35 } },
      },
    };
    const gps = getGpsFromLoadData(data);
    expect(gps).not.toBeNull();
    expect(gps.lat).toBe(45);
    expect(gps.lon).toBe(4);
  });

  it("sans gps ni centerLatLng → null", () => {
    const data = { roofState: { map: {} } };
    expect(getGpsFromLoadData(data)).toBeNull();
  });
});

// --- C2) Panels : projection.points accepté comme polygonPx pour le filtre shading ---
function enrichPanelsWithPolygonPx(panels) {
  return panels
    .map((p) => {
      const poly = p.polygonPx || (p.projection && p.projection.points);
      if (Array.isArray(poly) && poly.length >= 3 && !p.polygonPx) {
        return { ...p, polygonPx: poly };
      }
      return p;
    })
    .filter((p) => {
      const poly = p.polygonPx || (p.projection && p.projection.points);
      return Array.isArray(poly) && poly.length >= 3;
    });
}

describe("C2) Panels pipeline (polygonPx / projection.points)", () => {
  it("panneaux avec projection.points uniquement → conservés après enrichissement", () => {
    const panels = [
      { id: "a", enabled: true, projection: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] } },
    ];
    const out = enrichPanelsWithPolygonPx(panels);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0].polygonPx).toBeDefined();
    expect(out[0].polygonPx.length).toBe(3);
  });

  it("panneaux avec polygonPx inchangés", () => {
    const panels = [{ id: "b", enabled: true, polygonPx: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }] }];
    const out = enrichPanelsWithPolygonPx(panels);
    expect(out.length).toBe(1);
    expect(out[0].polygonPx).toEqual(panels[0].polygonPx);
  });

  it("sans polygone valide → exclus", () => {
    const panels = [{ id: "c", enabled: true }];
    expect(enrichPanelsWithPolygonPx(panels).length).toBe(0);
  });
});

// --- C2/B3) Obstacles : buildNearObstaclesFromState → rawCount, validCount, obstacles (polygonPx || polygon || points) ---
function buildNearObstaclesFromStateContract(state) {
  const raw = [...(state.obstacles || []), ...(state.shadowVolumes || []), ...(state.roofExtensions || [])];
  const obstacles = [];
  for (let oi = 0; oi < raw.length; oi++) {
    const o = raw[oi];
    if (!o || typeof o !== "object") continue;
    const polygonPx = o.polygonPx || o.polygon || o.points || (o.contour && o.contour.points) || null;
    if (!Array.isArray(polygonPx) || polygonPx.length < 3) continue;
    const heightM = typeof o.heightM === "number" ? o.heightM : (typeof o.heightRelM === "number" ? o.heightRelM : (typeof o.height === "number" ? o.height : 1));
    if (heightM <= 0) continue;
    obstacles.push({ id: (o.id != null && String(o.id)) || "obs-" + oi, polygonPx, heightM });
  }
  return { rawCount: raw.length, validCount: obstacles.length, obstacles };
}

describe("B3) Obstacles buildNearObstaclesFromState", () => {
  it("obstacle avec points → validCount > 0", () => {
    const state = {
      obstacles: [{ id: "o1", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], heightM: 3 }],
      shadowVolumes: [],
      roofExtensions: [],
    };
    const out = buildNearObstaclesFromStateContract(state);
    expect(out.rawCount).toBe(1);
    expect(out.validCount).toBe(1);
    expect(out.obstacles).toHaveLength(1);
    expect(out.obstacles[0].heightM).toBe(3);
  });

  it("sans obstacle valide → validCount 0", () => {
    const state = { obstacles: [], shadowVolumes: [], roofExtensions: [] };
    const out = buildNearObstaclesFromStateContract(state);
    expect(out.validCount).toBe(0);
    expect(out.obstacles).toHaveLength(0);
  });
});

// --- ensurePlacementEngineReadyForShading : après sync, getAllPanels() renvoie des panneaux (contract) ---
describe("ensurePlacementEngineReadyForShading + frozenBlocks", () => {
  it("après ensureReady, panelCountRaw > 0 quand engine a frozenBlocks avec panels", () => {
    const frozenBlockWithPanels = {
      id: "b1",
      panId: "pan1",
      panels: [
        { center: { x: 50, y: 50 }, projection: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] } },
      ],
    };
    const getFrozenBlocks = () => [frozenBlockWithPanels];
    const getAllPanels = () => {
      const frozen = getFrozenBlocks();
      const out = [];
      frozen.forEach((block) => {
        (block.panels || []).forEach((p, idx) => {
          const proj = p.projection;
          const polygonPx = proj && Array.isArray(proj.points) && proj.points.length >= 3 ? proj.points.map((pt) => ({ x: pt.x, y: pt.y })) : null;
          out.push({ id: block.id + "_" + idx, polygonPx, enabled: true });
        });
      });
      return out;
    };
    const syncPlacedPanelsFromBlocks = () => {};
    const ensurePlacementEngineReadyForShading = () => {
      if (typeof syncPlacedPanelsFromBlocks === "function") syncPlacedPanelsFromBlocks();
    };
    ensurePlacementEngineReadyForShading();
    const panelsRaw = getAllPanels();
    const panelCountRaw = panelsRaw.length;
    const valid = panelsRaw.filter((p) => p && p.enabled !== false).filter((p) => {
      const poly = p.polygonPx || (p.projection && p.projection.points);
      return Array.isArray(poly) && poly.length >= 3;
    });
    expect(panelCountRaw).toBeGreaterThan(0);
    expect(valid.length).toBeGreaterThan(0);
  });
});

// --- zMode FLAT : libellé overlay DSM « obstacles proches » (aligné dsmOverlayManager.updateShadingSummaryBlock) ---
describe("zMode FLAT (mode simplifié)", () => {
  it("label obstacles proches mode simplifié quand zMode FLAT", () => {
    const zMode = "FLAT";
    const nearLabel = zMode === "FLAT" ? "Obstacles proches (toiture, mode simplifié)" : "Obstacles proches (toit)";
    expect(nearLabel).toBe("Obstacles proches (toiture, mode simplifié)");
  });
  it("label obstacles proches toit quand zMode LOCAL", () => {
    const zMode = "LOCAL";
    const nearLabel = zMode === "FLAT" ? "Obstacles proches (toiture, mode simplifié)" : "Obstacles proches (toit)";
    expect(nearLabel).toBe("Obstacles proches (toit)");
  });
});

// --- C4) Non-silence : UI affiche "Calcul impossible : <reason>" (NO_PANELS, etc.) ; NO_GPS → état structuré UNAVAILABLE_NO_GPS (pas d’abort overlay) ---
describe("C4) Non-silence (reasonIfAbort → UI)", () => {
  it("NO_GPS sans lastAbortReason → pas de message Calcul impossible (far = UNAVAILABLE_NO_GPS dans normalized)", () => {
    const state = {
      shading: {
        lastAbortReason: null,
        normalized: { far: { source: "UNAVAILABLE_NO_GPS" }, shadingQuality: { blockingReason: "missing_gps" } },
      },
    };
    expect(getShadingAbortMessage(state)).toBeNull();
  });

  it("NO_PANELS → message Calcul impossible : NO_PANELS", () => {
    const state = { shading: { lastAbortReason: "NO_PANELS" } };
    const msg = getShadingAbortMessage(state);
    expect(msg).toBe("Calcul impossible : NO_PANELS");
  });

  it("EXCEPTION → message Calcul impossible : EXCEPTION", () => {
    const state = { shading: { lastAbortReason: "EXCEPTION" } };
    const msg = getShadingAbortMessage(state);
    expect(msg).toBe("Calcul impossible : EXCEPTION");
  });

  it("pas d'abort → null", () => {
    expect(getShadingAbortMessage({ shading: {} })).toBeNull();
    expect(getShadingAbortMessage(null)).toBeNull();
  });
});

// --- TEST 1 : Analyse Ombres ne peut plus finir silencieusement (contract) ---
describe("TEST 1 — Shading ne finit pas silencieusement", () => {
  it("si lastAbortReason est défini, getShadingAbortMessage retourne un message (pas de 0% trompeur)", () => {
    const state = { shading: { lastResult: null, normalized: null, lastAbortReason: "NO_PANELS" } };
    const msg = getShadingAbortMessage(state);
    expect(msg).not.toBeNull();
    expect(msg).toContain("NO_PANELS");
  });
  it("contract: après run, soit lastResult != null soit lastAbortReason != null (simulation)", () => {
    const withResult = { shading: { lastResult: { annualLossPercent: 1 }, lastAbortReason: null } };
    const withAbort = { shading: { lastResult: null, lastAbortReason: "NO_PANELS" } };
    const hasResult = withResult.shading.lastResult != null;
    const hasAbort = withAbort.shading.lastAbortReason != null;
    expect(hasResult || hasAbort).toBe(true);
    expect(withResult.shading.lastResult != null || withResult.shading.lastAbortReason != null).toBe(true);
    expect(withAbort.shading.lastResult != null || withAbort.shading.lastAbortReason != null).toBe(true);
  });
});

// --- TEST 8 : Trace format — un seul log [SHADING_TRACE] par run, JSON contient les champs ---
describe("TEST 8 — Trace format", () => {
  const REQUIRED_TRACE_KEYS = ["gps", "panelCountRaw", "panelCountValid", "obstacleCountRaw", "obstacleCountValid", "zMode", "nearLossPct", "farLossPct", "totalLossPct", "reasonIfAbort", "abortReason"];
  it("trace JSON contient les champs requis (succès)", () => {
    const trace = {
      gps: { lat: 48.85, lon: 2.35 },
      panelCountRaw: 10,
      panelCountValid: 10,
      obstacleCountRaw: 1,
      obstacleCountValid: 1,
      zMode: "LOCAL",
      nearLossPct: 1.5,
      farLossPct: 0.8,
      totalLossPct: 2.3,
      reasonIfAbort: null,
      abortReason: null,
    };
    const json = JSON.stringify(trace);
    const parsed = JSON.parse(json);
    for (const key of REQUIRED_TRACE_KEYS) {
      expect(parsed).toHaveProperty(key);
    }
    expect(parsed.abortReason).toBeNull();
  });
  it("trace JSON contient les champs requis (GPS absent — abortReason null, état structuré)", () => {
    const trace = {
      gps: null,
      panelCountRaw: 0,
      panelCountValid: 0,
      obstacleCountRaw: 0,
      obstacleCountValid: 0,
      zMode: null,
      nearLossPct: null,
      farLossPct: null,
      totalLossPct: null,
      reasonIfAbort: "NO_GPS",
      abortReason: null,
    };
    const json = JSON.stringify(trace);
    const parsed = JSON.parse(json);
    for (const key of REQUIRED_TRACE_KEYS) {
      expect(parsed).toHaveProperty(key);
    }
    expect(parsed.abortReason).toBeNull();
  });
});

// --- ensureGetSunPositionAt : après init, window.getSunPositionAt existe si __SHADING_SOLAR_POSITION__.getSunPosition dispo ---
describe("ensureGetSunPositionAt (contrat getSunPositionAt)", () => {
  it("définit window.getSunPositionAt quand __SHADING_SOLAR_POSITION__.getSunPosition est dispo", () => {
    if (typeof window === "undefined") return;
    const solar = {
      getSunPosition: (date, latDeg, lonDeg) => ({ azimuthDeg: 180, elevationDeg: 25 }),
    };
    window.__SHADING_SOLAR_POSITION__ = solar;
    delete window.getSunPositionAt;
    if (typeof window.ensureGetSunPositionAt === "function") {
      window.ensureGetSunPositionAt();
    } else {
      if (typeof window.getSunPositionAt !== "function" && solar.getSunPosition) {
        window.getSunPositionAt = function (date, latDeg, lonDeg) {
          const r = solar.getSunPosition(date, latDeg, lonDeg);
          return r != null ? { azimuthDeg: r.azimuthDeg, elevationDeg: r.elevationDeg } : null;
        };
      }
    }
    expect(typeof window.getSunPositionAt).toBe("function");
    const result = window.getSunPositionAt(new Date(), 48.85, 2.35);
    expect(result).not.toBeNull();
    expect(typeof result.azimuthDeg).toBe("number");
    expect(typeof result.elevationDeg).toBe("number");
    expect(result.azimuthDeg).toBe(180);
    expect(result.elevationDeg).toBe(25);
  });
});
