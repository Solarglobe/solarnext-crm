/**
 * Batterie de runtimes calpinage plausibles pour la chaîne canonical 3D (hors produit).
 * Chaque entrée est injectable via `buildSolarScene3DFromCalpinageRuntime` + `getAllPanels`.
 *
 * @see docs/architecture/canonical3d-runtime-fixture-battery.md
 */

const MPP = 0.02;

function worldContract(northDeg = 0) {
  return {
    schemaVersion: 1,
    metersPerPixel: MPP,
    northAngleDeg: northDeg,
    referenceFrame: "LOCAL_IMAGE_ENU" as const,
  };
}

function roofBase(northDeg = 0) {
  return {
    scale: { metersPerPixel: MPP },
    roof: { north: { angleDeg: northDeg } },
    canonical3DWorldContract: worldContract(northDeg),
  };
}

/** Quad panneau moteur-like (px image), centré sur (cx, cy). */
export function makeSyntheticPanel(
  id: string,
  panId: string,
  cx: number,
  cy: number,
  halfPx = 10,
): Record<string, unknown> {
  return {
    id,
    panId,
    enabled: true,
    center: { x: cx, y: cy },
    polygonPx: [
      { x: cx - halfPx, y: cy - halfPx },
      { x: cx + halfPx, y: cy - halfPx },
      { x: cx + halfPx, y: cy + halfPx },
      { x: cx - halfPx, y: cy + halfPx },
    ],
    rotationDeg: 0,
  };
}

export type Runtime3DFixtureBundle = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly runtime: Record<string, unknown>;
  readonly panels: unknown[];
};

/** CAS 1 — toit mono-pan nominal + obstacle polygon + panneaux. */
const monoPanNominal: Runtime3DFixtureBundle = {
  id: "mono-pan-nominal",
  title: "Mono-pan nominal",
  description: "1 pan, contrat monde valide, cheminée polygonale, 2 panneaux.",
  runtime: {
    roof: {
      ...roofBase(0),
      roofPans: [
        {
          id: "pan-main",
          polygonPx: [
            { x: 100, y: 100 },
            { x: 300, y: 100 },
            { x: 300, y: 300 },
            { x: 100, y: 300 },
          ],
          h: 5.5,
        },
      ],
    },
    contours: [
      {
        roofRole: "contour",
        points: [
          { x: 100, y: 100, h: 5.5 },
          { x: 300, y: 100, h: 5.5 },
          { x: 300, y: 300, h: 5.5 },
          { x: 100, y: 300, h: 5.5 },
        ],
      },
    ],
    obstacles: [
      {
        id: "obs-chimney-mono",
        type: "polygon",
        panId: "pan-main",
        heightM: 1.2,
        points: [
          { x: 175, y: 175 },
          { x: 195, y: 175 },
          { x: 195, y: 195 },
          { x: 175, y: 195 },
        ],
        kind: "other",
        meta: { businessObstacleId: "chimney_square" },
      },
    ],
  },
  panels: [makeSyntheticPanel("pv-m1", "pan-main", 140, 200), makeSyntheticPanel("pv-m2", "pan-main", 240, 200)],
};

/** CAS 2 — double pan avec faîtage explicite. */
const dualPanRidge: Runtime3DFixtureBundle = {
  id: "dual-pan-ridge",
  title: "Double pan + faîtage",
  description: "2 pans accolés, ridge sur l’arête commune, panneaux sur les deux pans.",
  runtime: {
    roof: {
      ...roofBase(12),
      roofPans: [
        {
          id: "pan-L",
          polygonPx: [
            { x: 100, y: 100 },
            { x: 200, y: 100 },
            { x: 200, y: 220 },
            { x: 100, y: 220 },
          ],
          h: 5.2,
        },
        {
          id: "pan-R",
          polygonPx: [
            { x: 200, y: 100 },
            { x: 320, y: 100 },
            { x: 320, y: 220 },
            { x: 200, y: 220 },
          ],
          h: 5.2,
        },
      ],
    },
    ridges: [{ id: "ridge-LR", a: { x: 200, y: 100 }, b: { x: 200, y: 220 } }],
    contours: [
      {
        roofRole: "contour",
        points: [
          { x: 100, y: 100, h: 5.2 },
          { x: 200, y: 100, h: 5.2 },
          { x: 200, y: 220, h: 5.2 },
          { x: 100, y: 220, h: 5.2 },
        ],
      },
      {
        roofRole: "contour",
        points: [
          { x: 200, y: 100, h: 5.2 },
          { x: 320, y: 100, h: 5.2 },
          { x: 320, y: 220, h: 5.2 },
          { x: 200, y: 220, h: 5.2 },
        ],
      },
    ],
    obstacles: [],
  },
  panels: [
    makeSyntheticPanel("pv-d1", "pan-L", 150, 160),
    makeSyntheticPanel("pv-d2", "pan-R", 260, 160),
  ],
};

