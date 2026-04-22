# Charte Niveau 0 — Fidélité 2D / 3D calpinage (cadrage produit & QA)

**Statut :** référence vivante pour l’équipe. **Portée :** pipeline runtime → `SolarScene3D` (canonical3d) + overlay 2D calpinage.  
**Objectif :** trancher ce que « correct » signifie avant d’implémenter les niveaux 1–4.

---

## 1. Deux références possibles (à ne pas confondre)

| Référence | Définition | Usage typique |
|-----------|------------|----------------|
| **A — Dessin calpinage** | Polygones, cotes et contraintes **saisies** dans l’outil (state `pans`, `contours`, `ridges` / `traits`, etc.). | Vérité **métier** pour devis, pose, cohérence dossier. |
| **B — Imagerie satellite / orthophoto** | Pixels de fond + géométrie **réelle** du bâti (souvent non planimétrique, perspective résiduelle). | **Lecture** terrain, confort visuel, vente. |

### Règle de conflit (décision produit par défaut)

- **En cas de divergence entre A et B, la référence officielle pour la géométrie calculée (toit, shell, panneaux) est A — le dessin calpinage.**
- L’image B sert de **support** ; l’alignement pixel-par-pixel avec le satellite **n’est pas** garanti par le modèle actuel (`metersPerPixel` + `northAngleDeg` + plan horizontal — voir [3d-world-convention.md](./3d-world-convention.md)).

*Toute évolution future (recalage homographique, etc.) doit réécrire explicitement cette section.*

---

## 2. Invariants numériques (obligatoires pour dire « cohérent »)

Ces valeurs doivent être **identiques** pour toute chaîne qui projette image ↔ monde sur un même dossier :

| Invariant | Où c’est porté | Règle |
|-----------|----------------|--------|
| `metersPerPixel` | `roof.scale`, `canonical3DWorldContract` | Un seul `mpp` effectif par build ; le runtime **matérialise** le contrat monde à partir de scale + nord quand il manque (voir `applyCanonical3DWorldContractToRoof`). |
| `northAngleDeg` | `roof.roof.north.angleDeg`, contrat monde | Même valeur que pour le mapping horizontal. |
| `referenceFrame` | Contrat monde | Valeur supportée pour la 3D produit : **`LOCAL_IMAGE_ENU`** (Z up, plan horizontal métier). |
| Mapping image → plan horizontal (m) | `imagePxToWorldHorizontalM` | **Interdit** de dupliquer la formule ailleurs ; point d’entrée unique : `frontend/src/modules/calpinage/canonical3d/builder/worldMapping.ts` (cf. [3d-world-convention.md](./3d-world-convention.md)). |
| Unités monde | `RoofModel3D` / `SolarScene3D` | Positions en **mètres** dans le repère canonique ; pas de rescale métier caché dans le viewer. |

**Contrôle rapide :** pour un sommet `(xPx, yPx)` connu, le couple `(xWorldM, yWorldM)` doit matcher `imagePxToWorldHorizontalM` à tolérance flottante usuelle (tests : `geometricTruth.worldMapping`, `unifiedWorldAlignment`).

---

## 3. Dossiers témoins (jeux de régression + captures manuelles)

**Emplacement code :** `frontend/src/modules/calpinage/canonical3d/dev/runtime3DFixtureBattery.ts`.  
**Dev viewer :** `/dev/3d?mode=runtime&fixture=<id>` (voir [canonical3d-runtime-fixture-battery.md](./canonical3d-runtime-fixture-battery.md)).

### 3.1 Cinq familles officielles (non-régression forte)

| Id | Ce qu’on vérifie visuellement / métier |
|----|----------------------------------------|
| `simple_gable_clean` | Référence : 2 pans, faîtage, panneaux ; cohérence 2D/3D sur les **mêmes** ids de pans. |
| `gable_with_chimney` | Obstacle + toit ; pas de « trou » évident entre pan et volume obstacle dans le viewer. |
| `multi_pan_complex` | Multi-pans + structure ; coutures lisibles (pas d’objectif pixel-perfect satellite). |
| `partial_degraded_like` | Données incomplètes mais **build OK** ; pas d’écran vide silencieux. |
| `dense_loaded_case` | Charge : nombreux panneaux + obstacles ; perf acceptable, scène stable. |

### 3.2 Cas batterie legacy (complément)

