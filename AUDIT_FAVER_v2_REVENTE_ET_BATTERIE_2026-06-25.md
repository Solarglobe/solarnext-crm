# Audit FAVER v2 — revente, batterie physique, orientation Ouest, cohérence des cartes

**Date :** 25/06/2026 · **Mode :** audit seul, aucune modification de code.
**Recadrage :** on **abandonne** les points « remplacement batterie obligatoire » et « ROI total = bug » de l'audit précédent (ce sont des choix de modélisation acceptables, l'apport marginal peut être ajouté comme indicateur complémentaire). On traite les **4 priorités**.
**Méthode :** vrais moteurs du repo (`buildHourlyPV`, `simulateBattery8760`, `financeService`) + données réelles FAVER (conso 12 mois, PV 5924 kWh, batterie 7 kWh / 3,5 kW, prix 0,1952 €/kWh).

---

## PROBLÈME 1 — Tarif de revente : **il EST lu correctement (~0,011 €/kWh). L'audit précédent se trompait (0,0762 retiré).**

**Chaîne complète tracée :**

| Étape | Emplacement | Valeur |
|---|---|---|
| Saisie UI | `frontend/.../PvSettingsPage.tsx` l.448-455 — champ « Rachat surplus < 9 kWc », `type=number step=0.0001`, hint « €/kWh injecté » | écrit `economics.oa_rate_lt_9` |
| Stockage | `settings_json.economics.oa_rate_lt_9` (org) ; clé validée dans `orgEconomics.common.js` l.20-34 | 0,011 |
| Lecture moteur | `financeService.js` `pickEconomics` l.85-87 : `oa_rate_lt_9 = num(e.oa_rate_lt_9, DEFAULT)` où `e = overlayFormEconomics(mergeOrgEconomicsPartial(ctx.settings.economics), …)` | 0,011 |
| Sélection tranche | `financeService.js` l.606 : `oa_rate = kwc < 9 ? econ.oa_rate_lt_9 : econ.oa_rate_gte_9` (FAVER 6,3 kWc → lt_9) | 0,011 |
| Cashflow 25 ans | `financeService.js` `buildCashflows` l.641 → `gain_oa = surplus × oa_rate` l.322-324 | 0,011 |

**Preuve par les chiffres :** en cherchant le `oa_rate` qui reproduit **simultanément** SANS = 24 983 € et PHYS = 35 280 € (mode brut), le meilleur ajustement donne **oa ≈ 0,00-0,01 €/kWh** (PHYS reproduit à 35 296 €). À 0,0762 la carte SANS monterait à ~29 600 € (son surplus de 2 027 kWh × 0,0762 = +154 €/an), ce qui **ne colle pas** à la capture. **Le moteur n'utilise donc PAS 0,0762 pour FAVER.**

**`0,0762` n'est que le DÉFAUT** (`orgEconomics.common.js` l.52) appliqué **uniquement si l'org n'a rien saisi**. Comme tu as saisi 0,011, c'est 0,011 qui est utilisé. → **Aucune correction nécessaire sur ce point.** *(Je retire l'anomalie A5 de l'audit précédent : elle était fausse.)*

**Seul résidu à vérifier** (si tu veux être sûr à 100 %) : que la carte FAVER n'est pas un **snapshot** calculé avant ta saisie de 0,011. Les chiffres collent à 0,011 → le snapshot est à jour. RAS.

---

## PROBLÈME 2 + 4 — **La batterie physique est trop favorable car la carte mélange DEUX moteurs : base en 8760 horaire, batterie en mensuel.** (C'est LE bug.)

### La courbe horaire de conso n'est PAS le coupable

3 profils de conso testés (mêmes totaux mensuels FAVER, PV Ouest moteur, batterie 7 kWh) :

| Profil conso été | Autoconso SANS | Autoconso AVEC batt | Décharge batt | Cycles | Export |
|---|---|---|---|---|---|
| **A. Logiciel actuel** (résidentiel, pic soir) | 56,4 % | 75,5 % | 1132 kWh | 162 | 1330 |
| **B. Été talon plat + hiver diffus** | 55,0 % | 74,5 % | 1160 kWh | 166 | 1381 |
| **C. Prudent** (été moins concentré le soir) | 56,7 % | 75,6 % | 1122 kWh | 160 | 1323 |

