# AUDIT 04 — Audit du module de pilotage

Où le pilotage est appliqué, quelles charges sont pilotées, contraintes et limites physiques.

---

## Où le pilotage est appliqué

- **Fichier** : `backend/services/pilotageService.js`.  
- **Appel** : `calc.controller.js` (ligne 224) :  
  `const pilotage = buildPilotedProfile(conso.hourly, ctx.pv.hourly);`  
  `ctx.conso_p_pilotee = pilotage.conso_pilotee_hourly;`  
- **Entrée** : `baseLoadHourly` = conso 8760h (après loadConsumption), `pvHourly` = production 8760h.  
- **Sortie** : `conso_pilotee_hourly` (8760h), utilisé ensuite pour le calcul BASE et BATTERY_PHYSICAL (dispatch et batterie).  
- Le pilotage est donc **toujours** appliqué avant tout calcul de scénarios ; il n’y a pas de mode “sans pilotage” dans le flux actuel.

---

## Quelles charges sont pilotées

Le modèle considère une **part pilotable** du total kWh, répartie en trois types (constantes dans le code) :

| Type | Part du total conso | Rôle |
|------|----------------------|------|
| Stockable | 35 % | Chauffe-eau, ballon (déplacement vers heures solaires avec surplus) |
| Programmable | 20 % | Lave-linge, lave-vaisselle, sèche-linge (fenêtre temporelle) |
| Flexible | 10 % | VMC, IT, etc. (petits déplacements) |
| **Total pilotable** | **65 %** | `pilotable_share = 0.35 + 0.20 + 0.10` |

Les 35 % restants sont considérés non pilotables (consommation “rigide”).

---

## Contraintes et fenêtres

- **Fenêtre solaire** : par trimestre (T1: 10h–16h, T2: 9h–18h, T3: 8h–19h, T4: 10h–16h), via `getSolarWindow(hourIndex)` (lignes 19–36).  
- **Seuil de surplus** : déplacement uniquement si `surplus[h] > PV_SURPLUS_THRESHOLD` (0.15 kWh/h).  
- **Plafonds par déplacement** :  
  - stockable : min(surplus, stockable_restant, 0.6) ;  
  - programmable : min(surplus, programmable_restant, 0.3) ;  
  - flexible : min(surplus, flexible_restant, 0.15).  
- **Réduction des imports nocturnes** : en dehors de la fenêtre solaire, réduction de la charge jusqu’à 0.3 kWh/h par heure, dans la limite de `toRemove = totalPilotable`.  
- **Correction finale** : si le total kWh après déplacements diffère du total initial de plus de 0.001 kWh, ajustement sur les heures solaires (puis sur toutes les heures > 0) pour conserver le total exact (zéro création/perte).

---

## Le pilotage peut-il absorber artificiellement toute la production PV ?

- **Non**, pas en pratique avec les paramètres actuels :  
  - Seule une **partie** de la conso (65 %) est déplaçable.  
  - Les déplacements sont **plafonnés** par heure (0.6, 0.3, 0.15 kWh) et par type.  
  - La **fenêtre** est limitée (quelques heures autour de midi).  
  - Le **total annuel** de conso est **strictement conservé** (correction finale) ; on ne peut pas “inventer” de la conso pour absorber tout le PV.  
- En revanche, si la conso annuelle est **très élevée** et que le PV est faible, il est possible d’avoir peu ou pas de surplus (voir AUDIT_03). Le pilotage **augmente** la part consommée aux heures solaires et **réduit** les imports la nuit, mais il ne force pas “tout le PV en auto” sauf cas extrêmes de profil.

---

## Limites physiques modélisées

- **Puissance pilotable** : non modélisée explicitement en kW ; seuls des **plafonds en kWh/h** par type (0.6, 0.3, 0.15) limitent le déplacement.  
- **Énergie pilotable** : oui, limitée à 65 % du total annuel, répartie en stockable / programmable / flexible.  
- **Contraintes horaires** : oui, déplacement uniquement dans la fenêtre jour (getSolarWindow).  
- **Inertie / temps de réponse** : non modélisée (pas de contrainte “X heures consécutives”, pas de délai).

---

## Risque d’autoconsommation irréaliste

- **Risque modéré** : le total kWh est conservé et les plafonds par heure limitent les déplacements. En revanche :  
  - Les **65 %** et les **parts 35/20/10** sont fixes, non calibrés par foyer.  
  - L’absence de **puissance max** (kW) permet théoriquement des pointes de conso pilotée très fortes sur une heure (jusqu’à +0.6+0.3+0.15 = 1.05 kWh en plus sur une heure), ce qui reste raisonnable pour un foyer.  
  - Le **réduction nocturne** (jusqu’à 0.3 kWh/h) peut sous-estimer la conso réelle la nuit si les usages sont peu pilotables.  
- Pour un audit “physique” plus strict, il serait utile de :  
  - Introduire une **puissance max** (kW) par type de charge ;  
  - Rendre les **parts** pilotables configurables ou dérivées d’hypothèses par typologie de foyer.
