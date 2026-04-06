# CP-PDF-V2-021 — Cahier d'écarts PDF

**Mode :** ANALYSE UNIQUEMENT — Aucune modification de code  
**Objectif :** Comparer visuellement le PDF généré (renderer React PdfLegacyPort) avec le PDF référence Solarglobe (Etude-Solarglobe-Descamps-3.88kWc.pdf)

**Méthode :** Analyse structurelle basée sur le HTML legacy (`smartpitch-solarglobe.html`) et les composants React (`PdfLegacyPort`). Les écarts sont identifiés par comparaison code/structure, sans inspection visuelle directe des PDF.

---

## PAGE 1 — Couverture

### Rôle
Page d'accueil premium, synthèse client, KPI clés, paramètres installation.

### Structure cible (PDF référence)
- Header : logo 18mm, badge "Étude Solarglobe" 6mm, meta-compact (Client, Réf., Date) aligné à droite
- Barre dorée 1mm, gradient #C39847 → #d4af63
- Grid 2 colonnes (col-6)
- **Colonne gauche :** Hero texte "Votre maison, vos habitudes...", bloc Méthode & scénario, bloc Pourquoi, bloc Vos objectifs (liste à puces)
- **Colonne droite :** Photo 68mm (accueil-pdf.png), légende "Vue illustrative...", KPI 4 cases (Puissance, Autonomie, TRI, Gains 25 ans), bloc Paramètres installation (Raccordement, Réseau, Conso annuelle)

### Structure actuelle (PdfLegacyPort)
- Identique : header, barre, grid, colonnes
- Blocs présents dans le même ordre

