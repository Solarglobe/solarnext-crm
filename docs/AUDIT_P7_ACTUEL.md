# AUDIT P7 ACTUEL

**Date :** 19 mars 2025  
**Contexte :** PDF commercial SolarNext / SolarGlobe — Analyse exhaustive, zéro modification

---

## 1. Fichiers impliqués

| Type | Chemin exact |
|------|--------------|
| **Composant racine P7 (PDF commercial)** | `frontend/src/pages/pdf/PdfLegacyPort/PdfPage7.tsx` |
| **Composants enfants** | Aucun — P7 ne reçoit pas de props |
| **Engine graphique** | `frontend/public/pdf-engines/engine-p7.js` (hydrate `#p7_visual_zone`, génère barres + KPI) |
| **Bridge** | `frontend/public/pdf-engines/engine-bridge.js` (émet `p7:update`) |
| **Styles** | `frontend/src/pages/pdf/PdfLegacyPort/pdf-legacy-port.css` (classes `.sheet`, `.header`, `.bar`, `.card soft`) + styles inline dans PdfPage7.tsx |
| **Hook** | `frontend/src/pages/pdf/hooks/useLegacyPdfEngine.ts` (bindEngineP7 + emitPdfViewData) |
| **Mapper données** | `backend/services/pdf/pdfViewModel.mapper.js` (lignes 393-405, 612) |
| **Legacy mapper front** | `frontend/src/pages/pdf/legacy/legacyPdfViewModelMapper.ts` (pass-through, pas de transformation) |
| **Point d'entrée PDF** | `frontend/dist-crm/pdf-render.html` (charge engine-p7.js) |
| **Intégration** | `frontend/src/pages/pdf/PdfLegacyPort/index.tsx` (ligne 53 : `<PdfPage7 />` sans props) |

**Note :** `frontend/src/pages/pdf/FullReport/PdfPage7.tsx` existe mais n'est **pas utilisé** pour le PDF commercial. Le flux actuel = PdfLegacyPort + engine-p7.js.

---

## 2. Analyse header (comparatif P4/P5/P6)

### Comparatif détaillé

| Élément | P4 | P5 | P6 | **P7** |
|--------|----|----|-----|--------|
| **Logo** | `organization` + `getStorageUrl` (22mm) | Idem (22mm) | Idem (22mm) | **Hardcodé** `/pdf-assets/images/logo-solarglobe-rect.png` (26mm) |
| **Logo position** | `left: 0, top: 0` | Idem | Idem | `left: 0, top: 2mm` |
| **Logo hauteur** | 18mm | 18mm | 18mm | 18mm |
| **--logoW** | 22mm | 22mm | 22mm | **26mm** |
| **--metaW** | 110mm | 110mm | 110mm | **120mm** |
| **paddingBottom header** | 6mm | 6mm | 4mm | **15mm** |
| **paddingLeft** | `var(--logoW)` si logo | Idem | Idem | `var(--logoW)` (toujours 26mm) |
| **Badge position** | `left: 50%, transform: translateX(-50%)` | Idem | Idem | Idem |
| **Badge fontSize** | 6mm | 6mm | 6mm | **6mm** |
| **Meta structure** | `<div><b>Client</b> : ...` | Idem | Idem | **`<span>Client : ...`** (sans `<b>`) |
| **Props reçues** | `organization`, `viewModel` | Idem | Idem | **Aucune** |

### Ce qui est décalé

1. **Logo** : P7 ne reçoit pas `organization` ni `viewModel` → logo toujours Solarglobe par défaut, jamais logo client personnalisé.
2. **Trait doré** : P7 utilise `margin: "10mm 0 8mm"` sur la barre → **trait trop bas** par rapport à P4/P5/P6 (4mm).
3. **Header** : `paddingBottom: 15mm` vs 4–6mm sur P4/P5/P6 → **plus d'espace sous le header** = décalage visuel.
4. **Meta** : Labels sans gras (`Client :` vs `<b>Client</b> :`) → hiérarchie moins marquée.
5. **Section padding** : P7 `padding: "6mm 11mm 10mm 11mm"` vs P4 `7mm 9mm`, P5/P6 `6–7mm 9mm` → marges latérales différentes (11mm vs 9mm).

