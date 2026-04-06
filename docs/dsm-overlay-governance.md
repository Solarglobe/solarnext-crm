# DSM overlay — rôle et rapport au shading officiel

**Décision verrouillée** : le module `frontend/src/modules/calpinage/dsmOverlay/` reste **hors gouvernance shading officielle** pour la persistance, l’API et le JSON d’étude. Il sert à la **visualisation**, au **diagnostic** et à l’**overlay** sur la carte / canvas.

## Ce que le DSM overlay n’est pas

- Ce n’est **pas** une source de vérité pour le shading enregistré ou renvoyé par le backend.
- Ce n’est **pas** un substitut à `shared/shading/*.cjs`, ni aux scripts synchronisés `frontend/calpinage/shading/*`.
- Les pourcentages et structures **officiels** restent ceux produits par le pipeline documenté dans `docs/shading-governance.md` (lecture côté DSM via `buildShadingSummary`, `getTotalLossPctFromShading`, `getOfficialGlobalShadingLossPct`, etc.).

## Ce que le DSM overlay fait

- **UI** : radar d’horizon (`horizonRadar.js`), heatmap toit, contrôles d’animation solaire, gestionnaire d’overlay.
- **Helpers locaux** : `dominantDirection.js` agrège une **indication** de direction dominante à partir du masque d’horizon + trajectoire solaire **locale au module** (affichage / aide à la lecture, pas contrat produit).
- **Copie solaire ESM** : `dsmOverlay/solarPosition.js` reprend le **même modèle NOAA** que `shared/shading/solarPosition.cjs` pour des entrées **dans les plages valides**, afin de garder un bundle Vite **sans** importer le `.cjs` officiel (qui expose aussi des globals navigateur — risque de double attache et effets de bord).

## Différence volontaire (garde-fou)

- Pour des `lat` / `lon` **hors plage**, le module DSM **clamp** et peut encore renvoyer une position ; l’officiel renvoie `null` après clamp si la valeur d’entrée n’était pas strictement dans `[-90,90]` / `[-180,180]`.  
  → Comportement **uniquement** dans l’overlay ; ne pas réutiliser cette copie pour un nouveau « métier persistant » sans passer par `shared/`.

## Ce qu’on peut modifier

- Fichiers sous `dsmOverlay/` pour l’UX, le rendu canvas, les libellés, les garde-fous d’affichage.
- Toute évolution **numérique** du soleil **métier** : uniquement dans `shared/shading/solarPosition.cjs` + sync + tests shading officiels.

## Ce qu’on ne doit pas confondre

| Zone | Fichiers / entrées |
|------|---------------------|
| Vérité shading (near / far / annual / JSON) | `shared/shading/*.cjs`, backend services, `calpinageShadingNormalizer`, etc. |
| Overlay DSM (visualisation) | `frontend/src/modules/calpinage/dsmOverlay/*` |

## Tests de non‑ambiguïté

- Parité soleil DSM ↔ `shared` sur entrées valides : `frontend/src/modules/calpinage/dsmOverlay/__tests__/dsmSolarParityWithSharedTruth.test.js`.
- Lecture des pertes affichées vs backend : `shadingParity.test.js` (script `npm run test:shading-parity`).

---

*Référence croisée : `docs/shading-governance.md` §7.*