### Écarts visuels
| Élément | Cible | Actuel | Écart |
|---------|-------|--------|-------|
| Image p1_photo | /pdf-assets/images/accueil-pdf.png | Même chemin | Risque : chemin absolu peut ne pas résoudre en contexte pdf-render (Playwright) |
| Police | Inter 13.5px | Inter (fallback system-ui) | Police Inter peut être absente → rendu système |
| h2 hero | 9.8mm (legacy #p1 h2) | Non défini explicitement | Taille potentiellement différente |

### Écarts graphiques
Aucun graphique sur P1.

### Éléments manquants
- Aucun bloc structurel manquant
- **Risque :** image cassée si assets non servis

### Priorité correction
**Moyenne** — Vérifier résolution des assets en contexte print/Playwright.

---

## PAGE 2 — Étude financière 25 ans

### Rôle
Comparatif financier 25 ans, graphique évolution coûts, KPI, tableau jalons.

### Structure cible
- Header, barre dorée
- Grid 2 colonnes
- **Gauche :** Bloc "En 3 phrases" (p2_s1, s2, s3) + hint encadré #fbf6ec, tableau Comparatif 25 ans (6 lignes : 1, 5, 10, 15, 20, 25 ans), caption
- **Droite :** KPI 9 indicateurs (3×3), graphique Chart.js 42mm, liste bénéfices (b1, b2, b3)

### Structure actuelle
- Même layout
- Tableau jalons : 5 lignes (5, 10, 15, 20, 25) si données du mapper — **ligne "1 an" absente** dans le rendu actuel

### Écarts graphiques
| Élément | Cible | Actuel | Écart |
|---------|-------|--------|-------|
| Type | Chart.js Line, Canvas | Recharts LineChart, SVG | Bibliothèque différente |
| Hauteur | 42mm fixe | ResponsiveContainer 100% | Hauteur peut varier |
| Courbe "Avec solaire" | #C39847, tension 0.25 | #C39847 | OK |
| Courbe "Sans solaire" | #000, strokeDash [5,4] | #000, strokeDasharray "5 4" | OK |
| Axes Y | Format € (toLocaleString) | Idem | OK |
| Tooltip | € format FR | Idem | OK |
| Grille | Chart.js default | CartesianGrid stroke #e6e8ee | Style potentiellement différent |
| Légende | Chart.js native | Legend formatter null (masquée?) | Légende peut être absente ou différente |

### KPI
Tous présents : TRI, ROI, LCOE, Économie 25 ans, Revente 25 ans, Gains 25 ans, Tarif TTC, Prime, Reste à charge.

### Design
- Cards soft, couleurs #C39847 pour titres — aligné

### Éléments manquants
- Ligne "1 an" dans le tableau jalons (cible a 6 lignes)
- Légende du graphique potentiellement masquée (formatter null)

### Priorité correction
**Haute** — Tableau jalons complet (6 lignes), légende graphique visible.

---

## PAGE 3 — Offre chiffrée

### Rôle
Détail financier, tableau prix, résumé technique, financement.

### Structure cible
- Header "Offre chiffrée", barre
- Grid 2 colonnes
- **Gauche :** Tableau pricing (matériel, batterie, shelly, pose, gestion, sous-total HT, TVA, TTC, prime, reste), bloc Résumé technique (puissance, batterie, onduleurs, garantie, échelon, validité, délai)
- **Droite :** Bloc financement (mensualité, note), listes inclus / non inclus (localStorage)

### Structure actuelle
- Layout simplifié : une seule colonne, tableau + résumé + financement
- Pas de séparation gauche/droite comme dans le legacy
- Listes inclus/noninclus **absentes**

### Écarts visuels
- Disposition : cible = 2 colonnes, actuel = empilé vertical
- p3_ro_tva_pose : absent dans le rendu actuel
- p3_list_inclus, p3_list_noninclus : manquants

### Éléments manquants
- Listes "Inclus dans l'offre" / "Non inclus"
- Bloc TVA pose (si applicable)
- Layout 2 colonnes

### Priorité correction
**Haute** — Restaurer layout 2 colonnes, ajouter listes inclus/noninclus.

---

## PAGE 3B — Calepinage toiture

### Rôle
Vue toiture, orientation, inclinaison, surface, nombre de panneaux.

### Structure cible
- Photo calepinage (p3b_photo, localStorage override)
- Grille 2×2 : Inclinaison, Orientation, Surface, Panneaux

### Structure actuelle
- Placeholder "Vue toiture" (zone grise) à la place de l'image
- Grille 2×2 présente

### Écarts visuels
- Image calepinage : **manquante** (placeholder texte)

### Éléments manquants
- Image réelle p3b_photo

### Priorité correction
**Moyenne** — Image calepinage (données ViewModel ou placeholder cohérent).

---

## PAGE 4 — Production & Consommation

### Rôle
Graphique 12 mois (production, consommation, autoconso, batterie), totaux annuels.

### Structure cible
- Badge : **"Estimation de la production"**
- CTA bandeau : "Saisissez ou collez vos données mensuelles..."
- Zone chart : titre "Impact du photovoltaïque", Mois Jan→Déc, Autoconso calculée
- Légende : pill-violet (Consommation réseau), pill-gold (Production PV), pill-cyan (Autoconsommation), pill-green (Batterie)
- Récap annuel : "Chiffres validés (kWh) — Année"

### Structure actuelle
- Badge : **"Production & Consommation"** — **différent**
- Pas de CTA bandeau
- Pas de titre "Impact du photovoltaïque"
- Légende : Production, Consommation, Autoconso, Batterie (sans structure pill)
- Récap : grille 4 colonnes simple

### Écarts graphiques
| Élément | Cible | Actuel | Écart |
|---------|-------|--------|-------|
| Couleur Production | #F6D68B (pill-gold) | #C39847 | **Différent** |
| Couleur Consommation | #E9E6FF (pill-violet) ou bleu | #4A90E2 | **Différent** |
| Couleur Autoconso | #CFF5FB (pill-cyan) | #40E0D0 | Proche |
| Couleur Batterie | #E3FBE6 (pill-green) | #2E8B57 | **Différent** (vert plus foncé) |
| Légende | Grid pill + texte (Consommation réseau achetée, etc.) | Légende simple | Structure différente |
| ViewBox | 1750×600 | 1750×600 | OK |
| Algorithme | Catmull-Rom → Bézier | Idem | OK |

### Éléments manquants
- CTA bandeau saisie
- Titre "Impact du photovoltaïque"
- Légende détaillée (pill-violet, pill-gold, etc.)
- Badge correct "Estimation de la production"

### Priorité correction
**Haute** — Couleurs legacy, badge, CTA, légende pill.

---

## PAGE 5 — Journée type

### Rôle
Graphique 24h production/consommation/batterie.

### Structure cible
- Badge : **"Impact photovoltaïque — journée type"**
- CTA bandeau : "Définissez votre journée type heure par heure..."
- Titre : "Journée type — production, consommation et stockage"
- Légende : pill-gold (Production solaire), pill-gray (Consommation), pill-cyan (Autoconso), pill-green (Batterie)
- SVG viewBox 2000×560

### Structure actuelle
- Badge : **"Journée type"** — **tronqué**
- Pas de CTA bandeau
- Légende simplifiée
- ViewBox 2000×560 — OK

### Écarts graphiques
- Couleurs : cible pill-gold #F6D68B, pill-gray #D8D8D8 ; actuel #C39847, #4A90E2, #2E8B57

### Éléments manquants
- CTA bandeau
- Badge complet
- Légende détaillée (pill structure)

### Priorité correction
**Moyenne** — Badge, CTA, légende.

---

## PAGE 6 — Répartition consommation

### Rôle
Barres empilées 12 mois, KPI autonomie/import/autoconso.

### Structure cible
- Badge : **"Répartition consommation — 12 mois"**
- CTA bandeau : "Saisissez votre répartition mensuelle..."
- Titre : "Répartition mensuelle — PV directe, batterie, réseau"
- Légende : PV utilisée #86D8F1, Décharge batterie #B3F4C4, Import réseau #CFCBFF, **Moyenne conso** (barre grise #e6ebf2)
- KPI : 3 cards (Autonomie annuelle, Import réseau, Autoconsommation) avec pastilles colorées

### Structure actuelle
- Badge : "Répartition consommation"
- Pas de CTA bandeau
- Légende : PV directe, Batterie, Réseau — **Moyenne conso absente**
- KPI présents avec bonnes couleurs

### Écarts graphiques
- Couleurs barres : #86D8F1, #B3F4C4, #CFCBFF — OK
- Légende "Moyenne conso" : **absente**

### Éléments manquants
- CTA bandeau
- Badge complet "— 12 mois"
- Légende "Moyenne conso"
- Titre détaillé

### Priorité correction
**Moyenne** — Légende moyenne conso, badge complet.

---

## PAGE 7 — Origine / Destination

### Rôle
Barres 100 % (origine conso, destination prod), 4 KPI.

### Structure cible
- Header : badge **centré** "Décomposition de la consommation" (position absolute left 50%, transform -50%)
- Barre dorée
- Bandeau action (CTA)
- Zone visuelle : 2 barres segmentées (origine conso : PV, Batterie, Réseau ; destination prod : Autoconso, Batterie, Surplus)
- 4 KPI cards : Autonomie, Autoconsommation, Part réseau, Surplus

### Structure actuelle
- SheetLayout : badge à gauche (alignement standard)
- Pas de CTA bandeau
- Barres et KPI présents

### Écarts visuels
- **Badge centré** : cible a badge au centre du header ; actuel a badge à gauche (layout standard)
- CTA bandeau absent

### Éléments manquants
- CTA bandeau
- Badge centré (layout P7 spécifique)

### Priorité correction
**Moyenne** — Layout header P7 (badge centré).

---

## PAGE 8 — Impact batterie

### Rôle
Comparatif Sans/Avec batterie, barres %, profil journée, tableau détaillé, hypothèses.

### Structure cible
- Barres comparatives (Sans batterie : auto + surplus ; Avec batterie : auto + batt + surplus)
- SVG profil journée (4 courbes : pv, load, charge, discharge)
- Tableau "Autonomie & flux détaillés"
- Bloc Hypothèses
- Bloc Interprétation automatique
- Texte encadré "Grâce à une gestion intelligente..."

### Structure actuelle
- Barres, SVG, tableau, hypothèses présents
- Interprétation : paragraphe simplifié

### Écarts visuels
- Détails interprétation (p8_i_gain, p8_i_grid, p8_i_surplus) : structure actuelle simplifiée
- Delta sous barres (p8_delta_autocons, etc.) : à vérifier

### Éléments manquants
- Liens delta (texte sous barres)

### Priorité correction
**Basse** — Vérifier cohérence textes interprétation.

---

## PAGE 9 — Gains cumulés 25 ans

### Rôle
Courbes cumulées 2 scénarios, ROI pins, légende, 2 cards totaux.

### Structure cible
- Légende : Sans batterie (#4A5568), Avec batterie (#C39847)
- SVG courbes : buildPath cumul_25y, pins ROI (lignes verticales)
- 2 cards : p9_card_a, p9_card_b avec totaux et meta ROI/TRI

### Structure actuelle
- ChartP9 (Recharts) — courbes, ReferenceLine pour ROI
- Cards totaux présents

### Écarts graphiques
- Cible : SVG custom avec buildPath
- Actuel : Recharts LineChart
- Pins ROI : ReferenceLine vs divs positionnés — rendu potentiellement différent

### Éléments manquants
- Ligne "1 an" dans les données si applicable

### Priorité correction
**Basse** — Vérifier cohérence visuelle pins ROI.

---

## PAGE 10 — Synthèse

### Rôle
Récap config, KPI, barres de progression (ROI, TRI, LCOE).

### Structure cible
- kWc, modules, savings y1
- ROI, TRI, LCOE (valeurs + barres)
- Tableau : Configuration, Autoconsommation, Autonomie, Gains 25 ans, LCOE
- Barres : p10_roi_bar, p10_tri_bar, p10_lcoe_bar (gradients)
- Texte audit

### Structure actuelle
- KPI et tableau présents
- **Barres de progression absentes** (roi_bar, tri_bar, lcoe_bar)
- Texte audit absent

### Éléments manquants
- Barres de progression (ROI, TRI, LCOE)
- Texte audit

### Priorité correction
**Haute** — Barres de progression, texte audit.

---

## PAGE 11 — Finance

### Rôle
Résumé financement, graphique évolution, tableau durées, KPI mensualité.

### Structure cible
- Bloc params (mode, montant, durée, TAEG, assurance, apport)
- Mensualité mise en avant
- Graphique SVG (économies annuelles 25 ans)
- Tableau récap
- KPI : mensualité, total payé, ROI, reste moyen
- Blocs durées, post-prêt

### Structure actuelle
- Simplifié : investissement, puissance, économies annuelles
- **Graphique absent**
- **Tableau durées absent**
- **KPI détaillés absents**

### Éléments manquants
- Graphique évolution
- Tableau durées
- KPI (mensualité, total payé, ROI, reste)
- Blocs post-prêt

### Priorité correction
**Haute** — Graphique, tableau, KPI finance.

---

## PAGE 12 — Environnement

### Rôle
Donut autoconsommation, KPI CO₂, arbres, voitures.

### Structure cible
- Donut stroke-dasharray (autocons %)
- KPI : v_co2, v_trees, v_cars, v_co2_25, v_trees_25, v_cars_25

### Structure actuelle
- DonutP12 présent
- KPI présents

### Écarts visuels
- Donut : formule CIRC, autoLen — OK
- Couleurs : cible fond #e6e8ee, actuel #e6e8ee — OK

### Éléments manquants
- Aucun majeur

### Priorité correction
**Basse** — Vérification visuelle donut.

---

## PAGE 13 — Technique

### Rôle
Fiche technique détaillée.

### Structure cible
- Tableau technique (p13_rows) — contenu hydraté par engine

### Structure actuelle
- Texte générique "Les spécifications détaillées..."
- **Tableau technique absent**

### Éléments manquants
- Tableau technique complet (p13_rows)

### Priorité correction
**Moyenne** — Tableau technique.

---

## PAGE 14 — Meta finale

### Rôle
Page de fin, méta document.

### Structure cible
- Contenu minimal, meta client/ref/date

### Structure actuelle
- Texte "Document généré par SmartPitch — Étude Solarglobe"

### Éléments manquants
- Aucun majeur

### Priorité correction
**Basse**

---

## SYNTHÈSE DES ÉCARTS PAR PRIORITÉ

### Priorité HAUTE
1. **P2** : Tableau jalons 6 lignes (1 an), légende graphique
2. **P3** : Layout 2 colonnes, listes inclus/noninclus
3. **P4** : Couleurs legacy (pill), badge "Estimation de la production", CTA, légende
4. **P10** : Barres de progression ROI/TRI/LCOE, texte audit
5. **P11** : Graphique, tableau durées, KPI finance

### Priorité MOYENNE
1. **P1** : Vérification assets (logo, photo)
2. **P3b** : Image calepinage
3. **P5** : Badge complet, CTA, légende
4. **P6** : Légende moyenne conso, badge complet
5. **P7** : Badge centré
6. **P13** : Tableau technique

### Priorité BASSE
1. **P8** : Textes interprétation
2. **P9** : Pins ROI
3. **P12** : Vérification donut
4. **P14** : OK

---

## ÉCARTS DESIGN GLOBAUX

| Élément | Cible | Actuel |
|---------|-------|--------|
| Fond page | #f5f6f8 (écran), #fff (print) | Idem |
| Sheet | 277×190mm, border 0.3mm #e6e8ee | Idem |
| Barre dorée | 1mm, #C39847→#d4af63 | Idem |
| Badge | border #C39847, tailles variables par page | Taille unique possible |
| Police | Inter 13.5px | Inter + fallback |
| Couleurs pill P4/P5 | #E9E6FF, #F6D68B, #CFF5FB, #E3FBE6 | #C39847, #4A90E2, #40E0D0, #2E8B57 |

---

*Document CP-PDF-V2-021 — Cahier d'écarts PDF. Aucune modification de code. Analyse structurelle uniquement.*
