# CP-PDF-V2-020 — Rapport de portage fidèle PDF Legacy → React/TSX

**ÉTAPE 1 — Audit de portage fidèle**  
**ÉTAPE 2 — Mapping strict des données**

---

## 1. SOURCES ANALYSÉES

| Source | Rôle |
|--------|------|
| `pdf-template/smartpitch-solarglobe.html` | HTML legacy 14 pages |
| `pdf-template/engines/engine-main.js` | Orchestrateur (fetch /api/view/pX) |
| `pdf-template/engines/engine-p1.js` … `engine-p14.js` | Hydratation DOM par page |
| `backend/services/pdf/pdfViewModel.mapper.js` | ViewModel actuel (fullReport) |
| `frontend/src/pages/pdf/FullReport/` | Rendu React actuel |

---

## 2. AUDIT PAGE PAR PAGE — STRUCTURE DOM LEGACY

### PAGE 1 — Couverture

| Élément | IDs DOM | Sections | ViewModel actuel |
|--------|---------|----------|------------------|
| Section | `#p1` | sheet, data-engine="meta" | fullReport.p1 |
| Meta | `p1_client`, `p1_ref`, `p1_date` | meta-compact | p1_auto |
| Méthode | `p1_method`, `p1_m_kwc`, `p1_m_auto`, `p1_m_gain` | card | p1_auto |
| Pourquoi | `p1_why` | card | p1_auto |
| KPI | `p1_k_puissance`, `p1_k_autonomie`, `p1_k_tri`, `p1_k_gains` | kpis | p1_auto |
| Paramètres | `p1_param_kva`, `p1_param_reseau`, `p1_param_conso` | card | p1_auto |
| Photo | `p1_photo`, `p1_photo_img` | placeholder | **MANQUANT** (localStorage p3b_photo) |

**Textes statiques :** "Votre maison, vos habitudes...", "Méthode & scénario choisi", "Pourquoi ce dimensionnement ?", "Vos objectifs", "Paramètres installation".  
**Couleurs :** #C39847 (doré), barre gradient #C39847→#d4af63.

---

### PAGE 2 — Étude financière 25 ans

| Élément | IDs DOM | ViewModel actuel |
|--------|---------|------------------|
| Meta | `p2_client`, `p2_ref`, `p2_date` | p2_auto |
| Textes | `p2_s1`, `p2_s2`, `p2_s3`, `p2_hint` | p2_auto |
| Jalons | `p2_jalons_body` (table) | p2_auto.p2_jalons |
| KPI | `p2_k_tri`, `p2_k_roi`, `p2_k_lcoe`, `p2_k_economie25`, `p2_k_revente25`, `p2_k_gains`, `p2_k_tarif`, `p2_k_prime`, `p2_k_reste` | p2_auto |
| Bénéfices | `p2_b1`, `p2_b2`, `p2_b3` | p2_auto |
| Graphique | `#p2_chart` (Canvas Chart.js) | p2_auto.p2_chart_labels, p2_chart_sans, p2_chart_avec |

**Graphique legacy :** Chart.js line, "Avec solaire" #C39847, "Sans solaire" noir pointillé [5,4], tooltip €.  
**Correspondance :** OK. FullReport utilise Recharts — **écart** : Chart.js vs Recharts (à porter fidèlement).

---

### PAGE 3 — Offre chiffrée

| Élément | IDs DOM | ViewModel actuel |
|--------|---------|------------------|
| Meta | `p3_client`, `p3_ref`, `p3_date` | meta |
| Table | `p3_v_materiel`, `p3_v_batterie`, `p3_v_shelly`, `p3_v_pose`, `p3_v_gestion`, `p3_v_subht` | offer |
| TVA | `p3_ro_tva_mat`, `p3_v_tva_materiel`, `p3_v_tva_pose` | offer |
| Totaux | `p3_v_ttc`, `p3_v_prime`, `p3_v_reste` | offer |
| Résumé | `p3_r_puissance`, `p3_r_batterie`, `p3_r_onduleurs`, `p3_r_garantie` | offer (puissance, batterie_label, onduleurs, garantie) |
| Conditions | `p3_r_echelon`, `p3_r_validite`, `p3_r_delai` | offer |
| Financement | `p3_v_mensu`, `p3_finance_note` | finance |
| Listes | `p3_list_inclus`, `p3_list_noninclus` | **MANQUANT** (localStorage) |