→ Changer la forme du soir en été **ne bouge l'autoconso que de < 1 %**. La batterie cycle pareil parce que la conso d'été journalière (≈ 17 kWh/j) est **bien supérieure** à la batterie (7 kWh) : elle se vide de toute façon. **La courbe horaire n'explique pas le « trop favorable ». (Je retire aussi A6 « pic du soir ».)**

### Le vrai problème : 95,5 % et 244 cycles sont **physiquement impossibles** en 8760

Le moteur horaire réel `simulateBattery8760` **plafonne**, quelle que soit la production testée (de très saisonnière à anti-saisonnière) :

| Production testée | Autoconso SANS (8760) | Autoconso AVEC batt (8760) | Décharge | Cycles |
|---|---|---|---|---|
| été-piquée | 56,4 % | 75,5 % | 1132 | 162 |
| modérée | 59,9 % | 79,6 % | 1168 | 167 |
| plate | 63,6 % | 83,7 % | 1190 | 170 |
| anti-saisonnière (irréaliste) | 66,7 % | **87,3 %** | **1223** | **175** |

**Plafond physique 8760 ≈ 87 % / 1 223 kWh / 175 cycles.** La capture affiche **95,5 % / 1 711 kWh / 244 cycles** → **au-dessus du plafond physique**, impossible à atteindre heure par heure.

**Raison physique :** FAVER n'a du surplus chargeable que ~5 mois (mai-sept). Une batterie 7 kWh ne peut faire **244 cycles** que s'il y a 244 jours avec ≥ 7 kWh de surplus — or l'hiver n'en a **aucun**. Le maximum réel est ~170-180 cycles.

### D'où viennent alors 5 608 kWh / 95,5 % ?

Du modèle **MENSUEL** `min(production_mois, conso_mois)` (+ bonus 10 %) de `scenarioService.js` l.243-256 :

| Production | Mensuel `min(prod,conso)` → auto | autoconso PV | import | export |
|---|---|---|---|---|
| modérée | 5 454 kWh | 92,1 % | 10 546 | 470 |
| **(interpolé capture)** | **≈ 5 608** | **95,5 %** | **10 392** | **316** |
| plate | 5 754 kWh | 97,1 % | 10 246 | 170 |

→ **5 608 / 95,5 % / import 10 392 / export 316 se reproduit EXACTEMENT par l'agrégation mensuelle**, pas par le 8760. Ce modèle suppose que la batterie **déplace le surplus à l'échelle du mois entier** (stockage inter-journalier parfait), ce qu'un pack 7 kWh **ne peut pas faire**.

### L'incohérence des cartes (Problème 4)

- **Carte SANS** : autoconso 3 897 kWh (65,8 %) = **moteur 8760 horaire** (réaliste, tient compte du décalage heure/heure).
- **Carte BATTERIE** : autoconso 5 608 kWh (95,5 %) = **modèle mensuel** (optimiste, ignore le décalage).

Le « gain batterie » affiché **+1 711 kWh / +334 €/an** est donc en grande partie un **artefact de changement de méthode** (horaire → mensuel), **pas** l'effet physique de la batterie. Le vrai apport batterie en 8760 cohérent est **≈ +1 130 kWh / ≈ +220 €/an** (et concentré l'été, nul l'hiver).

**Fichiers / fonctions / lignes :**
- Modèle mensuel batterie (optimiste) : `backend/services/scenarioService.js` l.230-287, branche batterie l.243-256 (`auto = min(prod, conso, direct × 1.1)`), constante `SCENARIO_MONTHLY_BATTERY_AUTO_BOOST = 1.1` (`engineConstants.js` l.130).
- Moteur horaire (réaliste) : `backend/services/batteryService.js` `simulateBattery8760`.
- Aiguillage : `calc.controller.js` l.757-793 — la batterie physique est **calculée en 8760 seulement si `hasConso8760`** ; sinon **skip** → la carte est alors remplie par le modèle mensuel. La base, elle, reste en horaire.

