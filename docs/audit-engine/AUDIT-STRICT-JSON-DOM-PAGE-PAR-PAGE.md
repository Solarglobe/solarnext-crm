# Audit strict JSON → DOM page par page

**Date :** 2026-03-09  
**Mode :** Audit strict — AUCUNE modification de code  
**Objectif :** Comparer JSON backend → payload engine → DOM final pour chaque page

---

## Flux de données

```
Backend (pdfViewModel.mapper.js)
  → mapSelectedScenarioSnapshotToPdfViewModel(snapshot)
  → viewModel.fullReport = { p1, p2, ..., p14 }

Frontend (StudySnapshotPdfPage)
  → fetch /api/.../pdf-view-model
  → viewModel

useLegacyPdfEngine
  → emitPdfViewData({ fullReport })
  → engine-bridge._emit("pX:update", fr.pX)

Engine-pX
  → reçoit payload = fr.pX
  → set("#pX_*", valeur)
  → DOM mis à jour
```

---

## PAGE 1

### Champs représentatifs

| DOM ID | JSON SOURCE | PAYLOAD ENGINE | DOM FINAL | OK ? |
|--------|-------------|----------------|-----------|------|
| #p1_client | fullReport.p1.p1_auto.p1_client | a.p1_client (mapper: clientName) | String(val) ou "—" | OK |
| #p1_ref | fullReport.p1.p1_auto.p1_ref | a.p1_ref (mapper: SP-{studyId}-{versionId}) | String(val) ou "—" | OK |
| #p1_date | fullReport.p1.p1_auto.p1_date | a.p1_date (mapper: dateDisplay) | String(val) ou "—" | OK |
| #p1_m_kwc | fullReport.p1.p1_auto.p1_m_kwc | a.p1_m_kwc (mapper: systemPowerKw) | String(val) ou "—" | OK |
| #p1_k_tri | fullReport.p1.p1_auto.p1_k_tri | a.p1_k_tri (mapper: finance.irr_pct) | String(val) ou "—" | OK |
| #p1_k_gains | fullReport.p1.p1_auto.p1_k_gains | a.p1_k_gains (mapper: economie_year_1 * 25) | String(val) ou "—" | OK |
| #p1_param_conso | fullReport.p1.p1_auto.p1_param_conso | a.p1_param_conso (mapper: "X kWh/an") | String(val) ou "—" | OK |

**Engine :** set(id, val) → val null/undefined/"" → "—", sinon String(val). Aucune transformation.

**Conclusion P1 :** OK — Engine affiche exactement les valeurs du JSON.

---

## PAGE 2

### Champs représentatifs

| DOM ID | JSON SOURCE | PAYLOAD ENGINE | DOM FINAL | OK ? |
|--------|-------------|----------------|-----------|------|
| #p2_client | fullReport.p2.p2_auto.p2_client | a.p2_client | String(val) | OK |
| #p2_k_tri | fullReport.p2.p2_auto.p2_k_tri | a.p2_k_tri (mapper: `${irr_pct.toFixed(1)} %`) | String(val) | OK |
| #p2_k_roi | fullReport.p2.p2_auto.p2_k_roi | a.p2_k_roi (mapper: `${roiYears} ans`) | String(val) | OK |
| #p2_k_gains | fullReport.p2.p2_auto.p2_k_gains | a.p2_k_gains (mapper: toLocaleString) | String(val) | OK |
| #p2_chart_labels | fullReport.p2.p2_auto.p2_chart_labels | a.p2_chart_labels | Chart.js labels | OK |
| #p2_chart_sans | fullReport.p2.p2_auto.p2_chart_sans | a.p2_chart_sans | Chart.js dataset | OK |
| #p2_chart_avec | fullReport.p2.p2_auto.p2_chart_avec | a.p2_chart_avec | Chart.js dataset | OK |

### Graphe P2

