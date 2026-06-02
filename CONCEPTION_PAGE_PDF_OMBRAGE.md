# Conception — Page PDF "Analyse d'ombrage"
## SolarNext · Bureau d'étude photovoltaïque professionnel

---

## 1. Position dans le rapport

**Insertion :** entre PdfPage3b (Calepinage) et PdfPage4 (Production & Consommation).

**Logique narrative :**
> Toit → **Ombrage (nouveau)** → Production → Finance

Le client comprend d'abord comment son toit est configuré (P3b), puis pourquoi la production
est ce qu'elle est (ombrage), avant de voir les chiffres de production (P4).

**Numérotation cible :** PdfPageShading.tsx — renommée P4 (décalage des pages suivantes +1).

---

## 2. Objectif pédagogique

Cette page répond à trois questions que tout client pose implicitement :

1. **Mon toit est-il bien exposé ?** → Perte globale + décomposition near/far
2. **Quels mois sont les plus impactés ?** → Tableau et graphique mensuel
3. **Combien ça me coûte en kWh ?** → Pertes quantifiées, comparaison avec/sans ombrage

Elle sert aussi de **document de défense commerciale** : source des données,
confiance du calcul, référence PVGIS — tout est tracé.

---

## 3. Architecture de la page

### 3.1 Moteur de rendu

Architecture **PdfEngine** (moderne, comme P4/P5/P12).

```tsx
<PdfPageLayout
  title="Analyse d'ombrage"
  meta={{ client, ref, date }}
  pageNumber={4}
  totalPages={N+1}
  blockRatios={[1.3, 3.8, 2.4]}
>
  <PdfBlock title="Bilan des pertes">       {/* Bloc A — KPI */}
  <PdfBlock title="Détail mensuel">          {/* Bloc B — Charts */}
  <PdfBlock title="Impact énergétique">     {/* Bloc C — Tableau kWh */}
</PdfPageLayout>
```

### 3.2 Dimensions (référence pdfLayout.ts)

| Zone | Hauteur (px) |
|---|---|
| Header | 53 |
| Gap header→blocs | 10 |
| Bloc A — KPI | ~112 |
| Gap | 8 |
| Bloc B — Charts | ~328 |
| Gap | 8 |
| Bloc C — Tableau | ~207 |
| Gap | 8 |
| Footer | 23 |
| **Total** | **757 ≤ 794** ✓ |

### 3.3 Layout en colonnes

**Bloc B (Charts)** est divisé en deux colonnes :
- Colonne gauche (58%) : Graphique mensuel des pertes (barres)
- Colonne droite (42%) : Profil horizon (courbe linéaire)

---

## 4. Bloc A — KPI (bilan des pertes)

### Principe de lecture à deux niveaux

**Niveau 1 — Client** : ce qu'il produit, ce qu'il perd, l'impact réel.
**Niveau 2 — Technicien** : d'où vient la perte (far/near), fiabilité du calcul.

Les 4 premières cards parlent au client. La 5e et les sous-labels des graphiques parlent au technicien.

### Layout : 5 KPI cards en ligne horizontale

```
┌──────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
│  PRODUCTION  │  PRODUCTION  │  ÉNERGIE     │  PERTE       │  QUALITÉ     │
│  THÉORIQUE   │  RÉELLE      │  PERDUE/AN   │  OMBRAGE     │  DONNÉES     │
│              │              │              │              │              │
│  6 790 kWh   │  5 948 kWh   │   842 kWh    │   12,4 %     │  ● ÉLEVÉE   │
│  (sans ombr.)│  (avec ombr.)│  ~ 134 €/an  │  far + near  │  Terrain réel│
└──────────────┴──────────────┴──────────────┴──────────────┴──────────────┘
```

### KPI 1 — Production théorique (sans ombrage)
- **Valeur :** somme `monthlyKwhStats[].productionNoShadingKwh` arrondie (kWh)
  - Fallback : `pvgisAnnualEy × peakPowerKwc` si monthlyKwhStats absent
  - Si les deux absents → "—"
- **Label :** "Production théorique"
- **Sous-label :** "Sans ombrage · PVGIS réf."
- **Couleur valeur :** `#E8ECF8` (neutre — potentiel, pas un résultat)
- **Taille :** standard

### KPI 2 — Production réelle (après ombrage)
- **Valeur :** somme `monthlyKwhStats[].productionWithShadingKwh` arrondie (kWh)
  - Si absent → "—"