**À vérifier en runtime sur FAVER (clé du diagnostic)** : FAVER a-t-il un profil `energy_profile.engine.hourly` (8760) ? Log `CONSO_SOURCE_DECISION` (`solarnextPayloadBuilder.service.js` l.954). Si **absent** → la batterie tombe sur le modèle mensuel optimiste (95,5 %) tandis que la base reste horaire (65,8 %) = exactement la capture. **C'est le scénario le plus probable.**

---

## PROBLÈME 3 — Orientation Ouest : **ignorée dans la forme horaire de production.** (Réel, mais effet modeste.)

`buildHourlyPV` (`solarModelService.js` l.111-237) construit la cloche journalière **uniquement** à partir de `SUN_TIMES[mois]` (lever/coucher) avec une asymétrie fixe (`morning_pow 1.8`, `evening_pow 3.2`) → **pic vers 11-13 h, l'azimut/orientation n'entre JAMAIS dans la forme**. L'orientation Ouest n'agit que sur les **totaux mensuels** (via PVGIS), pas sur l'heure de production.

**Profil journée type 15 juin (kWh/h), mêmes totaux mensuels :**

| | 10h | 12h | 13h | 14h | 16h | 17h | 18h | 19h | 20h |
|---|---|---|---|---|---|---|---|---|---|
| **Logiciel** (buildHourlyPV) | 3,4 | 3,6 | 3,8 | 3,3 | 1,9 | 1,2 | 0,8 | 0,3 | 0,1 |
| Sud réel (pic 13h) | 1,8 | 4,3 | 4,8 | 4,3 | 1,8 | 0,8 | 0,3 | 0,1 | 0 |
| **Ouest réel (pic 16h30)** | 0,1 | 0,6 | 1,4 | 2,4 | 4,4 | 4,4 | 3,6 | 2,4 | 1,4 |
| Conso (pic du soir) | 0,7 | 0,8 | 0,7 | 0,7 | 0,9 | 1,1 | 1,2 | 1,2 | 1,0 |

**Impact (battery 7 kWh, mêmes totaux) :**

| Forme PV | Autoconso directe | Charge batt | Décharge | Export | Autoconso AVEC batt |
|---|---|---|---|---|---|
| **Logiciel (midi)** | 3 340 (56 %) | 1 190 | 1 132 | 1 330 | 75,5 % |
| Sud (13h) | 3 329 (56 %) | 1 218 | 1 158 | 1 312 | 75,7 % |
| **Ouest réel (16h30)** | **3 728 (63 %)** | 1 113 | **1 058** | **1 023** | **80,8 %** |

→ Une **vraie** toiture Ouest produit l'après-midi/soir, **en phase avec le pic de conso** → **+7 pts d'autoconso DIRECTE** (63 % vs 56 %) et **moins de besoin batterie** (décharge 1 058 vs 1 132). Le logiciel, en centrant la production à midi, **sous-estime l'autoconso directe et surévalue le rôle de la batterie** — mais l'effet est **modeste (~2 pts sur la batterie)**, secondaire devant le Problème 2.

**Fichier / fonction / ligne :** `backend/services/solarModelService.js` `buildDailyShape` l.111-147 (pas de paramètre orientation) ; constantes `engineConstants.js` l.100-119 (`SHAPE_MORNING_POW`, `SHAPE_EVENING_POW`, `SUN_TIMES`).

---

## SYNTHÈSE — anomalies confirmées (recadrées)

