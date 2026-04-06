import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { imagePxToWorldHorizontalM } from "../../builder/worldMapping";
import type { CanonicalHouseDocument } from "../../model/canonicalHouse3DModel";
import { parseCalpinageStateToCanonicalHouse3D } from "../../parsing/parseCalpinageStateToCanonicalHouse3D";
import { adaptCanonicalHouseLocalToWorldScene } from "../adaptCanonicalHouseLocalToWorldScene";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadCalpinageFixture(name: string): Record<string, unknown> {
  const raw = readFileSync(join(__dirname, "../../parsing/dev", name), "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

function loadStubCanonical(): CanonicalHouseDocument {
  const raw = readFileSync(join(__dirname, "../dev/canonical-house-document-stub.json"), "utf-8");
  return JSON.parse(raw) as CanonicalHouseDocument;
}

describe("adaptCanonicalHouseLocalToWorldScene", () => {
  it("identité numérique : sommets monde = sommets locaux (parseur officiel)", () => {
    const state = loadCalpinageFixture("state-simple-2pans.json");
    const parsed = parseCalpinageStateToCanonicalHouse3D(state, {});
    const doc = parsed.document;
    const r = adaptCanonicalHouseLocalToWorldScene(doc, {});
    const patch = doc.roof.geometry.roofPatches[0];
    const worldPatch = r.scene.roof.patches[0];
    expect(patch?.boundaryLoop3d.length).toBe(worldPatch?.boundaryLoopWorld.length);
    for (let i = 0; i < (patch?.boundaryLoop3d.length ?? 0); i++) {
      const a = patch!.boundaryLoop3d[i]!;
      const b = worldPatch!.boundaryLoopWorld[i]!;
      expect(b.x).toBeCloseTo(a.x);
      expect(b.y).toBeCloseTo(a.y);
      expect(b.z).toBeCloseTo(a.z);
    }
    expect(r.diagnostics.some((d) => d.code === "LOCAL_WORLD_NUMERIC_IDENTITY")).toBe(true);
  });

  it("footprint_centroid_xy_to_origin : centroid XY ramené à ~0", () => {
    const state = loadCalpinageFixture("state-simple-2pans.json");
    const doc = parseCalpinageStateToCanonicalHouse3D(state, {}).document;
    const r = adaptCanonicalHouseLocalToWorldScene(doc, { sceneOriginMode: "footprint_centroid_xy_to_origin" });
    const pts = r.scene.building.footprintWorld.points;
    let sx = 0;
    let sy = 0;
    for (const p of pts) {
      sx += p.x;
      sy += p.y;
    }
    expect(sx / pts.length).toBeCloseTo(0, 5);
    expect(sy / pts.length).toBeCloseTo(0, 5);
    expect(r.diagnostics.some((d) => d.code === "SCENE_ORIGIN_FOOTPRINT_CENTROID")).toBe(true);
  });

  it("satellite avec rotation nord ≠ 0 : coins alignés sur worldMapping", () => {
    const state = loadCalpinageFixture("state-simple-2pans.json");
    const doc = parseCalpinageStateToCanonicalHouse3D(state, {}).document;
    const mpp = 0.05;
    const north = 30;
    const docNorth: CanonicalHouseDocument = {
      ...doc,
      worldPlacement: { ...doc.worldPlacement, metersPerPixel: mpp, northAngleDeg: north, imageSpaceOriginPolicy: "imagePxToWorldHorizontalM" },
    };
    const r = adaptCanonicalHouseLocalToWorldScene(docNorth, {
      satelliteImageExtentsPx: { width: 400, height: 300 },
    });
    const c0 = imagePxToWorldHorizontalM(0, 0, mpp, north);
    expect(r.scene.satelliteBackdrop!.cornersWorld[0].x).toBeCloseTo(c0.x);
    expect(r.scene.satelliteBackdrop!.cornersWorld[0].y).toBeCloseTo(c0.y);
  });

  it("satellite : coins = imagePxToWorldHorizontalM + même chaîne que le bâtiment", () => {
    const state = loadCalpinageFixture("state-simple-2pans.json");
    const doc = parseCalpinageStateToCanonicalHouse3D(state, {}).document;
    const mpp = doc.worldPlacement?.metersPerPixel ?? 0.05;
    const north = doc.worldPlacement?.northAngleDeg ?? 0;
    const W = 800;
    const H = 600;
    const r = adaptCanonicalHouseLocalToWorldScene(doc, {
      satelliteImageExtentsPx: { width: W, height: H },
      satelliteZOffsetM: -0.01,
    });
    expect(r.scene.satelliteBackdrop).toBeDefined();
    const corners = r.scene.satelliteBackdrop!.cornersWorld;
    const expected0 = imagePxToWorldHorizontalM(0, 0, mpp, north);
    expect(corners[0].x).toBeCloseTo(expected0.x);
    expect(corners[0].y).toBeCloseTo(expected0.y);
    expect(corners[0].z).toBeCloseTo(-0.01);
    expect(r.diagnostics.some((d) => d.code === "SATELLITE_BACKDROP_EMITTED")).toBe(true);
  });

  it("monde incomplet : warning mpp et pas de satellite", () => {
    const stub = loadStubCanonical();
    const doc: CanonicalHouseDocument = {
      ...stub,
      worldPlacement: { northAngleDeg: 0 },
    };
    const r = adaptCanonicalHouseLocalToWorldScene(doc, { satelliteImageExtentsPx: { width: 100, height: 100 } });
    expect(r.diagnostics.some((d) => d.code === "METERS_PER_PIXEL_MISSING")).toBe(true);
    expect(r.scene.satelliteBackdrop).toBeUndefined();
    expect(r.diagnostics.some((d) => d.code === "SATELLITE_PLACEMENT_UNAVAILABLE")).toBe(true);
  });

  it("policy imageSpaceOriginPolicy non standard → warning", () => {
    const r = adaptCanonicalHouseLocalToWorldScene(loadStubCanonical(), {});
    expect(r.diagnostics.some((d) => d.code === "LOCAL_WORLD_ASSUMED_IDENTITY_UNDOCUMENTED_POLICY")).toBe(true);
  });

  it("Phase 3 : PV présents dans la scène monde", () => {
    const state = loadCalpinageFixture("state-simple-2pans.json");
    const doc = parseCalpinageStateToCanonicalHouse3D(state, {
      frozenPvBlocks: [
        {
          id: "b1",
          panId: "pan-a",
          rotation: 0,
          panels: [{ id: "p1", center: { x: 50, y: 50 }, localRotationDeg: 0 }],
        },
      ],
    }).document;
    expect(doc.pv?.pvPanels.length).toBeGreaterThan(0);
    const r = adaptCanonicalHouseLocalToWorldScene(doc, {});
    expect(r.scene.pv?.panels).toHaveLength(1);
    const localT = doc.pv!.pvPanels[0]!.panelLocalTransform.translation;
    const w = r.scene.pv!.panels[0]!.positionWorld;
    expect(w.x).toBeCloseTo(localT.x);
    expect(w.y).toBeCloseTo(localT.y);
    expect(w.z).toBeCloseTo(localT.z);
    expect(r.diagnostics.some((d) => d.code === "PV_SCENE_PHASE3_INCLUDED")).toBe(true);
  });

  it("sceneTranslationM appliquée partout", () => {
    const stub = loadStubCanonical();
    const doc: CanonicalHouseDocument = {
      ...stub,
      worldPlacement: {
        northAngleDeg: 0,
        metersPerPixel: 0.05,
        imageSpaceOriginPolicy: "imagePxToWorldHorizontalM",
      },
    };
    const r = adaptCanonicalHouseLocalToWorldScene(doc, { sceneTranslationM: { x: 1, y: -2, z: 3 } });
    const p = r.scene.building.footprintWorld.points[0];
    expect(p.x).toBeCloseTo(1);
    expect(p.y).toBeCloseTo(-2);
    expect(p.z).toBeCloseTo(3);
  });
});
