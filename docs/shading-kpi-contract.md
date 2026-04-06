# Contrat métier — KPI shading (SolarNext / Calpinage)

Document **sémantique** : définitions officielles des pourcentages d’ombrage, origine dans le code, usages autorisés, et règles snapshot / live.  
**Ne modifie pas** le moteur ni le JSON : il fige le langage pour l’UI, les exports, le commercial et les évolutions futures.

Références code : `backend/services/shading/officialShadingTruth.js`, `calpinageShadingNormalizer.js`, `shadingStructureBuilder.js`, `calpinageShading.service.js`, `weightedShadingKpi.js`, `solarnextPayloadBuilder.service.js`, `frontend/src/modules/calpinage/shading/officialGlobalShadingLoss.js`, `export/buildShadingExport.js`, `legacy/calpinage.module.js` (état live).

---

## 1. Glossaire — noms réels vs synonymes

| Nom « métier » (ce document) | Champs JSON / code réels | Remarque |
|------------------------------|--------------------------|----------|
| **Perte near (composante)** | `shading.near.totalLossPct` | Sortie moteur near (raycast annuel pondéré). **Ne pas** présenter seule comme « perte globale installation ». |
| **Perte far (composante)** | `shading.far.totalLossPct` | Peut être `null` si `far.source === "UNAVAILABLE_NO_GPS"`. |
| **Perte combinée globale (officielle)** | `shading.combined.totalLossPct` | **Vérité produit unique** pour perte d’ombrage globale (near + far selon moteur `computeCalpinageShading`). |
| **Alias racine (miroir)** | `shading.totalLossPct` | Doit refléter `combined.totalLossPct`. Priorité lecture : **toujours `combined` en premier**. |
| **Legacy plat (pré-normalisation)** | `nearLossPct`, `farLossPct`, `totalLossPct` à la racine | Produits par `buildStructuredShading` / service brut ; **absents** de l’objet **normalisé** V2 exposé consommateur (`normalizeCalpinageShading`). |
| **KPI combiné pondéré multi-pans** | `computeWeightedShadingCombinedPct` → valeur injectée dans `combined.totalLossPct` | Moyenne pondérée des `roof_pans[].shadingCombinedPct` par nombre de modules ; utilisé dans **payload étude / installation** quand des pans avec modules existent (`solarnextPayloadBuilder.service.js`). **Même sémantique « globale »** que `combined.totalLossPct`, autre **origine de calcul** (agrégat pans vs champ unique moteur). |
| **Live legacy calpinage (recompute UI)** | `CALPINAGE_STATE.shading.lastResult.annualLossPercent` (+ `nearLossPct`, `farLossPct`) | Objet **intermédiaire** après passage moteur front ; `annualLossPercent` = perte globale **à cette étape** (formule type combinaison near/far). Doit être **reconcilié** avec la structure normalisée backend quand celle-ci est la référence écran. |
| **Métadonnée moteur near (audit)** | `near.official` (dans structure structurée), `officialNear` côté pipeline TS | **Diagnostic** : quel moteur near, fallback, etc. **Pas** le KPI global d’installation. |

Le projet **n’utilise pas** un champ nommé `combinedLossPct` : l’équivalent officiel est **`combined.totalLossPct`**.

---

## 2. Contrat par KPI

### 2.1 `near.totalLossPct` (souvent appelé nearLossPct en plat)

1. **Définition métier** : perte de production annuelle **due à l’ombrage proche** (obstacles / raycast near), en % sur [0, 100].  
2. **Source technique** : `computeCalpinageShading` → `nearLossPct` → `buildStructuredShading` → `near.totalLossPct`.  
3. **Usage autorisé** : UI détail, diagnostic, PDF/exports **en tant que composante** ; explication commerciale « partie proche ».  
4. **Statut** : **KPI officiel composant**, pas vérité globale seule.  
5. **Compatibilité** : conservé ; le plat `nearLossPct` est **legacy structurant** avant normalisation uniquement.

### 2.2 `far.totalLossPct` (souvent farLossPct en plat)

1. **Définition** : perte annuelle **horizon lointain** (masque / relief), % [0, 100], ou **indisponible** (`null` + source GPS manquant).  
2. **Source** : même chaîne que near, branche far du service shading.  
3. **Usage** : UI détail, badges qualité horizon, exports **composante**.  
4. **Statut** : **KPI officiel composant** ; avec GPS manquant, **ne pas** inventer un 0 « rassurant » pour le global (voir `getOfficialGlobalShadingLossPct`).  
5. **Compatibilité** : `farLossPct` plat = legacy pré-normalisation.

### 2.3 `combined.totalLossPct` — **vérité globale officielle**

1. **Définition** : perte d’ombrage **globale** retenue pour le produit (near + far selon implémentation moteur unique `totalLossPct` du service).  
2. **Source** : `computeCalpinageShading` → `totalLossPct` → `combined.totalLossPct` après `buildStructuredShading` + `normalizeCalpinageShading`.  
3. **Usage** : **CRM**, synthèses, badges perte globale, **PDF**, exports premium, **persistance** étude lorsque le JSON normalisé est la référence.  
4. **Statut** : **KPI officiel principal** (`officialShadingTruth.js`, `officialGlobalShadingLoss.js`).  
5. **Compatibilité** : `shading.totalLossPct` racine = miroir ; si divergence avec `combined`, la **vérité** reste `combined`.

### 2.4 KPI pondéré multi-pans (`computeWeightedShadingCombinedPct`)