| Élément | Source JSON | Engine reçoit ? | DOM/SVG généré ? | Conclusion |
|--------|-------------|-----------------|------------------|------------|
| p2_chart_labels | p2_auto.p2_chart_labels [6] | OUI | Chart.js canvas | OK |
| p2_chart_sans | p2_auto.p2_chart_sans [6] | OUI | Chart.js dataset | OK |
| p2_chart_avec | p2_auto.p2_chart_avec [6] | OUI | Chart.js dataset | OK |

**Conclusion P2 :** OK — Données injectées, graphique Chart.js généré.

---

## PAGE 3

### Champs représentatifs

| DOM ID | JSON SOURCE | PAYLOAD ENGINE | DOM FINAL | OK ? |
|--------|-------------|----------------|-----------|------|
| #p3_client | fullReport.p3.meta.client | meta.client | String(val) | OK |
| #p3_ref | fullReport.p3.meta.ref | meta.ref | String(val) | OK |
| #p3_date | fullReport.p3.meta.date | meta.date | String(val) | OK |
| #p3_v_ttc | fullReport.p3.offer.total_ttc | offer.total_ttc | String(val) | OK |
| #p3_v_prime | fullReport.p3.offer.prime | offer.prime (mapper: 0) | String(val) | OK |
| #p3_r_puissance | fullReport.p3.offer.puissance | offer.puissance | String(val) | OK |
| #p3_v_mensu | fullReport.p3.finance.mensualite | finance.mensualite (mapper: 0) | String(val) | OK |

**Payload :** fr.p3 = { meta, offer, finance, tech }. Engine attend auto.meta, auto.offer, auto.finance → payload = auto. OK.

**Conclusion P3 :** OK — Structure alignée, valeurs brutes affichées.

---

## PAGE 3B

### Champs représentatifs

| DOM ID | JSON SOURCE | PAYLOAD ENGINE | DOM FINAL | OK ? |
|--------|-------------|----------------|-----------|------|
| #p3b_client | fullReport.p3b.p3b_auto.client | a.client | String(val) | OK |
| #p3b_ref | fullReport.p3b.p3b_auto.ref | a.ref | String(val) | OK |
| #p3b_date | fullReport.p3b.p3b_auto.date | a.date | String(val) | OK |
| #p3b_inclinaison | fullReport.p3b.p3b_auto.inclinaison | a.inclinaison | String(val) | OK |
| #p3b_orientation | fullReport.p3b.p3b_auto.orientation | a.orientation | String(val) | OK |
| #p3b_surface | fullReport.p3b.p3b_auto.surface_m2 | a.surface_m2 | String(val) | OK |
| #p3b_panneaux | fullReport.p3b.p3b_auto.nb_panneaux | a.nb_panneaux | String(val) | OK |

**Payload :** fr.p3b = { p3b_auto: { client, ref, date, inclinaison, orientation, surface_m2, nb_panneaux } }. Engine lit a = payload.p3b_auto. OK.

**Conclusion P3B :** OK — Données brutes, pas de computeLocalPanelData.

---

## PAGE 4

### Champs représentatifs

| DOM ID | JSON SOURCE | PAYLOAD ENGINE | DOM FINAL | OK ? |
|--------|-------------|----------------|-----------|------|
| #p4_client | fullReport.p4.meta.client | meta.client | String(val) | OK |
| #p4_ref | fullReport.p4.meta.ref | meta.ref | String(val) | OK |
| #p4_date | fullReport.p4.meta.date_display | meta.date_display | String(val) | OK |

### Graphe P4

| Élément | Source JSON | Engine reçoit ? | DOM/SVG généré ? | Conclusion |
|--------|-------------|-----------------|------------------|------------|
| production_kwh | fullReport.p4.production_kwh [12] | OUI (payload direct) | drawChart(rows) | OK |
| consommation_kwh | fullReport.p4.consommation_kwh [12] | OUI | drawChart(rows) | OK |
| autoconso_kwh | fullReport.p4.autoconso_kwh [12] | OUI | drawChart(rows) | OK |
| batterie_kwh | fullReport.p4.batterie_kwh [12] | OUI | drawChart(rows) | OK |

