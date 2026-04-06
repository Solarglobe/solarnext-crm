# AUDIT 03 — Dispatch énergétique (cœur du moteur)

Analyse de la logique heure par heure : autoconsommation, surplus, import réseau.

---

## Formules réelles (code)

### Sans batterie (monthlyAggregator.js, lignes 39–48)

```javascript
for (let i = 0; i < 8760; i++) {
  const a = Math.min(prodHourly[i], consoHourly[i]);
  const s = Math.max(0, prodHourly[i] - consoHourly[i]);
  autoHourly.push(a);
  surplusHourly.push(s);
}
// import mensuel : imp = Math.max(0, load - a)  (ligne 78)
```

Équivalent :

- **auto_h** = min(PV_h, Load_h)
- **surplus_h** = max(0, PV_h − Load_h)
- **import_h** = max(0, Load_h − auto_h) = max(0, Load_h − min(PV_h, Load_h))

Donc si PV_h ≥ Load_h : auto_h = Load_h, surplus_h = PV_h − Load_h, import_h = 0.  
Si PV_h < Load_h : auto_h = PV_h, surplus_h = 0, import_h = Load_h − PV_h.

---

## Correspondance avec le modèle physique attendu

| Formule attendue | Implémentation | Statut |
|------------------|----------------|--------|
| auto = min(PV_h, Load_h) | `Math.min(prodHourly[i], consoHourly[i])` | OK |
| surplus = max(PV_h − Load_h, 0) | `Math.max(0, prodHourly[i] - consoHourly[i])` | OK |
| import = max(Load_h − PV_h, 0) | `Math.max(0, load - a)` avec load = conso_h, a = auto_h | OK |

La logique du dispatch **sans batterie** correspond au modèle physique.

---

## Invariants (vérification)

- **autoconsommation ≤ production** : oui, car auto_h = min(PV_h, Load_h) ≤ PV_h.
- **autoconsommation ≤ consommation** : oui, car auto_h = min(PV_h, Load_h) ≤ Load_h.
- **surplus + autoconsommation = production** : oui, car surplus_h = max(0, PV_h − Load_h) et auto_h = min(PV_h, Load_h) ⇒ surplus_h + auto_h = PV_h (cas PV_h ≥ Load_h : auto=Load_h, surplus=PV_h−Load_h ; cas PV_h < Load_h : auto=PV_h, surplus=0).
- **import + autoconsommation = consommation** : oui, car import_h = Load_h − auto_h ⇒ import_h + auto_h = Load_h.

Les invariants sont respectés heure par heure et donc en agrégé (annuel/mensuel).

---

## Cas où surplus = 0 sur toute l’année

- **Surplus_h** = max(0, PV_h − Load_h). Il est nul pour toute l’année si et seulement si à chaque heure **PV_h ≤ Load_h**.
- Situations typiques :
  1. **Consommation très forte** : Load_8760 toujours ≥ PV_8760 (ex. bâtiment très énergivore, petit PV).
  2. **Profil de conso “artificiellement” aligné sur le PV** : après pilotage, la conso pilotée peut être augmentée aux heures de soleil et diminuée la nuit ; si le pilotage est poussé au point que toute la production est absorbée par la conso déplacée, alors surplus = 0. Le moteur de pilotage (part pilotable 35 % + 20 % + 10 %) peut augmenter la charge aux heures solaires, mais il ne garantit pas d’absorber 100 % du PV (plafonds par shift, fenêtres fixes, correction du total kWh). Donc surplus = 0 sur 8760h reste un cas limite (conso très forte ou profil extrême).
  3. **PV nul ou quasi nul** : production nulle → surplus = 0.

---

## Tableau exemple 24h (sans batterie)

Hypothèse : jour d’été, PV en cloche 6h–18h, conso matin/soir.

| h  | PV_h (kWh) | Load_h (kWh) | auto_h | surplus_h | import_h |
|----|------------|--------------|--------|-----------|----------|
| 0  | 0          | 0.4          | 0      | 0         | 0.4      |
| 1  | 0          | 0.3          | 0      | 0         | 0.3      |
| …  | …          | …            | …      | …         | …        |
| 6  | 0.2        | 0.5          | 0.2    | 0         | 0.3      |
| 7  | 0.8        | 0.6          | 0.6    | 0.2       | 0        |
| 8  | 1.5        | 0.5          | 0.5    | 1.0       | 0        |
| …  | …          | …            | …      | …         | …        |
| 12 | 2.5        | 0.4          | 0.4    | 2.1       | 0        |
| …  | …          | …            | …      | …         | …        |
| 18 | 0.5        | 0.9          | 0.5    | 0         | 0.4      |
| 19 | 0.1        | 1.1          | 0.1    | 0         | 1.0      |
| …  | 0          | 0.5          | 0      | 0         | 0.5      |

Formules utilisées : auto_h = min(PV_h, Load_h), surplus_h = max(0, PV_h − Load_h), import_h = max(0, Load_h − auto_h).

---

## Avec batterie physique (batteryService.js)

Le dispatch est modifié par `simulateBattery8760` :

- **direct** = min(PV_h, Load_h) (injection directe).
- **Surplus** après direct : surplus = PV_h − direct ; une partie est envoyée en charge (plafonnée par max_charge_kw, SOC max, rendement).
- **Besoin** après direct : need = Load_h − direct ; une partie est fournie par la décharge (plafonnée par max_discharge_kw, SOC min, rendement).
- **auto_h** = direct + décharge fournie au load.
- **import_h** = Load_h − auto_h.
- **surplus_h** = surplus restant après charge (non injecté au réseau).

Les invariants restent : auto ≤ prod (énergie “utile” côté conso), et import + auto = conso (équilibre au compteur).