**Champs manquants :** p3_ro_tva_pose, list_inclus, list_noninclus (overrides localStorage).

---

### PAGE 3B — Calepinage

| Élément | IDs DOM | ViewModel actuel |
|--------|---------|------------------|
| Meta | `p3b_client`, `p3b_ref`, `p3b_date` | p3b_auto |
| Données | `p3b_inclinaison`, `p3b_orientation`, `p3b_surface`, `p3b_panneaux` | p3b_auto (inclinaison, orientation, surface_m2, nb_panneaux) |
| Photo | `p3b_photo`, `p3b_photo_placeholder` | **MANQUANT** (localStorage smartpitch_overrides.p3b_photo) |

**Correspondance :** p3b_auto.client/ref/date vs p3b_client, etc. — mapping direct.

---

### PAGE 4 — Production & Consommation

| Élément | IDs DOM | ViewModel actuel |
|--------|---------|------------------|
| Meta | `p4_client`, `p4_ref`, `p4_date` | meta |
| Graphique | `#p4-chart` (SVG) | production_kwh, consommation_kwh, autoconso_kwh, batterie_kwh |
| Légende | `leg-batt`, `leg-batt-text` | batterie_kwh (si > 0) |
| Tableau | `p4_numbers`, `p4_numbers_table` | Calculé côté client |

**Graphique legacy :** SVG Catmull-Rom → Bézier, courbes Production (or), Consommation (bleu), Autoconso (turquoise), Batterie (vert).  
**Couleurs P4 :** pill-violet #E9E6FF, pill-gold #F6D68B, pill-cyan #CFF5FB, pill-green #E3FBE6.

---

### PAGE 5 — Journée type

| Élément | IDs DOM | ViewModel actuel |
|--------|---------|------------------|
| Meta | `p5_client`, `p5_ref`, `p5_date`, `p5_month` | meta |
| Graphique | `#p5-chart` (SVG) | production_kw, consommation_kw, batterie_kw |
| Légende | `p5_leg_batt`, `p5_leg_batt_text` | batterie_kw |

**Graphique legacy :** spline tension 0.10, dégradés p5pv, p5conso, p5auto, p5batt.  
**Couleurs :** pill-gold #F6D68B, pill-gray #D8D8D8, pill-cyan #CFF5FB, pill-green #E3FBE6.

---

### PAGE 6 — Répartition consommation

| Élément | IDs DOM | ViewModel actuel |
|--------|---------|------------------|
| Meta | `p6_client`, `p6_ref`, `p6_date` | p6.meta |
| Graphique | `#p6-chart` (SVG barres empilées) | p6.dir, p6.bat, p6.grid |
| KPI | `p6_autonomie`, `p6_autonomie_txt`, `p6_grid_kwh`, `p6_grid_eur`, `p6_auto_pct`, `p6_auto_txt` | Calculés (autonomie, grid, auto) |

**Couleurs P6 :** #86D8F1 (PV directe), #B3F4C4 (batterie), #CFCBFF (réseau).

---

### PAGE 7 — Origine / Destination

| Élément | IDs DOM | ViewModel actuel |
|--------|---------|------------------|
| Meta | `p7_client`, `p7_ref`, `p7_date`, `p7_meta_scen` | meta, scenario_label |
| Barres | `p7_conso_pv`, `p7_conso_batt`, `p7_conso_reseau`, `p7_prod_auto`, `p7_prod_batt`, `p7_prod_surplus` | pct (c_pv_pct, c_bat_pct, c_grid_pct, p_auto_pct, p_bat_pct, p_surplus_pct) |
| KPI | `p7_autonomie_pct`, `p7_autocons_pct`, `p7_reseau_pct`, `p7_reseau_kwh`, `p7_surplus_pct`, `p7_surplus_kwh` | pct + c_grid, p_surplus |

