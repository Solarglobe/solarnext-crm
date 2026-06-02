# Cursor Prompts — Sprint 1 · Page PDF "Analyse d'ombrage"

> **Règle d'exécution :** exécuter les 4 prompts dans l'ordre.
> Chaque prompt est autonome et référence les fichiers exacts.
> Ne pas commencer le prompt suivant avant validation visuelle du précédent.
> Aucun graphique dans ce sprint (ni barres mensuelles, ni profil horizon).

---

## Prompt 1 — Mapper : injection de `p_shading`

**Fichier cible :** `backend/services/pdf/pdfViewModel.mapper.js`

**Contexte :** Le moteur d'ombrage calcule et stocke dans `snapshot.shading` des données riches
(pertes far/near/combined, stats kWh mensuels, référence PVGIS) qui ne sont jamais injectées
dans le ViewModel PDF. Ce prompt injecte ces données sans modifier aucun code existant.

**Instructions :**

Ouvre `backend/services/pdf/pdfViewModel.mapper.js`.

Localise la section qui construit `p3b_auto` (autour de la ligne 700).
Immédiatement après cette section, ajoute le bloc suivant :

```javascript
// ── P_SHADING — Analyse d'ombrage ─────────────────────────────────────────
const _shading     = snapshot.shading ?? {};
const _pvgisRef    = _shading.pvgisReference ?? {};
const _horizonMask = _shading.horizonMask    ?? {};
const _far         = _shading.far            ?? {};

// Production annuelle théorique (kWh) — somme PVGIS sans ombrage
const _prodNoShading = Array.isArray(_shading.monthlyKwhStats)
  ? Math.round(_shading.monthlyKwhStats.reduce((s, m) => s + (m.productionNoShadingKwh ?? 0), 0))
  : (_pvgisRef.annualE_y != null && _pvgisRef.peakPowerKwc != null)
    ? Math.round(_pvgisRef.annualE_y * _pvgisRef.peakPowerKwc)
    : null;

// Production annuelle réelle (kWh) — après pertes d'ombrage
const _prodWithShading = Array.isArray(_shading.monthlyKwhStats)
  ? Math.round(_shading.monthlyKwhStats.reduce((s, m) => s + (m.productionWithShadingKwh ?? 0), 0))
  : null;

// Prix kWh pour estimer l'impact €
const _prixKwh = snapshot.form?.prix_kwh ?? snapshot.energy?.prix_kwh ?? null;

const p_shading = {
  // Méta page
  meta: { client: clientName ?? "—", ref, date: dateDisplay ?? "—" },

  // KPI niveau 1 — lecture client
  prodNoShadingKwh:   _prodNoShading,
  prodWithShadingKwh: _prodWithShading,
  annualLossKwh:      _shading.annualLossKwh != null ? Math.round(_shading.annualLossKwh) : null,
  annualLossEur:      (_shading.annualLossKwh != null && _prixKwh != null)
                        ? Math.round(_shading.annualLossKwh * _prixKwh)
                        : null,

  // KPI niveau 2 — lecture technicien
  combinedLossPct:    num(_shading.combinedLossPct ?? _shading.combined?.totalLossPct),
  farLossPct:         _shading.farLossPct != null ? num(_shading.farLossPct) : null,
  nearLossPct:        num(_shading.nearLossPct ?? _shading.near?.totalLossPct),

  // Qualité des données horizon
  farHorizonKind:     _horizonMask.farHorizonKind ?? "UNAVAILABLE",
  farConfidenceLevel: _far.confidenceLevel ?? null,
  farSource:          _far.source ?? null,

  // Tableau mensuel kWh (12 mois)
  monthlyKwhStats: Array.isArray(_shading.monthlyKwhStats)
    ? _shading.monthlyKwhStats.map(m => ({
        month:                    m.month,
        prodNoShadingKwh:         m.productionNoShadingKwh,
        prodWithShadingKwh:       m.productionWithShadingKwh,
        kwhLoss:                  m.kwhLoss,
        lossPct:                  m.combinedLossFraction != null
                                    ? +( m.combinedLossFraction * 100).toFixed(1)
                                    : null,
      }))
    : null,

  // Métadonnées PVGIS (footer tableau)
  pvgisSource:      _pvgisRef.source    ?? null,
  pvgisTiltDeg:     _pvgisRef.tiltDeg   != null ? num(_pvgisRef.tiltDeg)   : null,
  pvgisAzimuthDeg:  _pvgisRef.azimuthDeg != null ? num(_pvgisRef.azimuthDeg) : null,

  // Contexte site
  peakPowerKwc:     num(snapshot.installation?.puissance_kwc),
};
```

