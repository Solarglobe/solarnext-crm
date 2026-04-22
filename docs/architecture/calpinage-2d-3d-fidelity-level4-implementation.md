# Niveau 4 — Trace source & audit fidélité (emprise toit en m² monde)

**Référence :** [calpinage-2d-3d-fidelity-level0-charter.md](./calpinage-2d-3d-fidelity-level0-charter.md) · [2d-to-3d-fidelity-trace.md](./2d-to-3d-fidelity-trace.md) · [calpinage-2d-3d-fidelity-level3-implementation.md](./calpinage-2d-3d-fidelity-level3-implementation.md)

## Objectif

Enrichir la **`sourceTrace`** (`Scene2DSourceTrace`) avec une métrique d’**aire horizontale monde (m²)** du contour toiture, calculée par la même chaîne que le produit (`polygonHorizontalAreaM2FromImagePx`), et faire préférer cette valeur dans **`validate2DTo3DCoherence`** pour l’heuristique `ROOF_OUTLINE_AREA_MISMATCH` (repli : `roofOutlineArea2DPx × mpp²` si la métrique m² absente).

## Champs & fichiers

| Élément | Fichier |
|---------|---------|
| `metrics.roofOutlineHorizontalAreaM2` | `types/scene2d3dCoherence.ts` |
| Remplissage au build trace | `sourceTrace/buildScene2DSourceTrace.ts` |
| Fidélité somme aires pans vs emprise | `validation/validate2DTo3DCoherence.ts` |

## Tests

- `sourceTrace/__tests__/buildScene2DSourceTrace.test.ts`
- `validation/__tests__/validate2DTo3DCoherence.test.ts` (Cas 5b — priorité `trace_m2`)

## Révisions

| Version | Date | Changement |
|---------|------|------------|
| 1.0 | 2026-04-09 | Niveau 4 initial : métrique m² dans trace + validateur. |
