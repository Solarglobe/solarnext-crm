# AUDIT P6 ACTUEL

**Date :** 19 mars 2025  
**Contexte :** PDF commercial SolarNext / SolarGlobe — Analyse exhaustive, zéro modification

---

## 1. Fichiers impliqués

| Type | Chemin exact |
|------|--------------|
| **Composant racine P6 (PDF commercial)** | `frontend/src/pages/pdf/PdfLegacyPort/PdfPage6.tsx` |
| **Composants enfants** | Aucun — P6 ne reçoit pas de props, pas de ChartP6 React |
| **Engine graphique** | `frontend/public/pdf-engines/engine-p6.js` (dessine dans `#p6-chart`) |
| **Bridge** | `frontend/public/pdf-engines/engine-bridge.js` (émet `p6:update`) |
| **Styles** | `frontend/src/pages/pdf/PdfLegacyPort/pdf-legacy-port.css` (classes `.sheet`, `.chart-card`, `.card soft`) + styles inline dans PdfPage6.tsx |
| **Hook** | `frontend/src/pages/pdf/hooks/useLegacyPdfEngine.ts` (bindEngineP6 + emitPdfViewData) |
| **Mapper données** | `backend/services/pdf/pdfViewModel.mapper.js` (lignes 231-234, 383-391) |
| **Legacy mapper front** | `frontend/src/pages/pdf/legacy/legacyPdfViewModelMapper.ts` (pass-through, pas de transformation) |
| **Point d'entrée PDF** | `frontend/pdf-render.html` (charge engine-p6.js) |
| **Intégration** | `frontend/src/pages/pdf/PdfLegacyPort/index.tsx` (PdfPage6 sans props) |

**Note :** `frontend/src/pages/pdf/FullReport/PdfPage6.tsx` et `ChartP6.tsx` existent mais ne sont **pas utilisés** pour le PDF commercial actuel. Le flux actuel = PdfLegacyPort + engine-p6.js.

---

## 2. Structure visuelle

### Structure générale (de haut en bas)

