# AUDIT P5 ACTUEL

**Date :** 19 mars 2025  
**Contexte :** PDF commercial SolarNext / SolarGlobe — Analyse exhaustive, zéro modification

---

## 1. Fichiers impliqués

| Type | Chemin exact |
|------|--------------|
| **Composant racine P5** | `frontend/src/pages/pdf/PdfLegacyPort/PdfPage5.tsx` |
| **Composants enfants** | Aucun — P5 ne reçoit pas de props, pas de ChartP5 React |
| **Engine graphique** | `frontend/public/pdf-engines/engine-p5.js` (dessine dans `#p5-chart`) |
| **Bridge** | `frontend/public/pdf-engines/engine-bridge.js` (émet `p5:update`) |
| **Styles** | `frontend/src/pages/pdf/PdfLegacyPort/pdf-legacy-port.css` (classes `.chart-card`, `.legend`, `.pill`, `.pill-gold`, `.pill-gray`, `.pill-cyan`, `.pill-green`) + styles inline dans PdfPage5.tsx |
| **Hook** | `frontend/src/pages/pdf/hooks/useLegacyPdfEngine.ts` (bindEngineP5 + emitPdfViewData) |
| **Mapper données** | `backend/services/pdf/pdfViewModel.mapper.js` (lignes 246-248, 368-373) |
| **Legacy mapper front** | `frontend/src/pages/pdf/legacy/legacyPdfViewModelMapper.ts` (pass-through, pas de transformation) |
| **Point d'entrée PDF** | `frontend/pdf-render.html` (charge engine-p5.js) |
| **Intégration** | `frontend/src/pages/pdf/PdfLegacyPort/index.tsx` (PdfPage5 sans props) |

**Note :** `frontend/src/pages/pdf/FullReport/PdfPage5.tsx` et `ChartP5.tsx` existent mais ne sont **pas utilisés** pour le PDF commercial actuel. Le flux actuel = PdfLegacyPort + engine-p5.js.

---

## 2. Structure visuelle actuelle de la page

### Structure générale (de haut en bas)

1. **Header** — Logo Solarglobe (22mm) à gauche, badge "Impact photovoltaïque — journée type" centré, meta (Client, Réf., Date) à droite
2. **Barre dorée** — 1mm, gradient #C39847 → #d4af63, séparation visuelle
3. **Encart CTA / mode outil** — "Définissez votre journée type heure par heure (mois simulé + production / consommation / batterie). L'autoconsommation est calculée automatiquement *(min(PV, Conso))*."
4. **Zone graphique** — Carte avec bordure, titre "Journée type — production, consommation et stockage", "Mois simulé : Annuel", SVG 75mm de hauteur
5. **Légende** — 4 pills (Production solaire, Consommation, Autoconsommation, Batterie si > 0) en ligne

### Bloc par bloc — poids visuel

| Bloc | Rôle | Poids visuel | Remarque |
|------|------|--------------|----------|
| Header | Identité, contexte | Moyen | Logo + badge + meta — cohérent P1-P4 |
| Barre | Séparation | Faible | Élément de design récurrent |
| Encart CTA | Invitation à saisir | Élevé | **Problème** : parle d'un "mois simulé" et d'une saisie "heure par heure" — mode outil, pas projection client |
| Zone graphique | Données journée type | Dominant | Graphique SVG 75mm, 4 courbes superposées |
| Légende | Lecture des courbes | Moyen | 4 items, batterie conditionnelle |

### Zones visuellement chargées / vides

- **Chargée :** L'encart CTA (texte dense, formule mathématique) + le graphique (4 courbes, zones remplies, grille)
- **Vide :** Pas de KPI synthétiques, pas de phrase d'intro pédagogique, pas de texte de conclusion
- **Incohérence :** Le CTA dit "Définissez votre journée type" alors que le PDF est un document de vente figé — le client ne "définit" rien

---

## 3. Construction technique du graphique

### Composant utilisé

- **Pas de composant React** — le graphique est dessiné par `engine-p5.js` via `window.API_p5_drawChart(series)`
- **Zone cible :** `<svg id="p5-chart" viewBox="0 0 2000 560">` dans `#p5_chart_zone`
- **Librairie :** Aucune — SVG natif, paths générés en JavaScript

### Dataset

- **Entrée :** `payload` = `fullReport.p5` = `{ meta, production_kw, consommation_kw, batterie_kw }`
- **Transformation :** `mergeSeries()` fusionne les 3 tableaux 24h et calcule `auto = min(prod, conso)` pour chaque heure
- **Structure finale :** `[{ prod, conso, batt, auto }, ...]` × 24

### Séries affichées

