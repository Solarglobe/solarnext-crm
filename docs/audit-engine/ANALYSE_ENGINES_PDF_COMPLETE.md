# Analyse complète des engines PDF — pdf-template/engines/

**Mode :** ANALYSE UNIQUEMENT — Aucune modification de code.  
**Objectif :** Comprendre le moteur PDF précédent pour reconstruire le rendu dans pdf-render.tsx, conserver 100 % du visuel et des statistiques, supprimer définitivement les anciennes views `/api/view/pX`.

---

## 1. ENGINE MAIN

### Rôle
Orchestrateur central : récupère le scénario via `?scenario=A1`, charge séquentiellement les 15 vues via `GET /api/view/pX?scenario=...`, stocke les données dans `_data`, émet les événements `pX:update` pour chaque page.

### Événements émis (ordre d'exécution)
| Ordre | Événement | Déclenche |
|-------|-----------|-----------|
| 1 | `p1:update` | Page 1 (Couverture) |
| 2 | `p2:update` | Page 2 (Étude financière) |
| 3 | `p3:update` | Page 3 (Offre chiffrée) |
| 4 | `p3b:update` | Page 3b (Calepinage) |
| 5 | `p4:update` | Page 4 (Production & consommation) |
| 6 | `p5:update` | Page 5 (Journée type) |
| 7 | `p6:update` | Page 6 (Répartition) |
| 8 | `p7:update` | Page 7 (Origine/Destination) |
| 9 | `p8:update` | Page 8 (Impact batterie) |
| 10 | `p9:update` | Page 9 (Gains cumulés) |
| 11 | `p10:update` | Page 10 (Synthèse) |
| 12 | `p11:auto` | Page 11 (Finance) — **spécifique** : auto au lieu de update |
| 13 | `p12:update` | Page 12 (Environnement) |
| 14 | `p13:update` | Page 13 (Technique) |
| 15 | `p14:update` | Page 14 (Meta finale) |
| 16 | `all:loaded` | Signal final (après 600 ms) |

### Source des données
- URL : `?scenario=A1` (ou autre ID scénario)
- Fetch : `/api/view/p1` … `/api/view/p14`, `/api/view/p3b`
- Stockage : `Engine._data.p1` … `Engine._data.p14`

---

## 2. ENGINE P1 — Couverture / Synthèse

### Événement
`p1:update`

### JSON attendu
```json
{
  "p1_auto": {
    "p1_client": "string",
    "p1_ref": "string",
    "p1_date": "string",
    "p1_why": "string",
    "p1_m_kwc": "number|string",
    "p1_m_auto": "number|string",
    "p1_m_gain": "number|string",
    "p1_k_puissance": "number|string",
    "p1_k_autonomie": "number|string",
    "p1_k_tri": "number|string",
    "p1_k_gains": "number|string",
    "p1_param_kva": "string",
    "p1_param_reseau": "string",
    "p1_param_conso": "string"
  }
}
```

### Champs DOM
| ID | Rôle |
|----|------|
| `p1_client` | Nom client |
| `p1_ref` | Référence |
| `p1_date` | Date |
| `p1_why` | Contexte |
| `p1_m_kwc` | Puissance kWc (méthode) |
| `p1_m_auto` | Autonomie (méthode) |
| `p1_m_gain` | Gain (méthode) |
| `p1_k_puissance` | KPI Puissance |
| `p1_k_autonomie` | KPI Autonomie |
| `p1_k_tri` | KPI TRI |
| `p1_k_gains` | KPI Gains |
| `p1_param_kva` | Paramètre KVA |
| `p1_param_reseau` | Paramètre réseau |
| `p1_param_conso` | Paramètre conso |

### KPI
- Puissance, Autonomie, TRI, Gains

### Graphiques
Aucun.

### Autre
Envoi optionnel conso annuelle vers ERPNext (`receive_smartpitch_conso`).

---

## 3. ENGINE P2 — Étude financière 25 ans

### Événement
`p2:update`

