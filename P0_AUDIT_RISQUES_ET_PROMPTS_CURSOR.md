# P0 — AUDIT RISQUES + PROMPTS CURSOR
**Analyse pré-implémentation — 2 juin 2026**

---

## SYNTHÈSE EXÉCUTIVE

| Action P0 | Risque test | Risque prod | Bloquer ? | Préconditions |
|---|---|---|---|---|
| P0-1 Supprimer RELIEF_ONLY fallback | ⚠️ Moyen — 6 fichiers tests à mettre à jour | ✅ Faible — chemin FAR_UNAVAILABLE_ERROR déjà existant | Non — mitigation claire | Ne pas supprimer l'export de la fonction |
| P0-2 DSM par défaut | ✅ Faible | ✅ Faible — sans DSM_PROVIDER_TYPE valide, résultat = UNAVAILABLE (honnête) | Non | Coupler avec P0-1 |
| P0-3 monthlyFactors | ✅ Aucun risque tests | ✅ Additive | Non | Garder `__testMonthly` compat |
| P0-4 GTI cos(incidence) | ✅ Aucun risque — goldens préservés | ✅ Résultats changeront en prod (souhaité) | Non | Fallback horizontal si tiltDeg absent |

**Aucun blocage majeur. Ordre optimal : P0-3 → P0-2 → P0-1 → P0-4**

---

## P0-1 — SUPPRESSION DU FALLBACK RELIEF_ONLY

### Risques identifiés

**Risque 1 — Import direct brisé (BLOQUANT sans mitigation)**

`backend/tests/horizon-hd-nonreg.test.js` ligne 2 :
```javascript
import { computeHorizonMaskReliefOnly } from "../services/horizon/horizonMaskCore.js";
```
Si on supprime `computeHorizonMaskReliefOnly`, ce test crash à l'import avec `SyntaxError: The requested module has no export 'computeHorizonMaskReliefOnly'`.

**Mitigation obligatoire :** Ne PAS supprimer l'export de `computeHorizonMaskReliefOnly`. La garder comme fonction utilitaire isolée mais ne plus l'exposer via le provider automatique. Le test peut continuer à l'appeler directement pour ses cas B/C.

---

**Risque 2 — Assertions `source === "RELIEF_ONLY"` dans 6 fichiers**

| Fichier | Lignes impactées | Action |
|---|---|---|
| `tests/horizon-hd-nonreg.test.js` | L.32, 37, 47, 54 | Remplacer `"RELIEF_ONLY"` par `"FAR_UNAVAILABLE_ERROR"` dans les assertions AUTO |
| `tests/horizon-confidence-integration.test.js` | L.54 | Ajouter `"FAR_UNAVAILABLE_ERROR"` comme source valide |
| `tests/http-geotiff-priority-and-fallback.test.js` | L.62-72, L.168 | Changer l'assertion fallback : HTTP fail → UNAVAILABLE, pas RELIEF_ONLY |
| `tests/far-confidence-model.test.js` | L.26-36 | Adapter ou supprimer le test RELIEF_ONLY confidence |
| `scripts/test-shading-far-monthly-coherence.js` | — | Script dev — non bloquant, adapter si besoin |
| `tests/shading-kpi-contract.test.js` | L.22-100 | Les fixtures utilisent `source: "RELIEF_ONLY"` — fixtures statiques, non exécutées comme calcul live → SAFE |

---

**Risque 3 — Chemin FAR_UNAVAILABLE_ERROR déjà existant (PAS un risque)**

`shadingStructureBuilder.js` gère déjà `farUnavailableError`:
```javascript
const farUnavailableError = shadingResult.farHorizonStatus === "FAR_UNAVAILABLE_ERROR" || ...;
// → far = { source: "FAR_UNAVAILABLE_ERROR", confidenceScore: 0, totalLossPct: null }
```
`officialShadingTruth.js` gère déjà `"FAR_UNAVAILABLE_ERROR"` → return null.
`resolveShadingTotalLossPct.js` gère déjà ce cas.

Le chemin existe. On l'active juste en default.

---

