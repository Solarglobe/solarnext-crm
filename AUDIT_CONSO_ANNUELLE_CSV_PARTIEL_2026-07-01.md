# AUDIT — Conso annuelle fiche lead : 7 830 kWh/an au lieu de ~12 760 (CSV partiel)

Date : 01/07/2026 — Audit, puis **CORRIGÉ le même jour** (voir section « Correction livrée » en fin de document).

## Verdict

Le chiffre 7 830 kWh/an est reproduit **à l'unité près** par simulation du code actuel :

```
4 990,2 kWh (CSV réel, 3 426 h du 08/02 au 30/06)
+ 2 839,5 kWh (profil synthétique « active » non rescalé, 5 334 h manquantes)
= 7 830 kWh/an
```

**Il n'y a AUCUNE extrapolation.** Les heures manquantes (juil.→début fév.) sont comblées par un profil de base synthétique dont le niveau annuel est ~4 878 kWh/an — celui d'un petit foyer par défaut — alors que le client consomme ~12 760 kWh/an. Le moteur mélange donc bien deux sources : la courbe réelle (39 % de l'année) et un profil théorique 2,6× trop bas (61 % de l'année).

## Chaîne complète

| Étape | Fichier | Fonction / ligne |
|---|---|---|
| Affichage | `frontend/src/modules/leads/LeadDetail/OverviewTab.tsx:1696` (idem `LeadMeterModal.tsx:639`) | affiche `energyEngine.annual_kwh` — fidèle au backend |
| Upload CSV | `OverviewTab.tsx:564` `handleCsvUpload` | POST `/api/energy/compute-from-csv` |
| Route | `backend/routes/energy.routes.js:258-396` | persiste le CSV, puis `loadConsumption()` → `annual_kwh = sumHourly(conso.hourly)` (l.386) |
| Parsing | `backend/services/consumptionService.js:296` `parseHourlyCSV` | **CORRECT** : `startDate`/`powerInWatts` lus tels quels |
| Aiguillage | `consumptionService.js:679-697` | `rows.length >= 8760` ? non (3 426) → branche **`CSV_HOURLY_INCOMPLETE`** |
| **BUG** | `consumptionService.js:370-399` `rebuildHourlyIncomplete` | voir ci-dessous |
| Post-traitement | `applyEquipmentShape` (l.1292) | neutre ici (pas de reshape sans équipement ; « à venir » = additif) |

## Réponses aux points de contrôle

1. **`powerInWatts` bien interprété ?** Oui. `rebuildHourlyIncomplete` fait `w / 1000` une seule fois (l.396). Pas de double division, pas de ÷2. La branche « année complète » (`buildFromFullYearHourly`, l.339) fait `(w/1000)*deltaH` — correcte aussi.
2. **Le CSV importé est-il utilisé ?** Oui, en priorité absolue (l.675 : « si chemin fourni et fichier existe, utilisation OBLIGATOIRE du CSV »). Les 3 426 heures réelles sont bien dans le profil.
3. **Mélange de sources ?** OUI — c'est le bug. Les 5 334 heures absentes sont remplies par `buildFallbackBase8760(profilKey)` : profil théorique « active » **jamais rescalé** au niveau du client (~4 878 kWh/an intrinsèque, somme des pondérations 24 h × facteurs saisonniers, interprétée directement en kWh).
4. **Extrapolation période partielle ?** INEXISTANTE. Aucune formule `total/jours×365` nulle part dans la branche horaire.
5. **Correction saisonnière ?** Aucune correction volontaire. Pire : le remplissage est **désaligné saisonnièrement** — `rebuildHourlyIncomplete` indexe `base8760[i]` avec `i` = offset depuis le 08/02 (1re ligne CSV), alors que `buildProfile8760` construit un profil calé sur janvier→décembre (`month = floor(h/8760*12)`, l.235). Les heures comblées (juil.→fév. réels) reçoivent donc les pondérations de mai→décembre du profil.
6. **Origine du 7 830.** Backend, pas frontend : `annual_kwh = sum(hourly)` où `hourly` = 3 426 h réelles + 5 334 h de `base8760`. Reproduction exacte (script node, PRNG mulberry32 déterministe) : 4 990,2 + 2 839,5 = **7 830**. Le front affiche fidèlement ; le libellé « Profil chargé (moteur) » masque juste le mode réel `CSV_HOURLY_PARTIAL_REBUILT` (pourtant retourné dans `engine_consumption_source` et `debug`).

## Détail du bug — `rebuildHourlyIncomplete` (l.370-399)

```js
for (let i = 0; i < 8760; i++) {
  const ts = start + i * step;            // start = 1re ligne CSV (08/02 04:00)
  if (map[ts] !== undefined) { hourlyWatts.push(map[ts]); continue; }  // heures réelles
  // voisins ±3h (ne joue que sur ~3 h en bordure)…
  hourlyWatts.push(count ? sum / count : base8760[i] * 1000);          // ← BUG : profil défaut non rescalé
}
```

Trois défauts : (a) niveau du fallback jamais ajusté à la conso observée ; (b) index `i` désaligné du calendrier réel ; (c) incohérence mineure — cette branche n'applique pas `clampHourlyProfile` contrairement aux branches daily/monthly/manual.

## Vérification chiffrée

| Méthode | Résultat |
|---|---|
| Code actuel (reproduit) | **7 830 kWh/an** |
| Extrapolation brute `4 990,2 / 142,71 × 365` | 12 763 kWh/an |
| Extrapolation saisonnière (base alignée calendrier, k = 4 990,2/1 844,0 = 2,706) | 13 202 kWh/an |
| Solteo | 12 234 kWh/an |