/** CAS 3 — multi-pans en T / L, trait + obstacle + plusieurs panneaux. */
const multiPanLShaped: Runtime3DFixtureBundle = {
  id: "multi-pan-l-shaped",
  title: "Multi-pans (L)",
  description: "3 pans, faîtages multiples, un trait, obstacle sur un pan, 5 panneaux.",
  runtime: {
    roof: {
      ...roofBase(-5),
      roofPans: [
        {
          id: "pan-a",
          polygonPx: [
            { x: 200, y: 200 },
            { x: 380, y: 200 },
            { x: 380, y: 320 },
            { x: 200, y: 320 },
          ],
          h: 5.4,
        },
        {
          id: "pan-b",
          polygonPx: [
            { x: 380, y: 200 },
            { x: 480, y: 200 },
            { x: 480, y: 320 },
            { x: 380, y: 320 },
          ],
          h: 5.35,
        },
        {
          id: "pan-c",
          polygonPx: [
            { x: 200, y: 80 },
            { x: 380, y: 80 },
            { x: 380, y: 200 },
            { x: 200, y: 200 },
          ],
          h: 5.45,
        },
      ],
    },
    ridges: [
      { id: "ridge-ab", a: { x: 380, y: 200 }, b: { x: 380, y: 320 } },
      { id: "ridge-ac", a: { x: 200, y: 200 }, b: { x: 380, y: 200 } },
    ],
    traits: [{ id: "trait-c-valley", a: { x: 260, y: 120 }, b: { x: 340, y: 160 } }],
    contours: [
      {
        roofRole: "contour",
        points: [
          { x: 200, y: 200, h: 5.4 },
          { x: 380, y: 200, h: 5.4 },
          { x: 380, y: 320, h: 5.4 },
          { x: 200, y: 320, h: 5.4 },
        ],
      },
      {
        roofRole: "contour",
        points: [
          { x: 380, y: 200, h: 5.35 },
          { x: 480, y: 200, h: 5.35 },
          { x: 480, y: 320, h: 5.35 },
          { x: 380, y: 320, h: 5.35 },
        ],
      },
      {
        roofRole: "contour",
        points: [
          { x: 200, y: 80, h: 5.45 },
          { x: 380, y: 80, h: 5.45 },
          { x: 380, y: 200, h: 5.45 },
          { x: 200, y: 200, h: 5.45 },
        ],
      },
    ],
    obstacles: [
      {
        id: "obs-multi-skylight",
        type: "polygon",
        panId: "pan-b",
        heightM: 0.15,
        points: [
          { x: 400, y: 240 },
          { x: 430, y: 240 },
          { x: 430, y: 270 },
          { x: 400, y: 270 },
        ],
        kind: "other",
        meta: { businessObstacleId: "roof_window" },
      },
    ],
  },
  panels: [
    makeSyntheticPanel("pv-l1", "pan-a", 240, 250),
    makeSyntheticPanel("pv-l2", "pan-a", 320, 250),
    makeSyntheticPanel("pv-l3", "pan-b", 420, 250),
    makeSyntheticPanel("pv-l4", "pan-c", 260, 130),
    makeSyntheticPanel("pv-l5", "pan-c", 340, 130),
  ],
};

