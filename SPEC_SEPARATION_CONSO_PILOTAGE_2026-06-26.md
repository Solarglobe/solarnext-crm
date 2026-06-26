# SPEC technique — Séparation source conso / reconstruction synthétique / pilotage solaire

**Date :** 26/06/2026 · **Périmètre :** correction minimale validée (7 points + 8 tests) · Moteur V13.

## Principe
Trois notions strictement séparées :
1. **Source** (`consumption_source`) : ENEDIS_HOURLY / MONTHLY_SYNTHETIC / ANNUAL_SYNTHETIC / FALLBACK.
2. **Reconstruction synthétique** : le statut client ne façonne la courbe **que** si pas de courbe Enedis horaire. Ne signifie **jamais** pilotage.
3. **Pilotage solaire** (`solar_piloting_enabled`) : option **explicite**, défaut `false`, jamais auto-déduite du statut ni des équipements.

**Lever unique :** `ctx.conso.base_hourly` = profil de base (vérité) ; `ctx.conso.hourly` = profil **calculé** = piloté **ssi** `solar_piloting_enabled`, sinon = base. Tous les scénarios lisent `ctx.conso.hourly`. Par défaut (option OFF) `hourly === base_hourly` → **comportement actuel inchangé**, donc pas de nouvelle surprise.

**Invariant non négociable :** `consumption_source === ENEDIS_HOURLY && solar_piloting_enabled === false ⇒ calculated_consumption_profile_hash === base_consumption_profile_hash`.

---

## Fichiers / fonctions touchés

### Backend (cœur — appliqué ce tour, validé en sandbox)
| Fichier | Fonction | Avant | Après |
|---|---|---|---|
| `controllers/calc.controller.js` | bloc META (~l.288) | — | lit `solar_piloting_enabled` (form/params, défaut false), `usages_pilotables`, pose `ctx.solar_piloting_enabled`, `ctx.piloting_reason` (`explicit_user_choice`/`not_enabled`) |
| `controllers/calc.controller.js` | bloc PILOTAGE (~l.758) | `ctx.conso_p_pilotee` construit **et jamais utilisé** | routage : `base_hourly`=base ; `hourly`=piloté **ssi** option ON ; calcule `base_consumption_profile_hash` & `calculated_consumption_profile_hash` |
| `controllers/calc.controller.js` | 4 lignes `scenario_uses_piloted_profile = false` (l.771/820/933/1448) | hard-codé `false` | `= ctx.solar_piloting_enabled === true` |
| `controllers/studyScenarios.controller.js` | `getStudyScenarios` | renvoie les chiffres même si snapshot périmé | ajoute `display_blocked` + `blocked_reason` quand `needs_recompute` (V12≠V13) |

> `resolveRawScenarioConsumptionHourly` **inchangé** : il lit déjà `ctx.conso.hourly`, qui devient le profil calculé → les 3 scénarios batterie sont corrigés sans toucher leurs 3 appels.

### Backend (suite — à faire dans votre IDE, non testable headless)
- `services/pilotageBudgetFromEquipment.service.js` : ne plus dériver de budget si `solar_piloting_enabled !== true` (aujourd'hui le budget est calculé mais **inerte** car non routé — effet déjà neutralisé par le lever ci-dessus).
- `services/scenarioV2Mapper.service.js` : propager par scénario `consumption_source`, `occupancy_profile`, `solar_piloting_enabled`, `piloting_reason`, `usages_pilotables`, les 2 hash, `scenarios_engine_version`, `needs_recompute` (aujourd'hui posés dans `ctx.meta`).
- `services/pdf/pdfViewModel.mapper.js` + `pages/pdf/.../PdfPage4` : badge « Profil : brut / piloté / synthétique » ; **refus** de fabriquer mensuel/8760 manquant → renvoyer `needs_recompute` au lieu de reconstruire.
- `services/pdfGeneration.service.js` : refuser la génération si `needs_recompute`.

### Frontend (à faire dans votre IDE)
- Modale « **Optimisation solaire des usages ?** » (défaut **NON**) au clic « Valider le scénario / devis technique » → options Non / Oui (+ usages : ballon ECS, VE, PAC, électroménager, autre, habitudes) / Variante séparée. Envoie `solar_piloting_enabled` + `usages_pilotables` au calcul.
- `components/study/ScenarioComparisonTable.tsx` : badge profil + bandeau bloquant « Snapshot périmé — recalcul requis » si `display_blocked`.

---

## Comportement avant / après (cœur)
- **Avant :** scénarios batterie = conso brute en dur ; profil piloté calculé puis ignoré ; `scenario_uses_piloted_profile` toujours `false` ; snapshots V12 affichés comme actuels.
- **Après :** profil calculé unique = brut par défaut (inchangé) ou piloté **sur option explicite** ; flag piloté reflète le choix réel ; hash base/calculé tracés ; snapshot V12 signalé `display_blocked`.

---

## Tests (8 obligatoires)
1. CSV Enedis + piloting=false ⇒ `calculated_hash === base_hash`.
2. CSV Enedis + piloting=true (usages valides) ⇒ `calculated_hash !== base_hash`.
3. Mensuel sans Enedis ⇒ statut client change la forme synthétique.
4. Statut client ne met **jamais** `scenario_uses_piloted_profile=true`.
5. Équipements seuls ne mettent **jamais** `scenario_uses_piloted_profile=true`.
6. Snapshot V12 ⇒ `needs_recompute=true` et `display_blocked=true`.
7. Front et PDF affichent le même profil (à valider en IDE).
8. Invariant énergie : `production = énergie utilisée + injection + pertes batterie`.

Tests 1,2,4,5,8 : exécutables backend (sandbox). 3,6 : backend. 7 : IDE.
