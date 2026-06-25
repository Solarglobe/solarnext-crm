# Audit — calcul batterie physique vs virtuelle (cas Didier FAVER)

**Date :** 25/06/2026 · **Mode :** audit seul, aucune modification de code.
**Question de Benoit :** client à très grosse conso l'hiver et quasi rien l'été ; pourtant la batterie **physique** affiche presque autant d'économie que la **virtuelle**. Anormal.

---

## 1. Verdict en une phrase

Le moteur de batterie physique (`simulateBattery8760`) est **correct** : il cycle heure par heure, ne peut PAS déplacer l'énergie d'une saison à l'autre. Donc pour un client hiver-only, la physique **devrait** être quasi nulle. Si elle ressort proche de la virtuelle, **ce n'est pas le moteur batterie qui est en cause, c'est le profil de consommation horaire qui est trop lissé** : il étale la conso sur toute l'année (été compris) au lieu de respecter le vrai « tout l'hiver / rien l'été ». Le faux pic d'été donne à la batterie physique un cycle quotidien à faire qu'elle n'a pas dans la réalité.

---

## 2. Comment la batterie physique est calculée (chaîne exacte)

`backend/controllers/calc.controller.js` (bloc `BATTERY_PHYSICAL`, l.757-850) appelle **`simulateBattery8760()`** dans `backend/services/batteryService.js`. Logique, heure par heure sur 8760 h :

1. `direct = min(pv, conso)` → autoconsommation directe.
2. surplus PV → **charge** la batterie, borné par `max_charge_kw`, le rendement `√(roundtrip)` et la place restante (`capacity − SOC`).
3. déficit conso → **décharge** la batterie, borné par `max_discharge_kw`, le rendement, et `SOC − SOC_min` (plancher 10 %).
4. `import_réseau = max(0, conso − direct − décharge)`.

**Point clé :** la batterie ne peut décharger à l'heure *h* que ce qu'elle a chargé **plus tôt le même jour** (capacité finie, plancher 10 %, SOC remis à plat de fait sur un cycle ~journalier). **Elle ne stocke jamais le surplus de juillet pour le rendre en janvier.** C'est physiquement juste.

> Note : il existe un 2ᵉ simulateur propre, `domains/studies/financial/batterySimulator.js`, mais il **n'est pas branché** sur les cartes scénarios — seul `batteryService.js` l'est. Les deux donnent la même physique.

La batterie **virtuelle** (`virtualBattery8760.service.js` / `batterySimulator.js`) est au contraire un **compteur d'énergie annuel** : tout surplus crédité est restituable n'importe quand dans l'année, **sans perte ni contrainte de puissance** (cf. audit du 14/06). Elle, **traverse les saisons** sans problème.

---

## 3. Le vrai responsable : la construction du profil horaire de conso

`backend/domains/studies/financial/energyCalculator.js` → `buildConsumptionHourlyWh()` (l.194-219) :

- Conso de chaque mois répartie **également sur tous les jours** : `dailyWh = mois / nbJours`.
- Conso de chaque jour répartie par **une courbe horaire FIXE** (`RESIDENTIAL_HOURLY_WEIGHTS`) — **la même tous les jours de l'année**, avec un pic du soir (18-20 h).

Donc **la seule saisonnalité vient des totaux mensuels**. Et ces totaux mensuels :

- si la conso a été saisie **en mensuel réel** → la saisonnalité de FAVER est respectée ;
- si elle a été saisie **en annuel seul** (pas de CSV, pas de mensuel) → fallback sur `MONTHLY_SEASONAL_CONSUMPTION_WEIGHTS` (l.8-10) = **courbe générique de ménage** :
  `[1.24, 1.12, 1.04, 0.92, 0.84, 0.78, 0.76, 0.78, 0.88, 0.98, 1.10, 1.26]`
  → ratio hiver/été ≈ **1,65×** seulement. **Aucun rapport** avec un vrai « grosse conso l'hiver, rien l'été » (ratio réel 30-60×).

**Si FAVER est en annuel-seul, le modèle lui invente une conso d'été substantielle**, avec un pic du soir quotidien, pile quand le surplus PV d'été est maximal → la batterie physique cycle tous les jours d'été → économie gonflée.