### Pourquoi

- P7 est **isolé** : pas de props `organization`/`viewModel` passé par `PdfLegacyPort` (ligne 53 : `<PdfPage7 />`).
- P7 a été porté du legacy HTML avec des valeurs **hardcodées** (logo 26mm, metaW 120mm, paddingBottom 15mm) sans alignement sur P4/P5/P6.
- P4/P5/P6 ont été refactorisés pour recevoir `organization` et `viewModel` ; P7 n'a pas suivi.

### Différence CSS / structure

- **P4/P5/P6** : header avec `flexShrink: 0`, `position: relative`, meta en `position: absolute; right: 0; bottom: 0`.
- **P7** : même structure mais `paddingBottom: 15mm` au lieu de 4–6mm.
- **Barre** : P4/P5/P6 `marginBottom: 4mm` ; P7 `margin: 10mm 0 8mm` → **10mm au-dessus** du trait = espace vide important.

---

## 3. Structure visuelle

### Structure générale (de haut en bas)

1. **Header** — Logo Solarglobe (26mm) à gauche, badge "Décomposition de la consommation" centré, meta (Client, Réf., Date) à droite
2. **Barre dorée** — 1mm, gradient #C39847 → #d4af63, séparation visuelle
3. **Card CTA** — "Saisissez vos **valeurs annuelles** (en kWh ou %) — le **Réseau** et le **Surplus** sont calculés automatiquement." + badge "✓ Validé" (opacity: 0)
4. **Zone visuelle** (`#p7_visual_zone`) — **display: none par défaut** — rendue visible par engine-p7.js quand données reçues

### Contenu de `#p7_visual_zone` (quand hydrate)

- **Card principale** — Titre "Origine / Destination — scénario retenu", scénario label, légende 5 items (PV directe, Batterie, Réseau, Autoconso, Surplus)
- **Barre 1** — "Origine de la **consommation** (100 %)" — 3 segments : PV, Batterie, Réseau
- **Barre 2** — "Destination de la **production** (100 %)" — 3 segments : Autoconso, Batterie, Surplus
- **Échelle** — 0%, 25%, 50%, 75%, 100% sous chaque barre
- **4 KPI** — Autonomie, Autoconsommation, Part réseau, Surplus
- **Texte** — "Une barre = 100 %. Haut : origine de la **consommation**. Bas : destination de la **production**."

### Bloc par bloc — poids visuel

| Bloc | Rôle | Poids visuel | Remarque |
|------|------|--------------|----------|
| Header | Identité, contexte | Moyen | Logo + badge + meta — **incohérent** avec P4/P5/P6 |
| Barre | Séparation | Faible | **Trop bas** (margin 10mm 0 8mm) |
| Card CTA | Invitation à saisir | Élevé | **Problème** : mode outil, pas projection client |
| Zone visuelle | Données flux | Dominant | **Cachée par défaut** — si pas de données → page vide |
| KPI | Synthèse | Moyen | 4 cartes |
| Texte explicatif | Pédagogie | Faible | 1 phrase courte |

### Zones visuellement chargées / vides

- **Chargée :** Card CTA (texte dense) — visible même sans données
- **Vide :** `#p7_visual_zone` = `display: none` par défaut → si pas de `p7:update` ou si payload vide → **page quasi vide** (header + barre + CTA)

---

## 4. Contenu actuel

### Titres

| Élément | Texte |
|---------|-------|
| Badge | "Décomposition de la consommation" |
| Titre card | "Origine / Destination — scénario retenu" |
| Barre 1 | "Origine de la **consommation** (100 %)" |
| Barre 2 | "Destination de la **production** (100 %)" |
| Texte bas | "Une barre = 100 %. Haut : origine de la **consommation**. Bas : destination de la **production**." |

### Labels légende

- PV directe
- Batterie
- Réseau
- Autoconso (prod)
- Surplus

### Labels KPI

- Autonomie
- Autoconsommation
- Part réseau
- Surplus

### CTA

