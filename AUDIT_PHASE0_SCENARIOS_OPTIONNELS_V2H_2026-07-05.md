# Audit Phase 0 — Scénarios optionnels dynamiques + dimension Voiture V2H

**Date :** 2026-07-05
**Nature :** audit en lecture seule, AUCUNE modification de code
**Contexte prod :** cœur devis/finance — exactitude des calculs critique, tout doit être vérifié avant toute implémentation.

## Objectif produit (rappel validé)

1. La **page de scénarios** (aide à la décision commerciale, pas un devis) doit afficher un **jeu dynamique** de cartes : une carte n'apparaît que si **tous** ses actifs sont sélectionnés. Baseline « Sans batterie » toujours présente (référence).
2. Nouvelle dimension **Voiture V2H** (vehicle-to-home uniquement, **pas de V2G**), modélisée comme une **batterie physique sous contraintes**.
3. **Non bloquant** : ne pas choisir un actif ⇒ sa carte est absente, sans blocage. **Mais** un actif choisi et incomplet ⇒ on **alerte/bloque toujours** (garde-fou anti-FAVER).

### Matrice de cartes cible (verrouillée)

| Carte | Apparaît si |
|---|---|
| Sans batterie | toujours |
| Physique (P) | P |
| Virtuel (V) | V |
| Hybride (P+V) | P et V |
| Voiture (C) | C |
| Voiture + Physique (C+P) | C et P |
| Voiture + Virtuel (C+V) | C et V |
| Voiture + Physique + Virtuel (C+P+V) | C et P et V |

Jusqu'à **8 cartes** ; acceptable car c'est un comparateur interne, l'utilisateur choisit ensuite **manuellement** celle qui part en PDF.

---

## 1. État des lieux — le système de scénarios actuel

### 1.1 Bonne nouvelle : la génération backend est DÉJÀ conditionnelle
`backend/controllers/calc.controller.js` génère les scénarios **selon les actifs activés**, pas en dur :

- **BASE** — toujours (L799-801)
- **BATTERY_PHYSICAL** — si `battery_input.enabled === true && capacity_kwh > 0` (L805-956)
- **BATTERY_VIRTUAL** — si `virtual_battery_input.enabled === true` (L958-1469)
- **BATTERY_HYBRID** — si résultat physique présent **ET** virtuel activé (L1472-1822)

La logique « hybride = physique ET virtuel » **existe déjà** exactement comme voulu. Le motif à généraliser est donc déjà en place ; on l'étend, on ne le réinvente pas.

### 1.2 Là où « les 4 scénarios existent toujours » est CÂBLÉ EN DUR (les vrais verrous)

