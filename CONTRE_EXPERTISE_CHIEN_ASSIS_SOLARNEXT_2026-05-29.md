# Contre-expertise chien assis / lucarne - SolarNext

Date : 2026-05-29
Mode : audit expert de debogage, sans modification fonctionnelle du code
Perimetre : dessin 2D chien assis, persistence runtime, reconstruction 3D, hauteur PV et overlay

## 1. Reference metier : ce qu'il faut modeliser

Un chien assis n'est pas seulement un polygone pose sur un pan. C'est une lucarne qui ressort du toit, avec une facade verticale, des joues laterales, une couverture propre et des raccords avec le pan principal.

Les references externes consultes convergent sur ces points :

- Un chien assis est une ouverture de toiture formant une avancee par rapport a la pente du toit, avec une petite toiture propre.
  Source : https://www.guide-toiture.com/travaux-annexes-toiture/chien-assis-toiture/
- Le sens courant inclut souvent plusieurs lucarnes, mais le chien assis strict est une lucarne a pente inverse de celle du toit principal.
  Source : https://www.le-dictionnaire.com/definition/chien-assis
- Une lucarne se compose d'une facade verticale, de deux joues et d'une couverture qui forme des noues avec le pan principal.
  Source : https://fr.wikipedia.org/wiki/Lucarne
- En vocabulaire anglo-saxon, un dormer est une structure couverte qui projette hors d'un toit en pente, souvent avec une fenetre ; les types usuels incluent gable dormer, shed dormer et hip dormer.
  Source : https://roofs.wiki/Roof_Anatomy_and_Parts_Explained

Conclusion metier : dans SolarNext, le dessin 2D ne doit pas enregistrer un "obstacle toiture" vague. Il doit enregistrer une entite architecturale avec roles explicites :

- supportPanId : pan porteur
- footprint : empreinte sur le pan support
- facadeEdge : bord vertical visible, cote bas/rue
- rearSeamEdge : ligne d'ancrage ou de retour vers le pan principal
- cheekEdges : joues gauche/droite
- ridge : faitage du mini-toit
- valleyEdges / hips : raccords/noues ou aretiers vers la toiture principale
- heights : facade, ridge, reference de hauteur
- orientation : axes tangents au pan, jamais des axes monde par defaut

## 2. Mon verdict sur l'audit Claude

L'audit Claude est utile, mais il analyse essentiellement un etat anterieur. Dans le repo actuel, une partie importante des critiques a deja ete corrigee.

Points Claude confirms dans l'etat actuel :

- Le risque de double pipeline V1/V2 existe encore. Dans `buildSolarScene3DFromCalpinageRuntimeCore.ts`, les volumes legacy V1 et parametric V2 sont concatennes si `parametricDormers` existe, sans deduplication geometrique ni regle de source unique.
- Le dessin 2D reste pauvre semantiquement. Konva affiche les `roofExtensions`, mais ne dessine pas les `parametricDormers`; l'utilisateur ne voit donc pas toute la verite canonique.
- Le resolver de hauteur contient bien une logique P1.5 dormer, mais elle n'est pas alimentee en production par `extractHeightStateContextFromCalpinageState`, qui retourne seulement `contours`, `ridges`, `traits`.
- Le systeme garde encore deux familles de representation : `roofExtensions[]` legacy et `parametricDormers[]` V2. Tant que les deux survivent, les corrections locales ne garantissent pas la coherence produit.

Points Claude devenus faux ou incomplets dans l'etat actuel :