| Id | Ce qu’on vérifie |
|----|------------------|
| `mono-pan-nominal` | 1 pan + obstacle + panneaux. |
| `dual-pan-ridge` | Faîtage / ligne structurante reflétée en 3D. |
| `multi-pan-l-shaped` | Équivalent métier complexe (alias historique). |
| `partial-missing-world-contract` | **Sans** `canonical3DWorldContract` en persistance mais **scale + nord** valides → contrat matérialisé au build, **scène OK** (aligné tests intégration). |
| `tense-small-dual-pan` | Géométrie serrée, pas d’explosion Z. |

### 3.3 Capture manuelle attendue (process QA)

Pour **chaque** id ci-dessus, conserver dans l’outil de suivi interne (Notion / Drive / ticket) :

1. Capture **2D** (calpinage avec overlay).  
2. Capture **3D** (même dossier, même build).  
3. Date, branche, version app.  
4. Une phrase : « conforme charte A » ou écart décrit (référence A vs B).

*Les captures ne sont pas versionnées dans le dépôt Git dans cette charte ; elles sont un livrable process.*

---

## 4. Critères d’acceptation mesurables (exemples)

Les seuils ci-dessous sont des **propositions** ; l’équipe peut les ajuster une fois des mesures réelles sont prises sur dossiers témoins.

| ID critère | Description | Seuil indicatif |
|------------|-------------|-----------------|
| **AC-MAP** | Tout point issu de `polygonPx` utilisé pour le toit official reproduit `imagePxToWorldHorizontalM` côté tests automatisés. | Erreur max < `1e-6` m sur fixtures unitaires. |
| **AC-WORLD-CONTRACT** | Dossier éligible 3D : `canonical3DWorldContract` présent **après** build runtime si scale + nord valides. | `is3DEligible === true` sur témoins §3.1. |
| **AC-SCENE** | `buildSolarScene3DFromCalpinageRuntime` : `ok === true`, `scene != null`, diagnostics sans erreur bloquante. | Sur les 10 ids §3.1–3.2 (hors cas « KO attendu » futurs). |
| **AC-META** | Métadonnées provenance toiture : `scene.metadata.roofGeometrySource` cohérent avec le chemin (pans réels vs fallback contour). | Vérifié par tests `buildSolarScene3DFromCalpinageRuntime.test.ts` / prompt 8. |
| **AC-SHELL-FOOTPRINT** | Si contour bâti présent au state, le shell 3D utilise la source documentée (`CALPINAGE_STATE.contours` prioritaire — voir `buildBuildingShell3DFromCalpinageRuntime`). | Revue code + 1 capture témoin « grand rectangle contour ». |
| **AC-2D-3D-IDS** | Les ids de pans affichés / loggués 2D correspondent aux `roofPlanePatches[].id` 3D pour le même runtime. | Égalité d’ensemble d’ids sur témoins multi-pans. |

---

## 5. Révisions

| Version | Date | Changement |
|---------|------|------------|
| 1.0 | 2026-04-09 | Création charte Niveau 0. |

---

## 6. Liens utiles

- [3d-world-convention.md](./3d-world-convention.md) — axes, mapping, unités.  
- [canonical3d-runtime-fixture-battery.md](./canonical3d-runtime-fixture-battery.md) — où lancer les tests et les fixtures.  
- [calpinage-2d-3d-fidelity-level1-implementation.md](./calpinage-2d-3d-fidelity-level1-implementation.md) — implémentation Niveau 1 (resolver shell, clearance, cotes, viewer).
- [calpinage-2d-3d-fidelity-level2-implementation.md](./calpinage-2d-3d-fidelity-level2-implementation.md) — implémentation Niveau 2 (cotes 2D / m, nord, legacy canvas).
- [calpinage-2d-3d-fidelity-level3-implementation.md](./calpinage-2d-3d-fidelity-level3-implementation.md) — implémentation Niveau 3 (aires m², inférence modules PV, legacy surface pan).
- [calpinage-2d-3d-fidelity-level4-implementation.md](./calpinage-2d-3d-fidelity-level4-implementation.md) — implémentation Niveau 4 (trace source `roofOutlineHorizontalAreaM2`, audit cohérence).  
- [building-shell-3d.md](./building-shell-3d.md) — emprise shell vs pans.  
- [2d-to-3d-coherence-audit.md](./2d-to-3d-coherence-audit.md) — contexte audit cohérence.