| # | Verrou | Fichier / ligne | Impact |
|---|---|---|---|
| A | **Contrainte SQL `CHECK`** limitant `scenario_id` à `BASE / BATTERY_PHYSICAL / BATTERY_VIRTUAL / BATTERY_HYBRID` | `backend/migrations/1780500000000_cp-financial-scenarios.js` L28-30 | **Bloque tout nouvel ID** (V2H et combos) → migration obligatoire |
| B | **Libellés statiques** des 4 types | `backend/services/scenarioV2Mapper.service.js` L15-20 | Ajouter les libellés V2H |
| C | **Frontend : 4 colonnes fixes toujours rendues** `SCENARIO_IDS = [BASE, PHYSICAL, VIRTUAL, HYBRID]`, colonnes paddées à `null` | `frontend/src/components/study/ScenarioComparisonTable.tsx` L428, L663-665 | Rendre les colonnes **dynamiques** depuis la liste réellement reçue |
| D | **Validation PDF : liste blanche d'IDs** `VALID_SCENARIO_IDS = [...4...]` | `backend/controllers/generatePdfFromScenario.controller.js` L17 ; aussi `selectScenario.controller.js` | Étendre aux IDs V2H |
| E | **Scénarios non retenus émis quand même** avec `_skipped: true` (au lieu d'être absents) | `calc.controller.js` (branches skip) + `scenarioV2Mapper` L481-483 | Décider : absents vs présents-marqués (voir §4) |

### 1.3 Blocages actuels (à convertir en « conditionnels »)

- **Devis technique** : calpinage + economic_snapshot obligatoires (`validateDevisTechnique.controller.js` L40-60). Blocage légitime (données socle), à conserver.
- **Snapshot périmé / moteur incohérent** : `studyScenarios.controller.js` L46-74 → `display_blocked`, `needs_recompute`. Bloque affichage/PDF. À adapter pour tolérer un **jeu partiel** (un scénario absent parce que non choisi n'est **pas** une incohérence).
- **Frontend** : bouton « Choisir » désactivé si badge `missing`/`unsuitable` (`ScenarioComparisonTable.tsx` L1439-1445). C'est ici que se joue le « non bloquant » : non choisi ⇒ carte **absente** (pas de badge missing), choisi-incomplet ⇒ badge d'alerte.

### 1.4 Modèle de données
- Lecture opérationnelle : `study_versions.data_json.scenarios_v2` (array) + `selected_scenario_id` + `selected_scenario_snapshot` + `is_locked`.
- Audit/versioning : table `financial_scenarios` (avec la contrainte CHECK — verrou A).
- Config batteries : `battery_input` (enabled, capacity_kwh, battery_id, max_charge_kw, max_discharge_kw, roundtrip) ; `virtual_battery_input` (enabled, provider_code, contract_type, capacity_kwh, abonnement…). Schéma : `shared/schemas/scenario.schema.ts`.

---

## 2. Intégration de la Voiture V2H

### 2.1 Le moteur batterie est prêt à ~80 %
`backend/services/batteryService.js` → `simulateBattery8760()` (boucle horaire L110-169) gère déjà : capacité, puissances charge/décharge, rendement aller-retour, **SoC minimum** (mais **codé en dur à 10 %**, L88-89), SoC initial 45 %.

### 2.2 Ce qui MANQUE pour V2H (3 ajouts)

| Contrainte V2H | État actuel | Ajout nécessaire |
|---|---|---|
| **Fenêtre de présence** (voiture branchée ou non, heure par heure) | ❌ absent | `availability_hourly[8760]` (booléen) → interdire charge/décharge quand absente |
| **Recharge quotidienne de conduite** (km→kWh à prélever) | ❌ absent | `daily_drive_kwh` → prélèvement journalier de la réserve |
| **Réserve « charge à garder »** (mobilité) | ⚠️ codé en dur 10 % | rendre configurable : `SoC_min = max(10 %, charge_à_garder)` |

Faisabilité : **haute**. V2H = `simulateBattery8760()` + ces 3 contraintes. **Ne pas** créer un moteur parallèle.

### 2.3 Ce qui reste à concevoir (calcul — Phase 3)
- **Ordre de dispatch** quand plusieurs stockages coexistent. Proposition : solaire → conso maison → **batterie physique** → **V2H** (si présente) → **virtuel/injection**. À figer et justifier (impacte tous les chiffres des combos).
- **Combinaisons** C+P, C+V, C+P+V : réutiliser le motif « résiduel » de l'hybride existant (physique absorbe d'abord, le suivant travaille sur le surplus/import résiduel).
- **Dégradation / usure** : le V2H cycle plus → `battery_degradation_pct` potentiellement supérieur (paramétrable par type). Honnêteté : intégrer, ne pas l'oublier (leçon FAVER).
- **Pertes & disponibilité réelle** : bien en dessous de la capacité nominale ; présence limitée aux heures branchées.

### 2.4 Finance
`financeService.js` (`computeFinance` L537, `buildCashflows` L243-404) gère déjà `battery_contribution_y1` et `battery_degradation_pct` → la contribution V2H entre dans le cadre existant. À étendre : taux de dégradation par type de batterie.

---

## 3. Nouveaux IDs de scénarios (proposition)

Pour rester cohérent avec la liste blanche + la sélection PDF, proposer 4 nouveaux IDs :

- `VEHICLE_V2H` (Voiture seule)
- `VEHICLE_V2H_PHYSICAL` (Voiture + Physique)
- `VEHICLE_V2H_VIRTUAL` (Voiture + Virtuel)
- `VEHICLE_V2H_PHYSICAL_VIRTUAL` (triplette)

→ à ajouter partout où la liste des 4 est figée (verrous A, B, C, D). **Décision de nommage à valider** (§6).

---

## 4. Le point délicat « non bloquant » — la règle à trancher

Deux comportements possibles pour un actif **non sélectionné** :

- **(a) Absent** : le scénario n'est ni calculé ni renvoyé → carte n'existe pas. Le plus propre côté UX, mais demande d'adapter la validation de cohérence (§1.3) pour ne pas considérer l'absence comme une erreur.
- **(b) Présent marqué `_skipped`** (comportement actuel) : le scénario est renvoyé mais masqué. Moins de refactor backend, mais le frontend doit filtrer et la logique `display_blocked` reste sensible.

**Recommandation :** viser (a) à terme (absence = non calculé), mais migrer prudemment : Phase 1 peut d'abord **filtrer à l'affichage** (b) pour ne rien casser, puis basculer en (a) une fois les gardes de cohérence adaptés.

**Invariant non négociable (anti-FAVER) :** un actif **sélectionné mais incomplet** (ex. batterie cochée sans capacité) ne doit JAMAIS produire une carte « calculée » silencieuse → badge d'alerte + blocage PDF de cette carte, comme aujourd'hui.

---

## 5. Risques prod & plan de vérification

- **Verrou A (migration SQL CHECK)** : le plus sensible. Une migration additive (élargir la contrainte ou passer à une table de types) doit être **réversible** et testée sur copie. Rappel mémoire : l'index git de ce repo est fragile, écritures de gros fichiers à vérifier.
- **Calculs des combos** : chaque nouvelle combinaison (C+P, C+V, C+P+V) doit passer un **contrôle de bilan énergétique** (auto + import + décharges = conso ; SoC ∈ [min, capacité] ; réserve conduite jamais entamée hors présence) et une **non-régression** stricte des 4 scénarios existants (mêmes chiffres qu'avant sur études témoins).
- **Finance** : ROI/IRR/LCOE des combos vérifiés à la main sur au moins une étude réelle avant mise en prod.
- **PDF** : rendu sur jeu partiel (1, 2, … 8 cartes) sans casse de mise en page.

---

## 6. Décisions à trancher avant Phase 1

1. **Non bloquant** : viser l'absence réelle (a) ou le filtrage à l'affichage (b) en première étape ? (Reco : b d'abord, a ensuite.)
2. **Nommage des IDs V2H** (`VEHICLE_V2H*` ou autre) et faut-il un **libellé commercial** distinct (« Voiture », « V2H », « Voiture + batterie »…) ?
3. **Fenêtre de présence** : curseur simple (jour / nuit / les deux) ou plage horaire semaine/week-end ? (Reco : simple d'abord.)
4. **Ordre de dispatch** multi-stockage figé par nous (reco : solaire→maison→physique→V2H→virtuel) ou paramétrable ?
5. **Dégradation V2H** : taux distinct de la batterie stationnaire (usure mobilité) ? valeur par défaut à définir.

---

## 7. Plan de travail proposé (rappel, chaque phase = validation avant la suivante)

- **Phase 1 — Scénarios optionnels (battery-agnostique).** Élargir le verrou A (migration), rendre le frontend dynamique (verrou C), adapter validation de cohérence pour jeux partiels, convertir le blocage global en validation par scénario. Tests de non-régression sur les 4 scénarios existants.
- **Phase 2 — Devis/PDF non bloquant.** Sélection PDF sur IDs dynamiques (verrou D), badges « choisi-incomplet » vs « non choisi/absent ».
- **Phase 3 — Dimension V2H.** 3 ajouts moteur (`availability_hourly`, `daily_drive_kwh`, réserve configurable), 4 nouveaux IDs + génération des combos avec dispatch figé, finance (dégradation par type). Tests bilan énergétique + finance.
- **Phase 4 — Restitution & honnêteté.** Cartes + PDF V2H, modélisation conservatrice (pertes, disponibilité, usure), libellés clairs. Pas de V2G.

---

## Fichiers clés (référence)

- Orchestration scénarios : `backend/controllers/calc.controller.js`
- Mapper V2 + libellés : `backend/services/scenarioV2Mapper.service.js`
- Contrainte SQL : `backend/migrations/1780500000000_cp-financial-scenarios.js`
- Moteur batterie : `backend/services/batteryService.js`
- Batterie virtuelle : `backend/services/virtualBattery8760.service.js`
- Finance : `backend/services/financeService.js`
- Page scénarios : `frontend/src/pages/studies/ScenariosPage.tsx`
- Tableau comparatif : `frontend/src/components/study/ScenarioComparisonTable.tsx`
- PDF depuis scénario : `backend/controllers/generatePdfFromScenario.controller.js`
- GET scénarios : `backend/controllers/studyScenarios.controller.js`
- Schéma config : `shared/schemas/scenario.schema.ts`