- "Saisissez vos **valeurs annuelles** (en kWh ou %) — le **Réseau** et le **Surplus** sont calculés automatiquement."
- "✓ Validé" (opacity: 0, jamais visible)

### Ce que ça veut dire

- **Origine consommation** : d'où vient l'électricité consommée (PV direct, batterie, réseau).
- **Destination production** : où va la production (autoconso, batterie, surplus injecté).

### Clarté / utilité

- **Clair** : Les barres segmentées sont intuitives.
- **Utile** : Concept "origine / destination" pertinent pour comprendre les flux.
- **Technique** : "Autoconso (prod)" vs "PV directe" — nuance pas évidente pour un client.
- **Vide** : Si `p7_visual_zone` reste cachée → seul le CTA reste visible → **message inadapté** ("Saisissez").

---

## 5. Graphique / visuel

### Type

- **Barres horizontales segmentées** (100 % = 1 barre, 3 segments colorés par barre).
- **2 barres** : consommation (origine) et production (destination).

### Données utilisées

- **Origine** : `fullReport.p7` = `{ meta, pct, c_grid, p_surplus }`
- **pct** : `c_pv_pct`, `c_bat_pct`, `c_grid_pct`, `p_auto_pct`, `p_bat_pct`, `p_surplus_pct`
- **Mapper** : `c_pv_pct = selfConsumptionPct`, `c_bat_pct = 0`, `c_grid_pct = 100 - autonomyPct`, `p_auto_pct = selfConsumptionPct`, `p_bat_pct = 0`, `p_surplus_pct = 100 - selfConsumptionPct`
- **Scénario BASE** : batterie toujours 0 → 2 segments visibles par barre (PV + réseau, Autoconso + surplus)

### Logique de calcul

- **Autonomie** (engine) : `c_pv_pct + c_bat_pct` (PV directe + batterie)
- **Autoconsommation** (engine) : `p_auto_pct + p_bat_pct` (autoconso + batterie)
- **Part réseau** : `c_grid_pct`, note ≈ `c_grid` kWh
- **Surplus** : `p_surplus_pct`, note ≈ `p_surplus` kWh

### Lisibilité

- **Correcte** — Barres colorées, légende 5 items, échelle 0–100 %.
- **Risque** : Segments < 2 % masqués (`display: none`) par engine — peut créer des barres vides si valeurs arrondies à 0.

### Pourquoi la page peut être vide

1. **`#p7_visual_zone`** a `display: none` par défaut.
2. **Engine** : `zone.style.display = "block"` + `zone.innerHTML = ""` + `buildP7()` uniquement quand `p7:update` reçu.
3. **Si** `fr.p7` absent ou `buildEmptyViewModel` utilisé → `p7: { meta: emptyMeta, pct: {}, c_grid: 0, p_surplus: 0 }` → `pct` vide.
4. **Engine** : `mergeP7(payload)` avec `pct: {}` → tous les `safeNum(pct.xxx)` = 0 → barres à 0 % ou vides.
5. **Segments** : `v < 2` → `display: none` → barres invisibles.

→ **Page vide** = header + barre + CTA "Saisissez" + zone vide ou barres à 0 %.

---

## 6. KPI

### KPI présents

| KPI | Valeur | Source | Note |
|-----|--------|--------|------|
| Autonomie | % | `c_pv_pct + c_bat_pct` | "= X % PV directe + Y % Batterie" |
| Autoconsommation | % | `p_auto_pct + p_bat_pct` | "= X % Autoconso" |
| Part réseau | % | `c_grid_pct` | "≈ X kWh" |
| Surplus | % | `p_surplus_pct` | "≈ X kWh" |

### Utilité

- **Autonomie** : utile, aligné avec P6.
- **Autoconsommation** : utile, aligné avec P4/P6.
- **Part réseau** : utile, aligné avec P6.
- **Surplus** : utile, complémentaire.

### Compréhensibilité

- **Correcte** — Labels clairs, notes en kWh pour réseau et surplus.
- **Redondance** : Autonomie + Part réseau = 100 % (complémentaires).

### Redondance avec P6

