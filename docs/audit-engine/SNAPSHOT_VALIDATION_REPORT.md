# SNAPSHOT_VALIDATION_REPORT — Vérification selected_scenario_snapshot

**Mode : analyse + tests uniquement. Aucune modification de code.**

---

## 1️⃣ Structure du snapshot

### Fichiers analysés
- `backend/services/selectedScenarioSnapshot.service.js`
- `backend/controllers/selectScenario.controller.js`

### Blocs attendus vs implémentés

| Bloc attendu | Présent | Remarque |
|--------------|--------|----------|
| `scenario_type` | ✅ | Ligne 212 : `scenario_type: scenarioId` |
| `created_at` | ✅ | Ligne 213 : ISO string |
| `client` | ✅ | Lignes 42-107, 215 |
| `site` | ✅ | Lignes 43-50, 122-128, 217 |
| `installation` | ✅ | Lignes 130-135, 218 |
| `equipment` | ✅ | Lignes 137-161, 219 |
| `shading` | ✅ | Lignes 163-167, 220 |
| `energy` | ✅ | Lignes 169-177, 222 |
| `finance` | ✅ | Lignes 179-187, 223 |
| `production` | ✅ | Lignes 189-192, 224 |
| `cashflows` | ✅ | Lignes 194-200, 225 |
| `assumptions` | ✅ | Lignes 202-207, 226 |

**Structure : OK** — Les 12 blocs sont bien présents et retournés dans l’ordre documenté.

### Exemple réel (forme générée)

```json
{
  "scenario_type": "BASE",
  "created_at": "2025-03-06T12:00:00.000Z",

  "client": {
    "nom": "Dupont",
    "prenom": "Jean",
    "adresse": "12 rue de la Paix",
    "cp": "75001",
    "ville": "Paris"
  },
  "site": {
    "lat": 48.8566,
    "lon": 2.3522,
    "orientation_deg": 180,
    "tilt_deg": 30,
    "puissance_compteur_kva": 9,
    "type_reseau": "mono"
  },
  "installation": {
    "panneaux_nombre": 12,
    "puissance_kwc": 5.82,
    "production_annuelle_kwh": 7200,
    "surface_panneaux_m2": null
  },
  "equipment": {
    "panneau": { "marque": "LONGi", "modele": "Hi-MO 5", "puissance_wc": 485 },
    "onduleur": { "marque": "ATMOCE", "modele": "Micro", "quantite": 12 },
    "batterie": { "capacite_kwh": null, "type": null }
  },
  "shading": {
    "near_loss_pct": 2.5,
    "far_loss_pct": 1.1,
    "total_loss_pct": 3.6
  },

  "energy": {
    "production_kwh": 7200,
    "consumption_kwh": 13000,
    "autoconsumption_kwh": 3500,
    "surplus_kwh": 3700,
    "import_kwh": 9500,
    "billable_import_kwh": null,
    "independence_pct": 26.9
  },
  "finance": {
    "capex_ttc": 15000,
    "economie_year_1": 850,
    "economie_total": 18500,
    "roi_years": 12,
    "irr_pct": 5.2,
    "facture_restante": 2200,
    "revenu_surplus": 148
  },
  "production": {
    "annual_kwh": 7200,
    "monthly_kwh": [320, 480, 620, 680, 720, 750, 740, 700, 580, 420, 350, 330]
  },
  "cashflows": [
    { "year": 1, "gain": 850, "cumul": 850 },
    { "year": 2, "gain": 880, "cumul": 1730 }
  ],
  "assumptions": {
    "model_version": "ENGINE_V2",
    "shading_source": "DSM",
    "battery_enabled": false,
    "virtual_enabled": false
  }
}
```

---

## 2️⃣ Sources de données par bloc