**Couleurs P7 :** #E7C25A (PV), #CFEFD9 (batterie), #D5CBFF (réseau), #CFF5FB (autoconso), #6BB4E0 (surplus).

---

### PAGE 8 — Impact batterie

| Élément | IDs DOM | ViewModel actuel |
|--------|---------|------------------|
| Meta | `p8_client`, `p8_ref`, `p8_date`, `p8_meta_year` | meta, year |
| Barres A/B | `p8_a_auto`, `p8_a_surplus`, `p8_b_auto`, `p8_b_batt`, `p8_b_surplus` | A, B |
| SVG | `#p8_svg`, `#p8_svg_lines` | profile (pv, load, charge, discharge) |
| Tableau | `p8_t_A_prod`, `p8_t_B_prod`, etc. | A, B |
| Hypothèses | `p8_h_year`, `p8_h_cycles`, `p8_h_capacity`, `p8_h_profile` | hypotheses |
| KPI | `p8_kpi_autonomie`, `p8_kpi_grid` | detailsBatterie |
| Interprétation | `p8_i_gain`, `p8_i_grid`, `p8_i_surplus`, `p8_delta_*` | interpretation |

**Couleurs P8 :** #FFD54F (PV), #A6E3AE (charge), #2E8B57 (décharge), #E0E0E0 (conso).

---

### PAGE 9 — Gains cumulés 25 ans

| Élément | IDs DOM | ViewModel actuel |
|--------|---------|------------------|
| Meta | `p9_client`, `p9_ref`, `p9_date` | meta |
| Graphique | `#p9_chart` (SVG) | recommended.cumul_25y, compare.cumul_25y |
| Légende | `p9_leg_a`, `p9_leg_b` | recommended.label, compare.label |
| ROI pins | `#p9_roi_pins` | recommended.roi_year, compare.roi_year |
| Totaux | `p9_a_total`, `p9_b_total`, `p9_tri_a`, `p9_tri_b` | cumul_25y, tri_pct |

**Couleurs P9 :** #4A5568 (sans batterie), #C39847 (avec batterie).

---

### PAGE 10 — Synthèse

| Élément | IDs DOM | ViewModel actuel |
|--------|---------|------------------|
| Meta | `p10_client`, `p10_ref`, `p10_date` | meta |
| Best | `p10_kwc`, `p10_modules`, `p10_savings_y1`, `p10_roi`, `p10_tri`, `p10_lcoe`, `p10_cfg`, `p10_autoprod`, `p10_autonomy`, `p10_gains25` | best |
| Barres | `#p10_roi_bar`, `#p10_tri_bar`, `#p10_lcoe_bar` | best (calcul barres) |

---

### PAGE 11 — Finance

| Élément | IDs DOM | ViewModel actuel |
|--------|---------|------------------|
| Meta | `p11_client`, `p11_ref`, `p11_date` | meta |
| Data | overlay `g11_*` | data (capex_ttc, kwc, battery_kwh, economies_annuelles_25) |

---

### PAGE 12 — Environnement

| Élément | IDs DOM | ViewModel actuel |
|--------|---------|------------------|
| Meta | `p12_client`, `p12_ref`, `p12_date` | meta |
| Donut | `donut_auto`, `donut_inj`, `donut_center` | env.autocons_pct |
| KPI | `v_co2`, `v_trees`, `v_cars`, `v_co2_25`, `v_trees_25`, `v_cars_25` | v_co2, v_trees, v_cars, etc. |

**Formule donut :** CIRC = 2π×42, autoLen = (autoPct/100)*CIRC.

---

### PAGE 13 — Technique

