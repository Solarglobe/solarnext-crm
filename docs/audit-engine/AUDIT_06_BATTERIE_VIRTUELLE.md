# AUDIT 06 — Batterie virtuelle

Modèle actuel, caractère purement financier ou crédit kWh, comparaison avec un modèle “marché réel”.

---

## Modèle actuel (code)

- **Fichier** : `backend/services/virtualBatteryQuoteCalcOnly.service.js` (utilisé par `virtualBatteryQuoteCalculator.service.js` et par le calc).  
- **Fonction** : `computeVirtualBatteryQuote({ annual_surplus_kwh, annual_import_kwh, config })`.

### Comportement

- **Purement financier** : aucun changement des flux énergétiques (production, autoconsommation, surplus, import). Le scénario BATTERY_VIRTUAL reprend les **mêmes** energy que le BASE ; seul le bloc finance est modifié (coût annuel batterie virtuelle, cashflows, ROI).  
- **Formule du coût annuel** :  
  `annualCostTtc = annual_subscription_ttc + surplus * cost_per_kwh_storage + fee_fixed`  
  (avec `surplus` = annual_surplus_kwh).  
- **Champs lus** :  
  - `config.enabled` (doit être true).  
  - `config.annual_subscription_ttc` (obligatoire ≥ 0).  
  - `config.cost_per_kwh_storage` (optionnel, défaut 0).  
  - `config.fee_fixed` (optionnel, défaut 0).  
  - `config.vat_rate` (optionnel, pour calculer annual_cost_ht).  
  - `config.estimated_savings_annual` (optionnel, pour net_gain_annual = estimated_savings - annualCostTtc).  
- **annual_import_kwh** : passé en entrée mais **non utilisé** dans la formule de coût (seul le surplus entre dans `cost_per_kwh_storage`).

---

## Est-ce basé sur un crédit kWh ?

- **Non.** Il n’y a pas de logique “surplus → crédit kWh” ni “import → consommation du crédit”.  
- Le **surplus annuel** est uniquement utilisé comme **multiplicateur** pour un coût optionnel (`surplus * cost_per_kwh_storage`), typiquement pour représenter un tarif au kWh stocké/virtuel.  
- Aucun suivi de “stock virtuel” ni de valorisation du kWh injecté vs soutiré.

---

## Comparaison avec un modèle “marché réel”

Un modèle réaliste type offre de batterie virtuelle (ex. surplus → crédit, import → consommation du crédit) inclurait par exemple :

| Élément | Modèle actuel | Modèle “marché” typique |
|---------|----------------|--------------------------|
| Surplus → crédit kWh | Non (surplus utilisé seulement pour coût au kWh stocké) | Oui : surplus crédité en kWh ou en € |
| Import → consommation du crédit | Non | Oui : soutirage déduit du crédit |
| Abonnement | Oui (annual_subscription_ttc) | Souvent oui |
| Frais d’acheminement / frais fixes | Partiel (fee_fixed) | Souvent différenciés |
| Pertes / coefficient de conversion | Non | Souvent (ex. 80 % du surplus crédité) |
| Plafond de crédit (cap) | Non | Souvent (credit_kwh_cap, rollover) |
| Prix du kWh crédité vs soutiré | Un seul coût optionnel (cost_per_kwh_storage) | Souvent prix d’achat vs prix de revente / crédit |

---

## Champs manquants pour un modèle plus réaliste

- **Crédit kWh** : pas de notion de “crédit” en kWh ni de plafond (credit_kwh_cap).  
- **Rollover** : pas de report de crédit d’une période à l’autre.  
- **Valorisation surplus vs import** : pas de prix d’injection (€/kWh) ni de prix de soutirage distinct pour la partie “virtuelle”.  
- **Pertes / coefficient** : pas de coefficient (ex. 0.8) sur le surplus pour simuler les pertes ou la part valorisée.  
- **Saisonnalité / période** : tout est annuel ; pas de règles par mois ou par trimestre.  
- **Usage de annual_import_kwh** : actuellement inutilisé dans la formule de coût ; dans un modèle crédit, il servirait à calculer la part de l’import “couverte” par le crédit.

---

## Synthèse

- La batterie virtuelle est **purement financière** : coût annuel = abonnement + (surplus × coût au kWh stocké) + frais fixes, sans modification des flux énergétiques.  
- Elle **n’est pas** basée sur un modèle “crédit kWh” (pas de stock virtuel, pas de déduction du crédit sur l’import).  
- Pour approcher un modèle “marché réel”, il manque : crédit kWh, plafond, rollover, valorisation surplus/import, pertes ou coefficient, et l’utilisation de l’import dans la logique coût/bénéfice.