Ensuite, localise l'objet retourné final du mapper (là où sont assemblés `p1_auto`, `p2_auto`,
`p3b_auto`, etc. dans `fullReport`). Ajoute `p_shading` à cet objet :

```javascript
p_shading,
```

**Contraintes :**
- Ne modifie aucun code existant, uniquement des ajouts.
- La fonction `num()` est déjà disponible dans le scope du mapper — ne la redéfinit pas.
- Si `clientName`, `ref`, `dateDisplay` ne sont pas dans le scope exact, utilise les variables
  équivalentes déjà utilisées dans les autres sections (ex: `p3b_auto`) — copie le pattern.
- Ne crée aucun fichier. Uniquement cette modification dans le mapper.

**Vérification :** après la modification, cherche dans l'objet retourné final que `p_shading`
apparaît bien au même niveau que `p3b_auto`, `p4`, etc.

---

## Prompt 2 — Composants : `ShadingKpiCard` et `TableMonthlyKwh`

**Fichier à créer (1) :** `frontend/src/pages/pdf/PdfLegacyPort/components/ShadingKpiCard.tsx`
**Fichier à créer (2) :** `frontend/src/pages/pdf/PdfLegacyPort/components/TableMonthlyKwh.tsx`

**Contexte design :**
- Fond de page : `#0B0F1E` — surfaces : `#161C34`
- Accent gold : `#C39847` — texte primaire : `#E8ECF8` — texte secondaire : `#9FA8C7`
- Bordures : `rgba(255,255,255,0.08)` — accent border gold : `rgba(195,152,71,0.45)`
- Font : system-ui, taille base 11pt, small 9pt, XL 16pt
- Les styles doivent être inline (pas de classes CSS globales) pour isoler la page PDF

---

### Composant A — `ShadingKpiCard.tsx`

Crée un composant React fonctionnel `ShadingKpiCard` avec les props suivantes :

```typescript
interface ShadingKpiCardProps {
  label: string;
  value: string;             // valeur principale déjà formatée
  sublabel?: string;         // ligne sous la valeur (optionnelle)
  techLines?: string[];      // lignes techniques discrètes (optionnelles, max 2)
  valueColor?: string;       // couleur de la valeur (défaut: '#E8ECF8')
  isHero?: boolean;          // si true: valeur plus grande et gras (card production réelle)
  badge?: {                  // pour la card Qualité données
    color: string;
    text: string;
  };
}
```

**Rendu attendu :**

```
┌─────────────────────────────────┐
│  LABEL (9pt, #9FA8C7, majusc.)  │
│                                 │
│  VALEUR  (14pt normal / 16pt    │
│           bold si isHero)       │
│                                 │
│  sublabel (9pt, #9FA8C7)        │
│  techLines[0] (8pt, #9FA8C7)    │
│  techLines[1] (8pt, #9FA8C7)    │
└─────────────────────────────────┘
```

Styles inline :
- Container : `background: 'rgba(255,255,255,0.04)'`, `border: '1px solid rgba(255,255,255,0.08)'`,
  `borderRadius: 6`, `padding: '10px 12px'`, `flex: 1`, `display: 'flex'`, `flexDirection: 'column'`,
  `gap: 4`
- Label : `fontSize: '8pt'`, `color: '#9FA8C7'`, `textTransform: 'uppercase'`, `letterSpacing: '0.04em'`
- Valeur : `fontSize: isHero ? '16pt' : '14pt'`, `fontWeight: isHero ? 700 : 500`,
  `color: valueColor ?? '#E8ECF8'`, `lineHeight: 1.1`
- Si `badge` présent : remplace la valeur par un flex row `● TEXT` avec `badge.color`
- Sublabel : `fontSize: '9pt'`, `color: '#9FA8C7'`
- techLines : `fontSize: '8pt'`, `color: '#9FA8C7'`, `opacity: 0.8`

---

### Composant B — `TableMonthlyKwh.tsx`