- **Label :** "Production réelle"
- **Sous-label :** "Après pertes d'ombrage"
- **Couleur valeur :** `#C39847` (gold — c'est LA valeur de l'installation)
- **Taille :** légèrement plus grande que les autres (`sizeXL`, **gras**)
- **C'est le KPI visuellement dominant de la card strip**

### KPI 3 — Énergie perdue / an
- **Valeur :** `annualLossKwh` arrondi (kWh) — si absent → "—"
- **Label :** "Énergie perdue / an"
- **Sous-label :** `"≈ ${annualLossEur} €/an"` si prix élec disponible, sinon vide
- **Couleur valeur :** selon seuil sur `combinedLossPct`
  - `< 5%`  → `#9FA8C7` (discret — perte négligeable)
  - `5–15%` → `#C39847` (gold — perte notable)
  - `> 15%` → `#E57373` (rouge-orangé — perte significative)

### KPI 4 — Perte d'ombrage (%)
- **Valeur :** `combinedLossPct` (%)
- **Label :** "Perte d'ombrage"
- **Couleur valeur :** même logique de seuil que KPI 3
- **Sous-labels secondaires (niveau technicien, `#9FA8C7`, 8pt) :**
  - `"Horizon : ${farLossPct !== null ? farLossPct+'%' : 'N/D'}"`
  - `"Masques : ${nearLossPct}%"`
- **Rôle :** pont entre lecture client (kWh) et lecture technique (%)

### KPI 5 — Qualité des données
- **Valeur textuelle :** badge coloré
  - `farHorizonKind === "REAL_TERRAIN"` → ● ÉLEVÉE (`#4ade80`, vert)
  - `farHorizonKind === "SYNTHETIC"`    → ● ESTIMÉE (`#F59E0B`, orange)
  - `farHorizonKind === "UNAVAILABLE"`  → ● LIMITÉE (`#E57373`, rouge)
- **Label :** "Qualité données"
- **Sous-label :** source courte — "GeoTIFF terrain réel" / "Modèle synthétique" / "Données insuffisantes"
- **Note confidence** (`#9FA8C7`, 8pt) : `"Confiance : ${farConfidenceLevel}"` si disponible
- **Rôle :** signal de fiabilité pour le client + justification méthodologique pour le technicien

---

## 5. Bloc B gauche — Graphique mensuel des pertes

### Type : Barres empilées (SVG pur, pattern P6)

**Données :** `monthlyFactors[12]` — `farLossFraction` et `nearLossFraction`

**Dimensions :** viewBox `0 0 380 260`

**Structure par mois :**
Chaque mois = une barre verticale divisée en 2 segments :
- Segment inférieur (far) : hauteur proportionnelle à `farLossFraction * 100`
- Segment supérieur (near) : hauteur proportionnelle à `nearLossFraction * 100`
- Hauteur maximale barre = 100% de perte = hauteur_max_px

**Couleurs :**
- Far (horizon) : `#C39847` (gold) avec `opacity: 0.85`
- Near (masques) : `#4A90E2` (bleu) avec `opacity: 0.85`
- Fond barre (zone sans perte) : `rgba(255,255,255,0.04)`

**Axes :**
- X : mois (J F M A M J J A S O N D), `font-size: 8pt`, couleur `#9FA8C7`
- Y : % (0, 5, 10, 15, 20...), tirets horizontaux pointillés très discrets
- Y max : arrondi au 5% supérieur de `max(combinedLossFraction) * 100`

**Légende :** en dessous du graphique, 2 items inline
- ▬ `#C39847` Horizon lointain (far)
- ▬ `#4A90E2` Masques proches (near)

**Ligne total :** trait fin `#E8ECF8` reliant les tops de chaque barre (perte totale mensuelle)

**Cas dégradé :** si `farLossPct === null` → barres en bleu seul (`nearLossFraction`),
mention discrète "Données horizon non disponibles pour ce site"

---

## 6. Bloc B droite — Profil horizon

### Type : Courbe pleine (SVG pur)

C'est **le graphique signature** d'une étude PV professionnelle.
Il montre la ligne d'horizon réelle autour du site et la trajectoire solaire.

