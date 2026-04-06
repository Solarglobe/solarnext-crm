# AUDIT PRODUIT FINAL — CALPINAGE SOLARNEXT (VERSION PREMIUM VENDABLE)

**Date :** 17 février 2025  
**Mode :** ANALYSE UNIQUEMENT — Aucune modification, aucun fix, aucune implémentation  
**Objectif :** Transformer le calpinage en outil fluide, intuitif, professionnel, rassurant et commercialement vendable

---

## PARTIE 1 — PARCOURS UTILISATEUR COMPLET

### Phase 1 — Carte (avant capture)

| Aspect | Analyse |
|--------|---------|
| **Ce que l'utilisateur comprend** | Une carte satellite s'affiche. Le bouton "Capturer la toiture" est visible. La source cartographique (Géoportail / Google) est choisissable. |
| **Ce qu'il ne comprend pas** | Pourquoi choisir une source ? Quelle différence concrète ? Où placer le repère maison ? Faut-il zoomer avant de capturer ? L'échelle et le Nord sont "automatiques" — mais à quel moment exactement ? |
| **Points de friction** | Le select "Source cartographique" est en Zone A (sidebar) alors que l'action principale (capture) est en Zone B. L'utilisateur peut ne pas voir le select s'il scroll. |
| **Points d'hésitation** | "Cadrez la carte (zoom, orientation, centre), puis capturez" — l'utilisateur ne sait pas s'il doit centrer sur la maison, sur le toit, ou sur la parcelle. Pas de repère visuel "maison" explicite. |
| **Actions inutiles** | Changer de source sans raison (souvent par curiosité) peut provoquer un rechargement inutile. |
| **États ambigus** | Pas d'indication "prêt à capturer" vs "en cours de chargement". |
| **Charge cognitive** | Faible pour l'action, mais élevée pour la compréhension : "qu'est-ce que je dois faire exactement ?" |
| **Clics nécessaires** | 1 clic (Capturer) — correct. Mais 0 clic pour comprendre le flux. |
| **Temps avant première action utile** | Immédiat si l'utilisateur sait quoi faire. Sinon : hésitation, zoom/pan tâtonnant, puis capture. |

**Moments de doute :** "Ai-je bien cadré ?", "L'échelle sera-t-elle correcte ?", "Dois-je capturer tout le toit ou la parcelle ?"

**Ruptures de fluidité :** Passage carte → capture → canvas sans transition visuelle claire. L'utilisateur peut être surpris par le changement brutal de contexte (carte → image figée).

---

### Capture

| Aspect | Analyse |
|--------|---------|
| **Ce que l'utilisateur comprend** | Un clic sur "Capturer la toiture" déclenche une action. |
| **Ce qu'il ne comprend pas** | Que la capture utilise html2canvas sur le viewport — donc ce qui est visible à l'écran. Pas de feedback pendant la capture (spinner, overlay). |
| **Points de friction** | Aucun indicateur de progression. Si la capture est lente (réseau, tuiles), l'utilisateur peut recliquer ou penser que ça a planté. |
| **Points d'hésitation** | Après la capture : l'interface change (carte → canvas). La toolbar Phase 2 apparaît. Beaucoup d'outils d'un coup. |
| **Actions inutiles** | — |
| **États ambigus** | "Capture : effectuée" vs "Capture : non effectuée" — texte informatif mais pas d'état visuel fort (icône, couleur). |
| **Charge cognitive** | Pic au moment du basculement : 8+ outils visibles (Sélection, Dessin toiture, Éditer hauteurs, Obstacle toiture, Obstacle ombrant, Extension toiture). |
| **Clics nécessaires** | 1. |
| **Temps avant première action utile** | Après capture : l'utilisateur doit choisir un outil. Pas de guidage vers "Contour bâti" en premier. |

**Moments de complexité inutile :** La toolbar Phase 2 affiche tout en même temps. Un débutant ne sait pas par où commencer (contour → faîtage → pans implicites).

---

### Phase 2 — Relevé toiture