| Bloc | Source attendue | Source réelle (code) | Peut être null/vide |
|------|------------------|----------------------|----------------------|
| **client** | leads + clients + addresses | `leads` (first_name, last_name), `clients` si `client_id`, `addresses` via `lead.site_address_id` | ✅ Oui si pas de lead ou pas d’adresse |
| **site** | addresses + leads + quote-prep | `addresses` (lat, lon), `leads` (meter_power_kva, grid_type), `quotePrep.technical_snapshot_summary` (orientation_deg, tilt_deg, gps fallback) | ✅ orientation/tilt null si pas de quote-prep |
| **installation** | quote-prep technical_snapshot_summary | `quotePrepService.getQuotePrep()` → `technical_snapshot_summary` (nb_panels, power_kwc, production_annual_kwh) | ✅ Tout null si getQuotePrep en erreur (ex. NO_CALPINAGE) |
| **equipment** | quote-prep + scenario | technical.panel, technical.inverter, technical.inverter_totals ; scenario.hardware.battery_capacity_kwh + scenario_type pour batterie.type | ✅ panneau/onduleur vides si pas de technical ; batterie.type null pour BASE |
| **shading** | scenarios_v2[].shading | `scenario.shading` (near_loss_pct, far_loss_pct, total_loss_pct) | ✅ Valeurs null si absentes du mapper |
| **energy** | scenarios_v2[].energy | `scenario.energy` (tous les champs listés) | ✅ billable_import_kwh null pour BASE/PHYSICAL |
| **finance** | scenarios_v2[].finance | `scenario.finance` (capex_ttc, economie_*, roi_years, irr_pct, residual_bill_eur, surplus_revenue_eur) | ❌ Objet toujours présent, champs null possibles |
| **production** | scenarios_v2[].production | `scenario.production` (annual_kwh, monthly_kwh) | ✅ monthly_kwh peut être null |
| **cashflows** | scenarios_v2[].finance.annual_cashflows | `scenario.finance.annual_cashflows` mappé en `{ year, gain, cumul }` | ✅ Tableau vide si pas de flows |
| **assumptions** | scenarios_v2[].assumptions | `scenario.assumptions` (model_version, shading_source, battery_enabled, virtual_enabled) | ❌ Objet toujours présent |

**Blocs pouvant être partiellement vides / null :** client (sans lead), site (sans adresse ou sans quote-prep), installation (sans quote-prep), equipment.panneau/onduleur (sans quote-prep). Aucun bloc entier n’est `undefined` : tous sont des objets ou tableaux initialisés.

---

## 3️⃣ Champs critiques — Présence dans le snapshot

| Chemin | Présent (code) | Note |
|--------|----------------|------|
| client.nom | ✅ L.60, 102 | lead.last_name ou client.last_name / company_name |
| client.prenom | ✅ L.61, 103 | lead.first_name ou client.first_name |
| client.adresse | ✅ L.75-80 | formatted_address ou address_line1 + address_line2 |
| client.cp | ✅ L.81 | addr.postal_code |
| client.ville | ✅ L.82 | addr.city |
| site.lat | ✅ L.82-85, 126 | addresses.lat ou technical.gps.lat |
| site.lon | ✅ L.86-89, 127 | addresses.lon ou technical.gps.lon |
| site.orientation_deg | ✅ L.122 | technical.orientation_deg |
| site.tilt_deg | ✅ L.123 | technical.tilt_deg |
| site.puissance_compteur_kva | ✅ L.63-64 | lead.meter_power_kva |
| site.type_reseau | ✅ L.66 | lead.grid_type |
| installation.panneaux_nombre | ✅ L.131 | technical.nb_panels / total_panels |
| installation.puissance_kwc | ✅ L.132 | technical.power_kwc / total_power_kwc |
| installation.production_annuelle_kwh | ✅ L.133 | technical.production_annual_kwh |
| equipment.panneau.marque | ✅ L.141 | technical.panel.brand |
| equipment.panneau.modele | ✅ L.142 | technical.panel.model |
| equipment.panneau.puissance_wc | ✅ L.143 | technical.panel.power_wc |
| equipment.onduleur.marque | ✅ L.149 | technical.inverter.brand |
| equipment.onduleur.modele | ✅ L.150 | technical.inverter.name |
| equipment.onduleur.quantite | ✅ L.151 | technical.inverter_totals.units_required |
| shading.total_loss_pct | ✅ L.166 | scenario.shading.total_loss_pct |
| energy.production_kwh | ✅ L.170 | scenario.energy.production_kwh |
| energy.consumption_kwh | ✅ L.171 | scenario.energy.consumption_kwh |
| energy.import_kwh | ✅ L.174 | scenario.energy.import_kwh |
| energy.billable_import_kwh | ✅ L.175 | scenario.energy.billable_import_kwh (BATTERY_VIRTUAL) |
| finance.capex_ttc | ✅ L.180 | scenario.finance.capex_ttc |
| finance.economie_year_1 | ✅ L.181 | scenario.finance.economie_year_1 |
| finance.economie_total | ✅ L.182 | scenario.finance.economie_total |
| finance.roi_years | ✅ L.183 | scenario.finance.roi_years |
| finance.irr_pct | ✅ L.184 | scenario.finance.irr_pct |
| finance.facture_restante | ✅ L.185 | scenario.finance.residual_bill_eur |
| finance.revenu_surplus | ✅ L.186 | scenario.finance.surplus_revenue_eur |
| production.annual_kwh | ✅ L.190 | scenario.production.annual_kwh |
| production.monthly_kwh | ✅ L.191 | scenario.production.monthly_kwh |
| cashflows[] | ✅ L.194-200 | Tableau { year, gain, cumul } |
| assumptions.model_version | ✅ L.203 | scenario.assumptions.model_version |

Tous les champs critiques listés existent dans le snapshot ; les valeurs peuvent être `null` selon les données en base et le résultat du calcul.

---

## 4️⃣ Incohérences possibles