| # | Statut | Anomalie | Preuve FAVER | Fichier / fonction / ligne |
|---|---|---|---|---|
| **P2/P4** | ✅ **BUG principal** | Batterie calculée en **mensuel** `min(prod,conso)` (95,5 %, 244 cycles = impossible) pendant que la base est en **8760** (65,8 %) → gain batterie artificiel (+1 711 vs +1 130 réels) | 244 cycles > plafond physique 175 ; 5 608 = mensuel, pas 8760 | `scenarioService.js` l.230-287 (l.243-256) ; `SCENARIO_MONTHLY_BATTERY_AUTO_BOOST` `engineConstants.js` l.130 ; aiguillage `calc.controller.js` l.757-793 |
| **P3** | ✅ confirmé, **mineur** | Orientation Ouest ignorée dans la forme horaire (production centrée midi) → +7 pts d'autoconso directe perdus, ~2 pts surévalués côté batterie | journée 15 juin Ouest vs logiciel | `solarModelService.js` `buildDailyShape` l.111-147 ; `engineConstants.js` l.100-119 |
| **P1** | ❌ **retiré** | Revente 0,0762 au lieu de 0,011 | chiffres collent à 0,011 | — (lecture correcte) |
| ~~A6~~ | ❌ **retiré** | Pic du soir été gonfle la batterie | A/B/C < 1 % | — |
| **P4** | ⚠️ rappel | « Gain net » = « Économies 25 ans » (même nombre, brut) — déjà signalé | delta 10 297 = brut | `ScenarioComparisonTable.tsx` l.890/949-951 |

## CHIFFRES CORRIGÉS (FAVER)

| Indicateur | Affiché | Corrigé (8760 cohérent) |
|---|---|---|
| Autoconso PV avec batterie | 95,5 % | **~75-81 %** |
| Énergie utilisée avec batterie | 5 608 kWh | **~4 470-4 960 kWh** |
| Décharge batterie / cycles | 1 711 kWh / 244 | **~1 130-1 220 kWh / 160-175** |
| Export avec batterie | 316 kWh | **~1 000-1 330 kWh** |
| Apport batterie an 1 | +334 € | **~+220 €** |
| Revente surplus | 0,011 €/kWh (correct) | 0,011 €/kWh |

## RECOMMANDATIONS DE CORRECTION

1. **(P2/P4 — priorité absolue) Calculer TOUS les scénarios avec le même moteur 8760.** Ne jamais afficher une batterie calculée en mensuel `min(prod,conso)` à côté d'une base calculée en horaire. Si le profil 8760 conso manque, **dégrader la base AUSSI en mensuel** (cohérence) ou **bloquer la carte batterie**, plutôt que mélanger.
2. **(P2) Supprimer / plafonner le bonus mensuel batterie** (`SCENARIO_MONTHLY_BATTERY_AUTO_BOOST`) : un modèle mensuel ne doit jamais créditer une batterie au-delà du **cyclage journalier réalisable** (≤ capacité × jours-avec-surplus).
3. **(P3) Intégrer l'orientation dans la forme horaire** de `buildHourlyPV` (décalage du pic selon l'azimut), ou au minimum un profil Est/Sud/Ouest, pour ne pas attribuer à la batterie ce qu'une toiture Ouest autoconsomme directement.
4. **(P1) RAS** — revente correctement lue.

## TESTS ANTI-RÉGRESSION

```
// 1. Cohérence moteur entre cartes (P4)
assert(source_moteur(SANS) === source_moteur(BATTERY_PHYSICAL))   // jamais 8760 vs mensuel

// 2. Plafond physique batterie (P2) — cas FAVER hiver-only
assert(cycles_batterie <= jours_avec_surplus_chargeable)          // 244 doit échouer
assert(autoconso_batt <= autoconso_8760_max + marge)              // 95,5% doit échouer
assert(decharge_hiver(Déc,Jan,Fév) ≈ 0)

// 3. Revente (P1)
si economics.oa_rate_lt_9 == 0.011 : assert(oa_rate_utilisé == 0.011)  // pas 0.0762

// 4. Orientation (P3)
PV Ouest vs Sud, mêmes totaux : assert(heure_pic(Ouest) > heure_pic(Sud))
```

---

*Reconstructions : `/tmp/faver_deep.mjs` (3 profils conso), `/tmp/faver_p3.mjs` (Ouest/Sud), `/tmp/faver_prod.mjs` (plafond 8760), `/tmp/monthly_fallback.mjs` + `/tmp/faver_mix.mjs` (modèle mensuel), `/tmp/oafit.mjs` (revente). Limite : production horaire réelle de FAVER non lue en BDD (les fourchettes en dépendent), mais le résultat clé — **244 cycles impossibles en 8760, reproduits par le modèle mensuel** — est indépendant de cette donnée.*
