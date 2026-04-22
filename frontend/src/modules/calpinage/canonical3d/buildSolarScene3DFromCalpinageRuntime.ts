/**
 * Point d’entrée stable pour imports barrel / consommateurs historiques.
 * L’implémentation vit dans `buildSolarScene3DFromCalpinageRuntimeCore.ts` pour éviter
 * les cycles de modules ESM (ex. passerelle officielle ↔ pipeline).
 */
export * from "./buildSolarScene3DFromCalpinageRuntimeCore";