### Import BATTERY_VIRTUAL
- **Règle :** Pour `scenario_type === "BATTERY_VIRTUAL"`, l’affichage PDF doit utiliser `energy.billable_import_kwh` (import facturé après crédit kWh).
- **Code :** Le service remplit `energy.billable_import_kwh` depuis `scenario.energy.billable_import_kwh` (l.175). Le mapper V2 remplit ce champ uniquement pour BATTERY_VIRTUAL. Donc **pas d’incohérence** : si scénario virtuel, la valeur est présente dans le snapshot.

### Production incohérente
- **Comparaison :** `installation.production_annuelle_kwh` (quote-prep / calpinage) vs `production.annual_kwh` (scénario calculé).
- **Risque :** Écart possible (calpinage vs moteur énergie), mais les deux sont figés dans le snapshot. Pour le PDF sans recalcul, les deux sont disponibles ; une incohérence éventuelle est un sujet métier (alignement calpinage / calcul), pas une erreur de snapshot. Le script de test peut signaler un écart significatif si les deux sont renseignés.

### Cashflows
- **Attendu :** Chaque élément a `year`, `gain`, `cumul`.
- **Code :** L.196-199 : `year` ← `f.year`, `gain` ← `f.total_eur ?? f.gain_auto ?? f.gain_oa`, `cumul` ← `f.cumul_eur`. **Présence OK** ; `gain` peut être null si aucun de ces champs n’existe dans le flow.

---

## 5️⃣ Verrouillage (selectScenario.controller.js)

| Élément | Vérification |
|--------|----------------|
| `study_versions.selected_scenario_id` | ✅ L.65-66 : mis à jour avec `scenarioId` |
| `study_versions.selected_scenario_snapshot` | ✅ L.65-66 : `JSON.stringify(snapshot)` |
| `study_versions.is_locked = true` | ✅ L.65 : `is_locked = true` |
| `locked_at` | ✅ L.65 : `locked_at = NOW()` dans l’UPDATE (si la colonne existe en base). |
| Refus si version déjà locked | ✅ L.42-44 : si `row.is_locked === true` → 400 `LOCKED_VERSION` |

---

## 6️⃣ Compatibilité PDF (données nécessaires sans recalcul)

| Besoin PDF | Dans le snapshot | Statut |
|------------|-------------------|--------|
| client | client.* (nom, prenom, adresse, cp, ville) | ✅ |
| site | site.* (lat, lon, orientation, tilt, kva, type_reseau) | ✅ |
| installation | installation.* (panneaux, kWc, production annuelle) | ✅ |
| equipment | equipment.panneau, onduleur, batterie | ✅ |
| energy | energy.* (prod, conso, auto, surplus, import, billable_import, independence) | ✅ |
| finance | finance.* (capex, économies, ROI, TRI, facture restante, revenu surplus) | ✅ |
| production | production.annual_kwh, monthly_kwh | ✅ |
| cashflows | cashflows[] (year, gain, cumul) | ✅ |
| shading | shading.* (near, far, total loss %) | ✅ |

Le snapshot contient bien toutes les données nécessaires pour générer un PDF sans relancer le moteur de calcul.

---

## 7️⃣ Tests automatiques

Le script **`backend/scripts/test-selected-snapshot.js`** (voir fichier) :

1. Récupère une `study_version` avec `data_json.scenarios_v2` (et si possible `selected_scenario_snapshot`).
2. Au besoin, appelle `buildSelectedScenarioSnapshot` pour un (studyId, versionId, organizationId) donnés.
3. Lit et valide le snapshot (présence des blocs, champs critiques, cashflows, incohérences optionnelles).
4. Affiche **SNAPSHOT_VALIDATION_REPORT** : structure OK/KO, champs manquants, valeurs null, incohérences.

Exécution (depuis la racine du projet) :

```bash
# Prérequis : DATABASE_URL dans .env ou .env.dev (ou export)
node backend/scripts/test-selected-snapshot.js
# Ou avec des IDs explicites (version avec scenarios_v2 déjà calculés) :
# STUDY_ID=... VERSION_ID=... ORG_ID=... node backend/scripts/test-selected-snapshot.js
```

Sans `DATABASE_URL`, le script quitte avec une erreur (connexion DB requise).

---

## 8️⃣ Synthèse

- **Structure :** OK — 12 blocs présents.
- **Sources :** Conformes au tableau des sources (leads, clients, addresses, quote-prep, scenarios_v2).
- **Champs critiques :** Tous présents dans le code ; valeurs null possibles selon les données.
- **BATTERY_VIRTUAL / billable_import_kwh :** Géré correctement.
- **Verrouillage :** selected_scenario_id, selected_scenario_snapshot et is_locked sont mis à jour ; version déjà locked refusée.
- **PDF :** Snapshot exploitable pour générer le PDF final sans recalcul.
