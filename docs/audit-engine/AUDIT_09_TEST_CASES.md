# AUDIT 09 — Tests de cohérence (scénarios théoriques)

Scénarios simples pour vérifier le moteur (sans modification de code).

---

## 1. Maison avec faible conso → surplus élevé attendu

- **Setup** : conso annuelle faible (ex. 3 000 kWh), production PV normale (ex. 4 000 kWh), profil conso “actif” ou “télétravail”.  
- **Attendu** : autoconsommation ≤ min(prod, conso) ≈ 3 000 kWh ; surplus ≈ 4 000 − auto (élevé) ; import faible.  
- **Vérification** : dans les sorties scenarios_v2 (BASE), energy.autoconsumption_kwh ≤ energy.production_kwh et ≤ conso annuelle ; energy.surplus_kwh ≈ production_kwh − autoconsumption_kwh ; energy.import_kwh faible.  
- **Pilotage** : déplace une partie de la conso vers les heures solaires → auto peut augmenter, surplus diminuer ; le total conso reste 3 000 kWh.

---

## 2. Maison avec forte conso → surplus faible

- **Setup** : conso annuelle forte (ex. 15 000 kWh), même production (4 000 kWh).  
- **Attendu** : auto ≤ 4 000 (limité par le PV) ; surplus faible voire 0 si la conso absorbe tout le PV (après pilotage possible) ; import ≈ 15 000 − auto (élevé).  
- **Vérification** : energy.surplus_kwh faible ; energy.import_kwh ≈ conso − autoconsumption_kwh ; invariant surplus + auto = prod.

---

## 3. Batterie physique → autoconsommation doit augmenter

- **Setup** : même base (PV + conso) ; activer batterie physique (ex. 10 kWh, rendement 0.9, puissances 5 kW).  
- **Attendu** : BATTERY_PHYSICAL.autoconsumption_kwh > BASE.autoconsumption_kwh ; BATTERY_PHYSICAL.import_kwh < BASE.import_kwh ; BATTERY_PHYSICAL.surplus_kwh < BASE.surplus_kwh.  
- **Vérification** : comparer energy du scénario BASE et BATTERY_PHYSICAL ; les trois inégalités doivent être vérifiées (cf. script run-real-scenarios-e2e.js et AUDIT_05).

---

## 4. Batterie virtuelle → import “financier” / coût

- **Setup** : même base ; activer batterie virtuelle (abonnement annuel, optionnel cost_per_kwh_storage).  
- **Attendu** : BATTERY_VIRTUAL energy identique à BASE (pas de changement des flux). Finance : virtual_battery_cost_annual > 0 ; cashflows et ROI impactés (OPEX soustrait chaque année).  
- **Vérification** : energy BASE = energy BATTERY_VIRTUAL ; finance.virtual_battery_cost_annual présent ; roi_years (si calculé) ≥ BASE ou différent selon le niveau d’OPEX.

---

## 5. Invariants annuels (tous scénarios)

- Pour chaque scénario :  
  - autoconsumption_kwh ≤ production_kwh ;  
  - autoconsumption_kwh ≤ conso_annuelle ;  
  - surplus_kwh + autoconsumption_kwh = production_kwh ;  
  - import_kwh + autoconsumption_kwh = conso_annuelle.  
- Vérification : sommer les monthly ou utiliser les totaux energy du mapper ; les égalités doivent tenir (à l’arrondi près, ex. 1 kWh).

---

## 6. CAPEX null → ROI / IRR null

- **Setup** : economic_snapshot sans capex_total_ttc (ou finance_input.capex_ttc non renseigné).  
- **Attendu** : pour les scénarios concernés, capex_ttc = null, roi_years = null, irr_pct = null, flows = null.  
- **Vérification** : sorties scenarios_v2 et réponse computeFinance (cf. AUDIT_07).

---

## Comparaison avec ce que produit le moteur

- Les scripts existants `run-real-scenarios-e2e.js`, `test-scenario-battery-physical.js`, `test-scenario-battery-virtual.js` et les tests dans `monthlyAggregator` / `scenarioBuilderV2` couvrent une partie de ces cas.  
- Pour une validation complète : exécuter run-real-scenarios-e2e avec une étude réelle (ou fixture), puis vérifier sur les JSON générés (tmp/scenarios_*.json) les relations ci-dessus et les différences BASE vs PHYSICAL vs VIRTUAL.