- **P6** : Autonomie annuelle, Import réseau, Autoconsommation.
- **P7** : Autonomie, Autoconsommation, Part réseau, Surplus.
- **Overlap** : Autonomie, Import/Part réseau, Autoconsommation — **mêmes concepts**, format différent (barres vs graphique mensuel).

### Positionnement

- **Correct** — 4 cartes en grille sous les barres.
- **Problème** : Si zone visuelle cachée → KPI jamais affichés.

---

## 7. UX / commerciale

### P7 apporte-t-elle quelque chose ?

- **Oui** — Vue synthétique "origine / destination" des flux.
- **Non** — Si zone cachée ou données vides → page vide + CTA "Saisissez" = **message incohérent**.

### Le client comprend-il mieux son installation ?

- **Avec données** : Oui — barres = lecture intuitive.
- **Sans données** : Non — CTA parle de saisie, pas de projection.

### Est-elle inutile ?

- **Pas inutile** — Le concept est pertinent.
- **Mais** : Redondance avec P6 (autonomie, réseau, autoconsommation) + CTA inadapté + risque de page vide.

### Est-ce qu'elle casse le flow ?

- **Oui** — Après P5 (journée type) et P6 (dépendance réseau), P7 répète des KPI déjà vus.
- **P6** = graphique 12 mois + KPI ; **P7** = 2 barres 100 % + mêmes KPI.

### Verdict honnête

- **P7 a du potentiel** : les barres "origine / destination" sont une bonne représentation.
- **P7 rate la cible** : CTA mode outil, pas de props (logo/org), zone cachée par défaut, redondance avec P6.
- **Rôle actuel** : Page technique intermédiaire, pas de message commercial fort.

---

## 8. Design

### Cohérence avec P4 / P5 / P6

- **Header** : Incohérent (logo hardcodé, paddingBottom 15mm, meta sans gras).
- **Barre** : Incohérent (margin 10mm 0 8mm vs 4mm).
- **Section** : Padding 6mm 11mm 10mm vs 6–7mm 9mm.

### Hiérarchie visuelle

1. **Premier regard** : Card CTA (visible) ou zone visuelle (si affichée).
2. **Deuxième** : Barres segmentées.
3. **Troisième** : Légende.
4. **Quatrième** : KPI.

### Équilibre

- **Déséquilibré** — CTA occupe trop de place si zone visuelle vide.
- **Pas d'intro** : Contrairement à P4/P5/P6, pas de phrase d'accroche pédagogique.

### Lisibilité

- **Correcte** — Barres lisibles, couleurs distinctes, légende claire.

### Niveau premium

- **Inférieur** à P4/P5/P6 — Pas de logo dynamique, header décalé, CTA mode outil.

### Ce qui manque

- Intro pédagogique.
- Alignement header avec P4/P5/P6.
- Message orienté autonomie / flux.

### Ce qui est en trop

- CTA "Saisissez vos valeurs annuelles".
- "✓ Validé" (opacity: 0).

### Ce qui est mal placé

- Barre dorée (trop bas).
- CTA (devrait disparaître ou être remplacé par une intro).

---

## 9. Technique

### Complexité

- **Modérée** — Engine JS vanilla, pas de librairie graphique.
- **React** : Composant statique, pas de state, pas de props.

### Dépendances

- `engine-p7.js` → `window.Engine`, `window.API.bindEngineP7`
- `engine-bridge.js` → `emitPdfViewData` → `fr.p7` → `p7:update`
- `pdfViewModel.mapper.js` → `p7: { meta, pct, c_grid, p_surplus }`

### Couplage

- **Fort** — Engine manipule le DOM directement (`#p7_visual_zone`, `#p7_client`, etc.).
- **IDs** : `p7_client`, `p7_ref`, `p7_date`, `p7_meta_scen`, `p7_visual_zone`, `p7_conso_pv`, `p7_conso_batt`, `p7_conso_reseau`, `p7_prod_auto`, `p7_prod_batt`, `p7_prod_surplus`, `p7_autonomie_pct`, etc.

### Facilité de refonte

- **Moyenne** — Logique dans engine-p7.js, structure React minimaliste.
- **Refonte** : Migrer vers React pur (comme P4) = supprimer engine, récupérer données via props.

