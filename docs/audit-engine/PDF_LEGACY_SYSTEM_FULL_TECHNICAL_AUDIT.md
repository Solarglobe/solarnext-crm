# PDF Legacy System — Full Technical Audit

**Titre :** PDF Legacy System — Full Technical Audit  
**Objectif :** Comprendre exactement comment fonctionne le système PDF actuel avant toute refonte.  
**Contrainte :** Analyse uniquement — aucune modification de code.

**Date :** 2025-03-07

---

## 1. Template PDF actuel

### 1.1 Fichier identifié

| Élément | Valeur |
|--------|--------|
| **Fichier template** | `pdf-template/smartpitch-solarglobe.html` |
| **Note** | Le nom attendu `smartpitch-solarglobe.htm` n’existe pas ; l’extension réelle est **.html** |

### 1.2 Structure HTML

- **Doctype :** `<!doctype html>`
- **Langue :** `lang="fr"`
- **Titre :** « SmartPitch Solarglobe — A4 paysage (PDF ready) »
- **Viewport :** `width=device-width, initial-scale=1`
- **Conteneur principal :** `<div class="wrap">` qui englobe toutes les `<section class="sheet">`

### 1.3 Découpage des pages (CSS)

- **Règle @page :** `size: A4 landscape; margin: 0;`
- **Une section = une page :** chaque `<section class="sheet">` a :
  - `width: 277mm; height: 190mm`
  - `page-break-after: always; break-after: page;`
  - `.sheet:last-child { page-break-after: auto; }`
- **Impression :** `@media print` force fond blanc, dimensions fixes, pas de box-shadow.

### 1.4 Styles CSS utilisés

Tous les styles sont **inline dans le `<head>`** (pas de fichier CSS externe) :

| Catégorie | Sélecteurs / usage |
|-----------|--------------------|
| Base | `html, body` — margin, background #f5f6f8, font Inter 13.5px |
| Page | `.sheet` — dimensions, margin, border-radius, box-shadow, flex, padding 8mm 12mm, gap 4mm |
| Header / barre | `.bar` — dégradé doré #C39847 → #e8d2a5 ; `.header` — flex ; `.badge` — bordure dorée |
| Grille | `.grid` — 12 colonnes ; `.col-6` — span 6 ; `.card`, `.card.soft` |
| Métadonnées | `.meta-compact` — flex, wrap, gap 6mm |
| Spécifique P1 | `#p1_photo` — height 70mm, background-image ; `#p1 h2` — font-size 9.8mm |
| Print | `@media print` — fond blanc, dimensions .sheet forcées, pas d’ombre |

Couleur de marque récurrente : **#C39847** (doré Solarglobe).

### 1.5 Dépendances JS chargées

| Ordre | Ressource | Type |
|-------|-----------|------|
| 1 | `https://cdn.jsdelivr.net/npm/chart.js` | CDN — Chart.js (graphiques P2, etc.) |
| 2 | `/pdf-engines/engine-main.js` | Script local |
| 3 | `/pdf-engines/engine-p1.js` à `engine-p14.js` | Scripts locaux (y compris engine-p3b.js) |

Aucun autre framework (pas de React/Vue) ; script vanilla + Chart.js.

### 1.6 Ressources utilisées (liste exhaustive)

**CSS :**  
- Aucun fichier externe ; tout est dans `<style>` du template.

**JS :**  
- Chart.js (CDN)  
- `/pdf-engines/engine-main.js`  
- `/pdf-engines/engine-p1.js`, `engine-p2.js`, `engine-p3.js`, `engine-p3b.js`, `engine-p4.js`, `engine-p5.js`, `engine-p6.js`, `engine-p7.js`, `engine-p8.js`, `engine-p9.js`, `engine-p10.js`, `engine-p11.js`, `engine-p12.js`, `engine-p13.js`, `engine-p14.js`