/** CAS 4 — contrat 3D absent en persistance : le build runtime le matérialise (scale + nord valides). */
const partialMissingWorldContract: Runtime3DFixtureBundle = {
  id: "partial-missing-world-contract",
  title: "Partiel — contrat monde absent avant build",
  description:
    "Miroir roof.roofPans + échelle/nord OK sans bloc canonical3DWorldContract : alignement au même titre que sync roofPans.",
  runtime: {
    roof: {
      scale: { metersPerPixel: MPP },
      roof: { north: { angleDeg: 0 } },
      roofPans: [
        {
          id: "pan-ghost",
          polygonPx: [
            { x: 50, y: 50 },
            { x: 150, y: 50 },
            { x: 150, y: 150 },
            { x: 50, y: 150 },
          ],
        },
      ],
    },
    contours: [
      {
        roofRole: "contour",
        points: [
          { x: 50, y: 50, h: 5 },
          { x: 150, y: 50, h: 5 },
          { x: 150, y: 150, h: 5 },
          { x: 50, y: 150, h: 5 },
        ],
      },
    ],
  },
  panels: [makeSyntheticPanel("pv-x", "pan-ghost", 100, 100)],
};

/** CAS 5 — géométrie serrée : petits pans, nombreux panneaux, obstacle proche, faîtage court. */
const tenseSmallDualPan: Runtime3DFixtureBundle = {
  id: "tense-small-dual-pan",
  title: "Tendu mais valide",
  description: "2 petits pans, faîtage court, 8 panneaux, obstacle près d’un panneau.",
  runtime: {
    roof: {
      ...roofBase(0),
      roofPans: [
        {
          id: "pan-t1",
          polygonPx: [
            { x: 600, y: 600 },
            { x: 630, y: 600 },
            { x: 630, y: 630 },
            { x: 600, y: 630 },
          ],
          h: 5.1,
        },
        {
          id: "pan-t2",
          polygonPx: [
            { x: 630, y: 600 },
            { x: 660, y: 600 },
            { x: 660, y: 630 },
            { x: 630, y: 630 },
          ],
          h: 5.1,
        },
      ],
    },
    ridges: [{ id: "ridge-t", a: { x: 630, y: 600 }, b: { x: 630, y: 630 } }],
    contours: [
      {
        roofRole: "contour",
        points: [
          { x: 600, y: 600, h: 5.1 },
          { x: 630, y: 600, h: 5.1 },
          { x: 630, y: 630, h: 5.1 },
          { x: 600, y: 630, h: 5.1 },
        ],
      },
      {
        roofRole: "contour",
        points: [
          { x: 630, y: 600, h: 5.1 },
          { x: 660, y: 600, h: 5.1 },
          { x: 660, y: 630, h: 5.1 },
          { x: 630, y: 630, h: 5.1 },
        ],
      },
    ],
    obstacles: [
      {
        id: "obs-tense",
        type: "polygon",
        panId: "pan-t2",
        heightM: 0.4,
        points: [
          { x: 646, y: 612 },
          { x: 654, y: 612 },
          { x: 654, y: 620 },
          { x: 646, y: 620 },
        ],
        kind: "other",
        meta: { businessObstacleId: "vmc_round" },
      },
    ],
  },
  panels: [
    makeSyntheticPanel("pv-t1a", "pan-t1", 606, 606, 4),
    makeSyntheticPanel("pv-t1b", "pan-t1", 614, 614, 4),
    makeSyntheticPanel("pv-t1c", "pan-t1", 622, 622, 4),
    makeSyntheticPanel("pv-t1d", "pan-t1", 606, 622, 4),
    makeSyntheticPanel("pv-t2a", "pan-t2", 636, 606, 4),
    makeSyntheticPanel("pv-t2b", "pan-t2", 644, 614, 4),
    makeSyntheticPanel("pv-t2c", "pan-t2", 652, 622, 4),
    makeSyntheticPanel("pv-t2d", "pan-t2", 636, 622, 4),
  ],
};

// ─── Familles officielles (Prompt 15 — preuve robustesse / non-régression) ───

/** 5 cas versionnés pour docs, `/dev/3d?fixture=…`, tests intégration. Les ids legacy restent valides. */
export const RUNTIME_3D_OFFICIAL_FAMILY_FIXTURE_IDS = [
  "simple_gable_clean",
  "gable_with_chimney",
  "multi_pan_complex",
  "partial_degraded_like",
  "dense_loaded_case",
] as const;

export type Runtime3DOfficialFamilyFixtureId = (typeof RUNTIME_3D_OFFICIAL_FAMILY_FIXTURE_IDS)[number];