### Hardcodes

- Logo : `/pdf-assets/images/logo-solarglobe-rect.png`
- `--logoW`: 26mm
- `--metaW`: 120mm
- `paddingBottom`: 15mm
- CTA "Saisissez vos valeurs annuelles"

### Logique inutile

- `p7_validated` (opacity: 0) — vestige mode édition.
- CTA "Saisissez" — inadapté au PDF figé.

### Éléments morts

- Contenu statique dans `#p7_visual_zone` (lignes 94–170) — engine fait `zone.innerHTML = ""` puis rebuild → **tout le HTML React est écrasé**.
- Engine génère son propre contenu.

---

## 10. Position dans le tunnel

### P7 arrive après

- **P5** : Journée type (production, consommation, batterie).
- **P6** : Dépendance réseau (barres mensuelles, autonomie, import réseau).

### Rôle actuel

- **Synthèse annuelle** des flux en 2 barres (origine conso, destination prod).
- **Redondance** : Autonomie, Part réseau, Autoconsommation déjà vus sur P6.

### Rôle idéal

- **Autonomie + flux énergie** : vue synthétique "d'où vient / où va" l'électricité.
- **KPI décision** : autonomie, surplus, part réseau — pour aider à la décision (batterie, puissance).
- **Compréhension simple** : "Vous consommez X % de votre production, Y % part au réseau".

### Écart

- **Actuel** : Page technique intermédiaire, CTA inadapté, redondance avec P6.
- **Idéal** : Page orientée autonomie, message clair, pas de redondance.

---

## 11. Compatibilité futur

### Objectif futur P7

- Autonomie + flux énergie.
- KPI décision.
- Compréhension simple.

### Ce qui est récupérable

- **Barres** : Concept "origine / destination" pertinent.
- **KPI** : Autonomie, Autoconsommation, Part réseau, Surplus.
- **Mapper** : Structure `p7: { meta, pct, c_grid, p_surplus }` déjà utilisée.

### Ce qui doit disparaître

- CTA "Saisissez vos valeurs annuelles".
- "✓ Validé" (opacity: 0).
- Logo hardcodé.
- Header décalé (paddingBottom 15mm, margin barre 10mm 0 8mm).
- Engine DOM manipulation (migrer vers React pur).

### Ce qui manque totalement

- Props `organization` / `viewModel` pour logo dynamique.
- Intro pédagogique.
- Message orienté autonomie / flux.
- Alignement structure avec P4/P5/P6.
- Gestion état vide (pas de CTA "saisissez", afficher message "Données en cours" ou équivalent).

---

## 12. Verdict net

### Synthèse

| Critère | État |
|--------|------|
| **Header** | Incohérent (logo hardcodé, padding, meta sans gras) |
| **Trait doré** | Trop bas (10mm 0 8mm) |
| **Contenu** | Zone visuelle cachée par défaut → risque page vide |
| **CTA** | Inadapté (mode outil) |
| **Structure** | Pas de props, pas d'alignement P4/P5/P6 |
| **Redondance** | Forte avec P6 (autonomie, réseau, autoconsommation) |
| **Rôle** | Synthèse flux — pertinent mais mal exploité |

### Recommandations pour reconstruction

1. **Aligner header** : Props `organization`/`viewModel`, logo 22mm, metaW 110mm, paddingBottom 6mm, meta avec `<b>`.
2. **Barre** : `marginBottom: 4mm` comme P4/P5/P6.
3. **Supprimer CTA** : Remplacer par intro pédagogique orientée autonomie.
4. **Migrer vers React pur** : Supprimer engine-p7.js, données via props, rendu React.
5. **Gérer état vide** : Afficher message "Données non disponibles" ou masquer la page si pas de données.
6. **Dédupliquer** : Réfléchir à fusion P6/P7 ou différencier clairement (P6 = mensuel, P7 = synthèse annuelle + flux).
7. **Message** : Orienter vers "Votre autonomie et vos flux énergie" — pas "décomposition technique".

---

*Audit réalisé sans modification de code — analyse uniquement.*
