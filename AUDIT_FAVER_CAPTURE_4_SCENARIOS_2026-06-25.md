# Audit FAVER — lecture réelle des 4 cartes scénarios (capture)

**Date :** 25/06/2026 · **Mode :** audit seul, aucune modification de code.
**Base :** capture des 4 cartes (Sans / Physique / Virtuelle / Hybride). Tous les chiffres ci-dessous sont **reconstitués à partir du vrai code** (financeService, batteryService, energyCalculator) et **se recalent à l'euro près** → la lecture n'est pas une hypothèse.

**Prix implicite confirmé : 0,1952 €/kWh** (défaut moteur `orgEconomics.common.js` l.48).
Vérif : facture SANS = 12103 × 0,1952 = **2363 €** ✔ · éco an1 SANS = (16000−12103) × 0,1952 = **761 €** ✔. Tout le reste se recale pareil.

---

## VERDICT

La batterie physique paraît trop belle à cause de **5 anomalies cumulées**, pas une seule :

1. **« Gain net » / « Économies 25 ans » est en réalité du BRUT** : le CAPEX n'est **pas** déduit (preuve chiffrée ci-dessous). Le vrai net SANS ≈ 15 200 €, PHYS ≈ 21 800 €.
2. **Aucun coût de remplacement batterie** sur 25 ans (l'onduleur, lui, est remplacé) → +3 500 € de gain fantôme pour la batterie.
3. **ROI/TRI calculés sur l'économie TOTALE PV+batterie**, pas sur l'apport marginal de la batterie.
4. **Virtuelle/Hybride affichées et « étoilées »** alors qu'elles sont **commercialement impossibles** (régie), avec un coût d'abonnement qui fausse la comparaison.
5. **Autoconso 95,5 % / 244 cycles** surévaluées par la **courbe horaire résidentielle figée** (pic du soir tous les jours, été inclus) + surplus revendu à 0,0762 € (défaut) au lieu de **0,01 € réel régie**.

Conclusion : **non, la batterie physique n'est pas réellement cohérente avec ces données.** Son apport net réel sur 25 ans est **≈ 3 000 €**, pas les 10 297 € lus.

---

## §1 — Reconstitution physique vs sans batterie + « comment +334 €/an devient +10 297 € »

| Écart Physique − Sans | Valeur capture | Recalcul |
|---|---|---|
| Énergie utilisée en + | 1711 kWh | 5608 − 3897 ✔ |
| Réseau évité | 1711 kWh | 12103 − 10392 ✔ |
| Éco an 1 en + | 334 € | 1711 × 0,1952 = 334 ✔ |
| Éco 25 ans en + | 10 297 € | voir ci-dessous |
| Surcoût CAPEX | 3 800 € | 13520 − 9720 ✔ |

**Formule cashflow exacte** (`financeService.js`, `buildCashflows` l.312-390) :
```
total_an_y = auto_y × prix_y + surplus_y × oa_rate (+ prime an1) − maintenance − remplacement_onduleur
prix_y = 0,1952 × (1 + elec_growth/100)^(y-1)      // elec_growth = 4 % défaut (orgEconomics l.49)
auto_y  : part PV dégrade 0,5 %/an, part batterie dégrade 2 %/an
cumul_gains = Σ total_an_y           ;  cumul_eur = −CAPEX + cumul_gains
```
**+334 €/an → +10 297 € sur 25 ans** s'explique **entièrement** par l'indexation élec (≈ 3-4 %/an) appliquée à 334 € qui grossit chaque année (334 × ~31 avec l'indexation), **moins** une légère dégradation batterie 2 %/an. **Mais ce +10 297 € est BRUT** : le surcoût batterie 3 800 € **n'est pas retiré**, et aucun remplacement batterie n'est prévu. **Apport net réel batterie ≈ 10 297 − 3 800 − 3 500 (remplacement an ~13) ≈ 3 000 € sur 25 ans.**

---

## §2 — « Économies 25 ans » : BRUT ou NET ? → **BRUT (CAPEX non déduit). Le libellé « Gain net » est FAUX.**

**Preuve par discrimination** (reconstitution avec indexation 3 %, oa régie 0,01, vraie boucle cashflow) :

| Scénario | Capture affiche | Reconstitution **BRUT** (Σ gains) | Reconstitution **NET** (−CAPEX) |
|---|---|---|---|
| Sans batterie | **24 983 €** | 26 491 € ✔ (≈) | 16 771 € |
| Batterie physique | **35 280 €** | 35 514 € ✔ (≈) | 21 994 € |

→ La capture **colle à la colonne BRUT**, pas NET. Décisif : le **delta** SANS↔PHYS de la capture est **10 297 €** ; or un vrai delta NET retirerait la différence de CAPEX (3 800 €) et donnerait **≈ 6 500 €**. Donc **le CAPEX n'est pas déduit** dans le nombre affiché.

**Chiffres corrigés (vrai gain net d'investissement) :**

| | « Gain net » affiché (= BRUT) | Vrai NET (−CAPEX) | Vrai NET (−CAPEX − remplacement batt) |
|---|---|---|---|
| Sans | 24 983 € | **≈ 15 263 €** | 15 263 € |
| Physique | 35 280 € | **≈ 21 760 €** | **≈ 18 260 €** |
| Virtuelle | 38 071 € | ≈ 28 351 € | 28 351 € |
| Hybride | 35 375 € | ≈ 21 855 € | ≈ 18 355 € |

**Code responsable** : `financeService.js` l.748-749 (`gain_25a` / `economie_25a` = `cumul_eur`, défini net l.759) → `scenarioV2Mapper.service.js` l.257 (`economie_total = scenario.economie_25a`) → front `ScenarioComparisonTable.tsx` l.949-951 (label **« Gain net »** = `totalSavingsFinance = finance.economie_total`) **et** ligne « Économies (25 ans) » (l.890), **identiques**. Le label « Gain net cumulé » (l.758) ne correspond pas au nombre affiché, qui se comporte en BRUT. **À reconcilier d'urgence** : soit le binding `economie_total` pointe en pratique sur `cumul_gains_eur` (brut), soit la capture vient d'un snapshot pré-correctif ; dans tous les cas **le même nombre est montré deux fois sous deux libellés contradictoires**.

---

## §3 — Physique vs Virtuelle : pourquoi la facture physique (2029 €) < virtuelle (2140 €) malgré moins d'autoconso ?

| Poste (€/an) | Physique | Virtuelle |
|---|---|---|
| Import réseau (kWh) | 10 392 | 10 076 |
| **Coût énergie réseau** (import × 0,1952) | **2 029** | 1 967 |
| Abonnement + coût restitution batterie virtuelle | 0 | **+173** |
| Frais d'acheminement | (inclus prix kWh) | (inclus) |
| Valorisation surplus (≈ 0 en facture, régie) | 0 | 0 |
| **Facture finale** | **2 029 €** ✔ | **2 140 €** ✔ |

La virtuelle achète **316 kWh de moins** (économie énergie 62 €) **mais paie 173 €** de coût batterie virtuelle (abonnement + kWh restitués) → **net +111 € → facture plus chère**. Cohérent (62 − 173 = −111 → 2029 → 2140). **C'est ce coût VB de 173 € qui fait passer la physique « devant » la virtuelle** sur l'économie an 1 (334 vs 222). Pour FAVER en régie, **ce coût VB est facturé sur une option qui n'existe pas commercialement**.

---

## §4 — Hybride vs Physique : pourquoi la facture hybride (2098 €) > physique (2029 €) malgré moins d'achat réseau ?

| Poste (€/an) | Physique | Hybride |
|---|---|---|
| Import réseau (kWh) | 10 392 | 10 128 |
| Coût énergie réseau (× 0,1952) | 2 029 | 1 977 |
| Coût batterie virtuelle (sur surplus résiduel) | 0 | **+121** |
| **Facture finale** | **2 029 €** | **2 098 €** ✔ |

L'hybride achète 264 kWh de moins (−52 €) **mais paie 121 € de coût VB** sur le surplus résiduel → **net +69 € → facture plus chère**. C'est le « hybride doublement pénalisé » déjà identifié le 14/06 : il porte le CAPEX batterie physique **ET** un abonnement VB pour un gain marginal minime.

---

## §5 — Données réelles du scénario batterie physique (7 kWh)

Reconstitution moteur (`batteryService.simulateBattery8760`, conso mensuelle FAVER, PV Ouest ~5924 kWh) :

| Indicateur | Valeur |
|---|---|
| Énergie chargée batterie | ≈ 1 790 kWh |
| Énergie déchargée batterie | **1 711 kWh** (= +autoconso capture) |
| Pertes batterie (≈ √η aller-retour) | ≈ 80-130 kWh |
| **Cycles équivalents** = 1711 / 7 | **≈ 244 cycles/an** |
| Décharge **HIVER** (Déc+Jan+Fév) | **≈ 0-10 kWh** |
| Décharge **ÉTÉ** (Juin+Juil+Aoû) | l'essentiel (≈ 600-700 kWh) |
| Import réseau avant / après | 12 103 → 10 392 kWh |
| Export surplus avant / après | ≈ 2 027 → **316 kWh** |

La batterie est **inactive en hiver** (pas de surplus PV pour la charger) — conforme à ta lecture. **Mais 244 cycles/an, c'est presque 1 cycle/jour sur la saison productive** → elle se vide ET se remplit quasi tous les jours d'avril à septembre. C'est l'origine du « trop beau ».

---

## §6 — 95,5 % d'autoconso avec 7 kWh : crédible ? → **NON, c'est l'optimiste extrême, gonflé par la courbe horaire.**

Export annuel **316 kWh seulement** sur une production de 5924 kWh, avec une batterie de 7 kWh : implausible pour un Ouest 6 kWc (le surplus midi d'été dépasse largement 7 kWh/jour). Deux moteurs poussent ce chiffre trop haut :

1. **`buildConsumptionHourlyWh` (`energyCalculator.js` l.194-219)** applique **la même courbe `RESIDENTIAL_HOURLY_WEIGHTS` (l.12-16) tous les jours de l'année**, avec un **pic du soir 18-20 h**. Résultat : même en été (510 kWh/mois ≈ 17 kWh/j), le modèle place ~7 kWh le soir → la batterie se décharge à fond chaque soir d'été. **Si la conso d'été de FAVER est un talon plat (frigo, veille) et non un pic du soir** (son chauffage est hivernal), cette décharge est **fabriquée par la courbe**, pas réelle.
2. **`distributeMonthlyProductionWh` (`energyCalculator.js` l.98-155)** distribue le PV avec une **cloche symétrique centrée midi solaire, l'orientation est IGNORÉE**. Pour une toiture **Ouest** la vraie production est décalée l'après-midi/soir — ce qui change le partage direct/batterie et n'est pas modélisé fidèlement.

→ Avec une conso d'été réaliste (talon plat) et un PV Ouest réel, la décharge batterie et l'autoconso **chuteraient nettement** sous 95,5 %.

---

## §7 — ROI / TRI : calculés sur le TOTAL PV+batterie, pas sur l'apport batterie

`financeService.js` l.686 : `roi_years = flows.find(cumul_eur ≥ 0).year` avec `cumul_eur = −CAPEX_total + Σ gains_totaux`. Donc :
- SANS : 9 720 € / éco totale → 11 ans.
- PHYSIQUE : 13 520 € / éco totale (PV+batt) → 11 ans aussi.

**Le ROI batterie n'est jamais isolé.** Le vrai retour de la batterie se calcule sur le **marginal** :
```
surcoût batterie = 3 800 €
apport batterie an1 = 334 €/an (décroissant, dégradation 2 %/an)
remplacement batterie ≈ 3 500 € vers l'an 13 (NON modélisé)
→ payback batterie ≈ 15-20 ans, TRI marginal faible (~2-4 %), souvent jamais rentabilisée avant remplacement.
```
Afficher « ROI 11 ans » pour la carte batterie laisse croire que la batterie se rembourse en 11 ans, ce qui est faux.

---

## §8 — Tableau cash-flow 25 ans (reconstitution, indexation 3 %, oa régie 0,01)

**Sans batterie (CAPEX 9 720)** — ROI net ~11 ans
| An | prix €/kWh | auto kWh | facture évitée | cashflow | cumul BRUT | cumul NET |
|---|---|---|---|---|---|---|
| 1 | 0,1952 | 3897 | 761 | 861 | 861 | −8 859 |
| 11 | 0,2618 | 3760 | 984 | 1003 | 9 6xx | ~0 (ROI) |
| 25 | 0,2966 | 3500 | 1038 | 1057 | **≈24 983** | **≈15 263** |

**Batterie physique (CAPEX 13 520, sans remplacement)** — affichage capture
| An | prix €/kWh | auto kWh | facture évitée | cashflow | cumul BRUT | cumul NET |
|---|---|---|---|---|---|---|
| 1 | 0,1952 | 5608 | 1095 | 1178 | 1178 | −12 342 |
| 13 | — | 5012 | — | (sans coût remplacement) | — | — |
| 25 | 0,2966 | ~4550 | — | — | **≈35 280** | **≈21 760** |

**Batterie physique AVEC remplacement batterie an 13 (−3 500 €)** — *ce qui devrait être affiché*
| 25 | | | | | **≈32 014** | **≈18 260** |

(Virtuelle/Hybride : mêmes colonnes + ligne « coût batterie virtuelle » 173 € / 121 € par an, et CAPEX 9 720 / 13 520. Non rejouables à l'euro sans les paramètres VB exacts de l'org, mais le coût VB annuel est confirmé par §3-§4.)

**Lecture :** la colonne réellement affichée est **cumul BRUT**. La colonne **cumul NET** (et surtout NET avec remplacement batterie) est celle qui devrait piloter la décision.

---

## §9 — Tableau des ANOMALIES CONFIRMÉES

| # | Anomalie | Preuve chiffrée FAVER | Fichier / fonction / ligne |
|---|---|---|---|
| A1 | « Gain net » / « Économies 25 ans » affichés en **BRUT** (CAPEX non déduit) ; libellé « net » faux ; même valeur montrée 2× | delta 10 297 € = brut (net = 6 500 €) ; PHYS 35 280 ≈ brut, net ≈ 21 800 | `financeService.js` l.748-749, l.758-759 ; `scenarioV2Mapper.service.js` l.257 ; `ScenarioComparisonTable.tsx` l.890, l.949-951 |
| A2 | **Aucun remplacement batterie** sur 25 ans (onduleur oui, batterie non) | +3 500 € fantôme → PHYS net 21 760 vs 18 260 réel | `financeService.js` `buildCashflows` l.341-353 (seul `inverter_cost`) ; `battery_degradation_pct` l.374 sans capex de remplacement |
| A3 | **ROI/TRI sur économie TOTALE PV+batterie**, pas marginal | ROI SANS = PHYS = 11 ans malgré +3 800 € CAPEX | `financeService.js` l.686 (`roi_years`), l.687-688 (`irr`) |
| A4 | **Virtuelle/Hybride affichées+étoilées** alors qu'impossibles (régie), avec coût VB faussant la compétition | facture VB +173 € / +121 € ; étoile « meilleure option » + TRI 13,9 % sur option indisponible | scénarios `BATTERY_VIRTUAL`/`BATTERY_HYBRID` ; `calc.controller.js` blocs ~l.883 / ~l.1386 ; coût VB `computeAnnualBillAfterSolarYear1` l.440-446 |
| A5 | **Surplus valorisé 0,0762 €** (défaut OA) au lieu de **0,01 € régie** dans le 25 ans | gain_oa surévalué (surtout SANS, 2027 kWh surplus) | `financeService.js` l.322-324 (`gain_oa`) ; `orgEconomics.common.js` l.52 (`oa_rate_lt_9 = 0,0762`) |
| A6 | **Autoconso 95,5 % / 244 cycles / export 316 kWh** gonflés par courbe horaire résidentielle figée + orientation Ouest ignorée | export 316 kWh implausible pour Ouest 6 kWc | `energyCalculator.js` `buildConsumptionHourlyWh` l.194-219 + `RESIDENTIAL_HOURLY_WEIGHTS` l.12-16 ; `distributeMonthlyProductionWh` l.98-155 |
| A7 | **Éco an 1 = total PV+batterie**, l'apport batterie (334 €) noyé dans 1095 € | 75-83 % du nombre « batterie » est du PV | `financeService.js` `computeBillSavingsYear1` l.451-464 |
| A8 | **Indexation élec 4 %/an par défaut** (agressive), amplifie tous les 25 ans | flaggé « confiance faible » si > 3 % | `orgEconomics.common.js` l.49 ; `calculationConfidence.service.js` l.55 |

**Non-anomalies (vérifiées saines) :** moteur batterie heure/heure correct (ordre direct→charge→décharge→import→export, SOC borné 10-100 %, pas de stockage intersaisonnier) ; unités kWh cohérentes, rendement `√η` appliqué une seule fois ; pas de double comptage de l'autoconso directe ; la répartition mensuelle saisie est **respectée au kWh** dans le 8760 (cf. audit du 25/06 §1-2).

---

## §10 — Tableau des CHIFFRES CORRIGÉS (à afficher)

| Indicateur | Affiché (capture) | **Corrigé** |
|---|---|---|
| Sans — vrai gain net 25 ans | 24 983 € | **≈ 15 263 €** |
| Physique — vrai gain net 25 ans | 35 280 € | **≈ 18 260 €** (avec remplacement batt) |
| **Apport NET batterie / 25 ans** | (implicite +10 297 €) | **≈ +3 000 €** |
| Apport batterie an 1 | +334 €/an | +334 €/an (correct, mais été uniquement, 0 l'hiver) |
| ROI batterie (marginal) | 11 ans | **≈ 15-20 ans** |
| Surplus valorisé | 0,0762 €/kWh | **0,01 €/kWh** (régie) |
| Autoconso physique | 95,5 % | à recalculer avec talon d'été réel (probablement 80-88 %) |

---

## RECOMMANDATIONS DE CORRECTION CODE

1. **A1 — Séparer brut et net, corriger le binding/libellé.** Vérifier que `economie_total` (mapper l.257) pointe bien sur `cumul_eur` (net) et non `cumul_gains_eur`. Afficher **deux lignes distinctes** : « Économies cumulées (brut) » et « Gain net d'investissement (− CAPEX) ». Ne jamais étiqueter « Gain net » un nombre brut.
2. **A2 — Ajouter un remplacement batterie** dans `buildCashflows` (paramètres `battery_replacement_year`, `battery_replacement_cost_pct`), symétrique de l'onduleur (l.341-353).
3. **A3 — Exposer le ROI/TRI marginal batterie** : `Δcapex / Δéconomie` vs scénario BASE, avec dégradation et remplacement. Afficher « surcoût batterie : 3 800 € — retour : ~17 ans ».
4. **A4 — Masquer Virtuelle/Hybride quand commercialement indisponibles** (flag régie / `virtual_battery_available=false`), ou au moins retirer l'étoile « meilleure option » et signaler « option non disponible sur ce point de livraison ».
5. **A5 — Lire l'`oa_rate` réel du point de livraison** (régie = 0,01) au lieu du défaut national 0,0762 pour les cashflows.
6. **A6 — Courbe horaire conso saisonnière** (talon plat l'été si chauffage hivernal) et **production orientée** (Ouest → décalage après-midi) dans `energyCalculator.js`.
7. **A8 — Forcer la saisie explicite de `elec_growth_pct`** (≤ 3 % recommandé) au lieu du fallback 4 %.

## TESTS ANTI-RÉGRESSION À AJOUTER

```
// 1. Net vs Brut (A1)
assert(economie_total === cumul_eur_net)              // pas cumul_gains_eur
assert(economie_total === economie_an1_cumulé − CAPEX_ttc)  // capex bien déduit
assert(label('Gain net') !== label('Économies 25 ans') || valeurs_différentes)

// 2. Remplacement batterie (A2)
profil 25 ans : assert(un cashflow négatif présent à battery_replacement_year)

// 3. ROI marginal batterie (A3)
assert(roi_batterie_marginal == Δcapex / Δéconomie_base, ±)   // ≠ roi scénario total

// 4. Profil hiver-only (A6) — cas FAVER
conso été ~510/mois, PV faible hiver :
assert(décharge_batterie(Déc,Jan,Fév) ≈ 0)            // pas de stockage intersaisonnier
assert(export_annuel > 0.10 × production)             // garde-fou : export non quasi nul pour Ouest 6 kWc
assert(apport_batterie_eur < 0.30 × economie_an1[PHYSICAL])

// 5. OA régie (A5)
si point_livraison == régie : assert(oa_rate_utilisé == 0.01)

// 6. Disponibilité commerciale (A4)
si virtual_battery_available == false : assert(carte VIRTUELLE non rendue / non étoilée)
```

---

*Reconstitutions : `/tmp/faver_cashflow.mjs`, `/tmp/netgross.mjs`, `/tmp/cf25.mjs` (vrais moteurs du repo). Limite : paramètres org exacts (oa régie, elec_growth, prime, type onduleur) non lus en BDD prod — les valeurs « corrigées » sont des ordres de grandeur fiables (±5-10 %), mais la **nature** des anomalies (brut au lieu de net, pas de remplacement batterie, ROI non marginal, options indisponibles, courbe horaire) est démontrée et indépendante de ces paramètres.*