**Images :**  
- `/pdf-assets/images/logo-solarglobe-rect.png` — logo (répété sur chaque page)
- `/pdf-assets/images/accueil-pdf.png` — image d’accueil / couverture (P1)
- Référence legacy dans un style : `url('images/accueil-pdf.png')` (P1, #p1_photo) — doublon relatif, le template utilise aussi l’URL absolue ci-dessus.

**Fonts :**  
- Police déclarée : `"Inter", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif` — pas de fichier font chargé dans le template (polices système / web).

**Graphiques :**  
- Chart.js : canvas `#p2_chart` (P2).  
- P4, P5, P6 : zones `#p4_chart_zone`, `#p5_chart_zone`, `#p6_chart_zone` — dessin custom (canvas ou DOM).  
- P8 : SVG `#p8_svg`, `#p8_svg_lines`.  
- P9 : SVG `#p9_chart`, `#p9_roi_pins`.  
- P12 : script inline avec `drawChart(eco, ann)` (canvas ou similaire).

---

## 2. Structure des pages

### 2.1 Liste exacte des pages du PDF

| # | Id section | data-engine | Ligne approx. | Intitulé / contenu |
|---|------------|------------|---------------|-------------------|
| 1 | p1 | meta | 99 | Couverture (premium dorée) + overlay de saisie |
| 2 | p2 | summary | 246 | Étude financière 25 ans (version premium compacte) |
| 3 | p3 | offer | 407 | Offre chiffrée + overlay de saisie |
| 4 | p3b | calepinage | 564 | Photo calepinage & mémo toiture |
| 5 | p4 | prodconso | 708 | Production & consommation |
| 6 | p5 | journee-type | 812 | Journée type |
| 7 | p6 | — | 912 | (section sans data-engine explicite) |
| 8 | p7 | — | 1075 | (section sans data-engine explicite) |
| 9 | p8 | — | 1218 | Impact batterie / courbes |
| 10 | p9 | — | 1655 | Gains cumulés 25 ans |
| 11 | p10 | — | 1941 | (contenu dédié P10) |
| 12 | p11 | finance | 2203 | Finance |
| 13 | p12 | env | 2555 | Environnement |
| 14 | p13 | tech | 2770 | Technique (print-tight) |
| 15 | p14 | — | 3009 | Dernière page (meta) |

### 2.2 Nombre de pages réelles

**15 pages** (p1, p2, p3, p3b, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14).

### 2.3 Ordre d’affichage

Ordre DOM = ordre d’impression : **p1 → p2 → p3 → p3b → p4 → p5 → p6 → p7 → p8 → p9 → p10 → p11 → p12 → p13 → p14**.

### 2.4 Logique de pagination

- **Pagination purement CSS :** chaque `.sheet` a `page-break-after: always` (sauf la dernière).
- Aucune logique JS de pagination ; le document est un flux vertical de 15 sections, chaque section tenant sur une page A4 paysage.

---

## 3. Engines graphiques

### 3.1 Liste des engines

| Fichier | Rôle | Graphique / rendu | Dépendances | Initialisation |
|---------|------|-------------------|-------------|----------------|
| **engine-main.js** | Orchestrateur : récupère `?scenario=`, appelle tous les `/api/view/px`, stocke en `_data`, émet `pX:update` (et `p11:auto`, `all:loaded`) | Aucun | Aucun | `window.Engine = new Engine(); window.Engine.load();` au chargement |
| **engine-p1.js** | Hydrate P1 (meta, méthode, KPI, paramètres) ; envoi conso vers ERPNext (optionnel) | Aucun | — | Écoute `p1:update` ; `API.bindEngineP1(Engine)` en fin de HTML |
| **engine-p2.js** | KPI, jalons 25 ans, bénéfices, **graphique Chart.js** (ligne : Sans solaire / Avec solaire) | Canvas `#p2_chart` — Chart.js line | Chart.js | `p2:update` ; `bindEngineP2(Engine)` |
| **engine-p3.js** | Offre chiffrée (tableau, TVA, total TTC, prime, reste à charge, résumé technique) | Aucun | — | `p3:update` ; `bindEngineP3(Engine)` |
| **engine-p3b.js** | Calepinage toiture (photo, mémo, panneaux/surface depuis settings) | Aucun (image optionnelle) | localStorage `smartpitch_settings` | `p3b:update` ; pas de bind dans le bloc listé (géré par engine-main) |
| **engine-p4.js** | Production & consommation (tableau mensuel, overlay saisie, **graphique custom**) | Zone `#p4_chart_zone` — dessin custom (fonction `drawChart(rows)`) | — | `p4:update` ; `bindEngineP4(Engine)` |
| **engine-p5.js** | Journée type (séries temporelles) | Zone `#p5_chart_zone` — `API_p5_drawChart(series)` | — | `p5:update` ; `bindEngineP5(Engine)` |
| **engine-p6.js** | Répartition (direct, batterie, réseau, total) | Zone `#p6_chart_zone` — `drawChart(dir, bat, grid, tot)` | — | `p6:update` ; `bindEngineP6(Engine)` |
| **engine-p7.js** | Origine / destination énergie annuelle | Aucun (texte / tableaux) | — | `p7:update` ; `bindEngineP7(Engine)` |
| **engine-p8.js** | Impact batterie — courbes PV, charge, décharge, load | SVG `#p8_svg`, `#p8_svg_lines` — courbes type “Tesla soft” (interpolation monotone) | — | `p8:update` ; `bindEngineP8(Engine)` |
| **engine-p9.js** | Gains cumulés 25 ans | SVG `#p9_chart`, `#p9_roi_pins` — graphique SVG généré en JS | — | Écoute `p9:update` ; pas de bind dans le bloc listé (présent côté engine) |
| **engine-p10.js** | Données spécifiques P10 | Selon view-p10 | — | Écoute `p10:update` (pas de bind explicite dans le script final) |
| **engine-p11.js** | Finance | Aucun (tableaux / textes) | — | `p11:auto` émis par engine-main ; `bindEngineP11(Engine)` |
| **engine-p12.js** | Environnement | Script inline dans le HTML : `drawChart(eco, ann)` | — | Écoute `p12:update` + rendu inline P12 |
| **engine-p13.js** | Technique | Aucun | — | Écoute `p13:update` |
| **engine-p14.js** | Meta (client, ref, date) | Aucun | — | Écoute `p14:update` ; `Engine.getMeta` utilisé dans HTML mais **non implémenté** sur Engine (fallback payload / localStorage) |

### 3.2 Résumé des graphiques par technologie

- **Chart.js (canvas) :** P2 uniquement (`#p2_chart`).
- **Canvas / dessin custom :** P4, P5, P6 (zones dédiées).
- **SVG généré en JS :** P8 (courbes), P9 (gains cumulés).
- **Script inline dans le HTML :** P12 (`drawChart(eco, ann)`).

---

## 4. Données utilisées par les engines

### 4.1 Source principale : endpoints API

Toutes les données de vues viennent des **GET** suivants (paramètre commun : `scenario`), appelés par **engine-main.js** :

- `/api/view/p1?scenario=...`
- `/api/view/p2?scenario=...`
- `/api/view/p3?scenario=...`
- `/api/view/p3b?scenario=...`
- `/api/view/p4?scenario=...`
- `/api/view/p5?scenario=...`
- `/api/view/p6?scenario=...`
- `/api/view/p7?scenario=...`
- `/api/view/p8?scenario=...`
- `/api/view/p9?scenario=...`
- `/api/view/p10?scenario=...`
- `/api/view/p11?scenario=...`
- `/api/view/p12?scenario=...`
- `/api/view/p13?scenario=...`
- `/api/view/p14?scenario=...`

Aucun appel depuis le template vers `window.smartpitch` ou `window.project` ; le scénario est lu une seule fois depuis l’URL (`?scenario=A1` etc.) et réutilisé pour tous les fetch.

### 4.2 Objets globaux utilisés

| Global | Utilisation |
|--------|-------------|
| **window.Engine** | Instance unique : `load()`, `on(event, handler)`, `getP1()` … `getP14()`, `_data`, `_emit()`. Pas de `getMeta()` implémenté. |
| **window.API** | Fonctions de rendu par page : `renderP1`, `bindEngineP1`, … `renderP14`, `bindEngineP14`. Exposées par des scripts inline dans le HTML. |
| **window.__p2_chart** | Instance Chart.js pour P2 (détruite puis recréée à chaque mise à jour). |
| **window.__smartpitch_render_done** | Flag optionnel après `all:loaded`. |
| **localStorage** | `smartpitch_overrides` (overrides par page), `smartpitch_settings` (P3b : pvtech, pricing), utilisé pour métadonnées P12/P14 si besoin. |

Aucune donnée métier n’est exposée dans des globaux type `window.smartpitch` ou `window.project` ; tout passe par les payloads des événements `pX:update` et les accesseurs `Engine.getP1()` … `getP14()`.

### 4.3 Mapping des données (côté backend)

- **Contexte :** `global.smartpitch_ctx` (rempli par **calc.controller.js** après calcul SmartPitch).
- Chaque **view.controller.js** : `getViewPX(req, res)` lit `req.query.scenario` et `global.smartpitch_ctx`, appelle **buildViewPX(ctx, scenarioId)** depuis `views/view-pX.js`, renvoie le JSON.
- Les builders **view-p1.js** … **view-p14.js** font le mapping **ctx + scenarioId → payload** attendu par chaque engine (ex. `p1_auto`, `p2_auto`, …).

---

## 5. Endpoints backend utilisés

### 5.1 Routes

Toutes sous le préfixe **`/api/view`** (router : **`backend/routes/view.routes.js`**).

| Méthode | Endpoint | Contrôleur | Builder (mapper) |
|---------|----------|------------|------------------|
| GET | `/api/view/p1?scenario=` | view.controller.js — `getViewP1` | views/view-p1.js — `buildViewP1` |
| GET | `/api/view/p2?scenario=` | `getViewP2` | view-p2.js — `buildViewP2` |
| GET | `/api/view/p3?scenario=` | `getViewP3` | view-p3.js — `buildViewP3` |
| GET | `/api/view/p3b?scenario=` | `getViewP3b` | view-p3b.js — `buildViewP3b` |
| GET | `/api/view/p4?scenario=` | `getViewP4` | view-p4.js — `buildViewP4` |
| GET | `/api/view/p5?scenario=` | `getViewP5` | view-p5.js — `buildViewP5` |
| GET | `/api/view/p6?scenario=` | `getViewP6` | view-p6.js — `buildViewP6` |
| GET | `/api/view/p7?scenario=` | `getViewP7` | view-p7.js — `buildViewP7` |
| GET | `/api/view/p8?scenario=` | `getViewP8` | view-p8.js — `buildViewP8` |
| GET | `/api/view/p9?scenario=` | `getViewP9` | view-p9.js — `buildViewP9` |
| GET | `/api/view/p10?scenario=` | `getViewP10` | view-p10.js — `buildViewP10` |
| GET | `/api/view/p11?scenario=` | `getViewP11` | view-p11.js — `buildViewP11` |
| GET | `/api/view/p12?scenario=` | `getViewP12` | view-p12.js — `buildViewP12` |
| GET | `/api/view/p13?scenario=` | `getViewP13` | view-p13.js — `buildViewP13` |
| GET | `/api/view/p14?scenario=` | `getViewP14` | view-p14.js — `buildViewP14` |

### 5.2 Contrôleur

- **Fichier :** `backend/controllers/view.controller.js`.
- Pour chaque P1…P14 : lecture de `req.query.scenario`, vérification de `global.smartpitch_ctx`, appel du builder correspondant, `res.json(payload)`.
- En cas d’erreur : 400 si scenario manquant, 500 si `smartpitch_ctx` absent ou erreur interne.

### 5.3 Service / données

- Pas de service dédié “view” : les **views** sont de purs mappers **ctx + scenarioId → payload**.
- La **source de vérité** est **global.smartpitch_ctx**, alimenté par **calc.controller.js** (calcul SmartPitch, ex. route de calcul qui assigne `global.smartpitch_ctx = ctxFinal`).

---

## 6. Dépendances legacy

### 6.1 Code legacy identifié

| Élément | Type | Remarque |
|--------|------|----------|
| **pdf-template/smartpitch-solarglobe.html** | Template HTML monolithique | ~3280 lignes, styles et scripts inline, 15 pages |
| **pdf-template/engines/engine-main.js** | Moteur central | Fetch séquentiel des 15 vues, événements pX:update |
| **pdf-template/engines/engine-p1.js** … **engine-p14.js**, **engine-p3b.js** | Engines par page | Vanilla JS, dépendance à la structure DOM et aux IDs |
| **backend/views/view-p1.js** … **view-p14.js** | Mappers vues | Dépendent de la structure de `smartpitch_ctx` (calcul legacy) |
| **backend/controllers/calc.controller.js** | Calcul + contexte | Assigne `global.smartpitch_ctx` pour les view.* |
| **backend/routes/view.routes.js** | Routes /api/view/* | 15 routes GET p1…p14 |
| **backend/controllers/view.controller.js** | Handlers view | Lit global.smartpitch_ctx, appelle les buildViewPX |
| **Chart.js (CDN)** | Lib graphique | Uniquement P2 |
| **backend/pdf/assets/** | Images | logo-solarglobe-rect.png, accueil-pdf.png — servis sous `/pdf-assets` |
| **server.js** | Servitude PDF | GET `/pdf` → smartpitch-solarglobe.html ; `/pdf-engines` → engines ; `/pdf-assets` → assets |

### 6.2 Anciens mappers

Les **views** (view-p1 … view-p14) sont les mappers actuels ; ils sont “legacy” au sens où ils dépendent de la structure du calcul SmartPitch (scenarios, finance, etc.) et du format attendu par les engines (ex. `p1_auto`, `p2_auto`, …).

### 6.3 Anciennes routes backend

- **GET /pdf** — sert le template HTML.
- **GET /pdf-engines/** — sert les fichiers JS du dossier `pdf-template/engines/`.
- **GET /pdf-assets/** — sert `backend/pdf/assets/` (images).
- **GET /api/view/p1** … **/api/view/p14** — données JSON pour chaque page.

Aucune autre route backend n’est utilisée par le template pour la génération du PDF étude (hors calc qui alimente le contexte).

### 6.4 Dépendances CSS/JS

- **CSS :** uniquement le bloc `<style>` du template (pas de fichier externe).
- **JS :** Chart.js (CDN) + 16 fichiers engines (engine-main + engine-p1 … p14, dont engine-p3b).

---

## 7. Flux actuel de génération PDF

### 7.1 Schéma du flux

```
1. Utilisateur choisit un scénario (ex. dans l’app ou outil qui appelle le calcul)
         ↓
2. Backend exécute le calcul SmartPitch (calc.controller.js)
         ↓
3. global.smartpitch_ctx = ctxFinal (contexte figé pour la session)
         ↓
4. Utilisateur ouvre l’URL du template PDF avec ?scenario=A1 (ex. GET /pdf?scenario=A1)
         ↓
5. Backend renvoie smartpitch-solarglobe.html (GET /pdf)
         ↓
6. Navigateur charge la page :
   - Chart.js (CDN)
   - /pdf-engines/engine-main.js
   - /pdf-engines/engine-p1.js … engine-p14.js
         ↓
7. engine-main.js :
   - Lit ?scenario= dans l’URL
   - Appelle en séquence GET /api/view/p1?scenario=… … GET /api/view/p14?scenario=…
   - Pour chaque réponse : stocke dans Engine._data, émet pX:update (ou p11:auto)
   - À la fin : émet all:loaded
         ↓
8. Chaque engine-pX écoute pX:update (ou p11:auto pour P11) :
   - Met à jour le DOM (texte, tableaux)
   - Dessine les graphiques (Chart.js, SVG, canvas custom)
         ↓
9. Scripts inline en fin de HTML : API.bindEngineP1(Engine) … bindEngineP11(Engine)
   (rejouer P1 si déjà chargée, brancher les listeners)
         ↓
10. Rendu complet à l’écran (15 pages)
         ↓
11. Utilisateur déclenche l’impression (Ctrl+P / Cmd+P)
         ↓
12. Impression PDF navigateur : « Enregistrer en PDF » ou imprimante
         ↓
13. Résultat : fichier PDF côté client (aucune génération serveur pour ce template)
```

### 7.2 Points importants

- Le **PDF “étude”** actuel n’est **pas** généré côté serveur : c’est une **page HTML imprimée par le navigateur**.
- Le contexte **doit** être préparé avant d’ouvrir le template : **smartpitch_ctx** est rempli par une **requête de calcul** (calc) ; sans calcul préalable, les `/api/view/px` renverront 500 (ctx absent).
- Aucun lien depuis le frontend CRM vers GET `/pdf` n’a été identifié dans l’audit ; l’accès se fait en général par **URL directe** (avec paramètre `?scenario=`).

---

## 8. Tests de non-régression recommandés

À vérifier sans modifier le code :

1. **Template HTML**  
   - Ouvrir `GET /pdf` (ou le fichier servi à cette URL) avec `?scenario=A1` (ou un scénario valide après un calcul).  
   - Vérifier : pas d’erreur 404, pas de blocage CORS, page s’affiche.

2. **Engines**  
   - En devtools (Network) : tous les scripts `/pdf-engines/*.js` chargés (200).  
   - En console : pas d’erreur au chargement ; `window.Engine` défini ; après chargement, `window.Engine._data` contient au moins p1…p14 si les API ont répondu.

3. **Endpoints**  
   - Avec un **smartpitch_ctx** déjà rempli (après un calcul), appeler en GET :  
     `/api/view/p1?scenario=A1`, `/api/view/p2?scenario=A1`, … `/api/view/p14?scenario=A1`.  
   - Vérifier : réponse 200, body JSON (pas de HTML).

4. **Graphiques**  
   - P2 : graphique ligne visible dans `#p2_chart`.  
   - P4, P5, P6 : zones graphiques visibles après chargement des données.  
   - P8 : courbes dans le SVG.  
   - P9 : courbe gains cumulés dans le SVG.  
   - P12 : graphique rendu par le script inline.

5. **Impression PDF**  
   - Ctrl+P (ou Cmd+P) → « Enregistrer en PDF » : le PDF généré contient 15 pages en A4 paysage, sans page blanche ni erreur de mise en page évidente.

---

## 9. Synthèse

| Thème | Résumé |
|------|--------|
| **Template** | `pdf-template/smartpitch-solarglobe.html` (extension .html) — 15 sections .sheet, styles inline, Chart.js + 16 engines. |
| **Pages** | 15 pages : p1, p2, p3, p3b, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14. |
| **Engines** | engine-main.js + engine-p1 … engine-p14 + engine-p3b ; P2 = Chart.js, P4/P5/P6 = custom, P8/P9 = SVG, P12 = script inline. |
| **Endpoints** | GET /api/view/p1 … /api/view/p14 avec query `scenario` ; contrôleur view.controller.js, mappers views/view-pX.js. |
| **Données** | global.smartpitch_ctx (rempli par calc.controller.js) ; aucun objet global window.smartpitch/window.project utilisé. |
| **Dépendances** | Chart.js (CDN), /pdf-engines/*.js, /pdf-assets/images/*, structure DOM avec IDs fixes. |
| **Flux** | Calcul → smartpitch_ctx → Ouverture GET /pdf?scenario= → Chargement engines → Fetch views → Rendu DOM + graphiques → Impression navigateur → PDF client. |

**Aucune modification de code n’a été effectuée ; ce document est strictement une analyse.**
