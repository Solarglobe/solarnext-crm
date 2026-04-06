# AUDIT 05 — Batterie physique

Modèle réel utilisé, paramètres lus/ignorés, impact sur autoconsommation, import et surplus.

---

## Fonction de simulation

- **Fichier** : `backend/services/batteryService.js`.  
- **Fonction** : `simulateBattery8760({ pv_hourly, conso_hourly, battery })`.  
- **Comportement** :  
  - Si `battery` absent ou `enabled !== true` → `passThroughNoBattery` (auto = min(pv, load), surplus = max(0, pv - load)).  
  - Si `capacity_kwh` manquant ou ≤ 0 → retourne `{ ok: false, reason: "MISSING_BATTERY_CAPACITY" }`.  
  - Sinon : boucle 8760h avec logique charge/décharge, SOC, rendement, puis retourne `ok: true` et séries horaires + totaux.

---

## Paramètres utilisés

| Paramètre | Source (code) | Utilisation |
|-----------|----------------|-------------|
| **capacity_kwh** | `battery.capacity_kwh` | Taille du stock (kWh). Obligatoire > 0. |
| **roundtrip_efficiency** | `battery.roundtrip_efficiency` (0–1) | Rendement aller-retour. Si absent → 1. Réparti en charge/décharge : `effCh = effDis = sqrt(roundtrip)`. |
| **max_charge_kw** | `battery.max_charge_kw` | Puissance max de charge (kW). Si absent → Infinity. |
| **max_discharge_kw** | `battery.max_discharge_kw` | Puissance max de décharge (kW). Si absent → Infinity. |

---

## Paramètres ignorés (non lus dans batteryService)

- **DoD (Depth of Discharge)** : non utilisé. Le code fixe un **SOC minimum à 10 %** (`minSOCpct = 10`, `SOC_min = capacity_kwh * 0.10`). Pas de paramètre DoD configurable.  
- **Dégradation** : aucune dégradation de capacité ou de rendement dans le temps (même capacité et rendement sur les 8760h).  
- **SOC initial** : fixé à 45 % de la capacité (`SOC = capacity_kwh * 0.45`), non configurable.  
- **Seuil de charge** : surplus > 0.15 kWh/h pour déclencher une charge (`if (surplus > 0.15)`), valeur en dur.

---

## Logique heure par heure (résumé)

1. **Injection directe** : direct = min(pv, load).  
2. **Surplus** : surplus = pv - direct.  
3. **Charge** : si surplus > 0.15, charge_in = min(surplus, max_charge_kw), puis application du rendement effCh, puis limite par l’espace restant (capacity - SOC). SOC augmente.  
4. **Besoin** : need = load - direct.  
5. **Décharge** : discharge_out = min(need, max_discharge_kw), puis effDis, puis limite par (SOC - SOC_min). SOC diminue.  
6. **Auto** : auto_h = direct + discharge_out.  
7. **Import** : import_h = max(0, load - auto_h).  
8. **Surplus restant** : surplus après prélèvement par la charge (injecté au réseau ou perdu selon la logique ; dans le code, `surplus_total` cumule `Math.max(0, surplus)` après charge).

---

## Impact sur autoconsommation, import, surplus

- **Autoconsommation** : **augmente** avec la batterie (auto = direct + décharge ; la décharge compense une partie des besoins nocturnes ou creux).  
- **Import** : **diminue** (import = load - auto).  
- **Surplus** : **diminue** (une partie du surplus est stockée au lieu d’être injectée ; le surplus restant peut être 0 si la batterie absorbe tout le surplus disponible dans les limites de puissance et SOC).

Donc la batterie physique **modifie bien** les trois grandeurs dans le sens attendu.

---

## Si l’impact semble faible

Causes possibles (sans changer le code) :

1. **Capacité faible** par rapport à la conso et au PV : le stock est saturé ou vide rapidement, effet limité.  
2. **Puissance limitée** (max_charge_kw / max_discharge_kw) : plafonne la charge et la décharge, donc limite le report d’énergie.  
3. **Rendement** : sqrt(roundtrip) réduit l’énergie utile (pertes en charge et décharge).  
4. **SOC initial 45 %** et **SOC min 10 %** : une partie de la capacité n’est jamais utilisée (réserve), et le premier jour part de 45 % (pas d’optimisation multi-jour).  
5. **Pilotage déjà appliqué** : la conso est déjà déplacée vers le soleil ; la batterie n’a “que” le surplus restant et les creux nocturnes à lisser, ce qui peut donner des gains modestes si le profil est déjà favorable.

---

## Synthèse

- **Fonction** : `simulateBattery8760` dans `batteryService.js`.  
- **Paramètres utilisés** : capacity_kwh, roundtrip_efficiency, max_charge_kw, max_discharge_kw.  
- **Paramètres ignorés** : DoD (remplacé par SOC min 10 % fixe), dégradation, SOC initial configurable, seuil de charge configurable.  
- **Impact** : augmentation de l’autoconsommation, baisse de l’import et du surplus ; amplitude dépendant de la capacité, des puissances et du profil PV/conso.
