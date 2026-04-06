# AUDIT COMPLET — Batterie Virtuelle & Physique — Moteur SolarNext

**Date :** 19 mars 2026  
**Périmètre :** Moteur SolarNext — calculateSmartpitch, scenarios_v2, services énergie/batterie/finance  
**Méthode :** Analyse exhaustive du code, sans supposition.

---

## 1️⃣ BATTERIE PHYSIQUE

### Méthode de calcul
Simulation horaire 8760h : à chaque heure, ordre logique :
1. **Injection directe** : `direct = min(pv, load)`
2. **Surplus** : `surplus = pv - direct`
3. **Charge** : si surplus > 0.15 kWh/h → charge_in = min(surplus, max_charge_kw), application rendement effCh, limite par (capacity - SOC)
4. **Besoin** : `need = load - direct`
5. **Décharge** : discharge_out = min(need, max_discharge_kw), application effDis, limite par (SOC - SOC_min)
6. **Auto** : `auto_h = direct + discharge_out`
7. **Import** : `import_h = max(0, load - auto_h)`

### Stockage
- **Source** : surplus PV non autoconsommé
- **Seuil de charge** : surplus > 0.15 kWh/h (hardcodé, `batteryService.js` L104)
- **Charge effective** : `charge_eff = charge_in * effCh`, limitée par espace restant (capacity - SOC)
- **Stock** : `batt_charge_hourly` = énergie stockée (kWh) par heure

### Décharge
- **Déclenchement** : quand `need = load - direct > 0`
- **Quantité** : `discharge_out = min(need, max_discharge_kw)`, puis application effDis, limite par (SOC - SOC_min)
- **Sortie** : `batt_discharge_hourly` = énergie déchargée par heure

### Rendement
- **Paramètre** : `roundtrip_efficiency` (0–1)
- **Répartition** : `effCh = effDis = sqrt(roundtrip)` (charge et décharge symétriques)
- **Défaut** : 0.9 si absent (`solarnextPayloadBuilder.service.js` L399)

### Limites (kW / kWh)
- **Capacité** : `capacity_kwh` (obligatoire > 0)
- **Puissance charge** : `max_charge_kw` | défaut = `capacity_kwh / 2` si absent
- **Puissance décharge** : `max_discharge_kw` | défaut = `capacity_kwh / 2` si absent
- **SOC min** : 10 % fixe (non configurable)
- **SOC initial** : 45 % fixe (non configurable)

### Échelle
- **Horaire** : 8760h. Agrégation mensuelle via `monthlyAggregator.js`.

### Fichiers concernés
| Fichier | Rôle |
|---------|------|
| `backend/services/batteryService.js` | Simulation 8760h, `simulateBattery8760({ pv_hourly, conso_hourly, battery })` |
| `backend/services/monthlyAggregator.js` | Agrégation mensuelle avec `battSummary` (auto_hourly, surplus_hourly, batt_discharge_hourly) |
| `backend/controllers/calc.controller.js` | Appel `simulateBattery8760`, construction `BATTERY_PHYSICAL` |
| `backend/services/solarnextPayloadBuilder.service.js` | Construction `battery_input` depuis economic_snapshot |

### Fonctions exactes
- **`simulateBattery8760`** (`batteryService.js` L45–167) — simulation principale
- **`passThroughNoBattery`** (`batteryService.js` L7–37) — sans batterie
- **`aggregateMonthly`** (`monthlyAggregator.js` L17–136) — agrégation mensuelle

### Points critiques
- **`battery_throughput_kwh`** : calculé nulle part. Le `batteryService` retourne `charge_in_total`, `discharge_total`, `batt_discharge_hourly` mais aucun champ `battery_throughput_kwh` n’est propagé dans `scenarios_v2`. Le mapper P8 lit `B.battery_throughput_kwh` → **toujours 0**.
- **Profil 24h** : `hourly_charge` et `hourly_discharge` ne sont pas exposés dans `scenarios_v2`. Le mapper P8 lit `B.hourly_charge` / `B.hourly_discharge` → **toujours 0** (safe24 fallback).

