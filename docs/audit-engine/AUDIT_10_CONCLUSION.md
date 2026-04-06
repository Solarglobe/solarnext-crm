# AUDIT 10 — Conclusion

Synthèse des incohérences détectées, modèles corrects attendus et écarts entre implémentation et physique réelle.

---

## Points conformes au modèle physique / économique

- **Dispatch sans batterie** : formules auto = min(PV, Load), surplus = max(0, PV − Load), import = max(0, Load − auto) ; invariants (auto ≤ prod, auto ≤ conso, surplus + auto = prod, import + auto = conso) respectés.  
- **Batterie physique** : modélisation charge/décharge, SOC min 10 %, rendement sqrt(roundtrip), puissances max ; impact cohérent (auto ↑, import ↓, surplus ↓).  
- **Finance** : CAPEX 100 % devis ; cashflows avec prime an 1, dégradation PV, inflation élec, remplacement onduleur ; ROI = première année de cumul ≥ capex_net ; batterie virtuelle en OPEX soustrait des flux.  
- **Sources de données** : priorisation claire (conso : horaire > CSV > manuel > national ; PV : PVGIS > fallback ; paramètres : org settings + economic_snapshot + form).

---

## Incohérences ou limites détectées

1. **Batterie virtuelle**  
   - Modèle **purement financier** (abonnement + coût optionnel au kWh stocké) ; **pas de crédit kWh** ni de logique surplus → crédit / import → débit.  
   - **annual_import_kwh** passé en entrée mais **non utilisé** dans la formule de coût.  
   - Écart avec un modèle “marché réel” : pas de plafond crédit, rollover, valorisation distincte surplus/import, pertes.

2. **Batterie physique**  
   - **DoD** : non configurable (SOC min fixe 10 %).  
   - **Dégradation** : aucune sur 25 ans (capacité et rendement constants).  
   - **SOC initial** : fixe 45 %, non configurable.  
   - **Seuil de charge** : 0.15 kWh/h en dur.

3. **Pilotage**  
   - **Parts pilotables** fixes (35 % + 20 % + 10 %) ; pas de calibration par typologie de foyer.  
   - **Puissance max** (kW) non modélisée ; seuls des plafonds en kWh/h (0.6, 0.3, 0.15) limitent les déplacements.  
   - Risque limité mais réel d’**autoconsommation un peu optimiste** si la part réellement pilotable est plus faible.

4. **PV**  
   - **Fallback** : objectif boost 0.65 en fallback vs 0.89 en PVGIS (incohérence de cible).  
   - **Bruit** dans `buildDailyShape` (solarModelService) : `Math.random()` rend la sortie **non reproductible** à l’identique entre exécutions.

5. **Finance**  
   - **capex_ttc / roi_years / irr_pct null** dès que le devis ne fournit pas de CAPEX ou que le scénario est skipped ; comportement cohérent mais à documenter pour l’UI (éviter affichage “0” pour un null).

---

## Modèles corrects attendus (référence)

- **Dispatch** : déjà conforme (min/max, invariants).  
- **Batterie physique** : ajout optionnel DoD configurable, dégradation capacité/rendement, SOC initial et seuil de charge configurables amélioreraient la représentativité.  
- **Batterie virtuelle** : modèle “crédit kWh” avec plafond, rollover, valorisation surplus vs import, et usage de l’import dans la logique coût/bénéfice.  
- **Pilotage** : puissance max (kW) par type de charge et parts pilotables configurables ou typées.  
- **PV** : reproductibilité (graine fixe ou pas de random dans la forme journalière) ; alignement fallback/PVGIS sur la cible de facteur AC.

---

## Écarts implémentation / physique réelle

| Domaine | Écart | Gravité |
|---------|--------|---------|
| Batterie virtuelle | Pas de modèle crédit kWh, import non utilisé | Moyenne (impact business/offre) |
| Batterie physique | Pas de dégradation, DoD/SOC init fixes | Faible à moyenne (impact long terme) |
| Pilotage | Parts et puissances fixes, pas de kW max | Faible |
| PV horaire | Aléa dans la forme journalière | Faible (reproductibilité) |
| Fallback PV | Cible AC différente de PVGIS | Faible |

---

## Fichiers d’audit

- **AUDIT_01** : Sources de données (conso, PV, paramètres).  
- **AUDIT_02** : Pipeline (ordre des étapes, fichiers, fonctions).  
- **AUDIT_03** : Dispatch (formules, invariants, exemple 24h).  
- **AUDIT_04** : Pilotage (charges, contraintes, limites).  
- **AUDIT_05** : Batterie physique (paramètres, impact).  
- **AUDIT_06** : Batterie virtuelle (modèle actuel vs marché).  
- **AUDIT_07** : Finance (CAPEX, ROI, cashflows, null).  
- **AUDIT_08** : Sorties scenarios_v2 (mapping, cohérence).  
- **AUDIT_09** : Cas de test théoriques.  
- **AUDIT_10** : Conclusion (ce document).

Toutes les affirmations sont dérivées du code réel (fichiers et fonctions cités) ; aucun correctif ni refactor n’a été appliqué.
