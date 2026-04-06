# AUDIT 07 — Module finance

Source du CAPEX, calcul du ROI, cashflows, inflation, dégradation PV, remplacement onduleur, prime ; pourquoi capex_ttc / roi_years / irr_pct peuvent être null.

---

## Fichier principal

- `backend/services/financeService.js` : `computeFinance(ctx, scenarios)`.

---

## Source CAPEX

- **Unique** : `ctx.finance_input.capex_ttc` (injecté par le devis / economic_snapshot).  
- Code (lignes 213–216) :  
  `const capexInjected = ctx.finance_input?.capex_ttc;`  
  `const capex_ttc = capexInjected != null && Number.isFinite(Number(capexInjected)) ? Number(capexInjected) : null;`  
- Aucun calcul de CAPEX côté moteur (pas de pricing kit, pas de catalogue) : “CAPEX 100 % devis”.

---

## Pourquoi capex_ttc peut être null

- **finance_input** absent ou **capex_ttc** non renseigné (ou non numérique).  
- Scénario **skipped** (`_skipped === true`) : le module met explicitement `capex_ttc: null` (et pas de cashflows).  
- Pour les scénarios V2, si `capex_ttc == null` après lecture de `finance_input`, la branche “capex requis” est utilisée (lignes 218–232) : tous les champs finance (roi_years, flows, etc.) sont mis à null.

---

## Calcul ROI

- **Prime** : `prime = kwc < 9 ? kwc * prime_lt9 : kwc * prime_gte9` (prime_lt9 défaut 80, prime_gte9 défaut 180).  
- **CAPEX net** : `capex_net = max(capex_ttc - prime, 0)`.  
- **Cashflows** : `buildCashflows(...)` produit un flux par année (gain_auto, gain_oa, maintenance, inverter_cost, prime an 1, total_eur, cumul_eur).  
- **ROI** : `roi_years = flows.find(f => f.cumul_eur >= capex_net)?.year ?? null` (première année où le cumul couvre le capex_net).

---

## Cashflows (détail)

- **Gain an** = gain_auto + gain_oa + prime (an 1 seulement) − maintenance − inverter_cost.  
- **gain_auto** = auto × price (prix électricité de l’année).  
- **gain_oa** = surplus × oa_rate (taux OA &lt; 9 ou ≥ 9 kWc).  
- **Maintenance** : capex_ttc × (maintenance_pct / 100) chaque année.  
- **Remplacement onduleur** : à l’année `inverter_replacement_year` (défaut 15), coût = capex_ttc × (inverter_cost_pct / 100) (défaut 12 %).  
- **Évolution** : prix × (1 + elec_growth_pct/100) ; prod × (1 - pv_degradation_pct/100) ; auto et surplus dérivés via le ratio auto/(auto+surplus) de l’an 1.

---

## Inflation énergie, dégradation PV, onduleur

- **Inflation énergie** : `elec_growth_pct` (défaut 5 %) appliquée au prix chaque année.  
- **Dégradation PV** : `pv_degradation_pct` (défaut 0.5 %) appliquée à la production chaque année ; auto et surplus sont recalculés en gardant le ratio auto/(auto+surplus) de l’an 1.  
- **Remplacement onduleur** : une seule fois à `inverter_replacement_year`, coût = % du CAPEX (inverter_cost_pct).

---

## Prime autoconsommation

- Versée en **année 1 uniquement** (dans `buildCashflows`, `if (y === 1) total += prime_eur`).  
- Montant : kwc × 80 si kwc &lt; 9, kwc × 180 si kwc ≥ 9 (paramètres prime_lt9, prime_gte9).

---

## Pourquoi roi_years = null

- **capex_ttc** null → pas de cashflows → pas de cumul → pas d’année trouvée.  
- **Cumul jamais ≥ capex_net** sur l’horizon (ex. projet non rentable sur 25 ans) → `find` retourne undefined → null.  
- Scénario **skipped** ou **capex non injecté** : sortie explicite avec roi_years = null.

---

## Pourquoi irr_pct = null

- **IRR** : calcul par Newton-Raphson sur les flux [-capex_net, total_an1, total_an2, …] (fonction `irr(values, guess)`).  
- Retourne **null** si : dérivée trop proche de 0 (divergence), ou pas de convergence en 50 itérations.  
- **capex_ttc** null → pas d’appel à cette branche, ou capex_net = 0 → IRR non calculé / non fiable.  
- Scénario skipped ou sans CAPEX → pas de flux → irr_pct laissé null.

---

## BATTERY_VIRTUAL (OPEX)

- Si scénario `BATTERY_VIRTUAL` et `_virtualBatteryQuote.annual_cost_ttc` présent : chaque année, `total_eur` des cashflows est diminué de ce montant (OPEX annuel batterie virtuelle), puis cumul recalculé.  
- ROI et IRR sont donc calculés **après** soustraction de cet OPEX (lignes 208–215).

---

## Synthèse

- **CAPEX** : uniquement `ctx.finance_input.capex_ttc`.  
- **ROI** : première année où cumul_eur ≥ capex_net.  
- **Cashflows** : gain_auto + gain_oa + prime (an 1) − maintenance − remplacement onduleur (année N) ; inflation sur prix, dégradation sur prod.  
- **capex_ttc null** : devis non renseigné, scénario skipped, ou pas de finance_input.  
- **roi_years / irr_pct null** : pas de CAPEX injecté, projet non rentable sur l’horizon, ou échec de convergence IRR.