1. **Définition** : moyenne des `shadingCombinedPct` par pan, pondérée par **nombre de modules** ; alignée sur la logique de production multi-pan.  
2. **Source** : `backend/services/shading/weightedShadingKpi.js` ; injection dans `shading.combined.totalLossPct` (+ racine) dans `solarnextPayloadBuilder.service.js` lorsque des pans avec modules existent.  
3. **Usage** : **étude / installation / documents** dérivés de ce payload ; **pas** un second champ JSON : **remplace** la valeur portée par `combined.totalLossPct` pour ce contexte.  
4. **Statut** : **KPI officiel global** pour le **document étude** concerné, avec **origine** « agrégat pans » (à distinguer en diagnostic d’un run moteur « toit plat » unique).  
5. **Compatibilité** : ne pas exposer comme champ séparé `weightedCombinedPct` dans le JSON standard ; c’est une **valeur** pour `combined.totalLossPct`.

### 2.5 `officialNear` / `near.official`

1. **Définition** : traçabilité du **choix** near (canonical 3D vs legacy, fallback, etc.).  
2. **Source** : pipeline near front + `buildStructuredShading` (`near.official`).  
3. **Usage** : debug, audit, support ; **interdit** de l’afficher comme « perte globale » sans `combined.totalLossPct`.  
4. **Statut** : **technique / gouvernance**, secondaire.  
5. **Compatibilité** : conservé comme métadonnée.

### 2.6 `lastResult` (live) vs `normalized` (référence écran / API)

| Concept | Où | Rôle |
|---------|-----|------|
| **Recompute / live** | `state.shading.lastResult` | Dernier résultat **calcul client** (ex. `annualLossPercent`). Volatil pendant l’édition. |
| **Snapshot figé** | `calpinage_snapshots.snapshot_json`, champs étude persistés | Ce qui a été **enregistré** pour une version ; relire tel quel pour reproductibilité **de cette version**. |
| **Normalisé V2** | `state.shading.normalized` (après merge API / normalisation) | Forme **officielle** pour affichage CRM moderne et `buildPremiumShadingExport`. |

**Règle** : pour l’**affichage produit** « quelle est la perte retenue ? », utiliser **`getOfficialGlobalShadingLossPct(normalized)`** (ou équivalent backend) dès que `normalized` est disponible ; `lastResult` sert de **filet** ou d’état transitoire (ex. DSM overlay).

**Export / PDF** : partir du **JSON normalisé figé** dans le contexte d’export (étude versionnée ou `buildPremiumShadingExport(normalized)`), **sans recalcul** moteur dans l’export (voir commentaire dans `buildShadingExport.js`).

---

## 3. Décision nette : affichage / export / persistance

| Contexte | Vérité à utiliser |
|----------|-------------------|
| **Affichage CRM / cartes / synthèse** | `combined.totalLossPct` via `getOfficialGlobalShadingLossPct` (null si GPS bloque le far requis au produit). |
| **Export JSON premium / traçabilité** | Blocs `near`, `far`, `combined` copiés depuis normalisé ; globale = `combined.totalLossPct` (+ `totalLossPct` racine miroir dans l’export). |
| **Persistance étude / snapshot** | Valeurs **déjà calculées** dans le payload au moment du save (incl. surcharge multi-pan si appliquée en amont). |
| **Secondaire / technique** | `near` et `far` seuls, `officialNear`, `annualLossPercent` sans `normalized`, logs debug. |

---

## 4. Pièges documentés (ne pas « corriger » par renommage sauvage)

- **`annualLossPercent`** (moteur front `shadingEngine`) : équivalent **technique** du `totalLossPct` **global** pour le cœur annual ; aligné backend sur parité tests — **pas** un nom du contrat JSON V2.  
- **Lecture de `near.totalLossPct` comme globale** : erreur commerciale fréquente.  
- **Oublier `null` far sans GPS** : le global officiel peut être **indisponible** (`null`) ; ne pas substituer 0 sans règle produit.

---

## 5. Règles pour futurs développeurs

1. Toute nouvelle **bannière KPI client** : lire **`combined.totalLossPct`** (ou helper officiel).  
2. Toute évolution **math** : `shared/shading` + service shading — **pas** ce document pour changer les nombres.  
3. Tout nouveau champ **export** : ne pas introduire de second « total » contradictoire avec `combined` sans revue métier.  
4. Tests anti-dérive : `backend/tests/shading-kpi-contract.test.js` + `shading-resolve-display-truth.test.js` (enchaînés avec `npm run test:shading:lock`) ; frontend `officialGlobalShadingLoss.test.ts`.

---

## 6. Vérité unique d’affichage (produit)

**Objectif** : un même chiffre « perte globale » partout (CRM, calpinage, logs DSM orientés produit, PDF).

| Point d’entrée | Fichier / usage |
|----------------|-----------------|
| **Frontend** | `getOfficialGlobalShadingLossPct` / `getOfficialGlobalShadingLossPctOr` (`frontend/.../officialGlobalShadingLoss.js`) |
| **État calpinage live** | `getGlobalShadingLossPctForCalpinageShadingState(state.shading)` — préfère `normalized`, sinon dérive contrôlée depuis `lastResult.annualLossPercent` via le même helper |
| **Lecture DSM / résumé** | `getTotalLossPctFromShading` → délègue à `getOfficialGlobalShadingLossPct` |
| **Backend / PDF / snapshot** | `getOfficialGlobalShadingLossPct` (`officialShadingTruth.js`) ; `resolveShadingTotalLossPct` = même règle sur `shading` + repli **contrôlé** formulaire (sans court-circuiter GPS ni `combined.totalLossPct` null explicite) |

**Restent volontairement « techniques »** : `near.totalLossPct`, `far.totalLossPct`, `perPanel[].lossPct`, heatmap panneau, `officialNear`, traces moteur.

---

*Références : `docs/shading-governance.md`, `docs/dsm-overlay-governance.md`, `docs/shading-product-transparency.md` (discours produit / transparence).*
