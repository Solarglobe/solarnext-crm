/**
 * Propagation de jonctions explicites (trait / contour) — Phase 2.
 */
import { describe, it, expect } from "vitest";
import {
  propagateExplicitTraitJunction,
  propagateExplicitContourJunction,
  propagateLinkedEndpointsAfterDrag,
  propagateRoofContourEdgeJunctionAfterContourEdit,
  fixContourVertexDeleteAttaches,
  fixContourVertexInsertAttaches,
} from "../junctionPropagationPhase2.js";

describe("junctionPropagationPhase2", () => {
  it("A — deux traits : alias attach trait suit le sommet canonique", () => {
    var t1 = {
      id: "t1",
      roofRole: "main",
      a: { x: 0, y: 0 },
      b: { x: 10, y: 0 },
    };
    var t2 = {
      id: "t2",
      roofRole: "main",
      a: { x: 5, y: 5 },
      b: { x: 0, y: 0, attach: { type: "trait", id: "t1", pointIndex: 0 } },
    };
    var traits = [t1, t2];
    var ridges = [];
    propagateExplicitTraitJunction(traits, ridges, "t1", 0, 3, 4);
    expect(t1.a.x).toBe(3);
    expect(t1.a.y).toBe(4);
    expect(t2.b.x).toBe(3);
    expect(t2.b.y).toBe(4);
  });

  it("B — faîtage avec attach trait suit le sommet trait", () => {
    var t1 = { id: "t1", roofRole: "main", a: { x: 1, y: 1 }, b: { x: 9, y: 1 } };
    var r1 = {
      id: "r1",
      roofRole: "main",
      a: { x: 1, y: 1, attach: { type: "trait", id: "t1", pointIndex: 0 } },
      b: { x: 5, y: 9 },
    };
    propagateExplicitTraitJunction([t1], [r1], "t1", 0, 2, 2);
    expect(t1.a.x).toBe(2);
    expect(r1.a.x).toBe(2);
    expect(r1.a.y).toBe(2);
  });

  it("C — contour : sommet partagé synchronise les extrémités attachées", () => {
    var c = {
      id: "c1",
      roofRole: "main",
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    };
    var t1 = {
      id: "t1",
      roofRole: "main",
      a: { x: 0, y: 0, attach: { type: "contour", id: "c1", pointIndex: 0 } },
      b: { x: 50, y: 50 },
    };
    propagateExplicitContourJunction([c], [t1], [], "c1", 0, 7, 8);
    expect(c.points[0].x).toBe(7);
    expect(c.points[0].y).toBe(8);
    expect(t1.a.x).toBe(7);
    expect(t1.a.y).toBe(8);
  });

  it("D — superposition sans attach : propagateLinkedEndpointsAfterDrag (owner trait) ne lie pas deux traits arbitraires", () => {
    var t1 = { id: "t1", roofRole: "main", a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };
    var t2 = { id: "t2", roofRole: "main", a: { x: 0, y: 0 }, b: { x: 3, y: 3 } };
    var state = { contours: [], traits: [t1, t2], ridges: [] };
    t1.a.x = 1;
    t1.a.y = 2;
    t1.a.attach = null;
    propagateLinkedEndpointsAfterDrag(state, t1.a, { kind: "trait", traitId: "t1", traitPointIndex: 0 });
    expect(t2.a.x).toBe(0);
    expect(t2.a.y).toBe(0);
  });

  it("propagateLinkedEndpointsAfterDrag — branche attach contour", () => {
    var c = { id: "c1", roofRole: "main", points: [{ x: 0, y: 0 }] };
    var ep = { x: 5, y: 6, attach: { type: "contour", id: "c1", pointIndex: 0 } };
    propagateLinkedEndpointsAfterDrag({ contours: [c], traits: [], ridges: [] }, ep, { kind: "trait", traitId: "x", traitPointIndex: 0 });
    expect(c.points[0].x).toBe(5);
    expect(c.points[0].y).toBe(6);
  });

  // --- propagateRoofContourEdgeJunctionAfterContourEdit ---

  it("E — roof_contour_edge : x,y stocké re-calculé après déplacement de sommet de contour", () => {
    // Contour avec deux sommets (arête 0→1)
    var c = {
      id: "c1",
      roofRole: "main",
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    };
    // Trait dont l'extrémité A est à mi-chemin de l'arête 0 (t=0.5 → x=50, y=0)
    var t1 = {
      id: "t1",
      roofRole: "main",
      a: {
        x: 50, y: 0,
        attach: { type: "roof_contour_edge", contourId: "c1", segmentIndex: 0, t: 0.5 },
      },
      b: { x: 50, y: 60 },
    };
    // On déplace le sommet 1 du contour : arête devient (0,0)→(100,40)
    c.points[1].y = 40;
    propagateRoofContourEdgeJunctionAfterContourEdit([c], [t1], [], "c1");
    // Nouvelle position attendue : 0 + 0.5*(100-0)=50, 0 + 0.5*(40-0)=20
    expect(t1.a.x).toBeCloseTo(50);
    expect(t1.a.y).toBeCloseTo(20);
  });

  it("F — roof_contour_edge : faîtage avec attach sur autre contour non affecté", () => {
    var c1 = {
      id: "c1",
      roofRole: "main",
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    };
    var c2 = {
      id: "c2",
      roofRole: "main",
      points: [{ x: 0, y: 50 }, { x: 100, y: 50 }],
    };
    var r1 = {
      id: "r1",
      roofRole: "main",
      a: {
        x: 50, y: 50,
        attach: { type: "roof_contour_edge", contourId: "c2", segmentIndex: 0, t: 0.5 },
      },
      b: { x: 50, y: 0 },
    };
    // On modifie c1 — r1 est attaché à c2, doit rester inchangé
    c1.points[1].y = 20;
    propagateRoofContourEdgeJunctionAfterContourEdit([c1, c2], [], [r1], "c1");
    expect(r1.a.x).toBeCloseTo(50);
    expect(r1.a.y).toBeCloseTo(50);
  });

  it("G — roof_contour_edge : entités chienAssis ignorées", () => {
    var c = {
      id: "c1",
      roofRole: "main",
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    };
    var tChien = {
      id: "tChien",
      roofRole: "chienAssis",
      a: {
        x: 50, y: 0,
        attach: { type: "roof_contour_edge", contourId: "c1", segmentIndex: 0, t: 0.5 },
      },
      b: { x: 50, y: 60 },
    };
    c.points[1].y = 40;
    propagateRoofContourEdgeJunctionAfterContourEdit([c], [tChien], [], "c1");
    // chienAssis ignoré : position inchangée
    expect(tChien.a.y).toBe(0);
  });

  it("H — propagateExplicitContourJunction : multi-entités (trait + faîtage) synchronisées", () => {
    var c = {
      id: "c1",
      roofRole: "main",
      points: [{ x: 10, y: 10 }, { x: 80, y: 10 }],
    };
    var t1 = {
      id: "t1",
      roofRole: "main",
      a: { x: 10, y: 10, attach: { type: "contour", id: "c1", pointIndex: 0 } },
      b: { x: 40, y: 60 },
    };
    var r1 = {
      id: "r1",
      roofRole: "main",
      a: { x: 10, y: 10, attach: { type: "contour", id: "c1", pointIndex: 0 } },
      b: { x: 40, y: 80 },
    };
    // Deuxième trait avec attach sur pointIndex 1 — ne doit pas être affecté
    var t2 = {
      id: "t2",
      roofRole: "main",
      a: { x: 80, y: 10, attach: { type: "contour", id: "c1", pointIndex: 1 } },
      b: { x: 40, y: 60 },
    };
    propagateExplicitContourJunction([c], [t1, t2], [r1], "c1", 0, 15, 20);
    expect(c.points[0].x).toBe(15);
    expect(c.points[0].y).toBe(20);
    expect(t1.a.x).toBe(15);
    expect(t1.a.y).toBe(20);
    expect(r1.a.x).toBe(15);
    expect(r1.a.y).toBe(20);
    // t2 attaché à pointIndex 1 — non affecté
    expect(t2.a.x).toBe(80);
    expect(t2.a.y).toBe(10);
  });

  // --- fixContourVertexDeleteAttaches ---

  it("I — suppression sommet 0 : attach exact → null, attach pointIndex > 0 → décrémenté", () => {
    var c = {
      id: "c1",
      roofRole: "main",
      points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 100 }],
    };
    // t1.a attaché au sommet supprimé (0) → orphelin
    var t1 = {
      id: "t1", roofRole: "main",
      a: { x: 0, y: 0, attach: { type: "contour", id: "c1", pointIndex: 0 } },
      b: { x: 50, y: 50 },
    };
    // t2.a attaché au sommet 1 → pointIndex doit passer à 0
    var t2 = {
      id: "t2", roofRole: "main",
      a: { x: 50, y: 0, attach: { type: "contour", id: "c1", pointIndex: 1 } },
      b: { x: 50, y: 80 },
    };
    // r1.a attaché au sommet 2 → pointIndex doit passer à 1
    var r1 = {
      id: "r1", roofRole: "main",
      a: { x: 100, y: 100, attach: { type: "contour", id: "c1", pointIndex: 2 } },
      b: { x: 50, y: 80 },
    };
    fixContourVertexDeleteAttaches([c], [t1, t2], [r1], "c1", 0);
    expect(t1.a.attach).toBeNull();
    expect(t2.a.attach.pointIndex).toBe(0);
    expect(r1.a.attach.pointIndex).toBe(1);
  });

  it("J — suppression sommet intermédiaire : roof_contour_edge adjacent → null, segment plus haut → décrémenté", () => {
    var c = {
      id: "c1",
      roofRole: "main",
      points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
    };
    // Segment 1 (sommet 1 → 2) adjacent avant suppression de 1 → attach null
    var t1 = {
      id: "t1", roofRole: "main",
      a: { x: 75, y: 0, attach: { type: "roof_contour_edge", contourId: "c1", segmentIndex: 1, t: 0.5 } },
      b: { x: 75, y: 50 },
    };
    // Segment 0 (sommet 0 → 1) adjacent avant suppression de 1 (si=0 === deletedIndex-1=0) → attach null
    var t2 = {
      id: "t2", roofRole: "main",
      a: { x: 25, y: 0, attach: { type: "roof_contour_edge", contourId: "c1", segmentIndex: 0, t: 0.5 } },
      b: { x: 25, y: 50 },
    };
    // Segment 2 (sommet 2 → 3) > deletedIndex 1 → segmentIndex décrémenté à 1
    var r1 = {
      id: "r1", roofRole: "main",
      a: { x: 100, y: 50, attach: { type: "roof_contour_edge", contourId: "c1", segmentIndex: 2, t: 0.5 } },
      b: { x: 50, y: 80 },
    };
    fixContourVertexDeleteAttaches([c], [t1, t2], [r1], "c1", 1);
    expect(t1.a.attach).toBeNull();
    expect(t2.a.attach).toBeNull();
    expect(r1.a.attach.segmentIndex).toBe(1);
  });

  it("K — suppression sur contour différent : aucune entité affectée", () => {
    var c1 = { id: "c1", roofRole: "main", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }] };
    var c2 = { id: "c2", roofRole: "main", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }] };
    var t1 = {
      id: "t1", roofRole: "main",
      a: { x: 0, y: 0, attach: { type: "contour", id: "c1", pointIndex: 0 } },
      b: { x: 50, y: 50 },
    };
    fixContourVertexDeleteAttaches([c1, c2], [t1], [], "c2", 0);
    // t1 est attaché à c1, pas c2 → non affecté
    expect(t1.a.attach).not.toBeNull();
    expect(t1.a.attach.pointIndex).toBe(0);
  });

  it("L — entités chienAssis ignorées par fixContourVertexDeleteAttaches", () => {
    var c = { id: "c1", roofRole: "main", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }] };
    var tChien = {
      id: "tChien", roofRole: "chienAssis",
      a: { x: 0, y: 0, attach: { type: "contour", id: "c1", pointIndex: 0 } },
      b: { x: 50, y: 50 },
    };
    fixContourVertexDeleteAttaches([c], [tChien], [], "c1", 0);
    // chienAssis ignoré → attach inchangé
    expect(tChien.a.attach).not.toBeNull();
    expect(tChien.a.attach.pointIndex).toBe(0);
  });

  // --- fixContourVertexInsertAttaches ---

  it("M — insertion insertIndex=1 : contour attach >= 1 incrémenté, attach 0 intact", () => {
    var c = { id: "c1", roofRole: "main", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] };
    var t1 = { id: "t1", roofRole: "main",
      a: { x: 0, y: 0, attach: { type: "contour", id: "c1", pointIndex: 0 } }, b: { x: 50, y: 50 } };
    var t2 = { id: "t2", roofRole: "main",
      a: { x: 100, y: 0, attach: { type: "contour", id: "c1", pointIndex: 1 } }, b: { x: 50, y: 50 } };
    var r1 = { id: "r1", roofRole: "main",
      a: { x: 100, y: 100, attach: { type: "contour", id: "c1", pointIndex: 2 } }, b: { x: 50, y: 80 } };
    fixContourVertexInsertAttaches([c], [t1, t2], [r1], "c1", 1, 0.5);
    expect(t1.a.attach.pointIndex).toBe(0);  // non affecté
    expect(t2.a.attach.pointIndex).toBe(2);  // incrémenté
    expect(r1.a.attach.pointIndex).toBe(3);  // incrémenté
  });

  it("N — roof_contour_edge segment splitté : redistribution t correcte", () => {
    var c = { id: "c1", roofRole: "main", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] };
    // t=0.3 dans première moitié (insertion à t=0.6) → reste segment 0, t = 0.3/0.6 = 0.5
    var t1 = { id: "t1", roofRole: "main",
      a: { x: 30, y: 0, attach: { type: "roof_contour_edge", contourId: "c1", segmentIndex: 0, t: 0.3 } }, b: { x: 50, y: 50 } };
    // t=0.8 dans seconde moitié → passe segment 1, t = (0.8-0.6)/0.4 = 0.5
    var t2 = { id: "t2", roofRole: "main",
      a: { x: 80, y: 0, attach: { type: "roof_contour_edge", contourId: "c1", segmentIndex: 0, t: 0.8 } }, b: { x: 50, y: 50 } };
    // segment 1 (ancienne numérotation) → incrémenté à 2
    var r1 = { id: "r1", roofRole: "main",
      a: { x: 100, y: 50, attach: { type: "roof_contour_edge", contourId: "c1", segmentIndex: 1, t: 0.5 } }, b: { x: 50, y: 80 } };
    fixContourVertexInsertAttaches([c], [t1, t2], [r1], "c1", 1, 0.6);
    expect(t1.a.attach.segmentIndex).toBe(0);
    expect(t1.a.attach.t).toBeCloseTo(0.5);
    expect(t2.a.attach.segmentIndex).toBe(1);
    expect(t2.a.attach.t).toBeCloseTo(0.5);
    expect(r1.a.attach.segmentIndex).toBe(2);
  });

  it("O — fixContourVertexInsertAttaches : contour différent → rien affecté", () => {
    var c1 = { id: "c1", roofRole: "main", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }] };
    var t1 = { id: "t1", roofRole: "main",
      a: { x: 0, y: 0, attach: { type: "contour", id: "c1", pointIndex: 1 } }, b: { x: 50, y: 50 } };
    fixContourVertexInsertAttaches([c1], [t1], [], "c2", 1, 0.5);
    expect(t1.a.attach.pointIndex).toBe(1);  // non affecté (contour c2)
  });

  // --- Multi-jonction (P3C) ---

  it("Q — contour → T1(attach=contour) → T2,R1(attach=trait) : cascade complète", () => {
    var c1 = { id: "c1", roofRole: "main", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
    var t1 = { id: "t1", roofRole: "main",
      a: { x: 0, y: 0, attach: { type: "contour", id: "c1", pointIndex: 0 } }, b: { x: 60, y: 80 } };
    // T2 et R1 aliasent T1.A — c'est le cas non propagé avant P3C
    var t2 = { id: "t2", roofRole: "main",
      a: { x: 0, y: 0, attach: { type: "trait", id: "t1", pointIndex: 0 } }, b: { x: 80, y: 40 } };
    var r1 = { id: "r1", roofRole: "main",
      a: { x: 0, y: 0, attach: { type: "trait", id: "t1", pointIndex: 0 } }, b: { x: 40, y: 60 } };
    propagateExplicitContourJunction([c1], [t1, t2], [r1], "c1", 0, 15, 25);
    expect(c1.points[0].x).toBe(15);
    expect(t1.a.x).toBe(15);
    expect(t2.a.x).toBe(15); // cascade trait alias — était cassé avant P3C
    expect(r1.a.x).toBe(15); // cascade faitage alias — était cassé avant P3C
  });

  it("R — chaîne trait→trait profondeur 2 : T0←T1←T2 tous mis à jour", () => {
    var t0 = { id: "t0", roofRole: "main", a: { x: 0, y: 0, attach: null }, b: { x: 100, y: 0 } };
    var t1 = { id: "t1", roofRole: "main",
      a: { x: 0, y: 0, attach: { type: "trait", id: "t0", pointIndex: 0 } }, b: { x: 0, y: 100 } };
    var t2 = { id: "t2", roofRole: "main",
      a: { x: 0, y: 0, attach: { type: "trait", id: "t1", pointIndex: 0 } }, b: { x: 50, y: 80 } };
    propagateExplicitTraitJunction([t0, t1, t2], [], "t0", 0, 5, 7);
    expect(t0.a.x).toBe(5);
    expect(t1.a.x).toBe(5);
    expect(t2.a.x).toBe(5); // profondeur 2 — était cassé avant P3C
  });

  it("S — multi-attach contour : T1+T2 directs + T3 alias de T1 — tout suit", () => {
    var c1 = { id: "c1", roofRole: "main", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
    var t1 = { id: "t1", roofRole: "main",
      a: { x: 0, y: 0, attach: { type: "contour", id: "c1", pointIndex: 0 } }, b: { x: 50, y: 50 } };
    var t2 = { id: "t2", roofRole: "main",
      a: { x: 0, y: 0, attach: { type: "contour", id: "c1", pointIndex: 0 } }, b: { x: 70, y: 30 } };
    var t3 = { id: "t3", roofRole: "main",
      a: { x: 0, y: 0, attach: { type: "trait", id: "t1", pointIndex: 0 } }, b: { x: 20, y: 80 } };
    propagateExplicitContourJunction([c1], [t1, t2, t3], [], "c1", 0, 30, 40);
    expect(c1.points[0].x).toBe(30);
    expect(t1.a.x).toBe(30);
    expect(t2.a.x).toBe(30);
    expect(t3.a.x).toBe(30); // alias indirect — était cassé avant P3C
  });

  it("T — pas de faux couplage avec entité non liée", () => {
    var c1 = { id: "c1", roofRole: "main", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
    var c2 = { id: "c2", roofRole: "main", points: [{ x: 50, y: 50 }, { x: 150, y: 50 }] };
    var tOther = { id: "tOther", roofRole: "main",
      a: { x: 50, y: 50, attach: { type: "contour", id: "c2", pointIndex: 0 } }, b: { x: 80, y: 80 } };
    var tTarget = { id: "tTarget", roofRole: "main",
      a: { x: 0, y: 0, attach: { type: "contour", id: "c1", pointIndex: 0 } }, b: { x: 60, y: 60 } };
    propagateExplicitContourJunction([c1, c2], [tOther, tTarget], [], "c1", 0, 11, 22);
    expect(tTarget.a.x).toBe(11);
    expect(tOther.a.x).toBe(50);  // non affecté
    expect(c2.points[0].x).toBe(50); // non affecté
  });

  it("P — fixContourVertexInsertAttaches : chienAssis ignorés", () => {
    var c = { id: "c1", roofRole: "main", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }] };
    var tChien = { id: "tChien", roofRole: "chienAssis",
      a: { x: 100, y: 0, attach: { type: "contour", id: "c1", pointIndex: 1 } }, b: { x: 50, y: 50 } };
    fixContourVertexInsertAttaches([c], [tChien], [], "c1", 1, 0.5);
    expect(tChien.a.attach.pointIndex).toBe(1);  // chienAssis ignoré
  });
});