| Aspect | Analyse |
|--------|---------|
| **Ce que l'utilisateur comprend** | "Dessinez le toit réel : contour, faîtages, obstacles et mesures." Le titre est clair. |
| **Ce qu'il ne comprend pas** | L'ordre des actions : contour d'abord, puis faîtage pour créer les pans. "Contour bâti" vs "Arête" vs "Faîtage" — différence métier peu évidente. "Obstacle toiture" vs "Obstacle ombrant" vs "Extension toiture" — trois concepts proches, confusion possible. |
| **Points de friction** | Dropdown "Dessin toiture" : 4 options (Contour, Arête, Faîtage, Mesure). L'utilisateur doit ouvrir le dropdown, choisir, puis dessiner. Pas de raccourci clavier. Snap faîtage : peu de feedback visuel (preview magnétique) — l'utilisateur ne sait pas s'il a bien snapé. |
| **Points d'hésitation** | "Valider le relevé toiture" est désactivé tant que contour + au moins un pan. L'utilisateur peut ne pas comprendre pourquoi (message "Contour bâti et au moins un pan requis" — mais "pan" n'est pas défini avant validation du contour). |
| **Actions inutiles** | Éditer les hauteurs : bloc visible uniquement après sélection d'un élément. Peu d'utilisateurs savent que ce mode existe. Obstacle ombrant, Extension toiture : fonctionnalités avancées peu utilisées, mais visibles. |
| **États ambigus** | Quel outil est actif ? `.calpinage-tool-active` et `aria-pressed` existent mais le contraste visuel est faible (bleu indigo #eef2ff). Mode "Sélection" vs mode "Dessin" : pas de distinction forte. |
| **Charge cognitive** | Très élevée. 6 groupes d'outils (Sélection, Dessin toiture avec 4 sous-outils, Éditer hauteurs, Obstacle toiture avec 4 formes, Obstacle ombrant avec 2 formes, Extension toiture avec 3 sous-outils). |
| **Clics nécessaires** | Contour : 1 clic pour activer + N clics pour dessiner. Faîtage : idem. Valider : 1 clic. Total minimal : ~10–20 clics pour un toit simple. |
| **Temps avant première action utile** | Variable. Si guidé : 1 clic (Contour bâti). Sinon : exploration des dropdowns. |

**Moments de doute :** "Ai-je bien fermé le contour ?", "Le faîtage snap-t-il au bord ?", "C'est quoi un obstacle ombrant ?"

**Ruptures de fluidité :** Passage Phase 2 → Phase 3 (Valider le relevé) : la sidebar change complètement. La toolbar Phase 2 disparaît, remplacée par la toolbar Phase 3 dans la sidebar. Discontinuité forte.

---

### Phase 3 — Pose panneaux

| Aspect | Analyse |
|--------|---------|
| **Ce que l'utilisateur comprend** | "Implantation des modules". Deux boutons : "Ajouter panneaux" et "Sélectionner". |
| **Ce qu'il ne comprend pas** | Il faut d'abord ouvrir "Paramètres calpinage" pour choisir panneau + onduleur. Ces paramètres sont dans un modal overlay, pas dans la sidebar visible. L'ordre implicite : Paramètres → Panneau → Onduleur → Cliquer sur un pan pour poser. Pas de wizard. |
| **Points de friction** | "Paramètres calpinage" ouvre un modal avec tout (panneau, onduleur, orientation, marges, espacements). Beaucoup d'options. "Valider le calepinage" est désactivé si panneau non choisi, 0 panneaux posés, ou pas d'onduleur — mais le message n'est pas toujours explicite (alert générique). |
| **Points d'hésitation** | "Cliquez sur un pan pour ajouter un bloc" — le hint apparaît mais l'utilisateur peut ne pas savoir quel pan (les pans sont dans l'accordéon, pas visuellement mis en évidence sur le canvas). |
| **Actions inutiles** | Bouton "Masque d'horizon" (display:none) — mort. Champ "Recherche (à venir)" — placeholder inutile. |
| **États ambigus** | Mode "Ajouter panneaux" vs "Sélectionner" : différence peu visible. Sélection d'un bloc : poignées rotation/déplacement — pas de feedback "bloc sélectionné" fort. Suppression : uniquement clavier (Suppr/Backspace) — pas de bouton UI. |
| **Charge cognitive** | Élevée. Paramètres dans un modal. Règles d'implantation (marges, espacements) en cm — l'installateur pense peut-être en mm ou en panneaux. |
| **Clics nécessaires** | Paramètres : 1. Choisir panneau : 1. Choisir onduleur : 1. Fermer modal : 1. Clic sur pan : 1. Valider : 1. Minimum ~6 clics. Avec ajustements : 10+. |
| **Temps avant première action utile** | Long. L'utilisateur doit ouvrir les paramètres, configurer, fermer, puis cliquer sur le canvas. |

**Moments de doute :** "Où sont les paramètres ?", "Pourquoi je ne peux pas valider ?", "Comment supprimer un bloc ?" (Suppr pas évident).

**Ruptures de fluidité :** Toolbar Phase 3 dans la sidebar, pas au-dessus du plan. Le workspace (canvas) et les outils sont séparés. En Phase 2, la toolbar était au-dessus du plan (Zone B) — cohérence perdue.

---

### Validation

| Aspect | Analyse |
|--------|---------|
| **Ce que l'utilisateur comprend** | "Valider le calepinage" enregistre et ferme. |
| **Ce qu'il ne comprend pas** | Que la validation déclenche un calcul d'ombrage (horizon, near/far). Pas de feedback pendant le calcul. En cas d'erreur : try/catch silencieux (legacy) ou toast (CRM). |
| **Points de friction** | Si erreur API : toast rouge. Pas de retry explicite. Si données invalides : alert() — style ancien. |
| **Points d'hésitation** | "Retour au relevé toiture" invalide les panneaux posés. Pas de confirmation. Risque de perte de travail. |
| **Actions inutiles** | — |
| **États ambigus** | Succès : toast vert "Calpinage enregistré", overlay se ferme. Pas de récapitulatif (nb panneaux, puissance) avant fermeture. |
| **Charge cognitive** | Faible au moment du clic. |
| **Clics nécessaires** | 1. |

**Résumé parcours :**

| Phase | Compréhension | Friction | Hésitation | Charge cognitive | Clics min |
|-------|---------------|----------|------------|------------------|-----------|
| 1 Carte | Moyenne | Faible | Élevée | Moyenne | 1 |
| Capture | Bonne | Moyenne (pas de feedback) | Moyenne | Faible | 1 |
| 2 Relevé | Faible | Élevée | Élevée | Très élevée | 10–20 |
| 3 Pose | Faible | Élevée | Élevée | Élevée | 6+ |
| Validation | Bonne | Moyenne | Faible | Faible | 1 |

---

## PARTIE 2 — ERGONOMIE PROFESSIONNELLE

### Snap faîtage

| Aspect | Détail |
|--------|--------|
| **Logique** | `snapToRoofContour`, `snapToAllRoofEdges`, `snapToRoofContourEdge`. Tolérances : VERTEX_SNAP_DIST_PX=12, EDGE_SNAP_DIST_PX=12. |
| **Perception** | Snap discret. Pas de preview magnétique visible. L'utilisateur ne sait pas si le point a snapé ou non. |
| **Zoom** | Tolérance adaptée au viewport (vpScale). Comportement correct. |
| **Verdict** | **Utilisable** par un installateur formé. **Pas fluide** pour un débutant — manque de feedback. |

### Snap contour

| Aspect | Détail |
|--------|--------|
| **Logique** | Snap aux sommets et arêtes du contour existant. |
| **Perception** | Idem faîtage — peu de feedback visuel. |
| **Verdict** | Cohérent avec le faîtage. Magnétisme peu perceptible. |

### Rotation obstacles

| Forme | Handles | Rotation | Utilisable ? |
|-------|---------|----------|--------------|
| Rectangle | Coins + poignée rotation | Oui | Oui |
| Cercle | Rayon uniquement | Non (invariant) | Oui |
| Polygone | Aucun | Non | Limité — pas d'édition |

**Conflit possible :** Pan/zoom vs handles si priorité mal gérée. L'audit technique indique une priorité correcte (handles avant pan).

### Placement panneaux

| Aspect | Détail |
|--------|--------|
| **Workflow** | Clic sur pan → bloc créé avec paramètres par défaut. Déplacement/rotation via poignées. |
| **Feedback** | Message "Bloc de panneaux validé" (pv-layout-feedback). Erreur placement : pv-layout-error (rouge). |
| **Verdict** | Logique métier solide. Interface : paramètres cachés dans modal, pas de guidage. |

### Sélection blocs

| Aspect | Détail |
|--------|--------|
| **Mode** | Bouton "Sélectionner" active le mode. Clic sur bloc = sélection. |
| **Suppression** | Suppr/Backspace uniquement. Pas de bouton "Supprimer" dans l'UI. |
| **Verdict** | **Non intuitif** pour un utilisateur non technique. Raccourci clavier caché. |

### Modes outils (ambiguïtés)

| Conflit | Détail |
|---------|--------|
| Phase 2 : plusieurs outils | Un seul actif à la fois (drawState.activeTool). Mais les dropdowns (Dessin toiture, Obstacle) gardent un état "ouvert" qui peut prêter à confusion. |
| Phase 3 : panels vs select | Deux modes exclusifs. Sync correcte via syncPhase3ToolbarActiveTool. |
| Phase 2 vs Phase 3 | Bascule nette. Mais "Retour au relevé" réinitialise les panneaux — pas de confirmation. |

### Feedback visuel

| Élément | État actuel | Attendu premium |
|---------|-------------|-----------------|
| Snap | Aucun | Preview magnétique (cercle, ligne guide) |
| Outil actif | Bleu indigo discret | Contraste fort, icône soulignée |
| Sélection bloc | Poignées | Bordure colorée, infobulle |
| Capture | Aucun | Spinner ou overlay "Capture en cours..." |
| Validation | Toast | Toast + récap avant fermeture |
| Erreur | Alert / toast | Message contextuel, suggestion de correction |

### Magnétisme perceptible ou non

**Non.** Les tolérances de snap sont techniques (12–18 px) mais aucun feedback visuel ne les rend perceptibles. Un outil pro (Reonic, PVsyst, Solargis) affiche typiquement une prévisualisation du snap (cercle, ligne en pointillés, highlight du point cible).

### Logique métier vs interface

| Logique métier | Interface | Écart |
|----------------|-----------|-------|
| Contour → Pans (par faîtage) | Contour bâti, Arête, Faîtage séparés | L'utilisateur ne voit pas le lien. Pas de "Étape 1, 2, 3". |
| Panneau + Onduleur requis | Paramètres dans modal | Caché. Pas de checklist "Panneau ✓ Onduleur ✓". |
| Bloc = pan + orientation + marges | Bloc créé au clic | Les paramètres sont globaux, pas par bloc. Comportement correct mais peu explicite. |

### Réponses synthétiques

| Question | Réponse |
|----------|---------|
| **Utilisable par un installateur non formé ?** | **Non.** Trop de concepts (contour, faîtage, pans, obstacles, volumes ombrants, extensions). Formation ou tutoriel requis. |
| **Fluide ?** | **Partiellement.** Capture et validation sont fluides. Phase 2 et 3 sont saccadées (dropdowns, modal, changements de contexte). |
| **Cohérent ?** | **Moyennement.** Phase 2 : toolbar au-dessus du plan. Phase 3 : toolbar dans la sidebar. Incohérence de placement. |
| **Où est la complexité cachée ?** | Dans les dropdowns (Dessin toiture, Obstacle toiture, Obstacle ombrant, Extension toiture). Dans le modal Paramètres. Dans le raccourci Suppr pour supprimer un bloc. |

---

## PARTIE 3 — AUDIT VISUEL PREMIUM

### Hiérarchie visuelle

| Élément | État | Problème |
|---------|------|----------|
| Titres phase | Corrects (18px, bold) | — |
| Bouton Valider | Gradient brand, visible | Pas de hiérarchie claire vs "Paramètres" (secondaire) |
| Toolbar Phase 2 | Compacte, nombreux boutons | Pas de regroupement visuel (primaire vs avancé) |
| Zone A | Dense | Blocs state-block empilés sans respiration. Titres UPPERCASE (state-title) — lourds. |
| Zone B | Correcte | Bouton capture bien mis en avant. |

### Densité

| Zone | Densité | Verdict |
|------|---------|---------|
| Sidebar (Zone A) | Très élevée | Surcharge cognitive. Tout visible en même temps. |
| Toolbar Phase 2 | Élevée | 6 groupes, dropdowns. |
| Workspace (Zone C) | Correcte | Canvas épuré. |
| Modal Paramètres | Élevée | Beaucoup de champs. |

### Sidebar

| Aspect | Détail |
|--------|--------|
| Largeur | 280px fixe. |
| Contenu Phase 2 | Titre, description, Valider relevé, Source carte, État (3 items), Pans (liste/accordéon), Édition hauteur (caché). |
| Contenu Phase 3 | Titre, description, Toolbar (Ajouter/Sélectionner), Paramètres, Valider, Retour. + Paramètres dans modal. |
| Problème | Pas de structure "étapes". Tout au même niveau. Pas d'accordéon pour réduire les sections secondaires. |

### Workspace

| Aspect | Détail |
|--------|--------|
| Zone C | Carte ou canvas en plein écran. Correct. |
| Overlays | Boussole (Nord), messages feedback/erreur. Overlays obstacle (dimensions) en position fixe. |
| Problème | Pas de grille, pas de règles. Pas d'échelle visuelle sur le canvas. |

### Espaces négatifs

| Zone | État |
|------|------|
| Entre state-blocks | 16px (padding-top, border-top). Correct mais serré. |
| Entre boutons toolbar | 6px. Très serré. |
| Dans le modal | 24px padding. Correct. |
| Entre phase-title et phase-desc | 8px. Correct. |

### Cohérence boutons

| Type | Style | Cohérence |
|------|-------|-----------|
| Valider relevé | Gradient brand, plein | ✓ |
| Capturer | Gradient doré, pill | ✓ |
| Valider calpinage | Brand, plein | ✓ |
| Paramètres | Bordure, bg-soft | ✓ |
| Tool buttons | Gris #f9fafb, bordure #d1d5db | ✓ |
| Tool active | Bleu indigo #eef2ff | ⚠ Différent du brand (doré) |
| Retour | Bordure, bg-soft | ✓ |

**Problème :** Les outils actifs utilisent du bleu indigo alors que le reste de l'UI est doré/marron. Rupture de cohérence chromatique.

### Emojis (à bannir ?)

| Emoji | Usage | Verdict |
|-------|-------|---------|
| 📏 | Échelle | **À remplacer** par icône design system. |
| 🧭 | Nord | **À remplacer** par icône design system. |
| 📸 | Capture | **À remplacer** par icône design system. |
| ⊕ | Ajouter panneaux | Symbole Unicode, pas emoji. Acceptable mais peu professionnel. |

**Recommandation :** Bannir les emojis. Utiliser un jeu d'icônes cohérent (Lucide, Heroicons, ou custom SVG).

### Cohérence icônes

| Élément | Icône | Style |
|---------|-------|-------|
| État | Emojis | Incohérent |
| Dessin toiture | ▢, ─, ⟁, ↔ | Unicode |
| Obstacle | ◼, ▣, ●, ▭, ⬡ | Unicode |
| Obstacle ombrant | ◻, ▢, ○ | Unicode |
| Extension | ⌂ | Unicode |

**Problème :** Mélange emojis + symboles Unicode. Pas de design system. Tailles variables. Pas de cohérence de style (filled vs outline).

### États actifs

| Élément | Indication | Visibilité |
|---------|------------|------------|
| Tool actif | `.calpinage-tool-active`, `aria-pressed` | Faible — bleu discret |
| Pan sélectionné | `.pan-selected` | Correct — brand-soft |
| Orientation PV | `aria-pressed="true"` | Correct — gradient |
| Bloc sélectionné | Poignées | Pas de bordure/highlight fort |

### Micro-interactions

| Interaction | Présente | Qualité |
|-------------|----------|---------|
| Hover boutons | Oui | Standard |
| Clic feedback | Non | Pas d'effet ripple ou scale |
| Transition toolbar | Non | Bascule brutale (before/after capture) |
| Transition Phase 2→3 | Non | Sidebar change instantanément |
| Loading capture | Non | Aucun |
| Toast | Oui (CRM) | Créé via document.body, hors design system |

### Transitions

| Contexte | Transition | Verdict |
|----------|------------|---------|
| CSS | `--transition-fast: 150ms`, `--transition-med: 220ms` | Définies mais peu utilisées pour les changements de phase |
| Capture → Canvas | Aucune | Bascule brutale |
| Phase 2 → Phase 3 | Aucune | Changement instantané |
| Ouverture modal | Aucune (ou implicite) | Pas de fade-in/out visible |

### Impression "outil bricolé" vs "outil professionnel"

| Ce qui fait amateur | Ce qui casse la crédibilité | Ce qui empêche "wow pro" |
|--------------------|----------------------------|---------------------------|
| Emojis dans l'UI | Mélange emojis + symboles | Pas de polish (micro-interactions) |
| Toast via document.body | Paramètres dans overlay modal séparé | Transitions brusques |
| Pas de loading skeleton | Bloc "État" toujours visible avec infos redondantes | Pas de feedback snap |
| Messages erreur en div injectés | Interface chargée, peu rassurante | Densité sidebar excessive |
| "Recherche (à venir)" disabled | Bouton "Masque d'horizon" caché/mort | Pas de guidage (wizard, étapes) |
| Style tool active (bleu) ≠ brand (doré) | Nombreux blocs state-block sans regroupement | Pas de récap avant validation |

**Comparaison CRM SolarNext (image fournie) :** La page de connexion CRM est épurée, professionnelle, cohérente (violet/jaune). Le calpinage utilise un thème doré/marron différent, avec des emojis et une densité qui ne correspondent pas à cette identité premium.

---

## PARTIE 4 — SIMPLIFICATION RADICALE

### À supprimer

| Élément | Justification |
|---------|---------------|
| Emojis (📏, 🧭, 📸) | Remplacer par icônes design system |
| Champ "Recherche (à venir)" | Placeholder mort, crée de la confusion |
| Bouton "Masque d'horizon" (si non utilisé) | Caché, mort — supprimer ou activer |
| Bloc "État" (Échelle, Nord, Capture) en lecture seule permanente | Redondant. Afficher uniquement si pertinent (ex. après capture : "Échelle : 1 cm = X m") |
| Option "Sélectionner / modifier" dans dropdown Obstacle | Fusionner avec outil Sélection ou clarifier |

### À fusionner

| Éléments | Fusion proposée |
|----------|-----------------|
| "Obstacle toiture" + "Obstacle ombrant" | Un seul menu "Obstacles" avec onglets ou sections : Toiture (cercle, rect, polygone) | Ombrant (cube, tube) |
| "Dessin toiture" (4 options) | Garder les 4 mais les présenter comme étapes : 1. Contour 2. Faîtage 3. Arêtes (optionnel) 4. Mesure (optionnel) |
| "Paramètres calpinage" + contenu sidebar Phase 3 | Intégrer panneau/onduleur dans la sidebar, garder le modal pour marges/espacements avancés uniquement |

### À déplacer

| Élément | Destination |
|---------|-------------|
| Source cartographique | Zone B (près du bouton Capture) ou dans un menu "Options" discret |
| Toolbar Phase 3 | Au-dessus du plan (Zone B), comme Phase 2 — cohérence |
| Bouton "Valider le calepinage" | Toujours visible en bas de sidebar ou en barre fixe — pas noyé dans le flux |
| Bouton "Retour au relevé" | En bas, avec confirmation modale avant action |

### À cacher

| Élément | Condition d'affichage |
|---------|----------------------|
| "Éditer les hauteurs" | Uniquement quand un contour/faîtage/trait est sélectionné |
| "Obstacle ombrant", "Extension toiture" | Section "Avancé" repliable, ou 2e niveau du menu Obstacles |
| Paramètres avancés (marges, espacements) | Dans le modal, section "Avancé" repliable |
| Liste pans (détail) | Accordéon fermé par défaut, ou afficher uniquement le pan sélectionné |

### À rendre contextuel

| Contexte | Affichage |
|----------|-----------|
| Avant capture | Uniquement : Carte, Source, Capturer. Masquer État détaillé, Pans. |
| Après capture, avant contour | Afficher "Étape 1 : Dessinez le contour du toit" + outil Contour mis en avant |
| Après contour, avant faîtage | "Étape 2 : Ajoutez les faîtages pour définir les pans" |
| Phase 3, avant panneau choisi | "Choisissez un panneau et un onduleur pour commencer" — bloquer le reste |
| Bloc sélectionné | Afficher bouton "Supprimer" dans la sidebar ou barre d'outils contextuelle |

### À automatiser

| Action | Automatisation proposée |
|--------|-------------------------|
| Ordre des outils Phase 2 | Wizard : après contour validé, proposer automatiquement "Ajouter un faîtage ?" |
| Choix panneau/onduleur | Si un seul panneau dans le catalogue pour l'étude : sélection par défaut |
| Snap | Feedback visuel automatique (preview) sans action utilisateur |
| Validation | Pré-validation : vérifier les erreurs avant le clic, afficher un récap (nb panneaux, puissance) |

**Objectif :** Réduire la complexité visible (nombre d'options affichées, étapes implicites) sans réduire la puissance réelle (toutes les fonctionnalités restent accessibles, mais mieux organisées).

---

## PARTIE 5 — VERSION CIBLE VENDABLE

### Structure idéale Phase 1 → 2 → 3

```
PHASE 1 — Carte
├── Carte satellite (Google / Géoportail)
├── Bouton "Capturer" (unique CTA)
├── Option "Source" en discret (icône engrenage ou lien)
└── Message : "Cadrez la toiture puis cliquez sur Capturer"

CAPTURE
├── Overlay "Capture en cours..." (spinner)
├── Transition fluide vers canvas
└── Message : "Étape 1 : Dessinez le contour du toit"

PHASE 2 — Relevé (wizard implicite)
├── Étape 1 : Contour bâti (outil unique mis en avant)
├── Étape 2 : Faîtages (proposé après contour)
├── Étape 3 : Obstacles (optionnel, section repliable)
├── Étape 4 : Mesures (optionnel)
├── Bouton "Valider le relevé" (activé quand contour + ≥1 pan)
└── Toolbar au-dessus du plan, outils secondaires en dropdown

PHASE 3 — Pose
├── Sidebar : Panneau, Onduleur (visibles, pas dans modal)
├── Toolbar au-dessus du plan : Ajouter | Sélectionner
├── Paramètres avancés (marges, espacements) en modal ou section repliable
├── Bouton "Valider le calepinage" (toujours visible)
├── Récap avant validation : "X panneaux, Y kWc — Enregistrer ?"
└── Bouton "Supprimer" visible quand bloc sélectionné
```

### Organisation idéale sidebar

```
SIDEBAR — Largeur 260–300px

Phase 2 :
├── [Titre] Relevé toiture
├── [Étape courante] Étape 1/3 : Contour
├── [Bouton] Valider le relevé (ou désactivé + raison)
├── [Section repliable] Pans (accordéon)
├── [Section repliable] Options (source carte, etc.)
└── [Lien] Aide

Phase 3 :
├── [Titre] Implantation
├── [Select] Panneau
├── [Select] Onduleur
├── [Résumé] X panneaux, Y kWc
├── [Bouton] Paramètres avancés (ouvre modal)
├── [Bouton] Valider le calepinage
└── [Bouton] Retour au relevé (avec confirmation)
```

### Outils prioritaires

| Priorité | Outil | Visibilité |
|----------|-------|------------|
| P0 | Contour bâti | Toujours visible, mis en avant en étape 1 |
| P0 | Faîtage | Toujours visible, mis en avant en étape 2 |
| P0 | Capturer, Valider relevé, Valider calpinage | Toujours visibles |
| P1 | Obstacle toiture (cercle, rect, polygone) | Dropdown ou section "Obstacles" |
| P1 | Sélection, Ajouter panneaux, Sélectionner | Toujours visibles |
| P2 | Arête, Mesure | Dans "Dessin avancé" |
| P2 | Obstacle ombrant, Extension toiture | Dans "Avancé" |
| P2 | Éditer hauteurs | Contextuel (à la sélection) |

### Logique de validation

| Étape | Prérequis | Message si échec |
|-------|-----------|------------------|
| Valider relevé | Contour fermé + ≥1 pan | "Dessinez un contour fermé et au moins un faîtage pour créer les pans." |
| Valider calpinage | Panneau + Onduleur + ≥1 bloc | "Choisissez un panneau, un onduleur et posez au moins un bloc de panneaux." |
| Récap avant enregistrement | — | Modal ou toast : "12 panneaux, 5.82 kWc. Enregistrer ?" [Oui] [Non] |

### Feedback visuel premium

| Moment | Feedback |
|--------|----------|
| Snap | Cercle ou croix au point de snap, ligne en pointillés vers le bord |
| Outil actif | Bordure brand (doré), fond brand-soft, icône pleine |
| Sélection bloc | Bordure 2px brand, ombre légère, infobulle "Déplacer / Suppr pour supprimer" |
| Capture | Overlay semi-transparent + spinner + "Capture en cours..." |
| Validation | Spinner + "Calcul de l'ombrage..." puis "Enregistrement..." |
| Succès | Toast design system + récap (X panneaux, Y kWc) |
| Erreur | Message contextuel + suggestion ("Vérifiez votre connexion", "Choisissez un panneau") |

### États propres

| État | Représentation |
|------|----------------|
| `currentPhase` | ROOF_EDIT | PV_LAYOUT — une seule source de vérité |
| `activeTool` | Un seul à la fois. Désactivation explicite des autres. |
| `selectedBlockId` | Null ou ID. Sidebar et canvas synchronisés. |
| `drawState.*` | Reset à chaque changement de phase ou de tool. |

### UX fluide

| Principe | Application |
|----------|-------------|
| **Progressive disclosure** | Montrer l'essentiel. Avancé en sections repliables. |
| **Contextualité** | Outils et messages selon l'étape courante. |
| **Feedback immédiat** | Chaque action a une réponse visuelle (snap, sélection, validation). |
| **Cohérence** | Même placement toolbar (Zone B) en Phase 2 et 3. Même palette (brand doré). |
| **Récupération d'erreur** | Messages clairs. Actions correctives suggérées. Pas d'alert() brut. |
| **Confirmation des actions destructives** | "Retour au relevé" → "Les panneaux posés seront supprimés. Continuer ?" |

### Blueprint final — Calpinage SolarNext vendable

Pour être commercialement crédible face à Reonic, PVsyst, Solargis :

1. **Identité visuelle** : Aligner sur le CRM (violet/jaune ou thème cohérent). Supprimer emojis. Design system icônes.
2. **Parcours guidé** : Wizard implicite (Étape 1, 2, 3). Pas de découverte par essai-erreur.
3. **Feedback pro** : Snap visible. États actifs marqués. Transitions douces. Loading states.
4. **Simplicité apparente** : Sidebar épurée. Outils avancés cachés. Paramètres essentiels (panneau, onduleur) visibles.
5. **Robustesse** : Gestion d'erreurs explicite. Pas de try/catch silencieux. Toasts intégrés au design system.
6. **Cohérence** : Toolbar toujours au même endroit. Boutons primaires/secondaires distincts. Pas de mélange bleu/doré.
7. **Récap et confiance** : Avant validation, afficher un récap. Après succès, confirmer (toast + fermeture).
8. **Documentation intégrée** : Lien "Aide" ou tooltips sur les concepts (contour, faîtage, pan, obstacle).

---

## PARTIE 6 — PLAN D'ÉVOLUTION PRODUIT

### Ordre de refonte recommandé

| Phase | Périmètre | Priorité | Effort | Impact |
|-------|-----------|----------|--------|--------|
| **P0** | Supprimer emojis, remplacer par icônes | Critique | Faible | Crédibilité visuelle |
| **P0** | Ajouter feedback capture (spinner) | Critique | Faible | Rassurance |
| **P0** | Corriger try/catch silencieux validation | Critique | Faible | Fiabilité |
| **P1** | Réorganiser sidebar Phase 2 (étapes, repli) | Haute | Moyen | Charge cognitive |
| **P1** | Déplacer toolbar Phase 3 au-dessus du plan | Haute | Moyen | Cohérence |
| **P1** | Intégrer panneau/onduleur dans sidebar (hors modal) | Haute | Moyen | Parcours |
| **P1** | Ajouter bouton Supprimer (bloc sélectionné) | Haute | Faible | Découvrabilité |
| **P2** | Feedback visuel snap (preview) | Moyenne | Élevé | Fluidité pro |
| **P2** | Wizard implicite (Étape 1, 2, 3) | Moyenne | Élevé | Parcours |
| **P2** | Fusionner Obstacle toiture + ombrant | Moyenne | Moyen | Simplification |
| **P2** | Récap avant validation | Moyenne | Faible | Confiance |
| **P3** | Cacher État (échelle, nord, capture) ou le rendre contextuel | Basse | Faible | Densité |
| **P3** | Transitions Phase 2→3, ouverture modal | Basse | Moyen | Polish |
| **P3** | Aligner palette sur CRM (violet/jaune) | Basse | Moyen | Identité |

### Priorités produit

| Priorité | Objectif | Actions clés |
|----------|----------|--------------|
| **Immédiat** | Crédibilité minimale | Emojis → icônes, feedback capture, gestion erreurs |
| **Court terme (1–2 sprints)** | Parcours fluide | Réorganisation sidebar, toolbar Phase 3, panneau/onduleur visible |
| **Moyen terme (3–6 mois)** | Niveau pro | Snap feedback, wizard, fusion obstacles |
| **Long terme** | Premium | Transitions, palette CRM, documentation intégrée |

### Ce qui doit être corrigé en premier

1. **Emojis** — Impact immédiat sur la perception "amateur".
2. **Try/catch silencieux** — Risque d'erreurs invisibles, perte de confiance.
3. **Feedback capture** — L'utilisateur ne sait pas si ça charge ou si c'est cassé.
4. **Bouton Supprimer** — Raccourci clavier caché = frustration.

### Ce qui peut attendre

1. Alignement palette CRM (le thème doré fonctionne, pas bloquant).
2. Transitions animées (amélioration, pas bloquant).
3. Fusion Obstacle toiture + ombrant (simplification, pas urgent).
4. Wizard complet (amélioration majeure mais effort élevé).

### Ce qui doit être refondu complètement

1. **Architecture sidebar Phase 2** : Passer d'une liste plate à une structure en étapes/accordéons.
2. **Modal Paramètres** : Réduire son rôle. Garder uniquement les options avancées (marges, espacements). Panneau/onduleur dans la sidebar.
3. **Cohérence toolbar** : Phase 2 et Phase 3 doivent avoir la toolbar au même endroit (Zone B).
4. **Design system** : Introduire un jeu d'icônes cohérent et bannir emojis/Unicode hétéroclite.

---

## SYNTHÈSE EXÉCUTIVE

Le module Calpinage SolarNext est **techniquement solide** (audits précédents) mais **productivement immature** pour une commercialisation premium. Les principaux freins à la vente sont :

1. **Parcours utilisateur** : Complexité cachée (dropdowns, modal), pas de guidage, ordre implicite des actions.
2. **Ergonomie** : Snap peu perceptible, suppression par clavier cachée, paramètres essentiels dans un modal.
3. **Visuel** : Emojis, mélange de styles, densité excessive, incohérence toolbar Phase 2 vs Phase 3.
4. **Confiance** : Erreurs silencieuses, pas de récap avant validation, pas de feedback pendant les opérations longues.

**Recommandation stratégique :** Prioriser les corrections P0 (emojis, feedback, erreurs) pour atteindre un niveau "présentable commercialement", puis enchaîner sur P1 (réorganisation sidebar, toolbar, paramètres visibles) pour un parcours fluide. Les évolutions P2 (snap, wizard) positionneront l'outil au niveau des références du marché (Reonic, PVsyst).

---

*Fin du rapport. Aucun code, aucun patch, aucun fix — analyse stratégique uniquement.*