| Série | Source | Couleur / gradient | Rendu |
|-------|--------|--------------------|-------|
| Consommation | `consommation_kw` | Bleu carbone (#3A4A72 → #1A2A4A) | Area + stroke |
| Autoconsommation | `min(prod, conso)` | Cyan (#00D0EA → #00A5C0) | Area + stroke |
| Production | `production_kw` | Or (#FFCE63 → #E2A93F) + glow | Area + stroke |
| Batterie | `batterie_kw` | Vert (#54F49B → #1FC166) | Area + stroke (si batt ≠ 0) |

### Échelles (OPTION A++)

- **Production :** scale = 1 (inchangé)
- **Consommation :** scale = 4 / maxConso (amplification pour visibilité)
- **Autoconsommation :** scale = scaleConso
- **Batterie :** scale = 2.5 / maxBatt

→ Les courbes sont **rééchelonnées** pour un rendu visuel équilibré. Les valeurs affichées ne correspondent pas aux valeurs réelles en kW.

### Axes

- **Axe X :** Heures 00:00 à 22:00 (pas de 2h), labels texte 13px
- **Axe Y :** Pas de labels numériques — uniquement une grille horizontale (5 lignes, rgba(0,0,0,.08))
- **Unité :** Aucune unité affichée sur les axes

### Labels / légende

- Légende en bas : Production solaire (kW), Consommation (Besoins instantanés), Autoconsommation (Utilisation directe), Batterie (charge/décharge)
- "Mois simulé : Annuel" — hardcodé dans `applyMeta()`, pas dynamique

### Logique technique

- **Spline :** Tension 0.10 (Catmull-Rom → Bézier) pour courbes lisses
- **Ordre de dessin :** conso (fond) → auto → prod → batt (avant-plan)
- **Fond SVG :** #f3f4f6 (gris clair)
- **Tooltips :** Aucun
- **Données réelles vs modélisées :** 100 % modélisées (formules sinus dans le mapper)

### Dépendances

- `document.querySelector` pour accéder au DOM
- `window.API_p5_drawChart` exposé globalement
- `Engine.on("p5:update", ...)` pour recevoir les données

---

## 4. Ce que raconte actuellement le graphique

### Message métier

- Profil horaire sur 24h d'une "journée type annuelle moyenne"
- Production PV : pic en milieu de journée (8h-17h), sinusoïdal
- Consommation : répartie sur 24h avec pic soirée (sinusoïdal décalé)
- Autoconsommation : intersection prod/conso
- Batterie : toujours 0 dans le mapper actuel (scénario BASE)

### Message client

- "Voici comment votre production et votre consommation se répartissent sur une journée type."
- Implicite : le client peut voir quand il produit, quand il consomme, quand il utilise directement.

### Ce que le client comprend

- Une courbe qui monte le jour (production)
- Une courbe de consommation
- Une zone cyan (autoconsommation) = ce qu'il utilise directement
- Que "ça varie dans la journée"

### Ce qu'il ne comprend probablement pas

- **Pourquoi 4 courbes superposées** — confusion visuelle
- **Les unités** — pas de légende d'axe Y, pas de valeurs en kW
- **Que c'est une modélisation** — "journée type annuelle moyenne" = abstraction
- **La formule min(PV, Conso)** — trop technique
- **Que les échelles sont artificielles** — scaleConso = 4/maxConso, etc.
- **"Mois simulé : Annuel"** — contradictoire (mois vs annuel)

### Graphique de projection utile ou trop technique ?

- **Trop technique** : 4 séries, échelles différentes, pas de KPI synthétiques, pas de message clair
- **Utilité limitée** : La forme générale (pic prod jour, conso étalée) est compréhensible, mais le détail noie le message
- **Aide à vendre ?** : Faible — ressemble à un outil d'ingénieur, pas à une projection "je me projette dans ma maison"

---

## 5. Analyse du wording actuel

### Titre

- **Badge :** "Impact photovoltaïque — journée type"
- **Titre graphique :** "Journée type — production, consommation et stockage"

→ Redondant. "Impact photovoltaïque" est vague. "Journée type" répété.

### Phrase d'introduction (encart CTA)

- "Définissez votre **journée type** heure par heure (mois simulé + production / consommation / batterie). L'autoconsommation est calculée automatiquement *(min(PV, Conso))*."

**Problèmes :**
- Parle à l'utilisateur comme à un opérateur d'outil ("Définissez")
- "heure par heure" = effort cognitif élevé
- "mois simulé" = confusion (le PDF affiche "Annuel")
- Formule mathématique *(min(PV, Conso))* = jargon ingénieur
- **Aucune projection client** — pas de "Voyons comment votre maison est alimentée"

### Libellés légende

- Production solaire — Puissance PV (kW)
- Consommation — Besoins instantanés
- Autoconsommation — Utilisation directe
- Batterie — charge / décharge

→ Corrects mais "Besoins instantanés" est un peu technique.

### Message principal actuel

**En une phrase :** "Voici un graphique technique qui montre la répartition horaire de la production, consommation et autoconsommation sur une journée type modélisée."

### Message secondaire

- Implicite : "Vous pouvez personnaliser cette journée" (CTA) — **faux** dans un PDF figé.

### Éléments parasites

- CTA "Définissez votre journée type" — inadapté au PDF commercial
- "✓ Validé" (opacity: 0, jamais visible) — vestige d'un mode édition
- Formule *(min(PV, Conso))* — trop technique
- "Mois simulé : Annuel" — incohérent

### Doublons

- "Journée type" dans badge + titre graphique
- "Production" / "Consommation" dans titre + légende

### Éléments qui cassent la projection client

- Le CTA oriente vers une action (saisir) au lieu d'une projection (imaginer)
- Pas de phrase du type "Voyons concrètement comment votre installation alimente votre maison"
- Le graphique ne met pas en avant les 3 messages cibles : production journée, autoconsommation, baisse réseau

---

## 6. Analyse UX / commerciale

### Projection client

- **Faible** — La page ne permet pas de se projeter dans "ma maison un jour d'été". Le graphique est abstrait (journée type annuelle moyenne).

### Journée type réelle ?

- **Non** — C'est une modélisation sinusoïdale, pas une journée concrète. Pas de "7h réveil, 12h midi, 19h soir".

### Trop analytique ?

- **Oui** — 4 courbes, pas de synthèse, pas de chiffres clés (kWh autoconsommés, % couverture, etc.).

### Trop abstraite ?

- **Oui** — "Journée type annuelle moyenne" = concept statistique, pas une journée vécue.

### Page d'étude technique vs projection concrète ?

- **Oui, étude technique** — Le CTA "Définissez votre journée type", la formule min(PV, Conso), l'absence de KPI orientent vers un outil métier.

### Trop d'informations ?

- **Oui** — 4 séries + légende + CTA + meta = charge cognitive élevée pour une page PDF commerciale.

### Effort cognitif ?

- **Élevé** — Le client doit décoder 4 courbes, comprendre les échelles, ignorer le CTA inadapté.

### Mémorisable ?

- **Non** — Pas de message unique, pas de chiffre choc, pas de phrase d'accroche.

### Renforce la vente après P3/P4 ?

- **Non** — P4 a été refaite pour être plus commerciale (synthèse, intro, KPI). P5 fait retomber la tension : retour au mode outil, complexité technique.

---

## 7. Analyse design / hiérarchie

### Hiérarchie visuelle

1. **Premier regard :** Le graphique (zone la plus grande, couleurs vives)
2. **Deuxième :** L'encart CTA (texte dense)
3. **Troisième :** Le header (badge, meta)
4. **Quatrième :** La légende

### Équilibre texte / data / graphique

- **Déséquilibré** — Beaucoup de graphique, peu de texte pédagogique, CTA inadapté. Pas de KPI pour ancrer le message.

### Respiration

- **Correcte** — Padding 6mm/11mm, gap 5mm. Pas de surcharge visuelle dans les marges.

### Densité

- **Élevée** — 4 courbes + zones remplies + grille + légende 4 items = dense.

### Lisibilité

- **Moyenne** — Les courbes sont distinctes (couleurs), mais les zones se superposent. Pas d'axe Y lisible.

### Cohérence avec P1/P2/P3/P4

- **Partielle** — Header et barre cohérents. Mais P4 a une intro, des KPI, un message commercial. P5 n'a rien de tout ça.

### Cohérence ADN SolarGlobe / premium / commercial

- **Insuffisante** — Le CTA "Définissez" et la formule min(PV, Conso) cassent le positionnement premium. Le graphique est soigné (gradients, splines) mais le message est "outil".

### Niveau de sophistication du graphique

- **Élevé** — Splines, gradients, glow, grille. Qualité technique correcte.

### Premium ou outil métier ?

- **Outil métier** — Le wording et l'absence de projection client dominent.

### Ce qui attire l'œil

- Le graphique (couleurs, taille)
- Le CTA (contraste texte)

### Ce qui n'est pas assez valorisé

- Les 3 messages cibles : production, autoconsommation, baisse réseau
- Un chiffre clé (ex. "X kWh autoconsommés par jour")

### Ce qui prend trop de place

- Le CTA (texte long, inadapté)
- Les 4 courbes (pourrait être simplifié à 3 messages visuels)

### À supprimer ou simplifier

- CTA "Définissez votre journée type"
- Formule min(PV, Conso)
- "Mois simulé : Annuel"
- Réduire à 3 courbes ou 3 zones narratives

---

## 8. Analyse technique de refactorabilité

### Simplicité / complexité

- **Architecture hybride** — React (structure) + engine JS (graphique). Plus complexe que P4 (tout React).

### Fragilité

- **Modérée** — Dépendance à `#p5-chart`, `#p5_chart_zone`, IDs fixes. Si le DOM change, l'engine casse.
- **Ordre de chargement** — engine-p5.js doit être chargé après engine-bridge, avant React.

### Facilité de refactor

- **Moyenne** — Pour passer en React pur (comme P4), il faudrait :
  1. Créer un ChartP5 React (ou ChartP5JourneeType) avec la logique engine-p5
  2. Supprimer engine-p5.js du chargement
  3. Passer viewModel à PdfPage5
  4. Supprimer bindEngineP5

### Zones couplées

- **Graphique ↔ engine** — La logique de dessin (splines, gradients, échelles) est dans engine-p5.js. Couplage fort.
- **Données ↔ mapper** — p5Prod, p5Conso, p5Batt sont calculés dans pdfViewModel.mapper.js. Pas de scenarios_v2.energy.hourly — tout est modélisé.

### Hardcodes gênants

- `$('#p5_month').textContent = "Annuel"` — toujours "Annuel"
- scaleConso = 4 / maxConso, scaleBatt = 2.5 / maxBatt — magie
- PAD_L=70, PAD_R=50, PAD_T=25, PAD_B=70 — dimensions fixes
- W=2000, H=560 — viewBox fixe

### Conditions / fallbacks

- Batterie : si `series.some(s => s.batt !== 0)` → affiche légende batterie, sinon masque
- `#p5_chart_zone` : `display: none` par défaut, `display: block` après hydrate
- Données vides : `buildEmptyFullReport()` → p5 avec empty24

### Contenu texte imbriqué

- **Oui** — Titre, CTA, légende sont dans PdfPage5.tsx en dur. Pas de props, pas de i18n.

---

## 9. Compatibilité avec la future P5 simplifiée

### Objectif futur rappelé

- Projection usage réel
- 3 messages max : production journée, autoconsommation, baisse réseau
- "Je me projette dans ma maison"
- Intro : "Voyons maintenant concrètement comment cette installation produit et alimente votre maison au quotidien."

### Ce qui est déjà compatible

- **Structure header** — Logo, badge, meta réutilisables
- **Barre dorée** — Conservable
- **Données de base** — production_kw, consommation_kw existent ; autoconsommation = min(prod, conso) — réutilisable
- **Légende partielle** — Production, Consommation, Autoconsommation peuvent être conservées (simplifiées)

### Ce qui est incompatible

- **CTA "Définissez votre journée type"** — À supprimer
- **Formule min(PV, Conso)** — À supprimer
- **4 courbes** — Réduire à 3 messages visuels
- **"Mois simulé : Annuel"** — À supprimer ou remplacer
- **Message "outil"** — À remplacer par message "projection"

### Ce qui devra disparaître

- Encart CTA entier
- "✓ Validé" (déjà invisible)
- Batterie (si scénario BASE, toujours 0 — ou garder conditionnel)

### Ce qui pourrait être conservé sous forme simplifiée

- **Graphique** — Réduire à 3 zones/courbes : Production, Autoconsommation, Réseau (ou Consommation réseau)
- **Légende** — 3 items au lieu de 4
- **Mise en page** — Header, barre, zone graphique

### Graphique : simplifier ou repenser ?

- **Repenser** — Le graphique actuel est trop technique (4 courbes, échelles artificielles, pas d'axe Y). Il faut :
  - Soit simplifier à 3 courbes/zones avec message clair
  - Soit repenser en "journée type narrative" (ex. 3 blocs : matin, midi, soir)

### Message actuel récupérable ?

- **Non** — Le message actuel est "outil de saisie". Le nouveau message "projection quotidienne" doit être réécrit de zéro.

---

## 10. Verdict net

1. **Ce que P5 fait bien :** Graphique visuellement soigné (splines, gradients), structure header cohérente, données de base (prod, conso, auto) disponibles.

2. **Ce qu'elle fait mal :** CTA "Définissez votre journée type" inadapté au PDF commercial, 4 courbes trop techniques, pas de KPI, pas de phrase d'intro, message "outil" au lieu de "projection".

3. **Pourquoi elle doit être simplifiée :** Elle casse la tension commerciale après P4, demande trop d'effort cognitif, ne permet pas au client de se projeter.

4. **Graphique :** Doit être **repensé** — simplifier à 3 messages (production, autoconsommation, baisse réseau), ajouter des KPI synthétiques, supprimer l'artifice des échelles.

5. **Direction exacte future P5 :** Page "journée type simplifiée" avec intro "Voyons maintenant concrètement comment cette installation produit et alimente votre maison au quotidien", graphique 3 messages, KPI (kWh autoconsommés, % couverture), suppression totale du CTA et de la formule technique.

---

*Audit réalisé sans modification de code. Exploitable pour le prompt de refonte P5.*
