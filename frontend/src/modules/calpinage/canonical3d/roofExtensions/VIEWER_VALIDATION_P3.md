# Validation manuelle P3 — viewer & shading (chien assis)

## Prérequis

- Build **dev** (`vite` / CRM calpinage avec viewer `SolarScene3D`).
- Activer l’overlay **DEBUG 3D** si disponible (`showDebugOverlay` / mode debug produit).
- **Shift+Alt+E** (dev uniquement) : cycle le debug sur les volumes **extension** :
  1. off  
  2. **Fil de fer cyan** (`EdgesGeometry`, angle 38°)  
  3. **Fil de fer + normales faces jaunes** (segment par triangle, échelle ~1,5 % de la taille de scène)

Console : message `[Calpinage3D] debug volumes extension : …`.

## Scénarios à exercer

1. **Rectangle** chien assis (contour simple).
2. **Trapèze**.
3. **Apex déplacé** (après création : bouger le sommet central).
4. **Hauteur apex** (0 m puis > 0 m, ou inverse).
5. **Toit support incliné** (pan avec pente réelle).
6. **Édition après création** (contour / hips / ridge selon UX disponible).

## Observer (rendu filaire + ombrage)

| Critère | Fil de fer | Ombrage / couleur |
|--------|------------|-------------------|
| Trous | Pas de « fenêtres » dans le maillage extension | Pas de zones non éclairées anormales sur le volume |
| Faces inversées | Normales jaunes cohérentes vers l’extérieur des pans | Pas de facettes « sombres » regroupées qui pivotent avec la caméra de façon absurde |
| Z-fighting | Arêtes cyan stables en orbite | Pas de scintillement au joint extension / pan |
| Croisement pans | Arêtes sans confusion avec la toiture majeure | Comportement attendu des intersections maillage |
| Gap avec le pan | Base du volume suit le plan support | Pas de fente lumineuse sous le volume à h = 0 |

## Viewer vs shading

- **Même géométrie** : pipeline unique `RoofExtensionVolume3D` → `extensionVolumeGeometry` → viewer ; shading réutilise les mêmes données via la scène canonique / raycast.
- Comparer **vue 3D normale** et **vue avec ombrage panneaux** (ou mode shading prévu par le produit) : pas d’écart net de silhouette sur l’extension.

## Capture / note de session

Après test, noter :

- Date, navigateur, branche Git.
- Pour chaque scénario : OK / KO + capture (fil de fer et/ou vue ombrée).
- Si KO : décrire angle caméra, Zoom, et si Shift+Alt+E niveau 2 ou 3 était actif.

Ensuite seulement : **push** des commits validés.