| Élément | IDs DOM | ViewModel actuel |
|--------|---------|------------------|
| Meta | `p13_client`, `p13_ref`, `p13_date` | meta |

**Contenu :** Hydratation pure, pas de données dynamiques dans le legacy.

---

### PAGE 14 — Meta finale

| Élément | IDs DOM | ViewModel actuel |
|--------|---------|------------------|
| Meta | `p14_client`, `p14_ref`, `p14_date` | meta |

---

## 3. TABLEAU DE MAPPING STRICT (ÉTAPE 2)

| Champ legacy | Source ViewModel actuel | Transformation | Statut |
|--------------|-------------------------|----------------|--------|
| p1_client | fullReport.p1.p1_auto.p1_client | direct | OK |
| p1_ref | fullReport.p1.p1_auto.p1_ref | direct | OK |
| p1_date | fullReport.p1.p1_auto.p1_date | direct | OK |
| p1_why | fullReport.p1.p1_auto.p1_why | direct | OK |
| p1_m_kwc | fullReport.p1.p1_auto.p1_m_kwc | direct | OK |
| p1_m_auto | fullReport.p1.p1_auto.p1_m_auto | direct | OK |
| p1_m_gain | fullReport.p1.p1_auto.p1_m_gain | direct | OK |
| p1_k_puissance | fullReport.p1.p1_auto.p1_k_puissance | direct | OK |
| p1_k_autonomie | fullReport.p1.p1_auto.p1_k_autonomie | direct | OK |
| p1_k_tri | fullReport.p1.p1_auto.p1_k_tri | direct (engine: "10 ans" = TRI, pas ROI) | **VÉRIFIER** |
| p1_k_gains | fullReport.p1.p1_auto.p1_k_gains | direct | OK |
| p1_param_kva | fullReport.p1.p1_auto.p1_param_kva | direct | OK |
| p1_param_reseau | fullReport.p1.p1_auto.p1_param_reseau | direct | OK |
| p1_param_conso | fullReport.p1.p1_auto.p1_param_conso | direct | OK |
| p1_photo | — | localStorage p3b_photo | **MANQUANT** |
| p2_* | fullReport.p2.p2_auto | direct | OK |
| p3_v_materiel | fullReport.p3.offer.materiel_ht | toLocaleString("fr-FR") + " €" | OK |
| p3_v_batterie | fullReport.p3.offer.batterie_ht | idem | OK |
| p3_v_shelly | fullReport.p3.offer.shelly_ht | idem | OK |
| p3_v_pose | fullReport.p3.offer.pose_ht | idem | OK |
| p3_v_gestion | fullReport.p3.offer.gestion_ht | idem | OK |
| p3_v_subht | fullReport.p3.offer.sous_total_ht | idem | OK |
| p3_r_puissance | fullReport.p3.offer.puissance | + " kWc" | OK |
| p3_r_batterie | fullReport.p3.offer.batterie_label | direct | OK |
| p3_r_onduleurs | fullReport.p3.offer.onduleurs | direct | OK |
| p3_r_garantie | fullReport.p3.offer.garantie | direct | OK |
| p3_r_echelon | fullReport.p3.offer.echelon | direct | OK |
| p3_r_validite | fullReport.p3.offer.validite | direct | OK |
| p3_r_delai | fullReport.p3.offer.delai | direct | OK |
| p3_list_inclus | — | localStorage | **MANQUANT** |
| p3_list_noninclus | — | localStorage | **MANQUANT** |
| p3b_* | fullReport.p3b.p3b_auto | mapping orientation (S→Sud) | OK |
| p3b_surface | p3b_auto.surface_m2 | + " m²" | OK |
| p3b_panneaux | p3b_auto.nb_panneaux | direct | OK |
| p4 production_kwh | fullReport.p4.production_kwh | array 12 | OK |
| p4 consommation_kwh | fullReport.p4.consommation_kwh | array 12 | OK |
| p4 autoconso_kwh | fullReport.p4.autoconso_kwh | array 12 | OK |
| p4 batterie_kwh | fullReport.p4.batterie_kwh | array 12 | OK |
| p5 production_kw | fullReport.p5.production_kw | array 24 | OK |
| p5 consommation_kw | fullReport.p5.consommation_kw | array 24 | OK |
| p5 batterie_kw | fullReport.p5.batterie_kw | array 24 | OK |
| p6 dir, bat, grid, tot | fullReport.p6.p6 | arrays 12 | OK |
| p6 price | fullReport.p6.p6.price | direct | OK |
| p7 pct | fullReport.p7.pct | c_pv_pct, c_bat_pct, c_grid_pct, p_auto_pct, p_bat_pct, p_surplus_pct | OK |
| p7 c_grid, p_surplus | fullReport.p7 | direct | OK |
| p8 A, B, profile | fullReport.p8 | direct | OK |
| p8 hypotheses | fullReport.p8.hypotheses | **PARTIEL** (annee, cycles_an, capacite_utile_kwh, profil_journee) | OK |
| p9 recommended, compare | fullReport.p9 | direct | OK |
| p10 best | fullReport.p10.best | direct | OK |
| p11 data | fullReport.p11.data | direct | OK |
| p12 env, v_* | fullReport.p12 | direct | OK |
| p13, p14 meta | fullReport.p13, p14 | direct | OK |