**Données :** `horizonMask.mask` (array 180 valeurs, une par 2° d'azimut, 0°–360°)

**Dimensions :** viewBox `0 0 260 230`

### Axes
- **X :** Azimut — centré sur le Sud (0° au centre)
  - Repères : N (±180°), NE (−135°), E (−90°), SE (−45°), **S (0°)**, SO (+45°), O (+90°), NO (+135°)
  - Espacement 45° = un tiers de la largeur
- **Y :** Élévation solaire (°), 0° en bas → 50° en haut
  - Tirets horizontaux à 10°, 20°, 30°, 40°

### Éléments visuels

**1. Terrain / horizon (zone remplie)**
- Fill de la courbe horizon vers le bas : `rgba(195,152,71,0.25)` (gold transparent)
- Contour horizon : `#C39847`, épaisseur 1.5px
- Représente : relief + bâtiments distants

**2. Trajectoires solaires (3 courbes)**
- Solstice d'été (≈21 juin) : tirets `#F59E0B` (ambre), épaisseur 1px
- Équinoxe (≈21 mars/sept) : tirets `#9FA8C7` (gris bleu), épaisseur 1px
- Solstice d'hiver (≈21 déc) : tirets `#6366F1` (indigo), épaisseur 1px
- Calcul : altitude solaire = `arcsin(sin(lat)·sin(dec) + cos(lat)·cos(dec)·cos(HA))`
  où `dec` = déclinaison solaire, `HA` = angle horaire, `lat` = latitude site

**3. Zone de masquage (overlap)**
- Quand la courbe solaire est EN DESSOUS de la ligne horizon → zone colorée en rouge très transparent
- Fill : `rgba(229,115,115,0.15)` — indique visuellement les heures masquées

**Légende :**
- ▬ `#C39847` Horizon (terrain/bâti)
- --- `#F59E0B` Solstice été
- --- `#9FA8C7` Équinoxe
- --- `#6366F1` Solstice hiver

**Cas dégradé :** si `horizonMask` absent ou `farHorizonKind === "UNAVAILABLE"` →
placeholder gris avec message "Profil horizon non disponible pour ce site"

---

## 7. Bloc C — Tableau impact énergétique mensuel

### Type : Tableau 13 colonnes (12 mois + Total)

**Données :** `monthlyKwhStats[12]`

**Condition d'affichage :** ce bloc n'est rendu que si `monthlyKwhStats` est disponible
(i.e. `peakPowerKwc > 0` et PVGIS accessible). Sinon → message d'indisponibilité discret.

### Structure des lignes

| Ligne | Contenu | Style |
|---|---|---|
| En-tête colonnes | Jan, Fév, …, Déc, **Total** | `#9FA8C7`, 8pt, fond `rgba(255,255,255,0.03)` |
| Production de référence (kWh) | `productionNoShadingKwh` | `#E8ECF8`, 9pt |
| Production nette (kWh) | `productionWithShadingKwh` | `#C39847` (gold), **gras** |
| Perte ombrage (kWh) | `kwhLoss` | `#E57373` (rouge discret) |
| Perte ombrage (%) | `combinedLossFraction * 100` | `#9FA8C7`, 8pt, italique |

### Total colonne (dernière)
- Production référence : somme des 12 mois
- Production nette : somme des 12 mois → **valeur principale**
- Perte annuelle : = `annualLossKwh` (arrondi entier, kWh)
- Perte % : moyenne pondérée annuelle = `combinedLossPct`

### Footer tableau
Une ligne de 3 éléments inline discrets (`#9FA8C7`, 8pt) :
```
Source : PVGIS v5.3 (JRC)  ·  Référence : 1 kWc normalisé  ·  Inclinaison : 32°  ·  Azimut : 185° (S)
```

---

## 8. Données à injecter dans le mapper

### 8.1 Champs source dans le snapshot

Tous ces champs existent déjà dans `snapshot.shading` (calculés par `calpinageShading.service.js`) :

```
snapshot.shading.combinedLossPct          → perte totale (%)
snapshot.shading.farLossPct               → perte far (%) — peut être null
snapshot.shading.nearLossPct              → perte near (%)
snapshot.shading.monthlyFactors           → Array[12] {month, farLossFraction, nearLossFraction, combinedLossFraction}
snapshot.shading.monthlyKwhStats          → Array[12] {month, productionNoShadingKwh, productionWithShadingKwh, kwhLoss, gtiKwhM2perDay, combinedLossFraction}
snapshot.shading.annualLossKwh            → kWh perdus/an (number | undefined)
snapshot.shading.pvgisReference           → {source, annualE_y, peakPowerKwc, tiltDeg, azimuthDeg}
snapshot.shading.horizonMask.mask         → Array[180] élévations (°)
snapshot.shading.horizonMask.farHorizonKind → "REAL_TERRAIN" | "SYNTHETIC" | "UNAVAILABLE"
snapshot.shading.far.confidence           → [0,1]
snapshot.shading.far.confidenceLevel      → string
snapshot.shading.geometryCommercialWarnings → string[]
```

Données contextuelles nécessaires (déjà dans le snapshot) :
```
snapshot.form.lat / snapshot.form.lon     → pour trajectoires solaires
snapshot.installation.puissance_kwc       → pour label "kWc installés"
snapshot.finance?.prix_kwh                → pour estimer "€/an perdus"
```

### 8.2 Section à ajouter dans pdfViewModel.mapper.js

Ajouter après la construction de `p3b_auto` (ligne ~710), une nouvelle section `p_shading` :

```javascript
// ── P_SHADING — Analyse d'ombrage ─────────────────────────────────────────
const shading = snapshot.shading ?? {};
const pvgisRef = shading.pvgisReference ?? {};
const horizonMask = shading.horizonMask ?? {};

const p_shading = {
  // Méta
  meta: { client: clientName, ref, date: dateDisplay },

  // KPI
  combinedLossPct:   num(shading.combinedLossPct ?? shading.combined?.totalLossPct),
  farLossPct:        shading.farLossPct != null ? num(shading.farLossPct) : null,
  nearLossPct:       num(shading.nearLossPct ?? shading.near?.totalLossPct),
  annualLossKwh:     shading.annualLossKwh != null ? Math.round(shading.annualLossKwh) : null,
  annualLossEur:     shading.annualLossKwh && prixKwh
                       ? Math.round(shading.annualLossKwh * prixKwh)
                       : null,

  // Qualité données horizon
  farHorizonKind:    horizonMask.farHorizonKind ?? "UNAVAILABLE",
  farConfidence:     num(shading.far?.confidence),
  farConfidenceLevel: shading.far?.confidenceLevel ?? "—",
  farSource:         shading.far?.source ?? "—",

  // Warnings
  geometryWarnings:  shading.geometryCommercialWarnings ?? [],

  // Profil horizon (allégé — 180 valeurs)
  horizonMaskArray:  Array.isArray(horizonMask.mask) ? horizonMask.mask : null,

  // Facteurs mensuels (graphique barres)
  monthlyFactors:    Array.isArray(shading.monthlyFactors)
                       ? shading.monthlyFactors.map(m => ({
                           month:              m.month,
                           farLossPct:         +(m.farLossFraction  * 100).toFixed(1),
                           nearLossPct:        +(m.nearLossFraction * 100).toFixed(1),
                           combinedLossPct:    +(m.combinedLossFraction * 100).toFixed(1),
                         }))
                       : null,

  // kWh mensuels (tableau impact)
  monthlyKwhStats:   Array.isArray(shading.monthlyKwhStats)
                       ? shading.monthlyKwhStats.map(m => ({
                           month:                    m.month,
                           productionNoShadingKwh:   m.productionNoShadingKwh,
                           productionWithShadingKwh: m.productionWithShadingKwh,
                           kwhLoss:                  m.kwhLoss,
                           lossPct:                  +(m.combinedLossFraction * 100).toFixed(1),
                         }))
                       : null,

  // Métadonnées PVGIS (footer tableau)
  pvgisSource:       pvgisRef.source ?? "—",
  pvgisTiltDeg:      pvgisRef.tiltDeg != null ? num(pvgisRef.tiltDeg) : null,
  pvgisAzimuthDeg:   pvgisRef.azimuthDeg != null ? num(pvgisRef.azimuthDeg) : null,
  pvgisAnnualEy:     pvgisRef.annualE_y != null ? num(pvgisRef.annualE_y) : null,

  // Contexte site (pour trajectoires solaires)
  lat:               num(snapshot.form?.lat ?? snapshot.form?.latitude),
  lon:               num(snapshot.form?.lon ?? snapshot.form?.longitude),
  peakPowerKwc:      num(snapshot.installation?.puissance_kwc),
};
```

Ajouter `p_shading` dans l'objet retourné final du mapper.

---

## 9. Structure de PdfPageShading.tsx

### Emplacement : `/frontend/src/pages/pdf/FullReport/PdfPageShading.tsx`

### Composants à créer

**A. `ChartShadingMonthly.tsx`** (graphique barres empilées)
```
Entrée : monthlyFactors[12] { farLossPct, nearLossPct, combinedLossPct }
Sortie : SVG barres empilées far+near par mois
Pattern : ChartP6 (divs flex + percent) ou SVG pur
```

**B. `ChartHorizonProfile.tsx`** (profil horizon)
```
Entrée : horizonMaskArray[180], lat, lon
Sortie : SVG courbe horizon + 3 trajectoires solaires
Pattern : SVG pur path, calcul trajectoires en JS pur (pas de lib externe)
```

**C. `ShadingKpiCard.tsx`** (KPI card réutilisable)
```
Entrée : { value, label, sublabel, color }
Sortie : div card avec valeur colorée
Pattern : similaire aux KPI cards de PdfPage1
```

**D. `TableMonthlyKwh.tsx`** (tableau impact kWh)
```
Entrée : monthlyKwhStats[12]
Sortie : table HTML 5 lignes × 13 colonnes
Pattern : PdfTable étendu
```

### Squelette JSX (structure, pas de code)

```
PdfPageShading
├── PdfPageLayout (title="Analyse d'ombrage", blockRatios=[1.3, 3.8, 2.4])
│   ├── PdfBlock "Bilan des pertes"
│   │   └── Flex row (5 ShadingKpiCard)
│   │       ├── KPI: Perte totale (%)
│   │       ├── KPI: Horizon lointain (%)
│   │       ├── KPI: Masques proches (%)
│   │       ├── KPI: kWh perdus/an
│   │       └── KPI: Qualité données (badge)
│   │
│   ├── PdfBlock "Détail mensuel"
│   │   └── Flex row
│   │       ├── Col 58%: ChartShadingMonthly
│   │       └── Col 42%: ChartHorizonProfile
│   │
│   └── PdfBlock "Impact énergétique"
│       ├── [conditionnel] TableMonthlyKwh
│       └── [si indispo] Message "Puissance crête non renseignée — données PVGIS indisponibles"
└── (footer automatique PdfEngine)
```

---

## 10. Ordre d'implémentation optimal

### Étape 1 — Mapper (backend, ~30 min)
Ajouter la section `p_shading` dans `pdfViewModel.mapper.js`.
Vérifier que `p_shading` est bien dans l'objet retourné et accessible côté frontend.
**Risque zéro** : ajout pur, aucune modification de l'existant.

### Étape 2 — KPI + layout page (frontend, ~45 min)
Créer `PdfPageShading.tsx` avec `PdfPageLayout` et les 5 `ShadingKpiCard`.
Pas de graphique encore — vérifier que la page s'insère et s'affiche.
Insérer la page dans le rendu du rapport (FullReport ou équivalent).

### Étape 3 — Graphique barres mensuelles (frontend, ~60 min)
Créer `ChartShadingMonthly.tsx` en SVG pur.
Données de test : injecter des `monthlyFactors` statiques.
Vérifier rendu dans la page.

### Étape 4 — Profil horizon (frontend, ~90 min)
Créer `ChartHorizonProfile.tsx`.
Implémenter le calcul des trajectoires solaires en JS pur (formule astronomique basique).
Cas dégradé si `horizonMaskArray` est null.
**C'est le composant le plus complexe — isoler dans un storybook ou preview dédié.**

### Étape 5 — Tableau kWh mensuel (frontend, ~45 min)
Créer `TableMonthlyKwh.tsx`.
Gérer le cas `monthlyKwhStats === null`.
Ajouter le footer PVGIS.

### Étape 6 — Tests et vérification PDF final (~30 min)
Snapshot du PDF généré.
Vérifier que la pagination est correcte (décalage +1 des pages suivantes).
Vérifier les cas dégradés : pas de GPS, pas de peakPowerKwc, horizon unavailable.

---

## 11. Cas dégradés à gérer

| Situation | Comportement |
|---|---|
| `farLossPct === null` (pas de GPS) | KPI "Horizon lointain" → "N/D", graphique barres = bleu seul |
| `horizonMaskArray === null` | Zone droite du graphique → placeholder gris |
| `monthlyKwhStats === null` (pas de peakPowerKwc) | Bloc C → message d'indisponibilité |
| `farHorizonKind === "UNAVAILABLE"` | Badge qualité rouge, pas de trajectoires solaires |
| `geometryWarnings` non vide | Icône ⚠ discret sous KPI qualité avec tooltip (ou sous-texte) |
| PVGIS unavailable | `annualLossKwh` null → KPI "kWh perdus" → "—" |

---

## 12. Résultat attendu

Une page qui, au premier coup d'œil, communique :
- La perte d'ombrage globale (chiffre rouge/gold/vert selon gravité)
- Sa décomposition (ce qui vient du terrain vs des obstacles proches)
- L'impact mois par mois (hauteur des barres)
- L'horizon réel du site (courbe caractéristique de la localisation)
- La quantification en kWh (tangible pour le client)
- La rigueur méthodologique (source PVGIS, qualité données)

Ce n'est plus une "mention d'ombrage" dans un coin — c'est une **page d'analyse**.
