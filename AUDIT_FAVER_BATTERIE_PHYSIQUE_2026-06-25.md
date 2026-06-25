# Audit batterie physique — cas Didier FAVER (régie locale, toiture Ouest)

**Date :** 25/06/2026 · **Mode :** audit seul, aucune modification de code.
**Données FAVER :** 16 000 kWh/an, répartition mensuelle saisie, Ouest obligatoire, pas de batterie virtuelle (régie), revente surplus ≈ 0,01 €/kWh.
**Méthode :** exécution des **vrais moteurs du repo** (`calculateEnergy8760`, `simulateBattery8760`) avec les 12 valeurs de FAVER. PV synthétisé (Ouest ~6 kWc) faute d'accès BDD prod — la **logique** démontrée ne dépend pas de la taille exacte du PV.

---

## VERDICT EN UNE PHRASE

Le moteur batterie est **physiquement correct** (la batterie ne stocke PAS l'été pour l'hiver : décharge été 710 kWh / hiver 3 kWh). **L'économie « trop forte » ne vient pas de la batterie, elle vient de la définition du KPI** : la carte `BATTERY_PHYSICAL` affiche l'économie **totale PV + batterie**, dont **seulement 17–25 % est réellement due à la batterie** — le reste (75–83 %) est l'autoconsommation du PV, qui existerait **sans aucune batterie**.

---

## §1 — La répartition mensuelle est-elle bien utilisée ?

**Dans le moteur financier : OUI, à la perfection.** En passant les 12 valeurs de FAVER à `calculateEnergy8760()` (`backend/domains/studies/financial/energyCalculator.js`), le 8760 reconstruit **exactement** chaque mois (écart 0,0 kWh) — voir §2. La fonction `buildMonthlyConsumptionWh()` (l.178-192) utilise `monthlyConsumptionKwh` quand il est fourni et **ne tombe sur le profil générique `MONTHLY_SEASONAL_CONSUMPTION_WEIGHTS` que si AUCUN mensuel n'est fourni** (l.189-191).

**⚠️ Le seul risque de « profil qui écrase le mensuel » est en amont, dans le payload :**
`backend/services/solarnextPayloadBuilder.service.js`, l.575-583, le builder **préfère `energy_profile.engine.hourly`** s'il existe :
```js
const profileHourly = hourlyFromEngine ?? hourlyLegacy;   // l.583
...
...(profileHourly && !csvPath ? { hourly: profileHourly } : {})   // l.984
```
Si ce tableau 8760 a été **généré quand seul l'annuel existait** (puis non régénéré après saisie du mensuel), il **court-circuite** la répartition mensuelle. C'est **LE point à vérifier sur la fiche réelle de FAVER** (voir §9 — vérification terrain).

**Fichiers/fonctions/lignes :**
- `energyCalculator.js` : `buildMonthlyConsumptionWh` l.178-192, `buildConsumptionHourlyWh` l.194-219.
- `solarnextPayloadBuilder.service.js` : sélection source l.575-583, injection `hourly` l.984, log `CONSO_SOURCE_DECISION` l.954.
- `calc.controller.js` : conso utilisée par la batterie l.758 (`ctx.conso_p_pilotee || ctx.conso?.hourly || ctx.conso?.clamped`).

---

## §2 — Construction de la courbe 8760 : conso saisie vs réellement utilisée

Total recalculé = **16 000 kWh** ✔. Par mois après transformation 8760 :

| Mois | Saisie | 8760 | Écart |
|---|---|---|---|
| Jan | 2860 | 2860 | 0,0 |
| Fév | 2340 | 2340 | 0,0 |
| Mar | 1820 | 1820 | 0,0 |
| Avr | 910 | 910 | 0,0 |
| Mai | 600 | 600 | 0,0 |
| Juin | 540 | 540 | 0,0 |
| Juil | 510 | 510 | 0,0 |
| Août | 510 | 510 | 0,0 |
| Sep | 840 | 840 | 0,0 |
| Oct | 910 | 910 | 0,0 |
| Nov | 1690 | 1690 | 0,0 |
| Déc | 2470 | 2470 | 0,0 |

**Juin/juillet/août ne sont PAS gonflés** au niveau mensuel : 510-540 kWh respectés. **Réserve (intra-journalier) :** la forme **horaire est figée** (`RESIDENTIAL_HOURLY_WEIGHTS`, l.12-16) et **identique tous les jours de l'année**, avec un pic 18-20 h. Elle impose donc à l'été un pic du soir qui n'est peut-être pas réel si la conso d'été de FAVER est du talon plat. Effet **secondaire** (modeste), pas la cause principale.

---

## §3 — Moteur batterie physique heure par heure (`simulateBattery8760`, `batteryService.js` l.46-189)