---

## 4. CHAMPS MANQUANTS (BLOQUANTS OU PARTIELS)

| Champ | Page | Impact | Action recommandée |
|-------|------|--------|---------------------|
| p1_photo / p3b_photo | P1, P3B | Image calepinage | Lister comme manque — pas d’invention. Option : placeholder "Aucune image" |
| p3_list_inclus | P3 | Liste personnalisable | Lister comme manque — valeurs par défaut si vide |
| p3_list_noninclus | P3 | Liste personnalisable | Idem |
| p3_ro_tva_pose | P3 | Taux TVA pose | Mapper depuis offer si présent |
| p2_caption | P2 | Légende tableau jalons | Texte statique ou champ dérivé — **MANQUANT** dans ViewModel |
| p8 interpretation (ligne1, ligne2, ligne3) | P8 | Textes auto | fullReport.p8.interpretation — mapper si disponible |

---

## 5. DIFFÉRENCES GRAPHIQUES À PORTER FIDÈLEMENT

| Page | Legacy | React actuel | Action |
|------|--------|--------------|--------|
| P2 | Chart.js line, tension 0.25, tooltip € | Recharts LineChart | Porter algo Chart.js ou équivalent strict (couleurs, pointillé) |
| P4 | SVG Catmull-Rom → Bézier | SVG paths simples | Réimplémenter catmullRom2bezier |
| P5 | SVG spline tension 0.10, dégradés | SVG paths simples | Réimplémenter spline + dégradés |
| P6 | SVG barres empilées #86D8F1, #B3F4C4, #CFCBFF | Idem | Vérifier couleurs exactes |
| P8 | SVG pathSmooth (Catmull-Rom), 4 courbes | Courbes simplifiées | Porter pathSmooth engine-p8 |
| P9 | SVG buildPath cumul, ROI pins | Recharts | Porter buildPath + pins SVG |
| P12 | Donut stroke-dasharray | Donut actuel | Vérifier formule CIRC, autoLen |

---

## 6. STRUCTURE VISUELLE LEGACY À CONSERVER

- **Classe `.sheet`** : 277mm × 190mm, padding 8mm 12mm, page-break-after: always
- **Barre dorée** : height 1mm, gradient #C39847 → #d4af63
- **Badge** : border #C39847, border-radius 999mm
- **Cards** : border 0.3mm #e6e8ee, border-radius 2.8mm, .soft = #faf9f6
- **Meta-compact** : flex, gap 6mm, text-align right
- **Logo** : /pdf-assets/images/logo-solarglobe-rect.png (à servir ou remplacer par chemin statique)

---

## 7. CONFIRMATIONS