---

## 4. Preuve numérique (moteur réel du repo, `simulateBattery8760`)

Même client : 12 000 kWh/an, PV ≈ 7 000 kWh/an (6 kWc), batterie 10 kWh / 5 kW / 90 %, prix 0,25 €/kWh. Script : `faver_audit.mjs`.

| | Import sans batt | Éco PHYSIQUE | Éco VIRTUELLE | Décharge batt | Cycles éq. | Physique/Virtuelle |
|---|---|---|---|---|---|---|
| **A. Profil générique** (annuel-seul) | 6 795 kWh | **339 €/an** | 449 €/an | 1 355 kWh | 136 | **75 %** |
| **B. Profil réel FAVER** (hiver fort/été ~nul) | 9 379 kWh | **77 €/an** | 1 095 €/an | 310 kWh | 31 | **7 %** |

Lecture :

- **Cas A** (ce que fait le modèle si conso saisie en annuel) : la physique « tient » 75 % de la virtuelle, 136 cycles/an. C'est **exactement l'anomalie que tu observes**.
- **Cas B** (réalité de FAVER) : la physique s'effondre à **7 %** de la virtuelle, seulement 31 cycles. En été il y a du surplus mais **pas de conso à servir le soir** ; en hiver il y a de la conso mais **pas de surplus pour charger**. La batterie physique ne sert presque à rien — c'est le résultat attendu.
- La virtuelle, elle, **monte** quand la saisonnalité est réelle (4 379 kWh de crédit utilisé en B contre 1 795 en A) : elle banque l'été pour décharger l'hiver. D'où l'écart énorme **77 € vs 1 095 €**.

> Chiffres illustratifs (PV et forme hiver-only synthétisés) mais calculés avec le **vrai moteur batterie** du CRM — la mécanique et l'ordre de grandeur sont représentatifs, pas les euros exacts de la fiche FAVER.

---

## 5. Ce qu'il faut vérifier sur la fiche FAVER (1 seul point décisif)

**Comment sa consommation est-elle stockée ?**

1. Onglet énergie / compteur de FAVER : a-t-il une **répartition mensuelle réelle** (12 valeurs très contrastées) ou juste **un total annuel** ?
2. Dans le payload de calcul, regarder le log `CONSO_SOURCE_DECISION` (`solarnextPayloadBuilder.service.js` l.954) : `source: "CSV"` / `"SYNTHETIC"`.
   - **CSV** (courbe Enedis réelle) → saisonnalité respectée, la physique devrait déjà être faible. Si elle reste haute, on creuse ailleurs.
   - **SYNTHETIC** + conso annuelle seule → **c'est confirmé** : la physique est gonflée par le profil générique. C'est la cause.
3. Vérifier `energy_profile.engine.hourly` : si présent, voir si la somme des mois d'été (juin-août) est quasi nulle (réel) ou ~ 20 % de l'année (générique).

---

## 6. Conclusion

- Le **calcul** de la batterie physique n'est pas faux : il modélise correctement un stockage journalier avec pertes et puissance finie.
- L'**anomalie** « physique ≈ virtuelle » pour FAVER vient du **profil de conso trop lissé** : tant que la saisonnalité réelle (hiver fort / été nul) n'entre pas dans les **totaux mensuels**, le modèle suppose une conso d'été inexistante qui fait tourner la batterie physique pour rien.
- **Limite résiduelle même avec mensuel correct :** la forme **intra-journalière** reste figée (même courbe résidentielle 365 j/an). Si la conso d'hiver de FAVER est surtout du chauffage diffus jour+nuit (et pas un pic du soir), la physique peut encore être légèrement surestimée. Secondaire devant le point §3.

**Recommandation :** d'abord confirmer le mode de saisie conso de FAVER (§5). S'il est en annuel-seul, saisir/importer sa **vraie répartition mensuelle** (ou son CSV Enedis) : la batterie physique retombera à sa vraie valeur (~quelques dizaines d'€/an) et la virtuelle ressortira nettement, ce qui correspond à ton intuition.