Ordre confirmé, conforme à la physique :
1. **Autoconso directe** : `direct = min(pv, load)` (l.101).
2. **Charge** du surplus restant : `charge_in = min(surplus, pCh)`, bornée par le rendement `√η` et la place `capacity − SOC` (l.104-118).
3. **Décharge** sur déficit restant : `discharge_out = min(need, pDis)`, bornée par `√η` et `SOC − SOC_min` (l.120-133).
4. **Import** : `import = max(0, load − direct − discharge)` (l.136).
5. **Export** : `surplus` résiduel après charge (l.140, 145).
6. **SOC borné** : plancher `SOC_min = capacity × 10 %` (l.81-82), plafond `capacity`. Jamais dépassé.

→ **Aucune anomalie.** L'ordre et les bornes sont corrects.

---

## §4 — Batterie virtuelle déguisée ? **NON.**

Preuve par les flux mensuels (West, ci-dessous) : **décharge été (Jun-Aoû) = 710 kWh, décharge hiver (Déc-Fév) = 3 kWh.** Le SOC est plafonné à 10 kWh → **impossible de banquer l'été pour l'hiver**. Il n'y a :
- ❌ pas de surplus annuel stocké/réutilisé plus tard (SOC ≤ 10 kWh),
- ❌ pas de crédit traversant les mois,
- ❌ pas de recharge avec l'export passé,
- ❌ pas de décharge sans charge préalable (décharge bornée par `SOC − SOC_min`),
- ✔ le SOC se vide bien (cycle ~journalier), report inter-journalier limité à la capacité physique.

La batterie est **correctement inutile en hiver** (pas de surplus pour la charger). C'est l'inverse d'un stockage intersaisonnier.

---

## §5 — Unités. **Aucun bug.**

Tout est en **kWh**, et comme le pas est **horaire**, 1 kWh/h = 1 kW → les bornes `max_charge_kw`/`max_discharge_kw` se comparent directement au kWh horaire (l.106, 123). Rendement appliqué **une seule fois de chaque côté** : `effCh = effDis = √(roundtrip)` (l.71-72), charge `×effCh` (l.109), décharge `/effDis` (l.125). Pas de ×1000 / ÷1000 parasite (la conversion Wh→kWh est faite **en amont** dans le payload, le moteur batterie reçoit des kWh). `equivalent_cycles = décharge_kWh / capacité_kWh` (l.162) : cohérent.

---

## §6 — Double comptage économique. **C'EST ICI LA CAUSE.**

`backend/services/financeService.js` :
- `computeBillSavingsYear1(sc, price)` (**l.451-464**) :
  `economie_an1 = bill_before − bill_after = (conso − import) × price`
- `computeAnnualBillAfterSolarYear1` (**l.406-449**) : pour `BATTERY_PHYSICAL`, `bill_after = import_kwh × price` (l.429-448).

Donc **`economie_an1` de la carte `BATTERY_PHYSICAL` = (16 000 − import_avec_batterie) × prix**. C'est l'économie **TOTALE PV + batterie**, **pas l'apport de la batterie**.

**Décomposition chiffrée FAVER (prix 0,25 €/kWh) :**

| Orientation PV | Carte BASE (PV seul) | Carte BATTERY_PHYSICAL | **Apport réel batterie** | Part PV dans le nombre « batterie » |
|---|---|---|---|---|
| Ouest 6 kWc | 872 €/an | **1 169 €/an** ← affiché | **+297 €/an (25 %)** | **75 %** |
| (Sud/midi 6 kWc) | 973 €/an | 1 176 €/an | +203 €/an (17 %) | 83 % |

→ Le « 1 169 € » que voit le client/Benoit pour la batterie est en réalité **872 € de PV direct + 297 € de batterie**. La batterie ne pèse que **25 %**. **Aucune erreur arithmétique**, mais une **attribution trompeuse** : on lit comme « économie batterie » un nombre dominé par le PV.

Autres pistes §6, vérifiées **saines** : pas de revente du surplus comptée dans `economie_an1` (correctif §5 du 14/06, l.411-418) ; l'autoconso directe n'est pas comptée deux fois ; la base de comparaison (BASE) est correcte.

---

## §7 — Indicateurs annuels FAVER (Ouest 6 kWc, batterie 10 kWh / 5 kW / 90 %)

| Indicateur | Valeur |
|---|---|
| Production PV annuelle | 5 260 kWh |
| Autoconso directe (sans batt) | 3 486 kWh |
| Surplus (sans batt) | 1 774 kWh |
| Import réseau (sans batt) | 12 514 kWh |
| Énergie chargée batterie | 1 250 kWh |
| Énergie déchargée batterie | 1 189 kWh |
| Pertes batterie | 128 kWh |
| Cycles équivalents | **118,9** (≈ sous-utilisée) |
| Import réseau (avec batt) | 11 325 kWh |
| Surplus (avec batt) | 457 kWh |
| **Économie batterie physique (apport réel)** | **≈ 297 €/an** |
| Économie / kWh déchargé | 0,25 €/kWh (= prix réseau, normal) |

