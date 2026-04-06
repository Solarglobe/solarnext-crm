# Sanity check externe — vérité officielle d’ombrage (serveur)

**Nature :** filet de sécurité technique, pas benchmark marketing ni validation scientifique définitive.  
**Moteur :** aucune modification ; aucun recalibrage.  
**Chaîne mesurée :** `computeCalpinageShading` → `buildOfficialShadingFromComputeResult` (équivalent à `computeOfficialShading` dans `officialShading.service.js`).

## Références utilisées

| Type | Détail |
|------|--------|
| **Attentes physiques raisonnables** | Ordre de grandeur : horizon quasi nul → pertes quasi nulles ; masque sud élevé → pertes fortes ; obstacle directionnel → perte modérée asymétrique. |
| **Référence interne verrouillée** | Fixture `tests/fixtures/horizonMasks/ign_like_step1_hd.json` — golden `totalLossPct ≈ 8.823` (voir `tests/shading-premium-lock.test.js`). |
| **Scénarios synthétiques** | Alignés sur `tests/validation/stress-scenarios.test.js` (monotonie, saisonnalité, plages). |
| **PVGIS / SolarEdge / Archelios** | **Non appelés** dans ce lot (API, scénarios et métriques non équivalentes ligne à ligne). Une comparaison chiffrée fine nécessiterait un protocole dédié (même toiture, même pas de temps, même convention de perte). |

## Reproductibilité

```bash
cd backend && npm run audit:official-shading-sanity
```

Sortie JSON : valeurs ci-dessous générées le **2026-04-01** (relancer le script pour dates ultérieures).

## Résultats mesurés (vérité officielle)

| Cas | totalLossPct | near | far | combined | perPanel (×1) |
|-----|-------------|------|-----|----------|----------------|
| S1 Horizon plat (0°) | 0 | 0 | 0 | 0 | 0 |
| S2 Ville dense (synth.) | 10.485 | 0 | 10.485 | 10.485 | 10.48 |
| S3 Immeuble plein sud (~45°) | 18.456 | 0 | 18.456 | 18.456 | 18.46 |
| S4 Arbre à l’est (synth.) | 1.657 | 0 | 1.657 | 1.657 | 1.66 |
| S5 Fixture IGN-like 45°N | 8.823 | 0 | 8.823 | 8.823 | 8.82 |
| S6 Obstacle proche + horizon plat | 0.01 | 0.01 | 0 | 0.01 | 0.01 |

## Tableau sanity (verdict qualitatif)

| Cas | Vérité officielle | Référence / attendu | Écart | Verdict |
|-----|-------------------|---------------------|-------|---------|
| S1 | 0 % global | Horizon sans relief → irradiation annuelle quasi non réduite par le lointain | — | **OK** |
| S2 | ~10.5 % far | Milieu urbain type « canyon » / sud masqué : perte **significative** attendue | — | **OK** |
| S3 | ~18.5 % far | Obstacle haut plein sud (48°N) : perte **très forte** crédible | — | **OK** |
| S4 | ~1.7 % far | Masque limité en azimut (est) : perte **modérée** | — | **OK** |
| S5 | 8.823 % | Golden interne + cohérent avec un relief modéré (pas extrême) | 0 % vs golden test | **OK** |
| S6 | ~0.01 % (near) | Near seul, scène type golden obstacles — ordre de grandeur **très faible** | — | **OK** |

## Écarts observés (vs références externes « strictes »)

- **Aucune mesure numérique PVGIS / outil tiers** dans ce lot → pas d’« écart % » officiel tiers à reporter.
- **Cohérence interne :** S5 reproduit exactement le verrou de test ; S1–S4 respectent la logique déjà assertée dans `stress-scenarios.test.js` (ampleurs et comportements saisonniers/monotones côté pipeline brut).

## Verdict global

- La vérité officielle, sur ces cas, est **globalement crédible** : zéro pour horizon plat, montée progressive de la sévérité avec la hauteur d’horizon sud, perte modérée pour un masque sectoriel, near faible pour une scène d’obstacle proche typée test.
- Comportement **ni ridiculement optimiste ni délirant** sur les synthétiques volontairement extrêmes (S3 reste < 100 % et > S2).
- **Biais systémique** : non détecté sur ce jeu limité ; une affirmation forte exigerait comparaison protocolisée avec un outil de référence ou des mesures terrain.

## Risque résiduel

- Les masques sont **synthétiques ou fixture** : ils ne remplacent pas une campagne sur DSM réel multi-sites.
- **Pas d’équivalence déclarée** avec PVGIS (convention de perte, discrétisation, ombrage proche absent côté PVGIS classique).

## Peut-on considérer la vérité officielle « saine » ?

**Oui, comme base technique raisonnable** pour la suite, au sens : *pas manifestement absurde*, *alignée sur des garde-fous et golden internes*, *répond à des attentes d’ordre de grandeur physique sur scénarios contrôlés*.  
Cela **ne remplace pas** une validation externe chiffrée si le produit l’exige réglementairement ou commercialement.

## Si une anomalie apparaît plus tard

Documenter le cas (géométrie, GPS, masque), quantifier l’écart, pointer la couche probable (near vs far vs normalisation) — **hors scope** de ce lot de correction moteur.