---

## 2️⃣ BATTERIE VIRTUELLE

### Méthode de calcul
**Modèle crédit kWh** : surplus crédité → stock virtuel → crédit consommé sur import → import facturé = import physique − crédit utilisé.

- **Fichier** : `backend/services/virtualBatteryCreditModel.service.js`
- **Fonction** : `applyVirtualBatteryCredit({ baseMonthly, config, economics })`

### Abonnement
- **Source** : `config.annual_subscription_ttc` (obligatoire si enabled)
- **Calcul coût** : `computeVirtualBatteryAnnualCost({ creditResult, config })` — `annual_cost_ttc = sub + fee_fixed + (kwh_for_cost * cost_per_kwh_storage)`
- **Grille DB** : `virtualBatteryQuoteCalculator.service.js` — `computeVirtualBatteryQuoteFromGrid` (restitution_energy_eur_kwh_ht, restitution_network_fee_eur_kwh_ht, virtual_subscription_eur_kwc_month_ht, etc.)

### Stock virtuel
- **Crédit** : `credited_kwh = surplus * credit_ratio` (par mois)
- **Banc** : `creditBankKwh += creditedKwhM`, puis déduction par `usedCreditKwhM = min(creditBankKwh, importM)`
- **Plafond** : `credit_cap_kwh` optionnel — excédent perdu

### Récupération énergie
- **Utilisation** : `used_credit_kwh` = crédit consommé sur l’import
- **Import facturé** : `billable_import_kwh = import - used_credit`
- **Autoproduction** : `autoproduction_kwh = autoBase + used_credit_kwh`

### Limites
- **credit_ratio** : 0–1 (défaut 1)
- **credit_cap_kwh** : optionnel, pas de plafond si null

### Fichiers concernés
| Fichier | Rôle |
|---------|------|
| `backend/services/virtualBatteryCreditModel.service.js` | `applyVirtualBatteryCredit`, `computeVirtualBatteryAnnualCost` |
| `backend/services/virtualBatteryQuoteCalcOnly.service.js` | `computeVirtualBatteryQuote` (formule simplifiée : abo + surplus*kwh + fee) |
| `backend/services/virtualBatteryQuoteCalculator.service.js` | `computeVirtualBatteryQuoteFromGrid` (grille DB, restitution, TURPE) |
| `backend/controllers/calc.controller.js` | Appel `applyVirtualBatteryCredit`, construction `BATTERY_VIRTUAL` |
| `frontend/src/data/virtualBatteryTariffs2026.ts` | Tarifs MyLight, Urban Solar (restitution, réseau, abo) |

### Fonctions exactes
- **`applyVirtualBatteryCredit`** (`virtualBatteryCreditModel.service.js` L27–89)
- **`computeVirtualBatteryAnnualCost`** (`virtualBatteryCreditModel.service.js` L99–132)
- **`computeVirtualBatteryQuote`** (`virtualBatteryQuoteCalcOnly.service.js` L17–79) — utilisé par route devis, pas par le moteur CALC principal
- **`computeVirtualBatteryQuoteFromGrid`** (`virtualBatteryQuoteCalculator.service.js` L60–255) — route devis, grille DB

### Points critiques
- **KPI** : Correction appliquée L562 : `virtualScenario.energy.import = billable_import_kwh` avant `addEnergyKpisToScenario`. Les KPI utilisent donc l'import facturé. Historique : `docs/audit-engine/ANALYSE_KPI_BATTERY_VIRTUAL.md`.
- **Deux modèles** : `virtualBatteryQuoteCalcOnly` (simple) vs `virtualBatteryCreditModel` (crédit kWh). Le moteur CALC utilise `virtualBatteryCreditModel` ; la route devis peut utiliser `computeVirtualBatteryQuoteFromGrid` (grille DB, restitution, TURPE).

---

## 3️⃣ COÛTS ÉNERGÉTIQUES