- C1 est corrige : `buildRoofDormerParametric3D.ts:176-177` utilise directement `ridge.front` et `ridge.rear`, plus les moyennes du footprint.
- C2 est corrige cote V2 : `sourceRidgePx` a ete renomme en `sourceRidgeLocalM` dans `buildRoofDormerParametric3DFromRuntime.ts:195`.
- C4 est corrige : `roofRiseM <= 0` leve une erreur dans `roofDormerParametricModel.ts:99-103`, avec tests.
- C6 est partiellement corrige en V1 : `heightRefCos` convertit `vertical_from_main_roof` dans `buildRoofExtensionV1FromSource.ts:117-122`.
- E7 est corrige : `right-gable` suit le cycle symetrique `[gFR, gRR, rRight]`.
- E8 est corrige partiellement : `flashing` exclut `base:rear`, mais `seams` reste tout le perimetre.
- E9 est corrige : `baseElevationM` utilise `Math.min` dans `buildRoofDormerParametric3DFromRuntime.ts:149`.
- E10 est corrige : `depthAxisPx` passe par `imagePxToWorldHorizontalM` puis `worldHorizontalMToImagePx` dans `buildRoofExtensionV1FromSource.ts:157-164`.
- E11 est corrige en lecture runtime V2 : orientation explicite obligatoire, sinon erreur `ROOF_DORMER_PARAMETRIC_ORIENTATION_MISSING`.
- E12 est corrige : `ORIENTATION_OFF_PLANE` est une erreur dans `roofDormerParametricValidation.ts:118`.
- E13 est corrige : `propagateRoofContourEdgeJunctionAfterContourEdit` cascade vers les aliases.
- E14 est partiellement corrige : Konva lit `roofExtensions`, mais pas `parametricDormers`.
- M15/M16 sont corriges partiellement : profondeur de footprint degeneree bloque la creation V1 ; pente quasi nulle emet warning.
- M20 est corrige : `intersectInfiniteLines2D` utilise un seuil relatif dans `roofExtensionApex.ts:39-41`.
- M21 est corrige : seuil d'ancre a 5 cm avec severite error dans `roofDormerParametricValidation.ts:124-125`.
- M22 est corrige : debord parametrique a 0.30 m.
- M23 est corrige : aire corrigee par `1/cos(slope)` dans `buildRoofExtensionV1FromSource.ts:178`.
- M27 est corrige : tolerance hauteur passee a 1 mm.

## 3. Probleme racine que Claude n'a pas assez isole

Le vrai probleme n'est pas seulement "un bug de faitage" ou "un bug de hauteur". Le vrai probleme est que SolarNext n'a pas encore un contrat unique pour dire ce qu'est un chien assis en 2D.

Aujourd'hui :

- V1 lit un dessin libre `roofExtensions[]` avec contour, ridge, hips, apex, champs legacy.
- V2 lit un modele parametrique `parametricDormers[]` deja plus sain, mais non branche comme source unique visible/editable.
- La scene 3D accepte les deux et les additionne.
- Le resolver de hauteur peut interpoler un dormer, mais le contexte produit ne lui transmet pas les dormers.
- L'overlay 2D montre les roofExtensions mais ignore les parametricDormers.

Donc meme quand chaque bug local est corrige, l'utilisateur peut encore dessiner un objet qui a l'air coherent dans une couche, et incoherent dans une autre.

## 4. Nouveaux constats critiques

### Critique A - La deduplication V1/V2 est absente

Dans `buildSolarScene3DFromCalpinageRuntimeCore.ts:688-691`, si un parametric dormer existe, on fait :

```ts
const extensionVolumesForScene = hasParametricDormers
  ? [...roofExtRes.extensionVolumes, ...paramDormerRes.extensionVolumes]
  : roofExtRes.extensionVolumes;
```

Ce n'est pas une migration ; c'est une superposition. Si le meme chien assis est stocke dans `roofExtensions[]` et `parametricDormers[]`, il y aura deux volumes, deux raycasts, deux keepouts et potentiellement deux ombres.

Correction concrete :

- Introduire une cle de reconciliation `canonicalDormerId`.
- Si `parametricDormers[]` contient un dormer avec le meme id ou une empreinte equivalente a une roofExtension, V2 gagne et V1 est ignoree.
- Ajouter un diagnostic `ROOF_EXTENSION_SHADOWED_BY_PARAMETRIC_DORMER`.
- Ajouter un test avec une V1 et une V2 superposees : la scene doit contenir exactement 1 volume.

### Critique B - Le resolver de hauteur dormer est ecrit, mais non cable au produit

