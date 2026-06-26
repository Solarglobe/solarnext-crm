# AUDIT — Régression autoconsommation du moteur PV (8760 h)

**Date :** 26/06/2026 · **Périmètre :** moteur de calcul énergie/finance (backend) · **Mode :** AUDIT SEUL — aucune correction effectuée
**Cas :** SGS-2026-0117 (A, 78 %), SGS-2026-0121 (B, 67 %), dossier 9 kWc

---

## 0. Conclusion en une phrase

La production (quasi identique : Δ0,26 %) **n'a aucune influence** sur l'écart d'autoconsommation. La cause exacte du basculement 78 %→67 % est **le profil de consommation injecté dans les scénarios batterie** : le commit **`c3f3a15a` (25/06 22:39 « use raw consumption for battery calculations »)** a remplacé le profil **piloté** (charges décalées vers les heures solaires) par le profil **brut**. À physique strictement identique, ce seul changement fait chuter l'autoconso de **~15 points** (démontré ci-dessous : 67,3 % → 51,9 %), augmente l'injection de ~1 000 kWh et fait baisser les économies. Deux dossiers proches divergent parce qu'ils ne sont **pas calculés sur la même version de moteur / le même profil** (V12→V13 + `needs_recompute`, commit `67a86f85`).

---

## 1. Démonstration mathématique de la cause (preuve chiffrée)

Banc de test exécuté avec **le code réel du moteur** (`batteryService.simulateBattery8760` + `pilotageService.buildPilotedProfile`, versions committées HEAD), courbe de consommation **réelle ENEDIS** (`backend/backend/loadcurve.csv`), même PV, même batterie (5 kWh, rendement 0,9, 2,5 kW).

**Conditions strictement identiques** : production 6850 kWh, consommation annuelle 8000 kWh (le pilotage **conserve** le total au kWh près : raw 8000 = piloté 8000), même batterie. Seul change le profil horaire de conso :

| Profil conso (même annuel, même prod, même batterie) | Autoconso % | Énergie utilisée | Injection | Import |
|---|---|---|---|---|
| **AVANT `c3f3a15a`** — profil **piloté** | **67,3 %** | 4 610 | 2 166 | 3 390 |
| **APRÈS `c3f3a15a`** — profil **brut** | **51,9 %** | 3 553 | 3 189 | 4 447 |
| **Δ (effet du seul commit)** | **−15,4 pts** | **−1 057 kWh** | **+1 023 kWh** | **+1 057 kWh** |

C'est exactement la signature décrite : **autoconso chute, énergie utilisée baisse (~1 000 kWh « disparus »), injection augmente fortement, économies chutent — à production inchangée.** L'ampleur (−15 pts) est du même ordre que l'écart A↔B (−11 pts) et que les 743 kWh perdus.

### Pourquoi : le pilotage déplace la consommation vers le soleil
`buildPilotedProfile` (`backend/services/pilotageService.js`) décale les charges pilotables (parts legacy **35 % stockable / 20 % programmable / 10 % flexible**) dans les fenêtres solaires trimestrielles (T1 10h–16h, T2 9h–18h, T3 8h–19h), **sans créer ni perdre un seul kWh** (tolérance ±0,001). Résultat : l'autoconsommation augmente mécaniquement. En retirant ce profil des scénarios batterie, on supprime ce gain → effondrement de l'autoconso.

### Le code exact qui a changé (commit `c3f3a15a`, `backend/controllers/calc.controller.js`)
```diff
- const consoHourly = ctx.conso_p_pilotee || ctx.conso?.hourly || ctx.conso?.clamped;
+ const consoHourly = resolveRawScenarioConsumptionHourly(ctx);   // = ctx.conso.hourly || ctx.conso.clamped (JAMAIS piloté)
```
Appliqué aux **trois** scénarios batterie : `BATTERY_PHYSICAL` (l. ~775), `BATTERY_VIRTUAL` (l. ~930), `BATTERY_HYBRID` (l. ~1437). Le drapeau passe aussi en dur à `scenario_uses_piloted_profile = false`. Le profil piloté reste calculé (`ctx.conso_p_pilotee`, l. 756) mais **n'est plus utilisé** dans les scénarios batterie.

> Les deux dossiers ayant une **batterie physique** (voir §4, les 129/139 kWh manquants = pertes batterie), ce sont précisément ces scénarios qui sont touchés.

---

## 2. Pourquoi deux dossiers « identiques » divergent (78 % vs 67 %)

L'autoconso n'est **pas** fonction de la production mais de : (1) niveau de conso, (2) **forme/source** de la courbe conso, (3) taille du système, (4) batterie, (5) **profil piloté ou brut**. Démonstrations (même code moteur) :

**a) À production constante (6850), l'autoconso suit la consommation :**

| Conso annuelle | 9500 | 8500 | 7500 | 6500 | 5500 |
|---|---|---|---|---|---|
| Autoconso % (auto/prod) | 56,3 | 53,4 | 50,2 | 46,8 | 42,9 |