La batterie ne fait que **119 cycles/an** (une batterie bien utilisée en fait 250+). Pour ~7 000 € de CAPEX → **retour ≈ 24 ans**. La batterie est **mauvaise pour FAVER**, et le moteur le montre correctement — c'est seulement l'**affichage** qui la fait paraître rentable.

---

## §8 — Tableau mensuel (Ouest 6 kWc, kWh)

| Mois | PV | Conso | Autoconso directe | Charge | Décharge | Import | Export |
|---|---|---|---|---|---|---|---|
| Jan | 180 | 2860 | 180 | 0 | 3 | 2677 | 0 |
| Fév | 260 | 2340 | 260 | 0 | 0 | 2080 | 0 |
| Mar | 420 | 1820 | 420 | 0 | 0 | 1400 | 0 |
| Avr | 520 | 910 | 408 | 106 | 101 | 401 | 0 |
| Mai | 640 | 600 | 317 | 279 | 258 | 25 | 29 |
| Juin | 690 | 540 | 293 | 261 | 247 | 0 | 122 |
| Juil | 720 | 510 | 281 | 242 | 229 | 0 | 184 |
| Août | 650 | 510 | 277 | 246 | 233 | 0 | 114 |
| Sep | 500 | 840 | 383 | 110 | 111 | 346 | 2 |
| Oct | 330 | 910 | 318 | 6 | 6 | 586 | 5 |
| Nov | 200 | 1690 | 200 | 0 | 0 | 1490 | 0 |
| Déc | 150 | 2470 | 150 | 0 | 0 | 2320 | 0 |

**Lecture :** toute l'activité batterie est concentrée **avril→septembre**. En **hiver** (où FAVER consomme le plus), la batterie est **à plat** (décharge ≈ 0) car le PV ne produit presque rien → elle ne peut pas se charger. **C'est exactement ton intuition, et le moteur la respecte.** La batterie ne « gagne » que sur les mois d'été où il y a du surplus ET ~17 kWh/jour de talon à servir.

---

## §9 — CONCLUSION

**Ce n'est pas la physique de la batterie qui est fausse — c'est l'attribution économique.**

| Élément | Responsable |
|---|---|
| **Fichier** | `backend/services/financeService.js` |
| **Fonctions** | `computeBillSavingsYear1` (l.451-464) + `computeAnnualBillAfterSolarYear1` (l.406-449) |
| **Bloc fautif** | `economie_an1 = (conso − import) × prix` appliqué tel quel à la carte `BATTERY_PHYSICAL` |
| **Pourquoi c'est faux physiquement** | Ce nombre mélange l'autoconso du **PV seul** (≈ 75-83 %) et l'apport **batterie** (≈ 17-25 %). Il fait croire que la batterie économise ~1 170 €/an alors qu'elle n'apporte que ~200-300 €/an, et **0 € en hiver** où FAVER consomme. |

### Correctif recommandé (à valider avant code)

1. **Exposer l'apport marginal de la batterie**, pas seulement le total :
   `economie_batterie_physique = economie_an1[BATTERY_PHYSICAL] − economie_an1[BASE]`
   et l'afficher sur la carte / le PDF comme **« apport batterie : +297 €/an »**, distinct de l'« économie totale PV+batterie ».
2. **Calculer le TRI/payback de la batterie sur ce delta** vs son **surcoût** (CAPEX batterie seul), pas sur l'économie totale — sinon le retour batterie est massivement flatté.
3. **(Secondaire)** Tracer dans la fiche FAVER que la conso est bien lue en mensuel (voir vérification terrain) ; et envisager une forme intra-journalière saisonnière (talon plat l'été) pour ne pas surévaluer la décharge du soir.

### Vérification terrain à faire sur la fiche réelle FAVER
- Log `CONSO_SOURCE_DECISION` (`solarnextPayloadBuilder.service.js` l.954) : doit être `SYNTHETIC` **avec mensuel**, ou `CSV`. Si `engine.hourly` est présent (l.575-583), vérifier que la **somme juin-août de ce tableau ≈ 1 560 kWh** (réel) et **non ~3 000 kWh** (générique) — sinon le mensuel est court-circuité par un profil stocké périmé.

### Test à ajouter (anti-régression)
Fichier `backend/tests/` — profil « hiver-only » (été ~510, hiver ~2800) + PV faible l'hiver :
```
assert decharge_hiver(Déc,Jan,Fév) ≈ 0 kWh                       // pas de stockage intersaisonnier
assert (economie_an1[BATTERY_PHYSICAL] − economie_an1[BASE])
        == round(decharge_annuelle_kWh × prix, 0)                // l'apport batterie = exactement la décharge valorisée, rien de plus
assert apport_batterie_eur < 0.35 × economie_an1[BATTERY_PHYSICAL] // garde-fou : la batterie ne doit pas représenter l'essentiel du nombre affiché pour ce profil
```
Ce test échouerait si un jour le KPI batterie réintègre l'économie PV (double attribution) ou si le SOC se mettait à franchir les saisons.