/** FAMILLE 1 — 2 pans propres, faîtage, 4 panneaux, pas d’obstacle, shading complet (référence). */
const simpleGableClean: Runtime3DFixtureBundle = {
  id: "simple_gable_clean",
  title: "Pignon 2 pans — propre",
  description:
    "Cas SolarNext le plus courant : 2 pans, faîtage, 4 panneaux, pas d’obstacle ; shading perPanel cohérent.",
  runtime: {
    roof: {
      ...roofBase(10),
      roofPans: [
        {
          id: "pan-nord",
          polygonPx: [
            { x: 120, y: 120 },
            { x: 220, y: 120 },
            { x: 220, y: 260 },
            { x: 120, y: 260 },
          ],
          h: 5.25,
        },
        {
          id: "pan-sud",
          polygonPx: [
            { x: 220, y: 120 },
            { x: 380, y: 120 },
            { x: 380, y: 260 },
            { x: 220, y: 260 },
          ],
          h: 5.25,
        },
      ],
    },
    ridges: [{ id: "ridge-principal", a: { x: 220, y: 120 }, b: { x: 220, y: 260 } }],
    contours: [
      {
        roofRole: "contour",
        points: [
          { x: 120, y: 120, h: 5.25 },
          { x: 220, y: 120, h: 5.25 },
          { x: 220, y: 260, h: 5.25 },
          { x: 120, y: 260, h: 5.25 },
        ],
      },
      {
        roofRole: "contour",
        points: [
          { x: 220, y: 120, h: 5.25 },
          { x: 380, y: 120, h: 5.25 },
          { x: 380, y: 260, h: 5.25 },
          { x: 220, y: 260, h: 5.25 },
        ],
      },
    ],
    obstacles: [],
    shading: {
      computedAt: "2026-04-02T12:00:00.000Z",
      perPanel: [
        { panelId: "pv-sg-1", lossPct: 3.8 },
        { panelId: "pv-sg-2", lossPct: 4.1 },
        { panelId: "pv-sg-3", lossPct: 5.2 },
        { panelId: "pv-sg-4", lossPct: 4.9 },
      ],
    },
  },
  panels: [
    makeSyntheticPanel("pv-sg-1", "pan-nord", 155, 175),
    makeSyntheticPanel("pv-sg-2", "pan-nord", 185, 205),
    makeSyntheticPanel("pv-sg-3", "pan-sud", 280, 175),
    makeSyntheticPanel("pv-sg-4", "pan-sud", 320, 205),
  ],
};

/** FAMILLE 2 — 2 pans + cheminée plausible (semi-réaliste SolarNext) + shading. */
const gableWithChimney: Runtime3DFixtureBundle = {
  id: "gable_with_chimney",
  title: "Pignon 2 pans + cheminée",
  description:
    "Dossier-type : façade sud avec cheminée métier (chimney_square), 4 panneaux, faîtage, pertes shading réalistes.",
  runtime: {
    roof: {
      ...roofBase(11),
      roofPans: [
        {
          id: "pan-nord",
          polygonPx: [
            { x: 120, y: 120 },
            { x: 220, y: 120 },
            { x: 220, y: 260 },
            { x: 120, y: 260 },
          ],
          h: 5.3,
        },
        {
          id: "pan-sud",
          polygonPx: [
            { x: 220, y: 120 },
            { x: 380, y: 120 },
            { x: 380, y: 260 },
            { x: 220, y: 260 },
          ],
          h: 5.28,
        },
      ],
    },
    ridges: [{ id: "ridge-gc", a: { x: 220, y: 120 }, b: { x: 220, y: 260 } }],
    contours: [
      {
        roofRole: "contour",
        points: [
          { x: 120, y: 120, h: 5.3 },
          { x: 220, y: 120, h: 5.3 },
          { x: 220, y: 260, h: 5.3 },
          { x: 120, y: 260, h: 5.3 },
        ],
      },
      {
        roofRole: "contour",
        points: [
          { x: 220, y: 120, h: 5.28 },
          { x: 380, y: 120, h: 5.28 },
          { x: 380, y: 260, h: 5.28 },
          { x: 220, y: 260, h: 5.28 },
        ],
      },
    ],
    obstacles: [
      {
        id: "obs-cheminée-client",
        type: "polygon",
        panId: "pan-sud",
        heightM: 1.05,
        points: [
          { x: 285, y: 165 },
          { x: 315, y: 165 },
          { x: 315, y: 205 },
          { x: 285, y: 205 },
        ],
        kind: "other",
        meta: { businessObstacleId: "chimney_square" },
      },
    ],
    shading: {
      computedAt: "2026-04-02T14:30:00.000Z",
      perPanel: [
        { panelId: "pv-gc-1", lossPct: 4.2 },
        { panelId: "pv-gc-2", lossPct: 6.8 },
        { panelId: "pv-gc-3", lossPct: 11.5 },
        { panelId: "pv-gc-4", lossPct: 5.1 },
      ],
    },
  },
  panels: [
    makeSyntheticPanel("pv-gc-1", "pan-nord", 155, 185),
    makeSyntheticPanel("pv-gc-2", "pan-nord", 185, 215),
    makeSyntheticPanel("pv-gc-3", "pan-sud", 265, 185),
    makeSyntheticPanel("pv-gc-4", "pan-sud", 340, 215),
  ],
};

