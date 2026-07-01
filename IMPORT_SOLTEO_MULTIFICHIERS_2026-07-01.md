# Import multi-fichiers Solteo/Switchgrid — livré 01/07/2026

Objectif : importer ensemble `c68.json` + `r65.json/csv` + `loadcurve.csv` (+ mensuel/quotidien + consentement PDF) et remplir automatiquement la fiche lead avec la bonne conso annuelle, le profil horaire, et les données contractuelles — avec la source affichée pour chaque valeur.

## Priorité métier conso annuelle (implémentée)

| P | Condition | Source affichée |
|---|---|---|
| 1 | R65 quotidien ≥ 365 j (fenêtre 365 derniers jours) | `R65_DAILY_365` — « R65 quotidien — 365 jours » |
| 2 | 12 mois complets | `MONTHLY_12` |
| 3 | Quotidien > 330 j | `R65_DAILY_PARTIAL_ANNUALIZED` (+ warning) |
| 4 | Courbe ≥ 8 760 h | `CSV_HOURLY_FULL_YEAR` |
| 5 | Courbe partielle | `CSV_HOURLY_PARTIAL_REBUILT` (méthode corrigée du 01/07, + warning) |
| 6 | Rien | `MANUAL` (valeur lead conservée) |

Règle clé : **R65 complet + courbe partielle → annuel = R65 (12 234), profil horaire = courbe reconstruite (13 206) puis normalisée ×0,9264 pour totaliser exactement 12 234**. Le profil est aligné calendrier janv→déc.

## Fichiers

**Créés**
- `backend/services/energy/solteoImportService.js` — parseC68 (structure SGE réelle : `relais` sous `dispositifComptage`, `futuresPlagesHeuresCreuses` sous `situationComptage`, lecture tolérante), parseR65Json (unité pilotée par le champ `unite`), parseDailyCsv/parseMonthlyCsv (unité par **médiane** globale, pas par ligne — corrige le piège du jour d'absence à 1 800 Wh), computeAnnualFromDaily/Monthly, resolveAnnualPriority (P1→P6), detectPhase, scaleHourlyToAnnual, monthlySumsFromHourly.
- `backend/routes/energy.routes.js` → **POST `/api/energy/import-solteo`** : persiste tous les fichiers (loadcurve en `consumption_csv`, le reste en `lead_attachment`, PDF consentement = archive jamais parsée), calcule, met à jour le lead, log `SOLTEO_IMPORT_DEBUG` (JSON complet : fichiers, périodes, totaux par source, annualisations brute/saisonnière, k, valeur finale, source, anciennes valeurs).
- `frontend/src/modules/leads/LeadDetail/solteoImport.ts` — collecte ZIP/multi-sélection, classification par nom puis par contenu, types réponse.
- `backend/tests/solteoImportService.test.mjs` — 8 tests.

**Modifiés**
- `OverviewTab.tsx` + `LeadMeterModal.tsx` : même bouton import (accepte `.csv,.zip,.json,.pdf`, multi-sélection) ; ZIP complet → import-solteo, loadcurve seule → **compute-from-csv inchangé** ; affichage « Source : R65 quotidien — 365 jours », « Contrat : HP/HC — 18 kVA — 230/400 V · Alimentation : triphasé », warnings non bloquants ; champs lead mis à jour localement (`onLeadChange`/`patchDraft`).
- `useLeadDetail.ts` : les libellés persistent au rechargement via `energy_profile.engine`.

## Données contractuelles C68 → lead (choix produit : **écrase** l'existant, ancien logué dans `import_debug.previous_lead_values`)

- `consumption_pdl`, `meter_power_kva` (souscrite), `tariff_type` (hp_hc/tempo/base), `hp_hc`, `consumption_mode='PDL'`, `consumption_annual_kwh`
- `grid_type` : **seulement si sûr** — tri si 230/400 V + souscrite > 12 kVA ; mono si 230 V seul ; sinon non touché, « triphasé probable » affiché
- Le reste (adresse installation, segment, état, raccordement 36 kVA, tension, plages HC actuelles/futures, Linky, titulaire si présent) → `energy_profile.contract` (jsonb, pas de migration). **L'adresse C68 n'écrase jamais l'adresse saisie.**

## Validation (01/07/2026)

- Tests service 8/8 verts (fixtures calquées sur les vrais fichiers).
- Vrais fichiers du dossier : C68 extrait intégralement (PDL 22493921713260, Linky, 230/400 V, 36/18 kVA, HP/HC, HC 22H30-6H30, futures 1H28-6H58;13H58-16H28, phase « triphasé »/tri) ; r65.json 608 j sans trou → fenêtre 01/07/2025→30/06/2026 = **12 234,4 kWh** (= Solteo) ; r65.csv idem ; priorité → `R65_DAILY_365` ; normalisation 13 206 → 12 234,4 exacte.
- Syntaxe backend validée (route + service) via reconstruction /tmp (sync sandbox tronque les gros fichiers).

## Complément 01/07/2026 (soir) — import CUMULATIF + renommage bouton

- **Import cumulatif** : la route `/import-solteo` réutilise désormais les fichiers déjà archivés sur le lead (`c68.json`, `r65.json`, `r65.csv`, `quotidien.csv`, `mensuel.csv` via `loadPersistedImportFile`, loadcurve via `resolveConsumptionCsv`). On peut importer les fichiers un par un dans n'importe quel ordre, ou en ZIP — chaque import recombine tout. Seuls les fichiers reçus dans la requête sont réarchivés (`providedKeys`), les réutilisés sont listés dans `import_debug.reused_files` et affichés « (+ réutilisés : …) ».
- **Tout passe par import-solteo** côté front (y compris loadcurve seule) — `compute-from-csv` reste intact pour les autres appels.
- Bouton renommé « Importer un CSV » → **« Import données Enedis »** (Overview + modale compteur).

## Complément — graphique conso mensuelle (01/07/2026 soir)

Nouveau composant `frontend/src/modules/leads/LeadDetail/MonthlyConsumptionChart.tsx` (recharts, déjà en dépendance) : bâtons Jan→Déc, tooltip kWh fr-FR, masqué si aucune donnée. Affiché : fiche lead + modale compteur, en mode PDL (calculé depuis le profil 8760 aligné calendrier — donc cohérent avec l'annuel normalisé R65) et en mode MENSUEL (12 valeurs saisies).

## Reste à faire / risques

- **Rebuild frontend requis.** ⚠️ tsc complet impossible dans la sandbox (fichiers tronqués par la sync) — lancer `npm run build` en local pour confirmer ; les modifications sont des Edit exacts à motifs déjà éprouvés.
- Redémarrage backend (nouvelle route).
- Les sauvegardes frontend ultérieures (overviewSave/meters) réécrivent `energy_profile` avec `{ engine }` seul → le détail `contract`/`import_debug` peut être perdu après édition manuelle du compteur ; les libellés (source, contrat, phase) survivent car portés par `engine`. Si tu veux une persistance dure du contrat → petite évolution overviewSave à prévoir.
- `applyEquipmentShape` est appliqué avant normalisation ; équipements « à venir » inclus puis rescalés avec le reste (cohérent avec compute-from-csv).
- Ancien flux ZIP (loadcurve seule) et POST `/api/energy/profile` inchangés.