L'écart Solteo (12 234) vs brut (12 763) s'explique par la pondération saisonnière propre à Solteo (fév.–juin légèrement au-dessus de la moyenne annuelle dans leur modèle) — ordre de grandeur cohérent, contrairement aux 7 830.

## Correction proposée (à valider avant toute modification)

Dans `rebuildHourlyIncomplete` uniquement (aucun impact sur les CSV ≥ 8760 h) :

1. **Aligner le calendrier** : indexer le fallback par heure-de-l'année réelle (`hourOfYear(ts)`), pas par offset depuis la 1re ligne.
2. **Rescaler le fallback au niveau observé** : `k = Σ(kWh réels) / Σ(base8760 sur les heures couvertes, calendrier aligné)`, puis combler avec `base8760[hourOfYear] × k`. Le total annuel devient une extrapolation saisonnière (~13 200 ici). Variante plus simple : cibler `total/jours×365` (~12 760) en scalant le remplissage pour atteindre ce total — choix à trancher (saisonnier vs brut).
3. Optionnel : appliquer `clampHourlyProfile` comme les autres branches (attention : peut écrêter des pointes réelles > kVA, à discuter).

Garde-fou minimal recommandé : si la couverture < ~330 jours, exiger que `annual_kwh` reste dans [0,8 ; 1,25] × extrapolation brute, sinon log d'alerte.

## Logs de debug proposés (dans `rebuildHourlyIncomplete` + route)

```js
console.log(JSON.stringify({
  tag: "CONSO_CSV_PARTIAL_DEBUG",
  source: "CSV_HOURLY_PARTIAL_REBUILT",
  points: rows.length,
  first_ts: new Date(rows[0].ts).toISOString(),
  last_ts: new Date(rows[rows.length-1].ts).toISOString(),
  step_hours_detected: medianStepH,          // médiane des deltas, à calculer
  period_kwh: realSum,                        // somme des heures réelles
  days_covered: daysCovered,
  annualized_raw: realSum / daysCovered * 365,
  fallback_fill_kwh: fillSum,                 // apport du profil synthétique
  fallback_scale_k: k,                        // 1.0 aujourd'hui = bug visible
  annual_kwh_final: annual,
}));
```

Côté fiche lead : afficher le mode (`engine_consumption_source`) à côté de « Profil chargé (moteur) », p.ex. « Profil chargé (CSV partiel reconstruit) », pour que le mélange soit visible.

## Point de vigilance supplémentaire

`overviewSave.ts:174` persiste ce `annual_kwh` erroné dans `lead.consumption_annual_kwh` → le 7 830 se propage aux études/smartpitch tant que le lead n'est pas recalculé après correction. Prévoir un recalcul des leads concernés (ceux avec `engine_consumption_source = CSV_HOURLY_PARTIAL_REBUILT`).

---

## Correction livrée (01/07/2026)

Périmètre strict : branche CSV horaire incomplet uniquement. Branches full-year / daily / monthly / manual / national inchangées.

**Fichiers modifiés**

1. `backend/services/consumptionService.js` — `rebuildHourlyIncomplete` réécrite + helper `hourOfYearUTC(ts)` :
   - heures réelles posées à leur **heure-de-l'année civile (UTC)** (plus d'offset depuis la 1re ligne — le profil 8760 est désormais aligné janv→déc, cohérent avec `monthly_kwh_ref` et le croisement production PV) ;
   - trous comblés par `base8760[hourOfYear] × k` avec `k = Σ kWh réels / Σ base8760 (heures couvertes)` → extrapolation saisonnière ;
   - trous ≤ 3 h : moyenne des voisins réels ±3 h (comportement conservé) ;
   - garde-fou : `console.warn` tag `CONSO_ANNUALIZATION_OUT_OF_RANGE` si le total final sort de `[0,8 ; 1,25] × (Σréel/jours×365)` — non bloquant ;
   - log `CONSO_CSV_PARTIAL_DEBUG` : points, first/last ts, pas médian détecté, kWh période, jours couverts, annualisation brute, Σ base couverte, k, kWh fallback ajoutés, annual final.
2. `backend/routes/energy.routes.js` — la réponse de `/compute-from-csv` expose `engine_consumption_source`.
3. `frontend .../OverviewTab.tsx`, `LeadMeterModal.tsx`, `hooks/lead/useLeadDetail.ts` — champ propagé + libellé : `CSV_HOURLY_PARTIAL_REBUILT` → « Profil chargé (CSV partiel reconstruit) », `CSV_HOURLY_FULL_YEAR` → « Profil chargé (CSV année complète) », sinon « Profil chargé (moteur) ». **Rebuild frontend requis.**
4. Nouveau test : `backend/tests/consumptionCsvPartialRebuild.test.mjs` (3 tests).

**Validation** (sandbox, reconstruction /tmp — sync tronquée sur gros fichiers, cf. mémoire) :

- Cas nominal reproduit (3 426 h, 4 990,6 kWh) → `annual_kwh = 13 206` (k = 2,706, brut 12 761, bornes garde-fou [10 209 ; 15 951]) — plus jamais 7 830.
- Nouveau test 3/3 vert ; non-régression `consumptionConservationPipeline` + `consumptionCsvActuelReshape` : 16/16 verts.

**Reste à faire**

- Rebuild + déploiement frontend.
- Recalcul des leads persistés avec l'ancienne valeur (réimport CSV ou re-calcul ; repérables via `energy_profile.engine.engine_consumption_source = "CSV_HOURLY_PARTIAL_REBUILT"` ou statut « Profil chargé (moteur) » avec CSV partiel).
- Décision séparée : appliquer ou non `clampHourlyProfile` (kVA) sur cette branche (non fait — risque d'écrêter des pointes réelles).