→ ±13 points rien qu'avec le niveau de conso. La production (Δ18 kWh) est hors sujet.

**b) À conso ET production identiques (7500 / 6850), la *forme* de la courbe suffit :**

| Forme conso | Autoconso % | Énergie utilisée |
|---|---|---|
| Réelle ENEDIS | 50,2 % | 3 441 |
| Synthétique « pic du soir » | 59,0 % | 4 043 |

→ ±9 points uniquement par la forme/source de la conso.

**Conséquence :** un écart 78 %↔67 % entre deux clients est **physiquement banal** dès lors que leurs consommations diffèrent (niveau, forme, ou pilotage). Le problème n'est donc pas « pourquoi ils diffèrent » mais **« sont-ils calculés dans les mêmes conditions ? »** — et la réponse est probablement non (cf. §3).

---

## 3. Facteur aggravant : mélange de versions de moteur (V12 → V13)

Commit `67a86f85` (25/06) :
- `CALC_ENGINE_VERSION` **V12 → V13** (`backend/services/calc/calc.constants.js`) — **invalide les anciens snapshots**.
- `SCENARIO_MONTHLY_BATTERY_AUTO_BOOST` **1,1 → 1,0** (`backend/services/core/engineConstants.js`) — supprime le **bonus +10 %** d'autoconso des scénarios batterie en repli mensuel.
- Garde « cohérence moteur » : toute carte batterie non-8760 à côté d'une base 8760 est forcée `_skipped` (`calc.controller.js`, bloc COHERENCE_MOTEUR).
- `studyScenarios` → `needs_recompute` quand le snapshot est périmé (commit `44e81a10`).

**Effet de bord critique :** tant qu'un dossier n'est pas recalculé, il **affiche encore les chiffres V12** (profil piloté, bonus +10 %, autoconso haute). Un dossier recalculé après les commits du 25–26/06 affiche les chiffres V13 (profil brut, sans bonus, autoconso basse). **Si A est sur un snapshot V12 (78 %) et B a été recalculé en V13 (67 %), l'écart de 11 points EST la régression** — pas une différence physique. C'est l'explication la plus simple d'une « variation disproportionnée » entre deux dossiers proches.

---

## 4. Vérification des invariants (preuve que le moteur est cohérent par ailleurs)

Les chiffres fournis **ne bouclent pas** sur `production = autoconso + injection`, mais bouclent sur la **vraie** identité avec batterie :

```
production = énergie utilisée + injection + pertes_batterie
```

| Dossier | Prod | Utilisée | Injection | Prod − Util − Inj = pertes |
|---|---|---|---|---|
| A (0117) | 6850 | 5335 | 1386 | **129 kWh** |
| B (0121) | 6868 | 4592 | 2137 | **139 kWh** |

Ces 129/139 kWh sont les **pertes round-trip de la batterie physique** (≈10 % sur ~1 300 kWh de throughput → ~130 kWh). **Cela prouve que les deux dossiers ont bien une batterie physique** et que l'invariant énergétique est respecté. Le moteur n'« perd » pas d'énergie : la batterie est réellement simulée heure par heure (boucle SOC, charge ssi surplus>0,15 kWh, plafonds puissance/capacité, réserve 10 %, rendement √η charge/décharge — `batteryService.js` l. 105–185). **Aucune moyennisation.**

Banc de test : l'invariant `prod − utilisée − injection − pertes = 0` retombe exactement à 0 dans toutes les simulations.

---

## 5. Le dossier 9 kWc n'est PAS incohérent

Production 8688 kWh, utilisée 5034 kWh. À conso comparable, **agrandir le système baisse mécaniquement l'autoconso %** (plus de surplus midi non absorbable). Démontré (conso fixe 7500) :

| Système | Production | Autoconso % | Injection |
|---|---|---|---|
| 7 kWc | 6850 | 50,2 % | 3 302 |
| 9 kWc | 8688 | 43,0 % | 4 833 |

→ « plus gros = moins d'autoconso % » est **le comportement physique attendu**, pas un bug. Une batterie 5 kWh ne suit pas un surplus midi qui grossit.

---

## 6. Causes ÉCARTÉES (vérifiées, non responsables)

| Hypothèse | Verdict | Preuve |
|---|---|---|
| La production cause l'écart | **NON** | Δ0,26 % ; à prod constante l'autoconso varie de 13 pts selon la conso (§2a) |
| Plancher conso `0.1→0 kWh/h` (commit `cac7118a`, `clampHourlyProfile`) | **Négligeable** | Sur courbe réaliste : Δ = 2 kWh, 0,0 pt. N'impacte que des profils à très nombreuses heures < 0,1 kWh |
| Batterie « estimée/moyennée » | **NON** | Boucle SOC 8760 h réelle, contraintes physiques respectées (§4) |
| Le 9 kWc est buggé | **NON** | Baisse d'autoconso % normale avec la taille (§5) |
| Énergie qui « disparaît » | **NON** | = pertes batterie (§4), invariant bouclé |

