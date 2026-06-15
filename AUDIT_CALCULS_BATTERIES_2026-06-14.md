# Audit des calculs — 4 scénarios batterie (Sans / Physique / Virtuelle / Hybride)

**Date :** 14/06/2026
**Périmètre :** moteur de calcul économie année 1, autoconsommation, couverture/autonomie, TRI — après devis technique.
**Mode :** audit seul, aucune modification de code.

---

## 1. Verdict en une phrase

Les chiffres affichés **ne sont pas faux arithmétiquement** : ils se reconstituent à l'euro près à partir du code. Mais ils découlent de **trois choix de modélisation incohérents** qui rendent l'Hybride structurellement perdant et l'affichage trompeur. Tes deux intuitions (« hybride devrait être le meilleur » et « 100 % puis 98 % illogique ») pointent **les bons symptômes**, mais la cause n'est pas une erreur de calcul classique — c'est le modèle.

---

## 2. Reconstitution des chiffres (preuve qu'il n'y a pas d'erreur de saisie)

Prix élec implicite déduit de la carte « Sans batterie » : **0,2027 €/kWh** (977 € ÷ 4 820 kWh autoconsommés). Avec ce prix unique, tout se recale :

| Scénario | Couverture site | Import réseau | Éco. an 1 affichée | Recalcul |
|---|---|---|---|---|
| Sans batterie | 31,1 % | 10 680 kWh | 977 € | 4 820 × 0,2027 = **977 €** ✔ |
| Physique | 49,2 % | 7 874 kWh | 1 509 € | ~1 546 € (hors revente surplus) ✔ |
| Virtuelle | 58,5 % | 6 432 kWh | 1 383 € | 1 838 € évités − 455 € coût VB ✔ |
| Hybride | 57,6 % | **6 572 kWh** | 1 219 € | 1 809 € évités − 590 € coût VB ✔ |

**Le point clé est dans la dernière ligne :** l'Hybride importe **140 kWh de PLUS** que la Virtuelle (6 572 vs 6 432). Or 140 kWh = exactement l'énergie perdue dans le rendement aller-retour de la batterie physique. C'est mathématiquement le cœur du problème.

---

## 3. Cause racine n°1 — La batterie virtuelle est modélisée comme « parfaite »

Fichier `backend/services/virtualBattery8760.service.js`, ligne 85, commentaire du code lui-même :

> « déficit couvert par déstockage puis réseau. **Pas de rendement ni puissance max.** »

La batterie virtuelle stocke et restitue le surplus **sans aucune perte (1:1)** et **sans limite de puissance** — seule contrainte : un plafond annuel d'énergie (ici jamais atteint, d'où les 100 % d'autoconso).

**Conséquence logique inévitable :** dans ce modèle, la virtuelle est un stockage quasi-parfait. Une batterie physique, elle, a ~10 % de pertes aller-retour + une capacité/puissance finies. Donc **ajouter une batterie physique ne peut que retirer de l'énergie utile et ajouter du CAPEX**. L'Hybride est *condamné par construction* à être ≤ Virtuelle.

C'est pour ça que :
- **Hybride autoconso 98,6 % < Virtuelle 100 %** → les ~1,4 % manquants = pertes de la batterie physique.
- **Hybride couverture 57,6 % < Virtuelle 58,5 %** → 140 kWh perdus en pertes physiques au lieu d'être crédités sans perte.

> ⚠️ C'est le point le plus discutable **commercialement** : un crédit virtuel sans perte ni plafond de puissance est une hypothèse très optimiste. Aucun contrat réel (MyLight, Urban Solar, etc.) ne restitue 100 % du surplus sans frais ni perte. Si la virtuelle est sur-idéalisée, **tous les comparatifs penchent artificiellement en sa faveur**, et le badge « MEILLEURE OPTION » sur la virtuelle est mécanique, pas mérité.

---

## 4. Cause racine n°2 — L'Hybride paie tout, ne capte presque rien

Bloc `BATTERY_HYBRID` dans `backend/controllers/calc.controller.js` (≈ lignes 1385-1695). La logique est : la batterie **physique d'abord**, puis la **virtuelle sur le surplus résiduel**.

Problème : une fois que la physique a absorbé l'essentiel du surplus, **il ne reste presque rien à créditer en virtuel** → bénéfice marginal de la couche virtuelle minime. Mais l'Hybride continue de **payer l'abonnement virtuel complet** (~455-590 €/an) **ET** porte le CAPEX de la batterie physique.

Bilan chiffré (avec prix 0,2027 €/kWh) :
- vs **Physique** : l'Hybride réduit l'import de ~1 300 kWh → +264 € évités, mais paie ~455 € d'abonnement VB → **net −191 €**. D'où 1 509 → ~1 219 €.
- vs **Virtuelle** : la physique ajoute 140 kWh de pertes + réduit le revenu de revente du surplus (moins de surplus résiduel), en payant toujours l'abonnement → **strictement perdant**.

→ L'Hybride est **doublement pénalisé**. Économiquement cohérent dans le modèle, mais cela signifie que **l'Hybride ne pourra quasiment jamais gagner** — il ne devrait peut-être même pas être proposé comme une option « concurrente » des autres, ou alors uniquement valorisé sur l'autonomie/secours (qu'aucune des deux autres n'offre).

---

