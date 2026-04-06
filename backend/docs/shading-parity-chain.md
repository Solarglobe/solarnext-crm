# Chaîne ombrage — cartographie factuelle (lecture seule)

Document d’observation : où vit le chiffre à chaque étape, sans préjuger d’une future bascule.

## A) UI calpinage (front)

- **State** : `window.CALPINAGE_STATE.shading` (IIFE `calpinage.module.js`).
- **Affichage / export client** : priorité `normalized` (objet V2 après `normalizeCalpinageShading` côté navigateur) ; repli possible sur `lastResult` / `annualLossPercent` avant sync.
- **Lecture stable** : `getUiShadingSnapshot()` (`frontend/src/modules/calpinage/shading/getUiShadingSnapshot.ts`), exposé sur `window.__SOLARNEXT_GET_UI_SHADING_SNAPSHOT__` pendant le montage de `CalpinageApp`.

## B) Officiel serveur (parallèle, non branché UI)

- **Calcul** : `computeCalpinageShading` puis `buildOfficialShadingFromComputeResult` → `normalizeCalpinageShading` (`backend/services/calpinage/officialShading.service.js`).
- **Exposition conditionnelle** : clés `shading_official` / `shading_debug` sur `solarnext_payload` si `USE_OFFICIAL_SHADING=true`.

## C) `solarnext_payload` (legacy inchangé pour le moteur)

- **Bloc** : `installation.shading` (objet normalisé + éventuel override pondéré multi-pans) et `installation.shading_loss_pct` (KPI injecté dans le form legacy).
- **Construction** : `buildSolarNextPayload` (`solarnextPayloadBuilder.service.js`).

## D) `calculateSmartpitch`

- **Entrée** : `buildLegacyPayloadFromSolarNext(solarnext_payload)` (`solarnextAdapter.service.js`) → `form.shadingLossPct` ← `installation.shading_loss_pct` uniquement (les clés `shading_official`, `shading_parity_debug`, etc. ne sont pas lues par l’adaptateur).

## E) PDF

- **Non tracé ici sans refactor** : le rendu consomme `pdf-view-model` / snapshots dérivés du calcul ; pas de second recalcul ombrage dans `StudySnapshotPdfPage` côté front. Vérifier la route API `pdf-view-model` pour le détail des champs exposés.

## Parité UI ↔ serveur

- **Quand** : POST `/api/studies/:id/versions/:n/calc` avec corps JSON optionnel `{ "shading_ui_snapshot": { ... } }` (même forme que `getUiShadingSnapshot()`).
- **Réponse stockée** : `payload.shading_parity_debug` (non consommé par le moteur). Persistance DB : `study_versions.data_json.shading_parity_debug` si `SHADING_PARITY_PERSIST=true`.
- **Logs** : `console.warn("[SHADING_UI_SERVER_DRIFT]", …)` si écarts > seuils (voir `shadingParity.service.js`).