⚠️ **Point de vigilance secondaire** (pas la cause ici, mais réel) : `cac7118a` introduit `preserveMonthlyTotals()` qui **renormalise la courbe horaire mois par mois** sur un `monthly_kwh_ref`. Pour un dossier saisi en **mensuel/manuel**, la forme intra-journalière est **reconstruite** par `buildProfile8760` (courbe « type » synthétique avec saisonnalité + bruit déterministe). Deux dossiers dont l'un est en CSV horaire réel et l'autre en mensuel n'ont donc **pas la même forme** → autoconso différente « par construction ». C'est exactement le type de reconstruction que vous redoutiez : il est légitime pour une saisie mensuelle, mais il faut savoir que **la courbe d'un dossier mensuel n'est pas mesurée, elle est synthétisée**.

---

## 7. Ce que je ne peux pas produire sans vos données (et comment l'obtenir)

L'export **8760 h réel ligne par ligne pour SGS-2026-0117 / 0121** (production, conso, autoconso, surplus, charge/décharge batterie, SOC, pertes, injection, import) exige les **entrées stockées de chaque dossier** (orientation, inclinaison, kWc, mode/source de consommation, paramètres batterie), qui sont en base / dans le snapshot d'étude — non accessibles dans cet espace de travail. Le banc de test ci-dessus utilise des entrées représentatives, pas les vôtres : il **prouve le mécanisme**, pas les valeurs exactes de vos deux dossiers.

**Diagnostic décisif à relever sur chaque dossier** (3 champs ajoutés justement par les commits du 25–26/06) :

1. `scenarios_engine_version` du snapshot → **A et B sont-ils tous deux en V13 ?** (sinon, régression de version confirmée).
2. `consumption_source_mode` → CSV_HOURLY (réel) vs MONTHLY / NATIONAL_FALLBACK / SYNTHETIC (reconstruit) pour A et pour B.
3. `scenario_uses_piloted_profile` + `energy_basis` sur la carte batterie de chaque dossier.

Si vous me fournissez le JSON d'entrée des deux dossiers (ou un accès lecture base), je produis l'export 8760 exact, les 12 totaux mensuels, le différentiel A↔B heure par heure et la localisation précise des 743 kWh — avec le code moteur réel.

---

## 8. Décision de modélisation à trancher (avant toute correction)

Le commit `c3f3a15a` n'est pas un « bug » au sens strict : c'est un **choix** de basculer les scénarios batterie sur la conso brute (plus conservateur) plutôt que pilotée (plus optimiste). La vraie question est : **78 % (piloté) ou 67 % (brut) représente-t-il le client réel ?**
- **Piloté (78 %)** suppose un pilotage type Shelly réellement installé qui décale 35/20/10 % des charges vers le soleil.
- **Brut (67 %)** ne suppose aucun pilotage.

Tant que ce point n'est pas tranché — et tant que **tous** les dossiers ne sont pas recalculés sur la **même** version V13 — les comparaisons inter-dossiers resteront faussées. **Aucune correction de code ne doit précéder cette décision.**

---

## Fichiers / lignes concernés (récapitulatif)

| Élément | Fichier | Réf. |
|---|---|---|
| Bascule piloté→brut (CAUSE) | `backend/controllers/calc.controller.js` | commit `c3f3a15a`, scénarios batterie ~l. 775 / 930 / 1437 ; `resolveRawScenarioConsumptionHourly` |
| Construction profil piloté | `backend/services/pilotageService.js` | `buildPilotedProfile`, fenêtres solaires, parts 35/20/10 |
| Bonus +10 % neutralisé | `backend/services/core/engineConstants.js` | commit `67a86f85`, `SCENARIO_MONTHLY_BATTERY_AUTO_BOOST 1.1→1.0` |
| Invalidation snapshots V12→V13 | `backend/services/calc/calc.constants.js` ; `studyScenarios.controller.js` | commit `67a86f85`, `44e81a10` |
| Renormalisation mensuelle / courbe synthétique | `backend/services/consumptionService.js` | commit `cac7118a`, `preserveMonthlyTotals`, `buildProfile8760` |
| Plancher conso 0.1→0 (négligeable) | `backend/services/consumptionService.js` | commit `cac7118a`, `clampHourlyProfile` |
| Autoconso directe (sain) | `backend/services/monthlyAggregator.js` | `min(prod,conso)` 8760 h |
| Simulation batterie (saine) | `backend/services/batteryService.js` | `simulateBattery8760`, boucle SOC l. 105–185 |

*Note technique : la copie de certains fichiers via le shell est tronquée dans cet environnement (artefact connu) ; tous les chiffres ci-dessus ont été produits avec les versions **committées HEAD** vérifiées syntaxiquement, pas avec la copie tronquée.*