`heightResolver.ts` contient `DormerHeightContext`, `getHeightOnDormerSurface` et la source `dormer_surface_interpolated`.
Mais `extractHeightStateContextFromCalpinageState` retourne seulement `{ contours, ridges, traits }`.

Impact : les panneaux poses sur un chien assis peuvent encore recevoir le Z du pan support dans les flux produit, malgre l'existence de la correction P1.5.

Correction concrete :

- Construire `state.dormers` depuis les volumes V1/V2 deja produits.
- Ne pas demander aux panels de "deviner" la surface dormer : injecter explicitement les dormers dans `HeightResolverContext`.
- Ajouter un test d'integration, pas seulement unitaire : `buildCanonicalPlacedPanelsFromRuntime` avec un panneau centre dans l'empreinte dormer doit sortir `source === dormer_surface_interpolated` et un Z superieur au pan support.

### Critique C - L'overlay 2D ne montre pas la verite canonique V2

`KonvaContoursLayer.tsx` dessine `roofExtensions.map(...)`, mais `parametricDormers` est lu dans le type et jamais rendu.

Impact : si V2 devient la vraie source, l'utilisateur ne voit pas le chien assis canonique dans l'outil de validation 2D. On retombe dans le bug humain : "je crois avoir corrige, mais je valide une autre couche".

Correction concrete :

- Rendre `parametricDormers` avec empreinte, faitage, facadeEdge et cheekEdges dans une couleur differente.
- Ajouter un toggle debug "legacy / parametric / both".
- Si V1 et V2 existent au meme endroit, afficher une alerte visuelle de superposition.

### Critique D - Le modele parametrique porte les points, mais pas encore assez les roles architecturaux

`RoofDormerParametricFootprint` contient `frontLeft`, `frontRight`, `rearRight`, `rearLeft`, et `ridge.front/rear`. C'est mieux que V1, mais les noms `ridge.front` et `ridge.rear` sont ambigus : un faitage a plutot une extremite gauche/droite, ou start/end selon l'axe U.

Impact : on corrige le calcul, mais on laisse une source de confusion durable. Les commentaires dans `buildRoofDormerParametric3D.ts` disent que `ridge.front` correspond a l'extremite gauche, ce qui contredit le nom.

Correction concrete :

- Renommer en `ridge.left` / `ridge.right`, ou `ridge.a` / `ridge.b` plus `ridgeAxisRole`.
- Ajouter `facadeEdge: ["frontLeft","frontRight"]` et `rearEdge: ["rearLeft","rearRight"]`.
- Ajouter une validation : le faitage doit etre globalement parallele a la facade pour un chien assis standard, sauf mode expert.

### Critique E - Le V1 transforme trop librement les footprints non quadrilateres

Les tests acceptent un contour pentagone et produisent une emprise architecturale stable. C'est robuste, mais dangereux pour un chien assis : un vrai dormer standard doit etre rectangulaire/trapezoidal en plan, pas un pentagone arbitraire sans semantic edges.

Impact : le systeme peut rendre un volume "stable" mais architecturalement faux.

Correction concrete :

- Pour `kind: dormer`, refuser ou declasser les footprints non quadrilateres.
- Si on veut accepter un polygone libre, le classer `roof_obstacle_custom` ou `roof_extension_freeform`, pas `gable_dormer`.
- Ajouter un diagnostic `DORMER_FOOTPRINT_NOT_QUADRILATERAL`.

### Critique F - La notion de chien assis strict vs lucarne generique n'est pas encodee

Les sources metier montrent que le mot "chien assis" est souvent utilise improprement pour plusieurs lucarnes. Le code unifie `"chien_assis"` vers `"dormer"`, ce qui est pragmatique mais perd l'intention.

Impact : impossible de savoir si on doit generer :

- chien assis strict a pente inverse / shed inversed,
- lucarne a deux pans / gable dormer,
- lucarne rampante / shed dans le meme sens,
- lucarne a croupe.

Correction concrete :

- `kind: "dormer"` ne suffit pas.
- Ajouter `dormerSubtype: "chien_assis_inverted_shed" | "gable" | "shed" | "hip" | "flat_capucine"`.
- Pour le cas utilisateur actuel, choisir explicitement le subtype avant generation.