Crée un composant React fonctionnel `TableMonthlyKwh` avec les props suivantes :

```typescript
interface MonthlyKwhRow {
  month: number;             // 1–12
  prodNoShadingKwh: number;
  prodWithShadingKwh: number;
  kwhLoss: number;
  lossPct: number | null;
}

interface TableMonthlyKwhProps {
  rows: MonthlyKwhRow[];     // 12 éléments
  pvgisSource?: string | null;
  pvgisTiltDeg?: number | null;
  pvgisAzimuthDeg?: number | null;
}
```

**Structure du tableau :**

```
         Jan  Fév  Mar  Avr  Mai  Jui  Jul  Aoû  Sep  Oct  Nov  Déc  Total
Réf.     xxx  xxx  ...                                                 xxxx
Nette    xxx  xxx  ...                                           (gold) xxxx
Perte    xxx  xxx  ...                                       (rouge)   xxxx
Perte %  x.x  x.x ...                                       (gris)    x.x
```

Labels colonnes mois : `['Jan','Fév','Mar','Avr','Mai','Jui','Jul','Aoû','Sep','Oct','Nov','Déc']`

**4 lignes de données :**
1. "Prod. référence (kWh)" — valeurs `prodNoShadingKwh` arrondies — couleur `#E8ECF8`
2. "Prod. nette (kWh)" — valeurs `prodWithShadingKwh` arrondies — couleur `#C39847`, **gras**
3. "Perte (kWh)" — valeurs `kwhLoss` arrondies — couleur `#E57373`
4. "Perte (%)" — valeurs `lossPct?.toFixed(1)+'%'` — couleur `#9FA8C7`, italique

Colonne Total (dernière) :
- Réf : somme de `prodNoShadingKwh`
- Nette : somme de `prodWithShadingKwh`
- Perte kWh : somme de `kwhLoss` (arrondi entier)
- Perte % : `(sommeLoss / sommeRef * 100).toFixed(1)+'%'`

**Footer du tableau** (si au moins une métadonnée PVGIS disponible) :
```
Source : PVGIS v5.3 (JRC)  ·  Inclinaison : 32°  ·  Azimut : 185° S
```
Style : `fontSize: '7.5pt'`, `color: '#9FA8C7'`, `opacity: 0.7`, `marginTop: 6`

**Styles inline :**
- Table : `width: '100%'`, `borderCollapse: 'collapse'`, `fontSize: '8.5pt'`
- En-tête colonnes : `color: '#9FA8C7'`, `fontSize: '7.5pt'`, `textAlign: 'right'`
  (première cellule : `textAlign: 'left'`)
- Cellules : `textAlign: 'right'`, `padding: '2px 4px'`
- Ligne alternée (pair) : `background: 'rgba(255,255,255,0.02)'`
- Label ligne : `textAlign: 'left'`, `color: '#9FA8C7'`, `paddingRight: 8`
- Colonne Total : `fontWeight: 600`, `borderLeft: '1px solid rgba(255,255,255,0.08)'`

**Contraintes :**
- Ne crée pas de fichier CSS global. Tout en inline styles.
- Export default des deux composants.
- Ne rien importer de recharts, chart.js ou autre lib graphique.

---

## Prompt 3 — Page `PdfPageShading.tsx`

**Fichier à créer :** `frontend/src/pages/pdf/PdfLegacyPort/PdfPageShading.tsx`

**Contexte :**
- Les pages actives utilisent le pattern : props `{ organization, viewModel }` où
  `viewModel.fullReport.p_shading` contient les données (ajoutées par le Prompt 1).
- Les styles de fond/layout doivent reproduire le style des autres pages PdfLegacyPort
  (fond sombre `#0B0F1E`, pas de PdfPageLayout du PdfEngine — les pages legacy utilisent
  leurs propres divs).
- Il n'y a PAS de graphique dans ce sprint. Les emplacements des deux graphiques futurs
  (barres mensuelles et profil horizon) seront des **placeholders** vides avec un texte discret.

**Instructions :**

Commence par lire les 80 premières lignes d'une page legacy existante (ex: `PdfPage4.tsx` ou
`PdfPage12.tsx`) pour reproduire exactement le même pattern de layout (div principale,
dimensions, header, footer).

Crée ensuite `PdfPageShading.tsx` en respectant ce pattern, avec le contenu suivant :