1. **Header** — Logo Solarglobe (22mm) à gauche, badge "Répartition consommation — 12 mois" centré, meta (Client, Réf., Date) à droite
2. **Barre dorée** — 1mm, gradient #C39847 → #d4af63, séparation visuelle
3. **Encart CTA / mode outil** — "Saisissez votre répartition mensuelle (PV utilisée, décharge batterie, import réseau) ou bien entrez la conso totale et laissez le réseau se calculer."
4. **Zone graphique** — Carte avec bordure, titre "Répartition mensuelle — PV directe, batterie, réseau", "Simulation validée — Année courante", légende 4 items, SVG 66mm
5. **Légende** — 4 items : PV utilisée (#86D8F1), Décharge batterie (#B3F4C4), Import réseau (#CFCBFF), Moyenne conso (barre grise)
6. **KPI** — 3 cartes : Autonomie annuelle, Import réseau, Autoconsommation

### Bloc par bloc — poids visuel

| Bloc | Rôle | Poids visuel | Remarque |
|------|------|--------------|----------|
| Header | Identité, contexte | Moyen | Logo + badge + meta — cohérent P1-P5 |
| Barre | Séparation | Faible | Élément de design récurrent |
| Encart CTA | Invitation à saisir | Élevé | **Problème** : parle de saisie / modification — mode outil, pas projection client |
| Zone graphique | Données 12 mois | Dominant | Barres empilées SVG, 66mm hauteur |
| Légende | Lecture des barres | Moyen | 4 items, "Moyenne conso" = ligne horizontale |
| KPI | Synthèse annuelle | Moyen | 3 cartes visibles après hydrate |

### Zones visuellement chargées / vides

- **Chargée :** L'encart CTA (texte dense) + le graphique (12 barres, 3 segments empilés, grille, axe Y) + légende 4 items = dense
- **KPI** : 3 cartes avec labels, valeurs, sous-textes — corrects mais dispersés
- **Incohérence :** Le CTA dit "Saisissez" / "Cliquer pour modifier" alors que le PDF est un document figé — le client ne "saisit" rien

---

## 3. Visuel principal

### Type de visuel

- **Graphique** : barres empilées (stacked bar chart)
- **12 colonnes** : une par mois (Jan à Déc)
- **3 segments par barre** : PV directe (bleu), batterie (vert), réseau (violet)

### Ce que ça représente

| Segment | Couleur | Signification |
|--------|---------|---------------|
| PV utilisée | #86D8F1 | Autoconsommation directe (PV → conso immédiate) |
| Décharge batterie | #B3F4C4 | Énergie stockée puis restituée |
| Import réseau | #CFCBFF | Électricité achetée au réseau |

→ Répartition mensuelle de la consommation selon 3 sources.

### Données utilisées

- **Origine** : `fullReport.p6.p6` = `{ meta, price, dir, bat, grid, tot }`
- **Mapper** : `dirMonthly` = autoMonthly (autoconsommation mensuelle), `batMonthly` = 0 (scénario BASE), `gridMonthly` = conso - dir - bat, `totMonthly` = conso
- **Transformation** : engine-p6.js `mergeSeries()` → extraction des 12 valeurs par série
- **Scénario BASE** : batterie toujours 0 → 2 segments visibles (PV + réseau)

### Lisibilité

- **Compréhensible** : barres empilées = lecture intuitive "d'où vient le kWh"
- **Axe Y** : labels kWh en grille (0 à max×1.1)
- **Ligne moyenne** : horizontale grise (#cbd5e1) — "Moyenne conso"
- **Mois** : 12 labels sous les barres (Jan, Fév, etc.)
- **Risque** : 12 barres × 3 segments = charge visuelle modérée ; scénario BASE : 2 segments seulement (PV + réseau)

### Ce que le client comprend

- Répartition mensuelle de sa consommation
- 3 sources : PV (bleu), batterie (vert), réseau (violet)
- Variation saisonnière (hiver = plus de réseau, été = plus de PV)

### Ce qu'il ne comprend probablement pas

- **"PV utilisée" vs "Décharge batterie"** — confusion si batterie = 0 (vert absent)
- **"Moyenne conso"** — ligne horizontale sans explication claire
- **Pourquoi saisir / modifier** — CTA inadapté au PDF figé
- **Dépendance réseau** — pas mis en avant visuellement ; le violet est au sommet des barres mais pas valorisé comme "ce qu'il reste à réduire"

### Utilité à la vente

- **Utile** : montre la répartition, donc le réseau est visible
- **Insuffisant** : la dépendance réseau n'est pas le message principal ; le titre parle de "répartition", pas de "autonomie" ou "réduction réseau"
- **KPI** : Autonomie, Import réseau, Autoconsommation — bons mais noyés dans le flux technique

---

## 4. Message actuel

### Titre

- **Badge** : "Répartition consommation — 12 mois"
- **Titre graphique** : "Répartition mensuelle — PV directe, batterie, réseau"

→ Redondant. "Répartition" répété. Pas de message orienté autonomie / dépendance.

### Sous-titre

- "Simulation validée — Année courante" (via `#p6_year_label` — **non mis à jour** par l'engine, reste "Année courante")

### Phrase CTA

- "Saisissez votre **répartition mensuelle** (PV utilisée, décharge batterie, import réseau) ou bien entrez la **conso totale** et laissez le réseau se calculer."

**Problèmes :**
- Parle à l'utilisateur comme à un opérateur ("Saisissez", "entrez")
- Pas de projection client
- Pas de message orienté autonomie / réduction réseau

### Labels légende

- PV utilisée — OK
- Décharge batterie — OK (mais absent si batterie = 0)
- Import réseau — OK
- Moyenne conso — peu clair (ligne horizontale)

### Labels KPI

- Autonomie annuelle — "Part couverte sans réseau" — **clair**
- Import réseau — "kWh & coût estimé" — **clair**
- Autoconsommation — "PV consommée sur place" — **clair**

### Message principal

**En une phrase :** "Voici la répartition mensuelle de votre consommation entre PV directe, batterie et réseau."

### Message secondaire

- Implicite : "Vous pouvez modifier cette répartition" (CTA) — **faux** dans un PDF figé.

### Éléments parasites

- CTA "Saisissez votre répartition mensuelle" — inadapté au PDF commercial
- "✓ Validé" (opacity: 0, jamais visible) — vestige mode édition
- "Cliquer pour modifier" (title sur zone graphique) — inadapté
- "Moyenne conso" — légende technique sans valeur narrative

### Doublons

- "Répartition" dans badge + titre graphique
- "PV utilisée" / "PV directe" — variantes

---

## 5. UX / commerciale

### P6 renforce-t-elle la vente ?

- **Partiellement** — Les KPI (autonomie, import réseau) sont utiles. Mais le message n'est pas orienté "autonomie" ou "réduction réseau". Le titre parle de "répartition", pas de "dépendance".

### Le client comprend-il combien il dépend encore du réseau ?

- **Pas assez** — L'import réseau est visible (violet) et le KPI "Import réseau" existe. Mais :
  - Le titre ne met pas en avant la dépendance
  - Pas de phrase du type "Vous dépendez encore du réseau à X %"
  - Pas de message orienté "réduire encore"

### Est-ce concret ?

- **Oui** — kWh, barres mensuelles, coût réseau en €. Plus concret que P5 (journée type abstraite).

### Est-ce trop technique ?

- **Modérément** — "PV utilisée", "Décharge batterie", "Import réseau" sont compréhensibles. Mais "Moyenne conso", "Répartition mensuelle", CTA "saisissez" = mode outil.

### Est-ce mémorisable ?

- **Non** — Pas de message unique, pas de chiffre choc mis en avant. Les 3 KPI sont dispersés.

### Verdict honnête

- **P6 a du potentiel** : les données (dir, bat, grid) et les KPI (autonomie, import réseau) sont alignés avec l'objectif "autonomie / dépendance réseau".
- **P6 rate la cible** : le wording, le CTA et le titre ne mettent pas en avant la dépendance réseau. Le message est "répartition technique", pas "voici combien vous dépendez encore du réseau et comment réduire".

---

## 6. Design

### Hiérarchie visuelle

1. **Premier regard** : Le graphique (zone la plus grande, couleurs vives)
2. **Deuxième** : Les 3 KPI (cartés)
3. **Troisième** : L'encart CTA (texte dense)
4. **Quatrième** : Header, légende

### Équilibre

- **Texte / data / graphique** : Déséquilibré — CTA inadapté, pas d'intro pédagogique. Les KPI sont présents mais pas mis en avant.

### Lisibilité

- **Correcte** — Barres empilées lisibles, couleurs distinctes, axe Y en kWh.

### Cohérence avec P4 / P5

- **Header** : Cohérent (logo, badge, meta)
- **Barre** : Cohérente
- **P4** : Intro, KPI, message commercial — P6 n'a pas d'intro
- **P5** : CTA "Définissez" — P6 : CTA "Saisissez" — même pattern inadapté

### Niveau premium vs outil technique

- **Outil technique** — CTA "Saisissez", "Cliquer pour modifier", pas de phrase d'accroche. Le graphique est soigné (barres, grille, axe Y) mais le message est "outil". Les KPI sont bons mais pas valorisés.

### Ce qui attire l'œil

- Le graphique (couleurs, taille)
- Les 3 KPI (cartés)
- Le CTA (contraste)

### Ce qui est inutile

- CTA "Saisissez votre répartition mensuelle"
- "✓ Validé" (invisible)
- "Cliquer pour modifier"
- "Moyenne conso" (ligne horizontale)

### Ce qui manque

- Phrase d'intro : "Voici combien vous dépendez encore du réseau et comment réduire."
- Mise en avant du KPI "Import réseau" ou "Autonomie"
- Message orienté autonomie / réduction

---

## 7. Technique

### Complexité

- **Architecture hybride** — React (structure) + engine JS (graphique). Même pattern que P5.

### Dépendances

- `document.querySelector` pour accéder au DOM (#p6-chart, #p6_client, etc.)
- `Engine.on("p6:update", ...)` pour recevoir les données
- `window.API.bindEngineP6(Engine)` exposé par engine-p6.js

### Couplage

- **Graphique ↔ engine** — Logique de dessin (barres, grille, KPI) dans engine-p6.js. Couplage fort.
- **Données ↔ mapper** — dir, bat, grid, tot calculés dans pdfViewModel.mapper.js. Scénario BASE : batterie = 0 (battMonthly = Array(12).fill(0)).

### Facilité de refonte

- **Moyenne** — Pour passer en React pur (comme P4) :
  1. Créer un ChartP6 React (ou réutiliser FullReport/ChartP6.tsx)
  2. Supprimer engine-p6.js du chargement
  3. Passer viewModel à PdfPage6
  4. Supprimer bindEngineP6

### Hardcodes

- `price = 0.18` dans mapper (ligne 235)
- `W = 1750, H = 520` dans engine (viewBox)
- `L = 28, R = 14, T = 24, B = 70` dans engine
- `#p6_year_label` : jamais mis à jour par l'engine — reste "Année courante"
- `C_DIR = "#86D8F1"`, `C_BATT = "#B3F4C4"`, `C_GRID = "#CFCBFF"`

### Logique inutile

- CTA "Saisissez" — inadapté au PDF figé
- `title="Cliquer pour modifier"` — inadapté

### Éléments bloquants

- Aucun — refonte possible sans blocage technique.

---

## 8. Compatibilité futur

### Objectif futur rappelé

- Montrer clairement la dépendance restante au réseau
- Orienter client vers autonomie et réduction réseau
- Supprimer toute lecture technique inutile

### Ce qui est compatible

- **Données** : dir, bat, grid, tot — parfaites pour répartition et autonomie
- **KPI** : Autonomie annuelle, Import réseau, Autoconsommation — alignés avec l'objectif
- **Graphique** : barres empilées — montrent clairement le réseau (violet)
- **Structure** : Header, barre, zone graphique, KPI — réutilisables

### Ce qui ne l'est pas

- **CTA "Saisissez"** — À supprimer
- **Titre "Répartition consommation"** — À remplacer par message orienté autonomie / dépendance
- **"Cliquer pour modifier"** — À supprimer
- **"Moyenne conso"** — Optionnel, peut être simplifié ou supprimé

### Ce qui doit disparaître

- Encart CTA entier
- "✓ Validé" (déjà invisible)
- title sur zone graphique

### Ce qui peut être simplifié

- **Titre** : "Votre dépendance au réseau — mois par mois" ou "Autonomie vs réseau — 12 mois"
- **Légende** : 3 items (PV, batterie, réseau) — "Moyenne conso" = optionnel
- **Message** : Intro + KPI mis en avant

---

## 9. Verdict net

1. **Ce que P6 fait bien :** Graphique barres empilées lisible, couleurs distinctes, axe Y en kWh.

2. **Données** : dir, bat, grid, tot — parfaites pour répartition et autonomie. KPI (autonomie, import réseau, autoconsommation) — alignés avec l'objectif.

3. **Ce qu'elle fait mal :** CTA "Saisissez" inadapté, titre "Répartition" pas orienté autonomie, pas de phrase d'intro, message "outil" au lieu de "projection". La dépendance réseau n'est pas le message principal.

4. **Pourquoi elle doit être simplifiée :** Le message actuel est "répartition technique". L'objectif est "autonomie / dépendance réseau / réduction". Le wording et le CTA cassent la projection client.

5. **Direction exacte future P6 :** Page "dépendance réseau" avec intro "Voici combien vous dépendez encore du réseau et comment réduire", graphique 3 segments (PV, batterie, réseau) conservé, KPI mis en avant (autonomie, import réseau, coût), suppression totale du CTA et de la formule technique. Titre orienté : "Votre autonomie — mois par mois" ou "Autonomie vs réseau".

---

*Audit réalisé sans modification de code. Exploitable pour le prompt de refonte P6.*