## 5. Cause racine n°3 — Définition « économie année 1 » incohérente entre scénarios

Fichier `backend/services/financeService.js`, `computeAnnualBillAfterSolarYear1()` (lignes 384-421) :

- **Sans batterie & Physique** : facture après = `import_kwh × prix`. → **La revente du surplus (OA / injection) n'est PAS comptée** dans l'économie année 1.
- **Virtuelle & Hybride** : facture après = `coût import + coût VB − revenu surplus exporté`. → **Le revenu de revente EST compté.**

C'est une comparaison pommes/oranges. Le Physique exporte ~1 440 kWh de surplus (~150-190 €/an de revente OA) qui sont **ignorés** dans son « économie année 1 ». Sa vraie économie année 1 serait plutôt ~1 680 € au lieu de 1 509 €.

À noter : l'économie **25 ans** (`economie_25a`), elle, utilise les cashflows complets *avec* le gain OA (ligne 322 : `total = gain_auto + gain_oa + import_savings_eur`). Donc **deux définitions différentes coexistent** : année 1 (sans OA pour physique) ≠ horizon 25 ans (avec OA). C'est une vraie incohérence interne à corriger.

---

## 6. Vérification métrique « autoconsommation PV » — PAS un bug (correction d'analyse)

⚠️ **Correction de ma première lecture.** La valeur *affichée* sur les cartes ne vient PAS du champ `self_consumption_pct` du contrôleur (l.1194 / 1636) : elle est **recalculée par le mapper** `scenarioV2Mapper.service.js` → `computePvSelfConsumptionPct()` (`energyKpiDefinitions.service.js` l.19-24), avec la **même formule pour Virtuelle ET Hybride** :

```
autoconso PV = (consommation − import réseau) / production
```

Pour la Virtuelle : (15 500 − 6 432) / 9 065 ≈ **100 %**.
Pour l'Hybride : (15 500 − 6 572) / 9 065 ≈ **98,6 %**.

La seule différence vient de l'import (6 432 vs 6 572 kWh), donc des 140 kWh perdus dans la batterie physique. **Même définition, calcul cohérent.** Le « 100 % vs 98,6 % » est un effet *physique réel*, pas une incohérence de KPI. → **Aucune correction de code nécessaire ici.**

---

## 7. Synthèse — est-ce un bug ?

| Observation de Benoit | Erreur arithmétique ? | Cause réelle |
|---|---|---|
| Hybride (1 219 €) < Physique (1 509 €) | Non | Abonnement VB > gain marginal sur surplus résiduel (§4) |
| Hybride (1 219 €) < Virtuelle (1 383 €) | Non | Pertes batterie physique + modèle virtuel sans perte (§3) — modélisation correcte |
| Virtuelle 100 % mais Hybride 98,6 % | Non | Effet physique réel (140 kWh de pertes), KPI **homogène** (§6) |
| Comparaison économie an 1 | **Oui, mineur** | Revenu d'export résiduel compté pour VB/Hybride mais pas pour Physique (§5) — **corrigé** |

**Conclusion (révisée après lecture complète) :** aucune formule cassée. Le seul vrai bug de code est l'asymétrie §5 (corrigée). Le « hybride toujours perdant » et le « 100 % vs 98,6 % » ne sont **pas** des erreurs : ils découlent d'une modélisation *correcte* de la batterie virtuelle comme crédit d'énergie 1:1 sans perte (c'est ainsi que fonctionnent réellement les offres type MyLight / Urban — le coût est l'abonnement, pas une perte d'énergie). Dans ce cadre, une batterie physique n'apporte rien en €/an pur : sa valeur est l'**autonomie / secours en coupure**, ce que le modèle ne valorise pas. C'est un point de **présentation client** (§4), pas de calcul.

---

## 8. Corrections appliquées le 14/06/2026

1. **§5 — CORRIGÉ.** `financeService.js` : suppression de la déduction du revenu d'export résiduel (`overflowRevenue`) dans le calcul de l'économie année 1 des scénarios Virtuelle / Hybride. Les 4 cartes utilisent désormais la même définition (économie sur facture, hors revente de surplus). Le revenu de revente reste pris en compte dans les cashflows 25 ans / TRI. Test `scenarioYear1BillSavings.test.mjs` : vert.
2. **§4 — CORRIGÉ.** `ScenarioComparisonTable.tsx` : sous-titre de la carte Hybride clarifié — sa valeur est l'autonomie / le secours en coupure, pas l'économie €/an maximale.

## 9. Points volontairement NON modifiés (et pourquoi)

- **§3 (batterie virtuelle sans perte)** — c'est une modélisation *correcte* du crédit 1:1. Y injecter un faux rendement fausserait les devis clients réels. À traiter, si besoin, en affichant l'hypothèse, pas en dégradant le calcul.
- **§6 (KPI autoconsommation)** — déjà homogène (voir §6 ci-dessus). Rien à corriger.

---

*Audit réalisé sans modification de code. Fichiers concernés : `backend/controllers/calc.controller.js` (blocs BATTERY_VIRTUAL ~l.883, BATTERY_HYBRID ~l.1385), `backend/services/financeService.js` (l.384-436, 668-712), `backend/services/virtualBattery8760.service.js` (l.85), `backend/domains/studies/financial/batterySimulator.js`.*