### JSON attendu
```json
{
  "p2_auto": {
    "p2_client": "string",
    "p2_ref": "string",
    "p2_date": "string",
    "p2_s1": "string",
    "p2_s2": "string",
    "p2_s3": "string",
    "p2_hint": "string",
    "p2_k_tri": "string",
    "p2_k_roi": "string",
    "p2_k_lcoe": "string",
    "p2_k_economie25": "string",
    "p2_k_revente25": "string",
    "p2_k_gains": "string",
    "p2_k_tarif": "string",
    "p2_k_prime": "string",
    "p2_k_reste": "string",
    "p2_b1": "string",
    "p2_b2": "string",
    "p2_b3": "string",
    "p2_jalons": [{ "year": 5, "sans": 0, "avec": 0, "eco": 0 }, ...],
    "p2_chart_labels": ["Année 1", "Année 5", ...],
    "p2_chart_sans": [0, 0, ...],
    "p2_chart_avec": [0, 0, ...]
  }
}
```

### Champs DOM
| ID | Rôle |
|----|------|
| `p2_client`, `p2_ref`, `p2_date` | Meta |
| `p2_s1`, `p2_s2`, `p2_s3`, `p2_hint` | Textes |
| `p2_k_tri`, `p2_k_roi`, `p2_k_lcoe` | KPI |
| `p2_k_economie25`, `p2_k_revente25`, `p2_k_gains` | KPI économie |
| `p2_k_tarif`, `p2_k_prime`, `p2_k_reste` | KPI tarif/prime |
| `p2_b1`, `p2_b2`, `p2_b3` | Bénéfices |
| `p2_jalons_body` | Tableau jalons (innerHTML) |