/** FAMILLE 3 — alias métier du multi-pan L (ruptures / implantation dense). */
const multiPanComplex: Runtime3DFixtureBundle = {
  ...multiPanLShaped,
  id: "multi_pan_complex",
  title: "Multi-pans complexe (chantier)",
  description:
    "3 pans, 2 faîtages, trait, lucarne, 5 panneaux — cas réaliste « un peu sale » sans être pathologique.",
};

/** FAMILLE 4 — monde OK, hauteurs pan implicites, shading partiel, ligne perPanel orpheline. */
const partialDegradedLike: Runtime3DFixtureBundle = {
  id: "partial_degraded_like",
  title: "Partiel / dégradé (dossier imparfait)",
  description:
    "Contrat 3D valide mais pans sans h explicite, shading perPanel incomplet, ligne ouvrage inexistante — pas de crash.",
  runtime: {
    roof: {
      ...roofBase(3),
      roofPans: [
        {
          id: "pan-deg-a",
          polygonPx: [
            { x: 80, y: 80 },
            { x: 200, y: 80 },
            { x: 200, y: 200 },
            { x: 80, y: 200 },
          ],
        },
        {
          id: "pan-deg-b",
          polygonPx: [
            { x: 200, y: 80 },
            { x: 320, y: 80 },
            { x: 320, y: 200 },
            { x: 200, y: 200 },
          ],
        },
      ],
    },
    ridges: [{ id: "ridge-deg", a: { x: 200, y: 80 }, b: { x: 200, y: 200 } }],
    contours: [
      {
        roofRole: "contour",
        points: [
          { x: 80, y: 80, h: 5.1 },
          { x: 200, y: 80, h: 5.1 },
          { x: 200, y: 200, h: 5.1 },
          { x: 80, y: 200, h: 5.1 },
        ],
      },
      {
        roofRole: "contour",
        points: [
          { x: 200, y: 80, h: 5.1 },
          { x: 320, y: 80, h: 5.1 },
          { x: 320, y: 200, h: 5.1 },
          { x: 200, y: 200, h: 5.1 },
        ],
      },
    ],
    obstacles: [
      {
        id: "obs-vmc-deg",
        type: "polygon",
        panId: "pan-deg-b",
        heightM: 0.35,
        points: [
          { x: 250, y: 120 },
          { x: 268, y: 120 },
          { x: 268, y: 138 },
          { x: 250, y: 138 },
        ],
        kind: "other",
        meta: { businessObstacleId: "vmc_round" },
      },
    ],
    shading: {
      computedAt: "2025-11-01T08:00:00.000Z",
      perPanel: [
        { panelId: "pv-deg-1", lossPct: 5.5 },
        { panelId: "pv-deg-2", lossPct: 8.1 },
        { panelId: "fantome-export-legacy", lossPct: 2 },
      ],
    },
  },
  panels: [
    makeSyntheticPanel("pv-deg-1", "pan-deg-a", 120, 130),
    makeSyntheticPanel("pv-deg-2", "pan-deg-a", 160, 150),
    makeSyntheticPanel("pv-deg-3", "pan-deg-b", 240, 130),
    makeSyntheticPanel("pv-deg-4", "pan-deg-b", 280, 150),
  ],
};