**Source JSON (mapper L296-301) :**
- production_kwh = monthly (normalizeMonthlyProduction)
- consommation_kwh = consoMonthly (recalcul sinus)
- autoconso_kwh = autoMonthly (min(prod, conso))
- batterie_kwh = [12].fill(0)

**Conclusion P4 :** OK — Tableaux présents, graphique généré. Données dérivées du snapshot (mapper).

---

## PAGE 5

### Champs représentatifs

| DOM ID | JSON SOURCE | PAYLOAD ENGINE | DOM FINAL | OK ? |
|--------|-------------|----------------|-----------|------|
| #p5_client | fullReport.p5.meta.client | meta.client | String(val) | OK |
| #p5_ref | fullReport.p5.meta.ref | meta.ref | String(val) | OK |
| #p5_date | fullReport.p5.meta.date | meta.date | String(val) | OK |

### Graphe P5

| Élément | Source JSON | Engine reçoit ? | DOM/SVG généré ? | Conclusion |
|--------|-------------|-----------------|------------------|------------|
| production_kw | fullReport.p5.production_kw [24] | OUI | API_p5_drawChart(series) | OK |
| consommation_kw | fullReport.p5.consommation_kw [24] | OUI | idem | OK |
| batterie_kw | fullReport.p5.batterie_kw [24] | OUI | idem | OK |

**Payload :** fr.p5 = { meta, production_kw, consommation_kw, batterie_kw }. Engine fait mergeSeries(payload) → payload direct, pas de .p5. OK.

**Conclusion P5 :** OK — Données injectées, graphique SVG généré.

---

## PAGE 6

### Champs représentatifs

| DOM ID | JSON SOURCE | PAYLOAD ENGINE | DOM FINAL | OK ? |
|--------|-------------|----------------|-----------|------|
| #p6_client | fullReport.p6.p6.meta.client | data.meta.client | String(val) | OK |
| #p6_ref | fullReport.p6.p6.meta.ref | data.meta.ref | String(val) | OK |
| #p6_date | fullReport.p6.p6.meta.date | data.meta.date | String(val) | OK |
| #p6_autonomie | calculé: (1 - totGrid/totConso)*100 | mergeSeries → renderKPIs | String(autonomie*100) | KO* |
| #p6_grid_kwh | calculé: sum(grid) | mergeSeries → renderKPIs | String(totGrid) | KO* |

\* **KO** : Les KPI (autonomie, grid_kwh, auto_pct) sont **calculés** par l'engine à partir de dir, bat, grid, tot. Ce n'est plus une transformation des données source (round, etc.) mais un **calcul dérivé**. Le JSON envoie dir, bat, grid, tot ; l'engine en déduit autonomie, totGrid. Si la règle est "JSON → DOM sans calcul", alors P6 KPI = KO (calcul engine). Si la règle est "pas de round/ceil", alors P6 = OK (les valeurs affichées sont les sommes brutes en String).

### Graphe P6

| Élément | Source JSON | Engine reçoit ? | DOM/SVG généré ? | Conclusion |
|--------|-------------|-----------------|------------------|------------|
| dir | fullReport.p6.p6.dir [12] | OUI (payload.p6) | drawChart(dir, bat, grid, tot) | OK |
| bat | fullReport.p6.p6.bat [12] | OUI | idem | OK |
| grid | fullReport.p6.p6.grid [12] | OUI | idem | OK |
| tot | fullReport.p6.p6.tot [12] | OUI | idem | OK |

**Conclusion P6 :** OK pour le graphique. KPI : calcul engine (autonomie = f(dir,bat,grid,tot)) — pas de valeur "autonomie" dans le JSON. Cause : **mapper** n'envoie pas p6_autonomie, p6_grid_kwh ; l'engine les calcule.

---

## PAGE 7

### Champs représentatifs