### Graphiques
- **Type :** Chart.js — Line
- **Canvas :** `#p2_chart`
- **Datasets :** "Avec solaire" (doré #C39847), "Sans solaire" (noir pointillé)
- **Données :** `p2_chart_labels`, `p2_chart_sans`, `p2_chart_avec`
- **Options :** responsive: false, animation: false, tooltip €

### KPI
- TRI, ROI, LCOE, Économie 25 ans, Revente 25 ans, Gains, Tarif, Prime, Reste à charge

---

## 4. ENGINE P3 — Offre chiffrée

### Événement
`p3:update`

### JSON attendu
```json
{
  "meta": { "client": "", "ref": "", "date": "" },
  "offer": {
    "materiel_ht": 0,
    "batterie_ht": 0,
    "shelly_ht": 0,
    "pose_ht": 0,
    "gestion_ht": 0,
    "sous_total_ht": 0,
    "tva_mat": 0,
    "tva_pose": 0,
    "tva_materiel_eur": 0,
    "tva_pose_eur": 0,
    "total_ttc": 0,
    "prime": 0,
    "reste": 0,
    "puissance": 0,
    "batterie_label": "",
    "onduleurs": "",
    "garantie": "",
    "echelon": "",
    "validite": "",
    "delai": ""
  },
  "finance": { "mensualite": 0, "note": "" },
  "tech": {}
}
```

### Champs DOM
| ID | Rôle |
|----|------|
| `#p3_client`, `#p3_ref`, `#p3_date` | Meta |
| `#p3_v_materiel`, `#p3_v_batterie`, `#p3_v_shelly`, `#p3_v_pose`, `#p3_v_gestion`, `#p3_v_subht` | Offre HT |
| `#p3_ro_tva_mat`, `#p3_ro_tva_pose` | Taux TVA |
| `#p3_v_tva_materiel`, `#p3_v_tva_pose` | Montants TVA |
| `#p3_v_ttc`, `#p3_v_prime`, `#p3_v_reste` | Totaux |
| `#p3_v_mensu` | Mensualité |
| `#p3_finance_note` | Note financement |
| `#p3_r_puissance`, `#p3_r_batterie`, `#p3_r_onduleurs`, `#p3_r_garantie` | Résumé technique |
| `#p3_r_echelon`, `#p3_r_validite`, `#p3_r_delai` | Conditions |
| `#p3_list_inclus`, `#p3_list_noninclus` | Listes (localStorage overrides) |

### KPI
- Puissance, Batterie, Onduleurs, Garantie, Prime, Reste à charge

### Graphiques
Aucun.

---

## 5. ENGINE P3B — Calepinage toiture

### Événement
`p3b:update`

### JSON attendu
```json
{
  "p3b_auto": {
    "client": "",
    "ref": "",
    "date": "",
    "inclinaison": "",
    "orientation": "S|SE|SO|E|O",
    "surface_m2": 0,
    "nb_panneaux": 0
  }
}
```

### Champs DOM
| ID | Rôle |
|----|------|
| `p3b_client`, `p3b_ref`, `p3b_date` | Meta |
| `p3b_inclinaison` | Inclinaison toiture |
| `p3b_orientation` | Orientation (mappée : S→Sud, etc.) |
| `p3b_surface` | Surface m² |
| `p3b_panneaux` | Nombre panneaux |
| `#p3b_photo` | Zone image (localStorage `smartpitch_overrides.p3b_photo`) |

### Calculs locaux
- `nb_panneaux` : kwc (P1) / panel_kwc (smartpitch_settings)
- `surface_m2` : nb_panneaux × panel_surface_m2 (smartpitch_settings)

### Graphiques
Aucun (image optionnelle).

---

## 6. ENGINE P4 — Production & Consommation

### Événement
`p4:update`

### JSON attendu
```json
{
  "meta": { "client": "", "ref": "", "date": "", "date_display": "" },
  "production_kwh": [0, ...],
  "consommation_kwh": [0, ...],
  "autoconso_kwh": [0, ...],
  "batterie_kwh": [0, ...]
}
```

### Champs DOM
| ID | Rôle |
|----|------|
| `p4_client`, `p4_ref`, `p4_date` | Meta |
| `p4-chart` | SVG graphique (id réel dans drawChart) |
| `p4_chart_zone` | Zone graphique |
| `p4_numbers`, `p4_numbers_table` | Tableau totaux |
| `g4_inputs_body` | Corps overlay saisie |
| `p4_prod_m1` … `p4_prod_m12` | Inputs production |
| `p4_conso_m1` … `p4_conso_m12` | Inputs conso |
| `p4_auto_m1` … `p4_auto_m12` | Inputs autoconso |
| `p4_batt_m1` … `p4_batt_m12` | Inputs batterie |
| `leg-batt`, `leg-batt-text` | Légende batterie |
| `p4_overlay` | Overlay saisie |
| `p4_validated` | Indicateur validation |

### Graphiques
- **Type :** SVG custom (Catmull-Rom → Bézier)
- **Zone :** `#p4-chart` (drawChart utilise cet ID)
- **Données :** 12 mois × { prod, conso, auto, batt }
- **Courbes :** Production (or), Consommation (bleu), Autoconso (turquoise), Batterie (vert)
- **Formule :** `catmullRom2bezier(pts)` pour lissage

### KPI
- Production annuelle, Consommation, Autoconso, Batterie (totaux)

---

## 7. ENGINE P5 — Journée type

### Événement
`p5:update`

### JSON attendu
```json
{
  "meta": { "client": "", "ref": "", "date": "" },
  "p5": {
    "production_kw": [0, ...],
    "consommation_kw": [0, ...],
    "batterie_kw": [0, ...]
  }
}
```
Ou directement : `production_kw`, `consommation_kw`, `batterie_kw` (24 valeurs chacune).

### Champs DOM
| ID | Rôle |
|----|------|
| `p5_client`, `p5_ref`, `p5_date`, `p5_month` | Meta |
| `#p5-chart` | SVG graphique |
| `p5_chart_zone` | Zone graphique |
| `p5_leg_batt`, `p5_leg_batt_text` | Légende batterie |

### Graphiques
- **Type :** SVG custom (spline tension 0.10)
- **Fonction :** `window.API_p5_drawChart(series)`
- **Données :** 24h × { prod, conso, batt, auto }
- **Formules :** scaleConso = 4/maxConso, scaleBatt = 2.5/maxBatt, scaleAuto = scaleConso
- **Dégradés :** p5pv, p5conso, p5auto, p5batt

### KPI
Production, Consommation, Autoconso, Batterie (journée type).

---

## 8. ENGINE P6 — Répartition consommation

### Événement
`p6:update`

### JSON attendu
```json
{
  "p6": {
    "meta": { "client": "", "ref": "", "date": "" },
    "price": 0.18,
    "dir": [0, ...],
    "bat": [0, ...],
    "grid": [0, ...],
    "tot": [0, ...]
  }
}
```
12 valeurs par tableau (mois).

### Champs DOM
| ID | Rôle |
|----|------|
| `p6_client`, `p6_ref`, `p6_date` | Meta |
| `#p6-chart` | SVG graphique |
| `p6_chart_zone` | Zone graphique |
| `p6_autonomie` | % autonomie |
| `p6_autonomie_txt` | Texte autonomie |
| `p6_grid_kwh` | kWh réseau |
| `p6_grid_eur` | € réseau |
| `p6_auto_pct` | % autoconso |
| `p6_auto_txt` | Texte autoconso |
| `p6_kpis` | Zone KPI |
| `p6_cta` | CTA (masqué après hydratation) |

### Graphiques
- **Type :** SVG — barres empilées
- **Données :** dir (PV directe), bat (batterie), grid (réseau) par mois
- **Couleurs :** C_DIR #86D8F1, C_BATT #B3F4C4, C_GRID #CFCBFF

### KPI
- Autonomie %, Autoconso %, Part réseau (kWh, €)

### Formules
- `autonomie = 1 - (totGrid / totConso)`
- `autoPct = (totDir + totBat) / totConso`

---

## 9. ENGINE P7 — Origine / Destination énergie

### Événement
`p7:update`

### JSON attendu
```json
{
  "meta": { "client": "", "ref": "", "date": "" },
  "pct": {
    "c_pv_pct": 0,
    "c_bat_pct": 0,
    "c_grid_pct": 0,
    "p_auto_pct": 0,
    "p_bat_pct": 0,
    "p_surplus_pct": 0
  },
  "c_grid": 0,
  "p_surplus": 0
}
```

### Champs DOM
| ID | Rôle |
|----|------|
| `p7_client`, `p7_ref`, `p7_date`, `p7_meta_scen` | Meta |
| `p7_visual_zone` | Zone principale (buildP7 génère le contenu) |

### Rendu
- Barres segmentées (origine conso : PV directe, Batterie, Réseau)
- Barres segmentées (destination prod : Autoconso, Batterie, Surplus)
- 4 KPI cards : Autonomie, Autoconsommation, Part réseau, Surplus

### KPI
- Autonomie %, Autoconsommation %, Part réseau %, Surplus %

### Graphiques
Aucun (barres flex CSS).

---

## 10. ENGINE P8 — Impact batterie

### Événement
`p8:update`

### JSON attendu
```json
{
  "meta": { "client": "", "ref": "", "date": "" },
  "year": "",
  "A": {
    "production_kwh": 0,
    "autocons_kwh": 0,
    "surplus_kwh": 0,
    "grid_import_kwh": 0,
    "autonomie_pct": 0
  },
  "B": {
    "production_kwh": 0,
    "autocons_kwh": 0,
    "battery_throughput_kwh": 0,
    "surplus_kwh": 0,
    "grid_import_kwh": 0,
    "autonomie_pct": 0
  },
  "profile": {
    "pv": [0, ...],
    "load": [0, ...],
    "charge": [0, ...],
    "discharge": [0, ...]
  },
  "hypotheses": {
    "annee": "",
    "cycles_an": 0,
    "capacite_utile_kwh": 0,
    "profil_journee": ""
  },
  "detailsBatterie": {
    "gain_autonomie_pts": 0,
    "reduction_achat_kwh": 0,
    "reduction_achat_eur": 0
  },
  "kpis": {},
  "texteSousBarres": { "b1": "", "b2": "", "b3": "" },
  "interpretation": { "ligne1": "", "ligne2": "", "ligne3": "" }
}
```

### Champs DOM
| ID | Rôle |
|----|------|
| `p8_client`, `p8_ref`, `p8_date`, `p8_meta_year` | Meta |
| `#p8_svg`, `#p8_svg_lines` | SVG courbes |
| `#p8_a_auto`, `#p8_a_surplus` | Barres scénario A |
| `#p8_b_auto`, `#p8_b_batt`, `#p8_b_surplus` | Barres scénario B |
| `#p8_t_A_prod`, `#p8_t_B_prod`, etc. | Tableau comparaison |
| `#p8_h_year`, `#p8_h_cycles`, `#p8_h_capacity`, `#p8_h_profile` | Hypothèses |
| `#p8_kpi_autonomie`, `#p8_kpi_autonomie_note` | KPI gain autonomie |
| `#p8_kpi_grid`, `#p8_kpi_grid_note` | KPI réduction réseau |
| `#p8_delta_*`, `#p8_i_*` | Textes interprétation |
| `#p8_action`, `#p8_results` | Visibilité |

### Graphiques
- **Type :** SVG — courbes Tesla soft (interpolation monotone PCHIP)
- **Courbes :** pv (#FFD54F), load (#CFCFCF), charge (#A6E3AE), discharge (#2E8B57)
- **Formule :** `monotone(points)` pour tangentes, Bézier cubic

### KPI
- Gain autonomie (pts), Réduction achats réseau (kWh, €)

---

## 11. ENGINE P9 — Gains cumulés 25 ans

### Événement
`p9:update`

### JSON attendu
```json
{
  "meta": { "client": "", "ref": "", "date": "" },
  "recommended": {
    "label": "Sans batterie",
    "cumul_25y": [0, ...],
    "roi_year": 8,
    "tri_pct": 5.2
  },
  "compare": {
    "label": "Avec batterie",
    "cumul_25y": [0, ...],
    "roi_year": 10,
    "tri_pct": 4.1
  }
}
```
`cumul_25y` : 25 valeurs (années 1 à 25).

### Champs DOM
| ID | Rôle |
|----|------|
| `p9_client`, `p9_ref`, `p9_date` | Meta |
| `p9_leg_a`, `p9_leg_b` | Labels légende |
| `p9_a_total`, `p9_b_total` | Totaux 25 ans |
| `p9_a_meta`, `p9_b_meta` | ROI + TRI |
| `p9_tri_a`, `p9_tri_b` | TRI détaillé |
| `#p9_chart` | SVG graphique |
| `#p9_roi_pins` | Pins ROI (divs positionnés) |
| `#p9_results` | Zone résultats |

### Graphiques
- **Type :** SVG généré en JS
- **Courbes :** Sans batterie (gris #4A5568), Avec batterie (doré #C39847)
- **Pins :** Lignes verticales ROI année
- **Formule :** `buildPath(cumul_25y)` → path M/L

### KPI
- ROI (année), TRI (%), Gains cumulés 25 ans (€)

---

## 12. ENGINE P10 — Synthèse finale

### Événement
`p10:update`

### JSON attendu
```json
{
  "meta": { "client": "", "ref": "", "date": "" },
  "best": {
    "kwc": 0,
    "modules_label": "",
    "inverter_label": "",
    "savings_year1_eur": 0,
    "roi_years": 0,
    "tri_pct": 0,
    "cfg_label": "",
    "battery_kwh": 0,
    "autoprod_pct": 0,
    "autonomy_pct": 0,
    "gains_25_eur": 0,
    "lcoe_eur_kwh": 0
  },
  "hyp": {
    "pv_degrad": 0.5,
    "elec_infl": 4,
    "oa_price": 0.04
  }
}
```

### Champs DOM
| ID | Rôle |
|----|------|
| `p10_client`, `p10_ref`, `p10_date` | Meta |
| `p10_kwc`, `p10_modules` | Config |
| `p10_savings_y1` | Économies année 1 |
| `p10_roi`, `p10_tri`, `p10_lcoe` | KPI |
| `p10_cfg` | Label config |
| `p10_autoprod`, `p10_autonomy`, `p10_gains25` | Autonomie/gains |
| `p10_roi_val`, `p10_tri_val`, `p10_lcoe_val` | Valeurs brutes |
| `#p10_roi_bar`, `#p10_tri_bar`, `#p10_lcoe_bar` | Barres de progression |
| `p10_audit` | Texte audit |
| `p10_action`, `p10_result` | Visibilité |

### KPI
- kWc, ROI, TRI, LCOE, Économies an 1, Gains 25 ans, Autoprod %, Autonomie %

### Formules barres
- `roi_bar` : (MAX.ROI - roi) / MAX.ROI
- `tri_bar` : tri / MAX.TRI
- `lcoe_bar` : lcoe / MAX.LCOE

---

## 13. ENGINE P11 — Finance

### Événement
`p11:auto` (émis par engine-main, pas p11:update en premier)

### JSON attendu
```json
{
  "meta": { "client": "", "ref": "", "date": "" },
  "data": {
    "capex_ttc": 0,
    "kwc": 0,
    "battery_kwh": 0,
    "economies_annuelles_25": [0, ...]
  }
}
```

### Champs DOM
| ID | Rôle |
|----|------|
| `p11_client`, `p11_ref`, `p11_date` | Meta (page) |
| `#g11_in_client`, `#g11_in_ref`, `#g11_in_date` | Overlay meta |
| `#g11_amount_in` | Capex TTC |
| `#g11_base_in` | Config (kWc + batterie) |
| `#g11_eco_in` | Économies (CSV) |

### KPI
- Capex, Économies annuelles

### Graphiques
Aucun.

---

## 14. ENGINE P12 — Environnement

### Événement
`p12:update`

### JSON attendu
```json
{
  "meta": { "client": "", "ref": "", "date": "" },
  "env": {
    "autocons_pct": 0
  },
  "v_co2": "",
  "v_trees": "",
  "v_cars": "",
  "v_co2_25": "",
  "v_trees_25": "",
  "v_cars_25": ""
}
```

### Champs DOM
| ID | Rôle |
|----|------|
| `p12_client`, `p12_ref`, `p12_date` | Meta |
| `v_co2`, `v_trees`, `v_cars` | KPI an 1 |
| `v_co2_25`, `v_trees_25`, `v_cars_25` | KPI 25 ans |
| `donut_auto`, `donut_inj` | Cercles SVG (stroke-dasharray) |
| `donut_center` | Texte central % |

### Graphiques
- **Type :** Donut SVG (stroke-dasharray)
- **Formule :** `CIRC = 2π×42`, `autoLen = (autoPct/100)*CIRC`, `injLen = CIRC - autoLen`

### KPI
- CO₂ évité, Arbres équivalents, Voitures équivalents (an 1 et 25 ans)

---

## 15. ENGINE P13 — Technique

### Événement
`p13:update`

### JSON attendu
```json
{
  "meta": { "client": "", "ref": "", "date": "" }
}
```

### Champs DOM
| ID | Rôle |
|----|------|
| `p13_client`, `p13_ref`, `p13_date` | Meta |

### KPI
Aucun (hydratation pure).

---

## 16. ENGINE P14 — Meta finale

### Événement
`p14:update`

### JSON attendu
```json
{
  "meta": { "client": "", "ref": "", "date": "" }
}
```

### Champs DOM
| ID | Rôle |
|----|------|
| `p14_client`, `p14_ref`, `p14_date` | Meta |

### KPI
Aucun.

---

## 17. STRUCTURE JSON GLOBALE ATTENDUE

Le pipeline actuel V2 utilise `selected_scenario_snapshot` → `pdfViewModel.mapper` → ViewModel unique. Pour reproduire le legacy, il faudrait soit :

1. **Adapter le mapper** pour produire une structure compatible avec les 15 pages (p1_auto, p2_auto, … p14, p3b_auto)
2. **Ou** créer 15 sous-objets dans le ViewModel correspondant aux payloads attendus par chaque engine

Structure agrégée (tous les payloads) :
```
{
  p1: { p1_auto: {...} },
  p2: { p2_auto: {...} },
  p3: { meta, offer, finance, tech },
  p3b: { p3b_auto: {...} },
  p4: { meta, production_kwh, consommation_kwh, autoconso_kwh, batterie_kwh },
  p5: { meta, p5: {...} },
  p6: { p6: { meta, price, dir, bat, grid, tot } },
  p7: { meta, pct, c_grid, p_surplus },
  p8: { meta, A, B, profile, hypotheses, ... },
  p9: { meta, recommended, compare },
  p10: { meta, best, hyp },
  p11: { meta, data },
  p12: { meta, env, v_co2, ... },
  p13: { meta },
  p14: { meta }
}
```

---

## 18. STRUCTURE REACT RECOMMANDÉE

Pour `pdf-render.tsx` (ou équivalent), proposer une architecture modulaire :

```
frontend/src/
├── pdf-render.tsx                 # Point d'entrée (existant)
├── pages/pdf/
│   ├── StudySnapshotPdfPage.tsx   # Page actuelle (minimal)
│   └── PdfLegacyReplica/          # Ou PdfFullReport/
│       ├── index.tsx              # Conteneur 15 pages
│       ├── PdfPage1.tsx           # Couverture
│       ├── PdfPage2.tsx           # Étude financière (Chart.js)
│       ├── PdfPage3.tsx           # Offre chiffrée
│       ├── PdfPage3b.tsx          # Calepinage
│       ├── PdfPage4.tsx           # Production & conso (SVG)
│       ├── PdfPage5.tsx           # Journée type (SVG)
│       ├── PdfPage6.tsx           # Répartition (SVG)
│       ├── PdfPage7.tsx           # Origine/Destination
│       ├── PdfPage8.tsx           # Impact batterie (SVG)
│       ├── PdfPage9.tsx           # Gains cumulés (SVG)
│       ├── PdfPage10.tsx          # Synthèse
│       ├── PdfPage11.tsx          # Finance
│       ├── PdfPage12.tsx          # Environnement (donut)
│       ├── PdfPage13.tsx          # Technique
│       ├── PdfPage14.tsx          # Meta finale
│       └── components/
│           ├── PdfChartP2.tsx     # Chart.js line
│           ├── PdfChartP4.tsx     # SVG prod/conso
│           ├── PdfChartP5.tsx     # SVG journée type
│           ├── PdfChartP6.tsx     # SVG barres empilées
│           ├── PdfChartP8.tsx     # SVG courbes batterie
│           ├── PdfChartP9.tsx     # SVG gains cumulés
│           └── PdfDonutP12.tsx    # Donut environnement
```

### Flux de données recommandé

1. **StudySnapshotPdfPage** (ou PdfFullReport) reçoit le ViewModel complet depuis `GET /api/.../pdf-view-model`
2. Le ViewModel est enrichi par le backend pour inclure toutes les structures p1…p14 (mapper étendu ou service dédié)
3. Chaque `PdfPageX` reçoit en props la portion du ViewModel qui correspond à son engine
4. Les graphiques sont des composants React (Chart.js pour P2, SVG pour P4/P5/P6/P8/P9, donut pour P12)

### Dépendances à conserver

- **Chart.js** : pour P2 uniquement (ou remplacer par SVG/Recharts si souhaité)
- **Aucune dépendance** à `localStorage` pour le rendu PDF final (overrides = mode édition, à exclure du PDF)
- **Aucun** appel ERPNext dans le flux PDF

---

## 19. RÉCAPITULATIF KPI GLOBAUX

| KPI | Pages |
|-----|-------|
| Puissance (kWc) | P1, P3, P10 |
| Autonomie (%) | P1, P6, P7, P8, P10 |
| TRI (%) | P1, P2, P9, P10 |
| ROI (ans) | P2, P9, P10 |
| Gains (€) | P1, P2, P9, P10 |
| LCOE (€/kWh) | P2, P10 |
| Production (kWh) | P4, P5, P8 |
| Consommation (kWh) | P4, P5, P6 |
| Économies (€) | P2, P10 |
| Prime / Reste à charge | P2, P3 |
| CO₂ / Arbres / Voitures | P12 |

---

## 20. RÉCAPITULATIF GRAPHIQUES

| Page | Techno | Élément | Données |
|------|--------|---------|---------|
| P2 | Chart.js | #p2_chart | labels, sans, avec (25 ans) |
| P4 | SVG custom | #p4-chart | prod, conso, auto, batt (12 mois) |
| P5 | SVG custom | #p5-chart | prod, conso, batt (24h) |
| P6 | SVG custom | #p6-chart | dir, bat, grid (12 mois) |
| P8 | SVG custom | #p8_svg_lines | pv, load, charge, discharge (24h) |
| P9 | SVG custom | #p9_chart | cumul_25y × 2 courbes |
| P12 | SVG donut | donut_auto, donut_inj | autocons_pct |

---

*Rapport généré — Analyse uniquement, aucune modification effectuée.*