### Structure JSX de la page

```
<div style={{ width: '1122px', height: '794px', background: '#0B0F1E', ... }}>

  ── HEADER ──
  Reproduire le header des pages legacy (logo, titre page, méta client/ref/date).
  Titre : "Analyse d'ombrage"
  Sous-titre (discret) : "Production théorique · Pertes · Impact énergétique"

  ── SECTION KPI (Bloc A) ──
  Flex row, gap 8px, 5 cartes ShadingKpiCard :

  Card 1 — Production théorique
    label: "Production théorique"
    value: prodNoShadingKwh != null ? `${prodNoShadingKwh.toLocaleString('fr-FR')} kWh` : "—"
    sublabel: "Sans ombrage · PVGIS réf."
    valueColor: "#E8ECF8"

  Card 2 — Production réelle  [isHero=true]
    label: "Production réelle"
    value: prodWithShadingKwh != null ? `${prodWithShadingKwh.toLocaleString('fr-FR')} kWh` : "—"
    sublabel: "Après pertes d'ombrage"
    valueColor: "#C39847"
    isHero: true

  Card 3 — Énergie perdue
    label: "Énergie perdue / an"
    value: annualLossKwh != null ? `${annualLossKwh.toLocaleString('fr-FR')} kWh` : "—"
    sublabel: annualLossEur != null ? `≈ ${annualLossEur.toLocaleString('fr-FR')} €/an` : undefined
    valueColor: couleur seuil (voir logique ci-dessous)

  Card 4 — Perte d'ombrage
    label: "Perte d'ombrage"
    value: combinedLossPct != null ? `${combinedLossPct.toFixed(1)} %` : "—"
    valueColor: couleur seuil (même logique)
    techLines: [
      farLossPct != null ? `Horizon : ${farLossPct.toFixed(1)} %` : "Horizon : N/D",
      `Masques : ${nearLossPct?.toFixed(1) ?? "—"} %`
    ]

  Card 5 — Qualité données
    label: "Qualité données"
    badge: { color: couleurBadge, text: texteBadge }  // voir logique ci-dessous
    sublabel: farSource ?? undefined
    techLines: farConfidenceLevel ? [`Confiance : ${farConfidenceLevel}`] : []

  ── SECTION GRAPHIQUES — PLACEHOLDER (Bloc B) ──
  Flex row, hauteur ~300px, gap 8px :

  Colonne gauche (58%) :
    Fond : rgba(255,255,255,0.03), border: 1px solid rgba(255,255,255,0.06)
    Centré verticalement/horizontalement :
      Texte : "Pertes mensuelles" (12pt, #9FA8C7)
      Texte : "Graphique barres — Sprint 2" (9pt, #9FA8C7, opacity 0.5)

  Colonne droite (42%) :
    Même style fond/border
    Centré :
      Texte : "Profil horizon" (12pt, #9FA8C7)
      Texte : "Sprint 3" (9pt, #9FA8C7, opacity 0.5)

  ── SECTION TABLEAU kWh (Bloc C) ──
  Si monthlyKwhStats != null et monthlyKwhStats.length === 12 :
    Afficher TableMonthlyKwh avec les props correspondantes
  Sinon :
    Texte centré discret (9pt, #9FA8C7, opacity 0.6) :
    "Données énergétiques mensuelles indisponibles
     (puissance crête non renseignée ou données PVGIS inaccessibles)"

  ── FOOTER ──
  Reproduire le footer des pages legacy.

</div>
```

### Logique couleur seuil (à définir en constante ou inline) :

```typescript
function shadingLossColor(pct: number | null): string {
  if (pct == null) return '#E8ECF8';
  if (pct < 5)  return '#9FA8C7';  // négligeable — discret
  if (pct < 15) return '#C39847';  // notable — gold
  return '#E57373';                 // significatif — rouge-orangé
}
```

### Logique badge qualité :

```typescript
const badgeMap = {
  REAL_TERRAIN: { color: '#4ade80', text: 'ÉLEVÉE'  },
  SYNTHETIC:    { color: '#F59E0B', text: 'ESTIMÉE' },
  UNAVAILABLE:  { color: '#E57373', text: 'LIMITÉE' },
};
const badge = badgeMap[farHorizonKind as keyof typeof badgeMap]
           ?? badgeMap.UNAVAILABLE;
```