| DOM ID | JSON SOURCE | PAYLOAD ENGINE | DOM FINAL | OK ? |
|--------|-------------|----------------|-----------|------|
| #p7_client | fullReport.p7.meta.client | payload.meta.client | String(val) | OK |
| #p7_ref | fullReport.p7.meta.ref | payload.meta.ref | String(val) | OK |
| #p7_date | fullReport.p7.meta.date | payload.meta.date | String(val) | OK |
| #p7_meta_scen | fullReport.p7.meta.scenario_label | payload.meta.scenario_label | String(val) | OK |
| conso.pv | fullReport.p7.pct.c_pv_pct | pct.c_pv_pct | safeNum, pas de normalisation | OK |
| conso.grid | fullReport.p7.pct.c_grid_pct | pct.c_grid_pct | safeNum | OK |
| prod.auto | fullReport.p7.pct.p_auto_pct | pct.p_auto_pct | safeNum | OK |

**Conclusion P7 :** OK — Normalisation 100 % supprimée, payload.pct affiché directement.

---

## PAGE 8

### Champs représentatifs

| DOM ID | JSON SOURCE | PAYLOAD ENGINE | DOM FINAL | OK ? |
|--------|-------------|----------------|-----------|------|
| #p8_client | fullReport.p8.meta.client | d.meta.client | String(val) | OK |
| #p8_ref | fullReport.p8.meta.ref | d.meta.ref | String(val) | OK |
| #p8_date | fullReport.p8.meta.date | d.meta.date | String(val) | OK |
| #p8_meta_year | fullReport.p8.year | d.year | String(val) | OK |
| #p8_t_A_prod | fullReport.p8.A.production_kwh | A.production_kwh | String(val) | OK |
| #p8_t_B_autopct | fullReport.p8.B.autonomie_pct | B.autonomie_pct | displayVal | OK |
| #p8_h_year | fullReport.p8.hypotheses.annee | h.annee | String(val) | KO |
| #p8_h_cycles | fullReport.p8.hypotheses.cycles_an | h.cycles_an | String(val) | KO |
| #p8_h_capacity | fullReport.p8.hypotheses.capacite_utile_kwh | h.capacite_utile_kwh | String(val) | KO |

### Graphe P8

| Élément | Source JSON | Engine reçoit ? | DOM/SVG généré ? | Conclusion |
|--------|-------------|-----------------|------------------|------------|
| profile.pv | fullReport.p8.profile.pv [24] | OUI | drawLines(profile) | OK |
| profile.load | fullReport.p8.profile.load [24] | OUI | idem | OK |
| profile.charge | fullReport.p8.profile.charge [24] | OUI | idem | OK |
| profile.discharge | fullReport.p8.profile.discharge [24] | OUI | idem | OK |

**Cause KO P8 :** Mapper L339 produit `hypotheses: { annee: "", cycles_an: 0, capacite_utile_kwh: 0, profil_journee: "" }` — valeurs vides en dur. **Problème : backend (mapper)**.

**Conclusion P8 :** KO — hypotheses vides (mapper). Graphique OK.

---

## PAGE 9

### Champs représentatifs

| DOM ID | JSON SOURCE | PAYLOAD ENGINE | DOM FINAL | OK ? |
|--------|-------------|----------------|-----------|------|
| #p9_client | fullReport.p9.meta.client | p.meta.client | String(val) | OK |
| #p9_ref | fullReport.p9.meta.ref | p.meta.ref | String(val) | OK |
| #p9_date | fullReport.p9.meta.date | p.meta.date | String(val) | OK |
| #p9_a_total | fullReport.p9.recommended.cumul_25y[24] | A.cumul_25y[24] | euro() | OK |
| #p9_b_total | fullReport.p9.compare.cumul_25y[24] | B.cumul_25y[24] | euro() | KO* |
| #p9_a_meta | fullReport.p9.recommended.roi_year, tri_pct | A.roi_year, A.tri_pct | String | OK |
| #p9_b_meta | fullReport.p9.compare.roi_year, tri_pct | B.roi_year, B.tri_pct | String | KO* |