| Élément | Statut | Détail |
|---------|--------|--------|
| **Prix restitution €/kWh** | **PRÉSENT** | `virtualBatteryQuoteCalculator.service.js` : `restitution_energy_eur_kwh_ht`, `restitution_energy_eur_kwh_ht` (format plat), `vEnergy.hp_htt`/`hc_htt` (legacy). Utilisé dans `computeVirtualBatteryQuoteFromGrid` (route devis). **Non utilisé** dans le moteur CALC principal (qui utilise `virtual_battery_input` injecté). |
| **TURPE / frais réseau** | **PRÉSENT** | `virtualBatteryQuoteCalculator.service.js` : `restitution_network_fee_eur_kwh_ht`, `restitution_network_fee_eur_kwh_ht` (format plat), `vNetwork.hp_htt`/`hc_htt`. **Non utilisé** dans le moteur CALC principal. |
| **Taxes** | **PARTIEL** | TVA 20 % appliquée dans `computeVirtualBatteryQuoteFromGrid` (L241–242). `vat_rate` dans `virtual_battery_input` pour `annual_cost_ht`. Pas de taxes détaillées (CSPE, TCFE, etc.). |
| **Prix achat réseau** | **PRÉSENT** | `tarif_kwh` / `tarif_actuel` / `price_eur_kwh` (défaut 0.1952). `financeService.js` L20–25, `calc.controller.js` L35–39. Utilisé pour gain_auto, residual_bill, import_savings (batterie virtuelle). |
| **Prix revente surplus** | **PRÉSENT** | `oa_rate_lt_9` (0.04), `oa_rate_gte_9` (0.0617). `financeService.js` L36–40, `calc.controller.js` L41–45. Pour BATTERY_VIRTUAL : gain_oa = 0 (pas de revente OA), économie = import_savings_eur. |

### Emplacements code
- **Prix élec** : `financeService.js` L20–25, `calc.controller.js` L35–39
- **OA** : `financeService.js` L36–40, L90–91
- **Restitution** : `virtualBatteryQuoteCalculator.service.js` L134–135, L171–178
- **TURPE** : `virtualBatteryQuoteCalculator.service.js` L134–135, L172

---

## 4️⃣ HYPOTHÈSES ÉCONOMIQUES

| Élément | Valeur / Méthode | Fichier |
|---------|------------------|---------|
| **Évolution prix élec** | `elec_growth_pct` (défaut 5 %) | `financeService.js` L29, `solarnextPayloadBuilder.service.js` L37 |
| **Inflation** | Non modélisée séparément | — |
| **TRI / ROI méthode** | IRR : Newton-Raphson sur [-capex_net, total_an1, …]. ROI : première année où cumul_eur ≥ capex_net | `financeService.js` L137–164, L291–292 |
| **Durée étude** | `horizon_years` (défaut 25) | `financeService.js` L48 |
| **Actualisation** | LCOE : `discount_rate = 0.03` | `financeService.js` L168, L175 |
| **Dégradation PV** | `pv_degradation_pct` (défaut 0.5 %) | `financeService.js` L32–34 |
| **Remplacement onduleur** | Année 15, coût 12 % du CAPEX | `financeService.js` L53–54 |
| **Prime autoconsommation** | 80 €/kWc si < 9 kWc, 180 €/kWc si ≥ 9 kWc | `financeService.js` L44–46 |

---

## 5️⃣ FLOW ÉNERGÉTIQUE GLOBAL

### Ordre logique (1 kWh produit)

1. **Autoconsommation directe** : `direct = min(pv, load)` — priorité 1
2. **Surplus** : `surplus = pv - direct`
3. **Batterie physique** (si activée) :
   - Charge : `charge_in = min(surplus, max_charge_kw)` si surplus > 0.15
   - Surplus restant après charge
   - Décharge : `discharge_out` pour couvrir `need = load - direct`
   - Auto = direct + discharge_out
4. **Batterie virtuelle** (si activée) :
   - Surplus crédité (credit_ratio) → stock virtuel
   - Import physique : `import = load - auto` (auto = direct, pas de décharge physique)
   - Crédit : `used_credit = min(creditBank, import)`
   - Import facturé : `billable_import = import - used_credit`