/** FAMILLE 5 — dossier chargé : 3 pans, 14 panneaux, 3 obstacles, shading complet. */
const denseLoadedCase: Runtime3DFixtureBundle = {
  id: "dense_loaded_case",
  title: "Dossier chargé",
  description: "Grande toiture 3 pans, 14 panneaux, cheminée + VMC + lucarne — tenue pratique viewer.",
  runtime: {
    roof: {
      ...roofBase(-8),
      roofPans: [
        {
          id: "pan-d1",
          polygonPx: [
            { x: 400, y: 400 },
            { x: 620, y: 400 },
            { x: 620, y: 560 },
            { x: 400, y: 560 },
          ],
          h: 5.35,
        },
        {
          id: "pan-d2",
          polygonPx: [
            { x: 620, y: 400 },
            { x: 840, y: 400 },
            { x: 840, y: 560 },
            { x: 620, y: 560 },
          ],
          h: 5.32,
        },
        {
          id: "pan-d3",
          polygonPx: [
            { x: 520, y: 240 },
            { x: 720, y: 240 },
            { x: 720, y: 400 },
            { x: 520, y: 400 },
          ],
          h: 5.4,
        },
      ],
    },
    ridges: [
      { id: "ridge-d12", a: { x: 620, y: 400 }, b: { x: 620, y: 560 } },
      { id: "ridge-d23", a: { x: 620, y: 400 }, b: { x: 720, y: 400 } },
    ],
    traits: [{ id: "trait-d", a: { x: 520, y: 320 }, b: { x: 720, y: 320 } }],
    contours: [
      {
        roofRole: "contour",
        points: [
          { x: 400, y: 400, h: 5.35 },
          { x: 620, y: 400, h: 5.35 },
          { x: 620, y: 560, h: 5.35 },
          { x: 400, y: 560, h: 5.35 },
        ],
      },
      {
        roofRole: "contour",
        points: [
          { x: 620, y: 400, h: 5.32 },
          { x: 840, y: 400, h: 5.32 },
          { x: 840, y: 560, h: 5.32 },
          { x: 620, y: 560, h: 5.32 },
        ],
      },
      {
        roofRole: "contour",
        points: [
          { x: 520, y: 240, h: 5.4 },
          { x: 720, y: 240, h: 5.4 },
          { x: 720, y: 400, h: 5.4 },
          { x: 520, y: 400, h: 5.4 },
        ],
      },
    ],
    obstacles: [
      {
        id: "obs-d-chimney",
        type: "polygon",
        panId: "pan-d1",
        heightM: 1.15,
        points: [
          { x: 480, y: 460 },
          { x: 510, y: 460 },
          { x: 510, y: 500 },
          { x: 480, y: 500 },
        ],
        kind: "other",
        meta: { businessObstacleId: "chimney_square" },
      },
      {
        id: "obs-d-vmc",
        type: "polygon",
        panId: "pan-d2",
        heightM: 0.42,
        points: [
          { x: 700, y: 440 },
          { x: 718, y: 440 },
          { x: 718, y: 458 },
          { x: 700, y: 458 },
        ],
        kind: "other",
        meta: { businessObstacleId: "vmc_round" },
      },
      {
        id: "obs-d-skylight",
        type: "polygon",
        panId: "pan-d3",
        heightM: 0.12,
        points: [
          { x: 580, y: 300 },
          { x: 640, y: 300 },
          { x: 640, y: 340 },
          { x: 580, y: 340 },
        ],
        kind: "other",
        meta: { businessObstacleId: "roof_window" },
      },
    ],
    shading: {
      computedAt: "2026-04-02T16:00:00.000Z",
      perPanel: [
        { panelId: "pv-d-01", lossPct: 4.0 },
        { panelId: "pv-d-02", lossPct: 4.2 },
        { panelId: "pv-d-03", lossPct: 5.1 },
        { panelId: "pv-d-04", lossPct: 4.8 },
        { panelId: "pv-d-05", lossPct: 6.2 },
        { panelId: "pv-d-06", lossPct: 5.9 },
        { panelId: "pv-d-07", lossPct: 7.1 },
        { panelId: "pv-d-08", lossPct: 6.5 },
        { panelId: "pv-d-09", lossPct: 5.3 },
        { panelId: "pv-d-10", lossPct: 5.0 },
        { panelId: "pv-d-11", lossPct: 4.4 },
        { panelId: "pv-d-12", lossPct: 8.2 },
        { panelId: "pv-d-13", lossPct: 7.8 },
        { panelId: "pv-d-14", lossPct: 5.5 },
      ],
    },
  },
  panels: [
    makeSyntheticPanel("pv-d-01", "pan-d1", 450, 450, 9),
    makeSyntheticPanel("pv-d-02", "pan-d1", 470, 500, 9),
    makeSyntheticPanel("pv-d-03", "pan-d1", 530, 450, 9),
    makeSyntheticPanel("pv-d-04", "pan-d1", 550, 510, 9),
    makeSyntheticPanel("pv-d-05", "pan-d2", 660, 450, 9),
    makeSyntheticPanel("pv-d-06", "pan-d2", 700, 490, 9),
    makeSyntheticPanel("pv-d-07", "pan-d2", 760, 450, 9),
    makeSyntheticPanel("pv-d-08", "pan-d2", 780, 510, 9),
    makeSyntheticPanel("pv-d-09", "pan-d2", 720, 530, 9),
    makeSyntheticPanel("pv-d-10", "pan-d3", 560, 280, 9),
    makeSyntheticPanel("pv-d-11", "pan-d3", 620, 280, 9),
    makeSyntheticPanel("pv-d-12", "pan-d3", 680, 280, 9),
    makeSyntheticPanel("pv-d-13", "pan-d3", 600, 340, 9),
    makeSyntheticPanel("pv-d-14", "pan-d3", 660, 350, 9),
  ],
};