- Aucun legacy réexécuté (engine-main, /api/view/pX)
- Aucun design réinventé — ce rapport décrit le portage fidèle à effectuer
- Champs manquants listés sans invention
- Mapping exhaustif fourni pour ÉTAPE 3 (portage React)

---

## 8. TABLEAU DE MAPPING EXHAUSTIF (ÉTAPE 2 — DÉTAIL)

### P1
| Champ legacy | Source ViewModel | Transformation |
|--------------|------------------|----------------|
| p1_client | fullReport.p1.p1_auto.p1_client | direct |
| p1_ref | fullReport.p1.p1_auto.p1_ref | direct |
| p1_date | fullReport.p1.p1_auto.p1_date | direct |
| p1_why | fullReport.p1.p1_auto.p1_why | direct |
| p1_m_kwc | fullReport.p1.p1_auto.p1_m_kwc | + " kWc" si nombre |
| p1_m_auto | fullReport.p1.p1_auto.p1_m_auto | + " %" si nombre |
| p1_m_gain | fullReport.p1.p1_auto.p1_m_gain | toLocaleString("fr-FR") + " €" |
| p1_k_puissance | fullReport.p1.p1_auto.p1_k_puissance | + " kWc" |
| p1_k_autonomie | fullReport.p1.p1_auto.p1_k_autonomie | + " %" |
| p1_k_tri | fullReport.p1.p1_auto.p1_k_tri | format "X %" ou "X ans" selon source |
| p1_k_gains | fullReport.p1.p1_auto.p1_k_gains | toLocaleString("fr-FR") + " €" |
| p1_param_kva | fullReport.p1.p1_auto.p1_param_kva | direct |
| p1_param_reseau | fullReport.p1.p1_auto.p1_param_reseau | direct |
| p1_param_conso | fullReport.p1.p1_auto.p1_param_conso | direct |
| p1_photo | — | **MANQUANT** (localStorage p3b_photo) |

### P2
| Champ legacy | Source ViewModel | Transformation |
|--------------|------------------|----------------|
| p2_client, p2_ref, p2_date | p2_auto | direct |
| p2_s1, p2_s2, p2_s3, p2_hint | p2_auto | direct |
| p2_jalons_body | p2_auto.p2_jalons | innerHTML table rows |
| p2_k_tri … p2_k_reste | p2_auto | direct |
| p2_b1, p2_b2, p2_b3 | p2_auto | direct |
| p2_chart | p2_chart_labels, p2_chart_sans, p2_chart_avec | Chart.js line (porter en SVG/Recharts fidèle) |

### P3
| Champ legacy | Source ViewModel | Transformation |
|--------------|------------------|----------------|
| p3_client, p3_ref, p3_date | meta | direct |
| p3_v_materiel … p3_v_subht | offer | toLocaleString + " €" |
| p3_ro_tva_mat, p3_v_tva_materiel | offer | direct |
| p3_v_ttc, p3_v_prime, p3_v_reste | offer | toLocaleString + " €" |
| p3_r_puissance … p3_r_delai | offer | direct |
| p3_v_mensu, p3_finance_note | finance | direct |
| p3_list_inclus, p3_list_noninclus | — | **MANQUANT** (localStorage) |

### P3b
| Champ legacy | Source ViewModel | Transformation |
|--------------|------------------|----------------|
| p3b_client, p3b_ref, p3b_date | p3b_auto | direct |
| p3b_inclinaison | p3b_auto.inclinaison | direct |
| p3b_orientation | p3b_auto.orientation | S→Sud, etc. |
| p3b_surface | p3b_auto.surface_m2 | + " m²" |
| p3b_panneaux | p3b_auto.nb_panneaux | direct |
| p3b_photo | — | **MANQUANT** |

### P4–P14
Voir sections 2 et 3 du présent rapport. Mapping identique : fullReport.pX → composant React.

---

*Rapport CP-PDF-V2-020 — ÉTAPES 1 et 2.*
