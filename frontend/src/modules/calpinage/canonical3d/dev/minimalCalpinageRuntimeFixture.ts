/**
 * État calpinage minimal valide pour le builder runtime — sandbox dev uniquement.
 * Même intention que les tests `buildSolarScene3DFromCalpinageRuntime` (aucune donnée produit).
 */

export const minimalCalpinageRuntimeFixture = {
  /** Source officielle toiture (prioritaire sur `roof.roofPans`). */
  pans: [
    {
      id: "pan-a",
      polygonPx: [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 200 },
        { x: 100, y: 200 },
      ],
    },
  ],
  roof: {
    scale: { metersPerPixel: 0.02 },
    roof: { north: { angleDeg: 0 } },
    canonical3DWorldContract: {
      schemaVersion: 1,
      metersPerPixel: 0.02,
      northAngleDeg: 0,
      referenceFrame: "LOCAL_IMAGE_ENU" as const,
    },
    roofPans: [
      {
        id: "pan-a",
        polygonPx: [
          { x: 100, y: 100 },
          { x: 200, y: 100 },
          { x: 200, y: 200 },
          { x: 100, y: 200 },
        ],
      },
    ],
  },
  contours: [
    {
      roofRole: "contour",
      points: [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 200 },
        { x: 100, y: 200 },
      ],
    },
  ],
};