\* **KO** : Mapper L347-350 produit pour `compare` :
- `cumul_25y: cumul25y.map((v, i) => v + (i > 5 ? 500 * i : 0))` — simulation
- `roi_year: roiYears + 2` — simulation
- `tri_pct: irr_pct - 0.5` — simulation

**Cause KO P9 :** Données simulées dans le **mapper (backend)**. L'engine affiche exactement ce qu'il reçoit.

### Graphe P9

| Élément | Source JSON | Engine reçoit ? | DOM/SVG généré ? | Conclusion |
|--------|-------------|-----------------|------------------|------------|
| recommended.cumul_25y | [25] | OUI | drawGraph(Ac, Bc) | OK |
| compare.cumul_25y | [25] simulé | OUI | idem | OK (engine correct, données fausses) |

**Conclusion P9 :** KO — Simulation batterie dans le **mapper** (compare.cumul_25y, roi_year, tri_pct). Engine affiche correctement les valeurs reçues.

---

## PAGE 10

### Champs représentatifs

| DOM ID | JSON SOURCE | PAYLOAD ENGINE | DOM FINAL | OK ? |
|--------|-------------|----------------|-----------|------|
| #p10_client | fullReport.p10.meta.client | meta.client | String(val) | OK |
| #p10_ref | fullReport.p10.meta.ref | meta.ref | String(val) | OK |
| #p10_date | fullReport.p10.meta.date | meta.date | String(val) | OK |
| #p10_kwc | fullReport.p10.best.kwc | b.kwc | String(val) | OK |
| #p10_roi | fullReport.p10.best.roi_years | b.roi_years | String(val) | OK |
| #p10_tri | fullReport.p10.best.tri_pct | b.tri_pct | String(val) | OK |
| #p10_audit | fullReport.p10.hyp.* | hyp.pv_degrad, elec_infl, oa_price | String(val) | OK |

**Conclusion P10 :** OK — Valeurs brutes, pas de nf0/nf1/nf3.

---

## PAGE 11

### Champs représentatifs

| DOM ID | JSON SOURCE | PAYLOAD ENGINE | DOM FINAL | OK ? |
|--------|-------------|----------------|-----------|------|
| #p11_client | fullReport.p11.meta.client | meta.client | String(val) | OK |
| #p11_ref | fullReport.p11.meta.ref | meta.ref | String(val) | OK |
| #p11_date | fullReport.p11.meta.date | meta.date | String(val) | OK |
| #p11_amount | fullReport.p11.data.capex_ttc | data.capex_ttc | set(id, val) | OK |
| #p11_base | fullReport.p11.data.kwc, battery_kwh | data.kwc, data.battery_kwh | "X kWc + batterie Y kWh" | OK |
| #p11_eco | fullReport.p11.data.economies_annuelles_25 | data.economies_annuelles_25 | join(", ") | OK |

**Payload :** fr.p11 = { meta, data: { capex_ttc, kwc, battery_kwh, economies_annuelles_25 } }. Engine renderP11 affiche ces champs. OK.

**Conclusion P11 :** OK — Données techniques affichées sans overlay.

---

## PAGE 12

### Champs représentatifs

| DOM ID | JSON SOURCE | PAYLOAD ENGINE | DOM FINAL | OK ? |
|--------|-------------|----------------|-----------|------|
| #p12_client | fullReport.p12.meta.client | meta.client | String(val) | OK |
| #p12_ref | fullReport.p12.meta.ref | meta.ref | String(val) | OK |
| #p12_date | fullReport.p12.meta.date | meta.date | String(val) | OK |
| #v_co2 | fullReport.p12.v_co2 | payload.v_co2 | String(val) | OK |
| #v_trees | fullReport.p12.v_trees | payload.v_trees | String(val) | OK |
| #v_cars | fullReport.p12.v_cars | payload.v_cars | String(val) | OK |
| #donut_center | fullReport.p12.env.autocons_pct | env.autocons_pct | String(autoPct) | OK |