**Risque 4 — `computeHorizonMaskAuto()` doit retourner un objet valide (pas throw)**

`calpinageShading.service.js` wrapp l'appel dans un try/catch :
```javascript
try {
  result = await Promise.resolve(provider.computeMask({ ...params }));
} catch (err) {
  result = await reliefOnlyProvider.computeMask({ ...params });  // ← ce fallback doit changer
```

Sans RELIEF_ONLY, le catch doit retourner `{ source: "FAR_UNAVAILABLE_ERROR", mask: [], ... }` directement au lieu d'appeler reliefOnlyProvider.

---

**Impact sur `combined.totalLossPct` et contrat test**

Quand far est UNAVAILABLE, dans `calpinageShading.service.js` :
- `horizonElev = 0` → `aboveHorizon = true` pour tous les samples → `totalWeightFar = totalWeightBaseline`
- `totalLossPct = nearLossPct` (seul l'ombrage proche contribue)
- `combined.totalLossPct` reste un **number** (pas null) — le test `assert(typeof s.combined.totalLossPct === "number")` PASSE

Pas de régression sur `shading-premium-lock.test.js` testOfficialContract.

---

### Corrections indispensables avant implémentation P0-1

1. Garder l'export de `computeHorizonMaskReliefOnly` dans `horizonMaskCore.js`
2. Mettre à jour 4 fichiers de tests (assertions auto)
3. Modifier `computeHorizonMaskAuto()` pour retourner `FAR_UNAVAILABLE_ERROR` directement dans le catch

---

## P0-2 — DSM ACTIVÉ PAR DÉFAUT

### Analyse complète

`horizonDsmGate.js` : `isSurfaceDsmTerrainReady()` retourne `true` seulement si :
- `HORIZON_DSM_ENABLED=true` ET
- `DSM_PROVIDER_TYPE` ∈ {`HTTP_GEOTIFF`+URL, `IGN_RGE_ALTI`, `LOCAL`}

Conséquence : changer le défaut de `=== "true"` à `!== "false"` ne change RIEN quand `DSM_PROVIDER_TYPE=STUB` (défaut). La sélection du provider reste inchangée.

**L'effet réel de P0-2 est** : en production correctement configurée (DSM_PROVIDER_TYPE=IGN_RGE_ALTI + DSM_ENABLE=true), on n'a plus besoin de passer `HORIZON_DSM_ENABLED=true` explicitement.

### Risques tests

`horizon-dsm-gate.test.js` manipule `process.env.HORIZON_DSM_ENABLED = "false"` explicitement dans ses tests — pas affecté par le changement de défaut.

`horizon-hd-nonreg.test.js` :
```javascript
process.env.HORIZON_DSM_ENABLED = "false";  // Test A — force disable
// → relief.source = "RELIEF_ONLY"  ← CHANGERA en "FAR_UNAVAILABLE_ERROR" après P0-1
```
Ce test ne test pas le défaut, il force la valeur — pas de régression sur P0-2 seul.

### Impact prod

Seule la ligne de config change. Les déploiements sans DSM_PROVIDER_TYPE valide → UNAVAILABLE (au lieu de RELIEF_ONLY).

### Corrections indispensables

Aucune. Changement d'une ligne.

---

## P0-3 — EXPOSITION monthlyFactors

### Analyse

`__testReturnMonthly` est utilisé dans :
- 4 scripts dans `backend/scripts/` (dev tools, non-CI)
- 0 fichiers dans `backend/tests/`

Les scripts utilisent `result.__testMonthly.monthlyBaselineEnergy` etc.

**Stratégie :** Toujours calculer les arrays mensuels. Retourner `monthlyFactors` comme champ stable. Retourner AUSSI `__testMonthly` avec les mêmes données pour la compatibilité des scripts dev.

### Risques

**Aucun.** Changement purement additif.

### Impact résultats

Aucun — n'affecte pas les calculs existants.

### Corrections indispensables

Mettre à jour `shared/schemas/study.schema.ts` pour documenter le nouveau champ.

---

## P0-4 — PONDÉRATION GTI cos(angle_incidence)

### Analyse précise

**Test golden `shading-premium-lock.test.js` TEST 2 (near) :**
```javascript
const GOLDEN_TOTAL = 0.010203482917434354;
// Panels : polygonPx sans tiltDeg ni azimuthDeg
```
`extractPanelNormal(geometry)` → tiltDeg absent → normalZ=1, normalX=0, normalY=0 → `cosIncidence = sunDir.dz`. **GOLDEN INCHANGÉ.**

**Test golden TEST 3 (far) :**
```javascript
const GOLDEN = 8.823;
// computeCalpinageShading sans geometry → no tiltDeg
```
Même raisonnement. **GOLDEN INCHANGÉ.**

**Test parity TEST 5 (front/back) :**
`computeAnnualShadingLoss()` (annualFarHorizonWeightedLossCore.cjs) utilise `sunDir.dz`.
`computeCalpinageShading()` avec la correction → `cosIncidence = sunDir.dz` (horizontal fallback).
**Parité maintenue.**

### Risques prod

Les études existantes en base de données ont des `totalLossPct` calculés avec l'ancienne pondération. Après déploiement, les recalculs donneront des valeurs légèrement différentes (±1-3 points relatifs selon inclinaison). C'est **voulu** — c'est une correction physique.

### Effet de bord important

Le changement dans `calpinageShading.service.js` affecte la pondération pour le calcul far+near combiné. La pondération **interne** de `nearShadingCore.computeNearShading()` reste `sunDir.dz` pour l'instant — ce sera aligné dans P1-4 quand on fera le raycast 3D complet. L'asymétrie est acceptable : on corrige d'abord la pondération globale (P0-4), puis la géométrie du raycast (P1-4).

### Corrections indispensables

1. Confirmer que `geometry.roof?.pans[0].tiltDeg` et `geometry.roof?.pans[0].orientationDeg` existent dans les payloads de production (à vérifier dans la DB ou les tests d'intégration).
2. Implémenter le fallback `{ normalX: 0, normalY: 0, normalZ: 1 }` si tiltDeg absent — indispensable pour rétrocompatibilité.

---

## ORDRE D'IMPLÉMENTATION OPTIMAL

```
P0-3 (monthlyFactors)  → risque zéro, purement additif, indépendant
P0-2 (DSM default)     → 1 ligne, indépendant
P0-1 (RELIEF_ONLY)     → dépend de P0-2 pour être cohérent ; met à jour 4 tests
P0-4 (GTI weight)      → indépendant, en dernier pour limiter le scope de retesting
```

---

---
---
# PROMPTS CURSOR DÉFINITIFS — PHASE P0

> Copier chaque bloc dans Cursor tel quel. Chaque prompt est autonome et contient tout le contexte nécessaire.

---

## CURSOR PROMPT P0-3 : Exposition permanente des facteurs d'ombrage mensuels

```
Contexte :
Dans `backend/services/shading/calpinageShading.service.js`, les facteurs d'ombrage
mensuels sont déjà calculés (variables monthlyBaseline, monthlyFar, monthlyFarNear)
mais uniquement quand `options.__testReturnMonthly === true`. En production, ces données
sont calculées puis jetées. Objectif : les exposer toujours dans le résultat.

Fichier à modifier : `backend/services/shading/calpinageShading.service.js`

Modifications exactes à effectuer :

1. Ligne ~425 : supprimer la conditionnelle `const returnMonthly = options.__testReturnMonthly === true;`

2. Lignes ~430-432 : supprimer les conditions ternaires sur `returnMonthly` pour
   l'initialisation des arrays. Remplacer par initialisation inconditionnelle :
   ```
   const monthlyBaseline = new Array(12).fill(0);
   const monthlyFar      = new Array(12).fill(0);
   const monthlyFarNear  = new Array(12).fill(0);
   ```

3. Dans la boucle principale (~lignes 443, 453, 475) : supprimer les `if (returnMonthly)`
   guards autour de :
   ```
   monthlyBaseline[month] += weight;
   monthlyFar[month]      += weight;
   monthlyFarNear[month]  += farNearWeight;
   ```
   Ces accumulations doivent se faire TOUJOURS, sans condition.

4. Dans le bloc return final (après le calcul de farLossPct/nearLossPct/totalLossPct),
   remplacer le bloc conditionnel `if (returnMonthly && ...) { result.__testMonthly = ... }`
   par :
   ```javascript
   // Facteurs mensuels — toujours calculés et exposés (API stable)
   result.monthlyFactors = monthlyBaseline.map((base, i) => {
     const far  = monthlyFar[i];
     const fn   = monthlyFarNear[i];
     return {
       month:                i + 1,
       farLossFraction:      base > 0 ? Math.max(0, Math.min(1, 1 - far / base)) : 0,
       nearLossFraction:     far  > 0 ? Math.max(0, Math.min(1, 1 - fn  / far))  : 0,
       combinedLossFraction: base > 0 ? Math.max(0, Math.min(1, 1 - fn  / base)) : 0,
     };
   });
   // Compat rétrograde scripts dev (__testMonthly)
   result.__testMonthly = {
     monthlyBaselineEnergy: monthlyBaseline,
     monthlyFarEnergy:      monthlyFar,
     monthlyFarNearEnergy:  monthlyFarNear,
   };
   ```

5. Mettre à jour le JSDoc du return type (ligne ~254) pour documenter `monthlyFactors`.

Contraintes :
- Ne modifier AUCUN autre calcul (farLossPct, nearLossPct, totalLossPct inchangés).
- Ne pas modifier les tests existants (aucun test n'utilise __testReturnMonthly).
- Vérifier que `npm run test:shading:lock` passe toujours après la modification.
```

---

## CURSOR PROMPT P0-2 : Activation DSM par défaut

```
Contexte :
Dans `backend/services/horizon/providers/dsm/dsmConfig.js`, `HORIZON_DSM_ENABLED`
ne s'active qu'avec la valeur explicite `"true"`. En production correctement configurée
(DSM_PROVIDER_TYPE=IGN_RGE_ALTI ou HTTP_GEOTIFF), la variable d'environnement doit être
explicitement passée. Objectif : la rendre active par défaut (opt-out, pas opt-in).

Fichier à modifier : `backend/services/horizon/providers/dsm/dsmConfig.js`

Modification exacte :

Ligne : `const enabled = process.env.HORIZON_DSM_ENABLED === "true";`
Remplacer par : `const enabled = process.env.HORIZON_DSM_ENABLED !== "false";`

Sémantique : DSM activé par défaut, désactivable avec HORIZON_DSM_ENABLED=false.

Contraintes :
- Ne modifier aucun autre fichier.
- `horizon-dsm-gate.test.js` manipule process.env explicitement dans ses tests
  (process.env.HORIZON_DSM_ENABLED = "false") — ce test ne sera pas affecté.
- Vérifier que `node tests/horizon-dsm-gate.test.js` passe toujours.
```

---

## CURSOR PROMPT P0-1 : Suppression du fallback RELIEF_ONLY automatique

```
Contexte :
Le moteur d'ombrage lointain de SolarNext tombe silencieusement sur un provider
"RELIEF_ONLY" qui génère des horizons fictifs (deux gaussiennes empiriques, confidence=0.3).
Ce fallback est activé chaque fois que le DSM réel n'est pas disponible.
Objectif : supprimer ce fallback silencieux. Quand aucune donnée réelle n'est disponible,
retourner un état UNAVAILABLE explicite au lieu d'inventer des données.

IMPORTANT : Ne pas supprimer la fonction `computeHorizonMaskReliefOnly` ni son export
depuis horizonMaskCore.js — elle est importée directement dans horizon-hd-nonreg.test.js.
Changer uniquement le comportement automatique du provider selector.

Fichiers à modifier et modifications exactes :

--- FICHIER 1 : backend/services/horizon/providers/reliefOnlyProvider.js ---

Remplacer la fonction `isAvailable()` par :
```javascript
export function isAvailable(params) {
  return {
    available: false,
    coveragePct: 0,
    resolution_m: null,
    notes: ["RELIEF_ONLY désactivé — données terrain IGN requises (DSM_PROVIDER_TYPE=IGN_RGE_ALTI ou LOCAL)"],
  };
}
```

Remplacer la fonction `computeMask()` par :
```javascript
export function computeMask(params) {
  return {
    source: "FAR_UNAVAILABLE_ERROR",
    mask: [],
    confidence: 0,
    unavailable: true,
    dataCoverage: {
      mode: "UNAVAILABLE",
      available: false,
      coveragePct: 0,
      notes: ["RELIEF_ONLY désactivé"],
      ratio: 0,
      effectiveRadiusMeters: 0,
      gridResolutionMeters: 0,
      provider: "FAR_UNAVAILABLE_ERROR",
    },
    meta: {
      source: "FAR_UNAVAILABLE_ERROR",
      qualityScore: 0,
    },
  };
}
```

--- FICHIER 2 : backend/services/horizon/providers/horizonProviderSelector.js ---

Remplacer la fonction `computeHorizonMaskAuto()` entièrement par :
```javascript
export async function computeHorizonMaskAuto(params) {
  const dsmAvail = surfaceDsmProvider.isAvailable(params);
  
  if (!dsmAvail.available) {
    const reason = dsmAvail.notes?.join("; ") ?? "SURFACE_DSM_NOT_AVAILABLE";
    console.log("[HORIZON] DSM non disponible, retour UNAVAILABLE :", reason);
    return {
      source: "FAR_UNAVAILABLE_ERROR",
      mask: [],
      confidence: 0,
      dataCoverage: {
        provider: "FAR_UNAVAILABLE_ERROR",
        notes: [reason],
        ratio: 0,
        effectiveRadiusMeters: 0,
        gridResolutionMeters: 0,
      },
      meta: { source: "FAR_UNAVAILABLE_ERROR", fallbackReason: reason },
    };
  }

  try {
    const result = await Promise.resolve(surfaceDsmProvider.computeMask({ ...params }));
    if (!result.meta) result.meta = {};
    if (result.meta.source == null) {
      result.meta.source = result.source === "SURFACE_DSM" ? "SURFACE_DSM" : "FAR_UNAVAILABLE_ERROR";
    }
    return result;
  } catch (err) {
    const reason = "SURFACE_DSM_EXCEPTION: " + (err?.message ?? "unknown");
    console.warn("[HORIZON] DSM exception, retour UNAVAILABLE :", reason);
    return {
      source: "FAR_UNAVAILABLE_ERROR",
      mask: [],
      confidence: 0,
      dataCoverage: {
        provider: "FAR_UNAVAILABLE_ERROR",
        notes: [reason],
        ratio: 0,
        effectiveRadiusMeters: 0,
        gridResolutionMeters: 0,
      },
      meta: { source: "FAR_UNAVAILABLE_ERROR", fallbackReason: reason },
    };
  }
}
```

Supprimer l'import de `reliefOnlyProvider` s'il n'est plus utilisé que pour le fallback.
Garder l'import et la fonction `selectBestProvider()` si elle est utilisée ailleurs.

--- FICHIER 3 : backend/tests/horizon-hd-nonreg.test.js ---

Ce fichier teste `computeHorizonMaskReliefOnly` directement (import ligne 2) ET teste
`computeHorizonMaskAuto()`. Les assertions sur le chemin AUTO doivent changer.

Garder intact :
- L'import de `computeHorizonMaskReliefOnly`
- Le test A sur le résultat direct de `computeHorizonMaskReliefOnly(params)` (source, mask.length, resolution_m)

Modifier uniquement les assertions sur `computeHorizonMaskAuto()` :

Test A (auto path) :
```javascript
// AVANT
assert(autoRelief.source === "RELIEF_ONLY", "A) auto RELIEF_ONLY");
assert(JSON.stringify(autoRelief.mask) === JSON.stringify(relief.mask), "A) auto mask === relief mask (snapshot)");
// APRÈS (DSM désactivé → UNAVAILABLE)
assert(autoRelief.source === "FAR_UNAVAILABLE_ERROR", "A) DSM désactivé → UNAVAILABLE");
assert(Array.isArray(autoRelief.mask) && autoRelief.mask.length === 0, "A) mask vide si UNAVAILABLE");
```

Test B (STUB) :
```javascript
// AVANT
assert(dsmStub.source === "RELIEF_ONLY", "B) STUB sans terrain réel → RELIEF_ONLY");
// APRÈS
assert(dsmStub.source === "FAR_UNAVAILABLE_ERROR", "B) STUB sans terrain réel → UNAVAILABLE");
```

Test C (STUB+HD) :
```javascript
// AVANT
assert(dsmHd.source === "RELIEF_ONLY", "C) STUB+HD → RELIEF_ONLY");
// APRÈS
assert(dsmHd.source === "FAR_UNAVAILABLE_ERROR", "C) STUB+HD → UNAVAILABLE");
```

--- FICHIER 4 : backend/tests/horizon-confidence-integration.test.js ---

Ligne ~54, remplacer :
```javascript
assert(horizonResult.source === "RELIEF_ONLY" || horizonResult.source === "SURFACE_DSM", "source valide");
```
Par :
```javascript
assert(
  ["RELIEF_ONLY", "SURFACE_DSM", "FAR_UNAVAILABLE_ERROR"].includes(horizonResult.source),
  "source valide (DSM, ou UNAVAILABLE si DSM non configuré)"
);
```

Lignes ~81-84 (if RELIEF_ONLY → score ≤ 30) : ajouter FAR_UNAVAILABLE_ERROR :
```javascript
if (shading.far.source === "RELIEF_ONLY" || shading.far.source === "FAR_UNAVAILABLE_ERROR") {
  assert(shading.far.confidenceScore <= 30, "RELIEF_ONLY/UNAVAILABLE plafonné à 30");
  assert(shading.far.confidenceLevel === "LOW", "RELIEF_ONLY/UNAVAILABLE → niveau LOW");
}
```

--- FICHIER 5 : backend/tests/http-geotiff-priority-and-fallback.test.js ---

Tests qui assertent le fallback HTTP → RELIEF_ONLY (lignes ~62-72 et ~168) :
Remplacer `"RELIEF_ONLY"` par `"FAR_UNAVAILABLE_ERROR"` dans ces assertions.
Adapter les vérifications de `dataCoverage.provider` de même.

Vérifications finales obligatoires :
- `node tests/shading-premium-lock.test.js` → doit passer (contract, goldens, parity inchangés)
- `node tests/horizon-hd-nonreg.test.js` → doit passer avec nouvelles assertions
- `node tests/shading-quality-integration.test.js` → doit passer
- `node tests/horizon-confidence-integration.test.js` → doit passer
```

---

## CURSOR PROMPT P0-4 : Pondération GTI — cos(angle d'incidence) au lieu de sin(élévation)

```
Contexte :
Dans `backend/services/shading/calpinageShading.service.js`, la pondération énergétique
de chaque pas de temps est `weight = Math.max(0, sunDir.dz)` = sin(élévation solaire).
Cela correspond à l'irradiance sur un plan HORIZONTAL.
Pour un panneau incliné à 30° orienté Sud, la pondération correcte est cos(angle_incidence)
= produit scalaire du vecteur solaire avec la normale du panneau.

Objectif : corriger la pondération dans le calcul combiné far+near en utilisant la géométrie
réelle du pan (tiltDeg, orientationDeg). Fallback sur sin(élévation) si la géométrie ne
fournit pas ces données (rétrocompatibilité totale avec les tests existants).

Fichier à modifier : `backend/services/shading/calpinageShading.service.js`

Modifications exactes :

--- ÉTAPE 1 : Ajouter la fonction d'extraction de la normale du pan ---

Après les imports et avant la fonction `resolveMetersPerPixelFromParams`, ajouter :

```javascript
/**
 * Extrait la normale unitaire du panneau depuis la géométrie du premier pan.
 * Retourne la normale du plan horizontal si tiltDeg est absent ou nul.
 * @param {object|null} geometry - Géométrie du calpinage
 * @returns {{ normalX: number, normalY: number, normalZ: number }}
 */
function extractPanelNormalFromGeometry(geometry) {
  const pans =
    geometry?.roof?.pans ??
    geometry?.validatedRoofData?.pans ??
    geometry?.roofState?.pans ??
    [];
  if (!Array.isArray(pans) || pans.length === 0) {
    return { normalX: 0, normalY: 0, normalZ: 1 }; // plan horizontal — fallback sûr
  }
  const pan = pans[0];
  const tiltDeg = pan.tiltDeg ?? pan.slopeDeg ?? pan.tilt_deg ?? 0;
  const azDeg   = pan.orientationDeg ?? pan.azimuthDeg ?? pan.azimuth_deg ?? 180;
  if (!tiltDeg || tiltDeg <= 0) {
    return { normalX: 0, normalY: 0, normalZ: 1 }; // plan plat — fallback sûr
  }
  const tiltRad = (tiltDeg * Math.PI) / 180;
  const azRad   = (azDeg   * Math.PI) / 180;
  return {
    normalX: Math.sin(azRad) * Math.sin(tiltRad),
    normalY: Math.cos(azRad) * Math.sin(tiltRad),
    normalZ: Math.cos(tiltRad),
  };
}
```

--- ÉTAPE 2 : Initialiser panelNormal avant la boucle ---

Dans `computeCalpinageShading()`, après la résolution de `metersPerPixel` et avant
la boucle `for (const sample of samples)`, ajouter :

```javascript
// Normale du pan pour pondération GTI (cos angle d'incidence)
const panelNormal = extractPanelNormalFromGeometry(geometry);
```

--- ÉTAPE 3 : Remplacer la pondération dans la boucle ---

Dans la boucle `for (const sample of samples)` (~ligne 437), remplacer :
```javascript
const weight = Math.max(0, sunDir.dz);
```
Par :
```javascript
// Pondération GTI : cos(angle d'incidence sur le pan réel)
// Si tiltDeg absent → normalZ=1 → cosIncidence = sunDir.dz (identique à sin(élévation))
const cosIncidence = sunDir.dx * panelNormal.normalX
                   + sunDir.dy * panelNormal.normalY
                   + sunDir.dz * panelNormal.normalZ;
const weight = Math.max(0, cosIncidence);
```

--- VÉRIFICATIONS OBLIGATOIRES ---

Goldens dans shading-premium-lock.test.js :
- TEST 2 (near golden 0.010203482917434354) : les panels n'ont pas tiltDeg →
  normalZ=1 → cosIncidence = sunDir.dz → GOLDEN INCHANGÉ ✅
- TEST 3 (far golden 8.823) : computeCalpinageShading appelé sans geometry →
  pans[] vide → normalZ=1 → GOLDEN INCHANGÉ ✅
- TEST 5 (front/back parity < 0.001) : même fallback horizontal des deux côtés → PARITY MAINTENUE ✅

Après modification :
- `node tests/shading-premium-lock.test.js` → doit passer SANS modifier les goldens
- `node tests/shading-quality-integration.test.js` → doit passer
- `node tests/near-shading-physics-invariants.test.js` → doit passer
```

---

## CHECKLIST DE LIVRAISON P0

Après les 4 implémentations, vérifier dans l'ordre :

```bash
# 1. Tests goldens et contrats
node backend/tests/shading-premium-lock.test.js

# 2. DSM gate
node backend/tests/horizon-dsm-gate.test.js

# 3. Horizon HD non-régression (avec nouvelles assertions)
node backend/tests/horizon-hd-nonreg.test.js

# 4. Confidence integration
node backend/tests/horizon-confidence-integration.test.js

# 5. Quality integration
node backend/tests/shading-quality-integration.test.js

# 6. Near shading physique
node backend/tests/near-shading-physics-invariants.test.js

# 7. Shading KPI contract
node backend/tests/shading-kpi-contract.test.js

# 8. Sync frontend (après toute modif shared/shading)
npm run sync:calpinage-shading-from-shared
```

**Critère de succès P0 :** Tous ces tests passent. Aucun golden modifié. L'état DSM UNAVAILABLE est retourné à la place de RELIEF_ONLY quand aucune donnée réelle n'est configurée.