5. **Sans batterie** : surplus injecté au réseau

### Flux par scénario

| Scénario | Auto | Surplus | Import | Stock |
|----------|------|---------|--------|-------|
| BASE | direct | pv - direct | load - direct | — |
| BATTERY_PHYSICAL | direct + décharge | surplus après charge | load - auto | charge/décharge 8760h |
| BATTERY_VIRTUAL | direct (identique BASE) | identique BASE | billable_import (import - crédit) | crédit kWh mensuel |

---

## 6️⃣ POINTS CRITIQUES

| Type | Détail |
|------|--------|
| **Simplifications** | SOC min 10 %, SOC initial 45 %, seuil charge 0.15 kWh/h fixes ; pas de dégradation batterie ; pas de HP/HC dans le flux physique |
| **Oublis** | `battery_throughput_kwh` jamais calculé ; `hourly_charge` / `hourly_discharge` non exposés dans scenarios_v2 ; P8 mapper lit B.battery_throughput_kwh → 0 |
| **Hypothèses risquées** | Prix élec 0.1952 par défaut ; OA 0.04 / 0.0617 ; pas de TURPE sur l’achat réseau |
| **Incohérences** | `virtualBatteryQuoteCalcOnly` vs `virtualBatteryCreditModel` (deux modèles) ; restitution/TURPE grille DB non utilisés dans le moteur CALC |

---

## 7️⃣ SCORE DE FIABILITÉ

| Élément | Note / 10 | Commentaire |
|---------|-----------|-------------|
| **Batterie physique** | **7/10** | Modèle 8760h cohérent, rendement, limites. Manque : throughput, profil 24h, DoD configurable |
| **Batterie virtuelle** | **6/10** | Modèle crédit kWh correct. Mais : bug KPI, restitution/TURPE grille non utilisés dans CALC, pas de saisonnalité |
| **Modèle économique global** | **6/10** | CAPEX devis, cashflows, IRR, LCOE. Manque : TURPE achat, taxes détaillées, inflation |

---

## CE QUI MANQUE POUR ÊTRE RÉALISTE MARCHÉ FRANCE 2026

1. **P8** : `battery_throughput_kwh` = somme `batt_discharge_hourly` ; `hourly_charge` / `hourly_discharge` dans scenarios_v2 ; `energy.import = billable_import_kwh` pour BATTERY_VIRTUAL dans addEnergyKpisToScenario.
2. **Batterie physique** : DoD configurable ; SOC initial ; dégradation capacité ; HP/HC si tarif dynamique.
3. **Batterie virtuelle** : Intégration restitution + TURPE grille DB dans le moteur CALC ; saisonnalité (été/hiver) ; plafond crédit réaliste.
4. **Coûts** : TURPE sur achat réseau ; CSPE, TCFE ; taxes détaillées.
5. **Prix** : Mise à jour OA 2026 ; évolution prix élec réaliste ; option tarif dynamique.
6. **Conformité** : Vérification des offres batterie virtuelle (MyLight, Urban Solar, etc.) 2026.

---

## 8️⃣ RÉFÉRENCES FICHIERS

| Fichier | Lignes clés |
|---------|-------------|
| `backend/services/batteryService.js` | 45–167 (simulateBattery8760) |
| `backend/services/virtualBatteryCreditModel.service.js` | 27–89, 99–132 |
| `backend/services/financeService.js` | 13–55, 60–132, 189–358 |
| `backend/controllers/calc.controller.js` | 59–620 (calculateSmartpitch, BASE, BATTERY_PHYSICAL, BATTERY_VIRTUAL) |
| `backend/services/scenarios/scenarioBuilderV2.service.js` | 17–118 |
| `backend/services/monthlyAggregator.js` | 17–136 |
| `backend/services/pdf/pdfViewModel.mapper.js` | 427–520 (P8) |

---

*FIN DU RAPPORT AUDIT*
