# Export SGS-2026-0137

## Statut

- Etude trouvee: oui
- Version retenue: 966fbbaa-dc88-4729-b3ae-14d1de478ff4 / numero 1
- Scenario retenu: n/a
- Erreur: aucune
- Fichier JSON: scripts/export-study/results/SGS-2026-0137-snapshot.json

## Tentatives d'acces

- local script execution

## Donnees recuperees

- Tables lues: addresses, calpinage_data, calpinage_snapshots, economic_snapshots, entity_documents, lead_consumption_monthly, lead_meters, leads, organizations, quotes, studies, study_versions
- Services appeles: aucun service metier; SQL SELECT direct
- Sections exportees: export_metadata, study, site, pv_system, consumption, production, v2h, virtual_battery, economics, results, raw_technical_snapshots, missing_fields, validation_checks

## Donnees manquantes

- study_versions.selected_scenario_id | importance: important | recherché: study_versions.selected_scenario_id | reconstructible sans recalcul: false
- study_versions.selected_scenario_snapshot | importance: important | recherché: study_versions.selected_scenario_snapshot | reconstructible sans recalcul: false
- consumption.hourly_8760 | importance: bloquant benchmark horaire | recherché: study_versions.data_json, CSV path, calpinage payload | reconstructible sans recalcul: possible seulement si CSV accessible ou recalcul consommation autorisé
- production.pv_hourly_8760 | importance: important benchmark horaire | recherché: calc_result, scenarios_v2, selected_scenario_snapshot | reconstructible sans recalcul: possible par recalcul non destructif si payload complet

## Controles

- OK study_number exact — {"value":"SGS-2026-0137"}
- FAIL consumption hourly length 8760 — {"length":0}
- OK production hourly length 8760 if present — {"length":null}
- OK total power coherent with pans — {"pan_sum_kwc":12,"total_power_kwc":12}
- OK selected scenario coherent with snapshot — {"selected_scenario_id":null,"snapshot_scenario_type":null}
- OK no secret or database url in file
- OK no unnecessary personal data keys in file

## Suffisance benchmark PVcalc vs seriescalc

A confirmer selon les controles ci-dessus : le benchmark peut demarrer uniquement si les donnees PV, site et consommation necessaires sont presentes.

## Garantie lecture seule

Le script refuse toute requete non SELECT et n'appelle pas runStudy, runStudyCalc, ni les services de persistance.