## 5. Proposition d'amelioration concrete

Je propose de sortir du conflit V1/V2 par une migration en trois couches.

### Etape 1 - Contrat canonique 2D

Creer `RoofDormer2DCanonical` :

```ts
type DormerSubtype =
  | "chien_assis_inverted_shed"
  | "gable_dormer"
  | "shed_dormer"
  | "hip_dormer";

interface RoofDormer2DCanonical {
  version: "roof_dormer_2d_canonical_v1";
  id: string;
  supportPanId: string;
  subtype: DormerSubtype;
  footprintPx: {
    frontLeft: PointPx;
    frontRight: PointPx;
    rearRight: PointPx;
    rearLeft: PointPx;
  };
  facadeEdge: ["frontLeft", "frontRight"];
  rearSeamEdge: ["rearLeft", "rearRight"];
  ridgePx: { left: PointPx; right: PointPx };
  heightReference: "support_plane_normal";
  facadeHeightM: number;
  ridgeHeightM: number;
  orientation: {
    uAxisWorld: Vec3;
    vAxisWorld: Vec3;
    normalWorld: Vec3;
  };
}
```

Regle : `roofExtensions[]` legacy peut encore etre lu, mais il doit etre converti vers ce contrat avant toute 3D.

### Etape 2 - Builder unique

Un seul builder doit produire `RoofExtensionVolume3D`.

Pipeline cible :

```txt
roofExtensions legacy / parametricDormers
        -> normalizeDormer2DCanonical()
        -> validateDormer2DCanonical()
        -> buildDormerMesh3D()
        -> extensionVolumes[]
```

Interdit :

- concatener V1 + V2 sans reconciliation
- reconstruire une orientation par defaut depuis X/Y monde
- utiliser un contour libre sans roles facade/rear/joues

### Etape 3 - Validation visuelle et numerique

Ajouter quatre tests et un overlay :

1. `dormerV1V2Dedup.test.ts` : V1 + V2 meme emplacement => 1 volume.
2. `dormerPanelHeight.integration.test.ts` : panneau sur mini-toit => Z = pan + hauteur dormer.
3. `parametricDormerOverlay.test.tsx` : Konva dessine V2.
4. `dormerArchitecturalSemantics.test.ts` : facade, rear, ridge, cheeks sont coherents.
5. Overlay debug : afficher facade en bleu, ridge en orange, noues/joues en pointille, empreinte en remplissage leger.

## 6. Priorite d'execution

P0 - A faire avant toute autre correction :

- dedupliquer V1/V2 dans la scene 3D
- brancher `state.dormers` dans le resolver de hauteur produit
- rendre `parametricDormers` dans Konva

P1 - Stabilisation architecturale :

- introduire `RoofDormer2DCanonical`
- renommer `ridge.front/rear` ou ajouter roles explicites
- refuser les footprints dormer non quadrilateres en mode standard

P2 - Qualite PV :

- tests d'ombrage dormer reels, avec perte PV attendue
- keepout differentie : facade/joues/noues/seam, pas un seul offset uniforme
- validation visuelle Playwright sur un fixture avec pan incline + chien assis + panneau dessus

## 7. Verdict final

Claude avait raison sur la direction generale : le chien assis etait casse par des incoherences entre 2D, 3D, hauteurs et legacy. Mais l'audit ne doit plus etre applique tel quel : une grande partie de ses bugs est deja corrigee.

Le diagnostic actuel est plus precis :

1. Les bugs locaux les plus visibles ont ete traites.
2. Le probleme restant est systemique : deux sources de verite coexistent.
3. La 2D ne decrit pas encore assez les roles reels d'un chien assis.
4. La correction de hauteur dormer existe, mais n'est pas cablee au flux produit.
5. La validation utilisateur ne voit pas encore la source V2.

La vraie amelioration n'est donc pas de patcher encore une formule. Il faut imposer un contrat canonique 2D, migrer V1/V2 vers lui, puis faire produire toute la 3D, l'ombrage, le keepout et l'overlay depuis cette source unique.