### Extraction des données dans le composant :

```typescript
const fr = (viewModel?.fullReport ?? {}) as Record<string, unknown>;
const ps = (fr.p_shading ?? {}) as Record<string, unknown>;

// Ensuite extraire chaque champ avec typage explicite :
const prodNoShadingKwh   = ps.prodNoShadingKwh   as number | null ?? null;
const prodWithShadingKwh = ps.prodWithShadingKwh as number | null ?? null;
// ... etc.
```

**Contraintes :**
- Ne pas utiliser le PdfEngine (PdfPageLayout, PdfBlock) — utiliser le pattern des pages legacy.
- Importer `ShadingKpiCard` et `TableMonthlyKwh` depuis `./components/`.
- Tous les styles en inline.
- Ne pas créer de CSS global.
- Export default du composant.

---

## Prompt 4 — Intégration dans le rapport PDF

**Fichiers à modifier :**
1. `frontend/src/pages/pdf/PdfLegacyPort/index.tsx`
2. `frontend/src/pages/pdf/FullReport/types.ts` (si ce fichier existe)

**Instructions :**

### Modification 1 — `PdfLegacyPort/index.tsx`

Ouvre le fichier. Localise les imports des autres pages en haut du fichier.
Ajoute l'import :
```typescript
import PdfPageShading from "./PdfPageShading";
```

Localise dans le JSX l'endroit où `PdfPage4` est rendu (page Production & Consommation).
Insère `<PdfPageShading>` **juste avant** `<PdfPage4>` :

```tsx
<PdfPageShading
  organization={organization}
  viewModel={viewModel}
/>
```

La page ombrage est affichée sans condition — elle est toujours présente dans le rapport
(même si certaines données sont indisponibles, la page affiche "—" ou les placeholders).

### Modification 2 — `frontend/src/pages/pdf/FullReport/types.ts`

Ouvre le fichier. Dans l'interface `FullReportViewModel` (ou l'interface équivalente qui
définit `fullReport`), ajoute le champ `p_shading` :

```typescript
p_shading?: {
  meta?:               { client?: string; ref?: string; date?: string };
  prodNoShadingKwh?:   number | null;
  prodWithShadingKwh?: number | null;
  annualLossKwh?:      number | null;
  annualLossEur?:      number | null;
  combinedLossPct?:    number | null;
  farLossPct?:         number | null;
  nearLossPct?:        number | null;
  farHorizonKind?:     string;
  farConfidenceLevel?: string | null;
  farSource?:          string | null;
  monthlyKwhStats?:    Array<{
    month:               number;
    prodNoShadingKwh:    number;
    prodWithShadingKwh:  number;
    kwhLoss:             number;
    lossPct:             number | null;
  }> | null;
  pvgisSource?:        string | null;
  pvgisTiltDeg?:       number | null;
  pvgisAzimuthDeg?:    number | null;
  peakPowerKwc?:       number;
};
```

**Contraintes :**
- Ne modifier que les deux fichiers indiqués.
- Ne pas supprimer ni déplacer les autres pages.
- Si `types.ts` n'existe pas, ne pas le créer — la modification est facultative.

---

## Vérification finale Sprint 1

Après les 4 prompts, vérifier manuellement :

1. **Backend :** `pdfViewModel.mapper.js` — chercher `p_shading` dans l'objet retourné.
2. **Composants :** les deux fichiers `ShadingKpiCard.tsx` et `TableMonthlyKwh.tsx` existent
   dans `frontend/src/pages/pdf/PdfLegacyPort/components/`.
3. **Page :** `PdfPageShading.tsx` existe dans `frontend/src/pages/pdf/PdfLegacyPort/`.
4. **Intégration :** dans `PdfLegacyPort/index.tsx`, `PdfPageShading` apparaît avant `PdfPage4`.
5. **Rendu PDF :** générer un PDF de test — la page "Analyse d'ombrage" doit apparaître
   avec les 5 KPI cards, les deux placeholders graphiques et le tableau kWh (ou son message
   d'indisponibilité).

**Sprint 2 (après validation visuelle) :** `ChartShadingMonthly.tsx` — barres mensuelles far/near.
**Sprint 3 (après validation visuelle) :** `ChartHorizonProfile.tsx` — profil horizon + trajectoires solaires.