### Graphe P12

| Élément | Source JSON | Engine reçoit ? | DOM/SVG généré ? | Conclusion |
|--------|-------------|-----------------|------------------|------------|
| env.autocons_pct | fullReport.p12.env.autocons_pct | OUI | setDash, donut_center | OK |

**Conclusion P12 :** OK — Donut et KPIs environnementaux affichés.

---

## PAGE 13

### Champs représentatifs

| DOM ID | JSON SOURCE | PAYLOAD ENGINE | DOM FINAL | OK ? |
|--------|-------------|----------------|-----------|------|
| #p13_client | fullReport.p13.meta.client | meta.client | String(val) | OK |
| #p13_ref | fullReport.p13.meta.ref | meta.ref | String(val) | OK |
| #p13_date | fullReport.p13.meta.date | meta.date | String(val) | OK |

**Conclusion P13 :** OK — Meta uniquement.

---

## PAGE 14

### Champs représentatifs

| DOM ID | JSON SOURCE | PAYLOAD ENGINE | DOM FINAL | OK ? |
|--------|-------------|----------------|-----------|------|
| #p14_client | fullReport.p14.meta.client | meta.client | String(val) | OK |
| #p14_ref | fullReport.p14.meta.ref | meta.ref | String(val) | OK |
| #p14_date | fullReport.p14.meta.date | meta.date | String(val) | OK |

**Conclusion P14 :** OK — Meta uniquement.

---

## Synthèse finale

| PAGE | STATUT | CAUSE EXACTE |
|------|--------|--------------|
| P1 | OK | — |
| P2 | OK | — |
| P3 | OK | — |
| P3B | OK | — |
| P4 | OK | — |
| P5 | OK | — |
| P6 | OK* | *KPI (autonomie, grid_kwh) calculés par engine à partir de dir/bat/grid/tot — pas dans JSON. Si règle = "aucun calcul" → KO. Sinon OK. |
| P7 | OK | — |
| P8 | KO | hypotheses vides : mapper produit `{ annee: "", cycles_an: 0, capacite_utile_kwh: 0, profil_journee: "" }` |
| P9 | KO | Simulation batterie dans mapper : compare.cumul_25y (+500*i), compare.roi_year (+2), compare.tri_pct (-0.5) |
| P10 | OK | — |
| P11 | OK | — |
| P12 | OK | — |
| P13 | OK | — |
| P14 | OK | — |

---

## Origine des problèmes restants

| PAGE | PROBLÈME | ORIGINE |
|------|----------|---------|
| P8 | hypotheses vides | **Backend (mapper)** — pdfViewModel.mapper.js L339 |
| P9 | Données simulées (compare) | **Backend (mapper)** — pdfViewModel.mapper.js L347-350 |

**Aucun problème identifié dans :** engine, DOM React, legacyPdfViewModelMapper (pass-through).

---

## Graphes — Récapitulatif

| PAGE | Source JSON | Engine reçoit | DOM généré | Conclusion |
|------|-------------|---------------|------------|------------|
| P2 | p2_chart_labels, p2_chart_sans, p2_chart_avec | OUI | Chart.js | OK |
| P4 | production_kwh, consommation_kwh, autoconso_kwh, batterie_kwh | OUI | drawChart SVG | OK |
| P5 | production_kw, consommation_kw, batterie_kw | OUI | API_p5_drawChart SVG | OK |
| P6 | p6.dir, bat, grid, tot | OUI | drawChart SVG | OK |
| P8 | profile.pv, load, charge, discharge | OUI | drawLines SVG | OK |
| P9 | recommended.cumul_25y, compare.cumul_25y | OUI | drawGraph SVG | OK (données compare simulées côté mapper) |
| P12 | env.autocons_pct | OUI | donut SVG | OK |

---

*Document généré en mode audit strict. Aucune modification de code effectuée.*