/**
 * Duplique `roof.roofPans` → racine `pans` si absent — aligné sur `CALPINAGE_STATE.pans` en produit.
 * Les fixtures historiques ne portaient que le miroir.
 */
export function runtimeFixtureWithStrictRootPans(runtime: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(runtime.pans) && runtime.pans.length > 0) return runtime;
  const roof = runtime.roof;
  if (!roof || typeof roof !== "object") return runtime;
  const rp = (roof as Record<string, unknown>).roofPans;
  if (!Array.isArray(rp) || rp.length === 0) return runtime;
  const pans = rp.map((item) =>
    item && typeof item === "object" ? { ...(item as Record<string, unknown>) } : item,
  );
  return { ...runtime, pans };
}

/** Point d’entrée unique : clé → bundle (ordre stable pour docs / tests). */
export const RUNTIME_3D_FIXTURE_BATTERY: Readonly<Record<string, Runtime3DFixtureBundle>> = {
  [simpleGableClean.id]: simpleGableClean,
  [gableWithChimney.id]: gableWithChimney,
  [multiPanComplex.id]: multiPanComplex,
  [partialDegradedLike.id]: partialDegradedLike,
  [denseLoadedCase.id]: denseLoadedCase,
  [monoPanNominal.id]: monoPanNominal,
  [dualPanRidge.id]: dualPanRidge,
  [multiPanLShaped.id]: multiPanLShaped,
  [partialMissingWorldContract.id]: partialMissingWorldContract,
  [tenseSmallDualPan.id]: tenseSmallDualPan,
} as const;

/** Ordre stable : familles officielles d’abord, puis ids legacy. */
export const RUNTIME_3D_FIXTURE_KEYS = [
  ...RUNTIME_3D_OFFICIAL_FAMILY_FIXTURE_IDS,
  monoPanNominal.id,
  dualPanRidge.id,
  multiPanLShaped.id,
  partialMissingWorldContract.id,
  tenseSmallDualPan.id,
] as const;

export type Runtime3DFixtureKey = (typeof RUNTIME_3D_FIXTURE_KEYS)[number];

export function getRuntime3DFixture(id: string): Runtime3DFixtureBundle | undefined {
  return RUNTIME_3D_FIXTURE_BATTERY[id];
}

export function listRuntime3DFixtureIds(): readonly string[] {
  return [...RUNTIME_3D_FIXTURE_KEYS];
}
