# Architecture Adresse SolarGlobe — V1

**Version** : 1.0  
**Statut** : Spécification  
**Date** : 2026  
**Contexte** : CRM SolarGlobe multi-organisation, fiche Lead/Client unique, objet Adresse pour DP / Calpinage / PVGIS / Ombrage.

---

## 1. DESCRIPTION MÉTIER (10 LIGNES)

L’adresse SolarGlobe distingue **adresse postale** (humain, facturation, courrier) et **géolocalisation** (coordonnées lat/lon du bâtiment). La géolocalisation est assortie d’un **niveau de précision** vérifiable. Seules les précisions ROOFTOP_BUILDING et MANUAL_PIN_BUILDING autorisent PVGIS, ombrage et calpinage. La saisie passe par un flux assisté : champ unique → suggestions API → sélection → auto-remplissage. Si l’utilisateur saisit sans choisir une suggestion, l’adresse reste en « brouillon postal » sans lat/lon, et les actions aval sont bloquées. Le pin manuel sur carte est la méthode recommandée pour atteindre la précision maximale.

---

## 2. MODÈLE DE DONNÉES — ADDRESS

### 2.1 Table principale `addresses`

| Champ | Type | Contraintes | Description |
|-------|------|-------------|-------------|
| `id` | uuid | PK, default gen_random_uuid() | Identifiant unique |
| `organization_id` | uuid | NOT NULL, FK organizations CASCADE | Isolation multi-org |
| `label` | varchar(80) | nullable | "Site", "Facturation", "Livraison" |
| **Adresse postale** | | | |
| `address_line1` | varchar(255) | nullable | Numéro + voie |
| `address_line2` | varchar(255) | nullable | Complément |
| `postal_code` | varchar(20) | nullable | Code postal |
| `city` | varchar(150) | nullable | Ville |
| `country_code` | char(2) | default 'FR' | ISO 3166-1 alpha-2 |
| `formatted_address` | text | nullable | Chaîne d’affichage complète |
| **Géolocalisation** | | | |
| `lat` | numeric(10,7) | nullable | Latitude WGS84 |
| `lon` | numeric(10,7) | nullable | Longitude WGS84 |
| `geo_provider` | varchar(50) | nullable | BAN, Nominatim, Google, etc. |
| `geo_place_id` | varchar(255) | nullable | ID du provider si dispo |
| `geo_source` | varchar(50) | nullable | manual_pin, autocomplete_pick, import, unknown |
| `geo_precision_level` | varchar(50) | nullable | Enum métier (voir §3) |
| `geo_confidence` | smallint | nullable, 0–100 | Score de confiance |
| `geo_bbox` | jsonb | nullable | Bounding box [minLon, minLat, maxLon, maxLat] |
| `geo_updated_at` | timestamptz | nullable | Dernière mise à jour géo |
| **Qualité / conformité** | | | |
| `is_geo_verified` | boolean | default false | Validé manuellement (pin) |
| `geo_verification_method` | varchar(50) | nullable | pin_confirmed, provider_rooftop, provider_interpolated, none |
| `geo_notes` | text | nullable | Notes libres |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

**Index** : `(organization_id)`, `(lat, lon)` (GIST si recherche spatiale future).

### 2.2 Lien avec la fiche Lead/Client

**Modèle unifié** : une seule entité (ex. `contacts` ou `leads` selon implémentation) avec deux vues filtrées (Lead vs Client).

| Champ sur la fiche | Type | Description |
|-------------------|------|-------------|
| `site_address_id` | uuid, FK addresses | Adresse du bâtiment à étudier (obligatoire pour études) |
| `billing_address_id` | uuid, FK addresses | Adresse de facturation (optionnel) |

**Raisons** :
- `site_address` ≠ `billing_address` par défaut : cas fréquent (propriétaire ≠ occupant, siège social ≠ site d’installation).
- `site_address_id` est la référence pour PVGIS, ombrage, calpinage, DP.
- `billing_address_id` sert à la facturation et aux documents légaux.
- Si `billing_address_id` est null, on utilise `site_address_id` pour la facturation (fallback métier).

---

## 3. NIVEAUX DE PRÉCISION — ENUM MÉTIER

### 3.1 Enum `geo_precision_level`

| Valeur | Définition métier | Risque PV/ombrage | PVGIS | Ombre proche | Ombre lointaine / horizon | Calpinage |
|--------|-------------------|-------------------|-------|--------------|---------------------------|-----------|
| `UNKNOWN` | Aucune info ou non géocodé | Élevé | Non | Non | Non | Non |
| `COUNTRY` | Pays uniquement | Très élevé | Non | Non | Non | Non |
| `CITY` | Ville ou agglomération | Élevé | Non | Non | Non | Non |
| `POSTAL_CODE` | Code postal (centroïde) | Moyen | Non | Non | Non | Non |
| `STREET` | Rue (interpolation) | Moyen | Non | Non | Non | Non |
| `HOUSE_NUMBER_INTERPOLATED` | Numéro interpolé sur segment | Faible à moyen | Non | Non | Non | Non |
| `ROOFTOP_BUILDING` | Toit/bâtiment (provider) | Faible | **Oui** | **Oui** | **Oui** | **Oui** |
| `MANUAL_PIN_BUILDING` | Pin confirmé sur bâtiment | Très faible | **Oui** | **Oui** | **Oui** | **Oui** |

**Règle bâtiment SolarGlobe** : `precision ∈ {ROOFTOP_BUILDING, MANUAL_PIN_BUILDING}`.

---

## 4. STRATÉGIE UX — SAISIE + AUTOCOMPLETE + AUTOFILL

### 4.1 Flux principal

1. **Champ unique "Adresse complète"** : saisie libre, debounce 300 ms.
2. **Appel API autocomplete** : `GET /geo/autocomplete?q=...`
3. **Affichage liste de suggestions** : label, ville, CP, indicateur de précision.
4. **Sélection obligatoire** : l’utilisateur choisit une suggestion.
5. **Auto-remplissage** : line1, line2, CP, ville, pays, lat, lon, precision_level, confidence, provider, place_id.
6. **Enregistrement** : création/mise à jour de l’adresse avec `geo_source=autocomplete_pick`.

### 4.2 Saisie sans sélection (brouillon postal)

- Si l’utilisateur valide sans choisir une suggestion : on enregistre uniquement les champs postaux saisis (line1, line2, CP, ville, pays).
- `lat`, `lon`, `geo_precision_level` restent null.
- `geo_source` = `unknown`.
- **Conséquence** : blocage PVGIS, ombrage, calpinage avec message explicite.

### 4.3 Bouton "Utiliser ma position"

- Utilise l’API géolocalisation du navigateur.
- **Ne doit pas** être considéré comme "bâtiment".
- `geo_precision_level` = `STREET` ou `UNKNOWN` selon fiabilité.
- `geo_source` = `unknown`.
- **Message UX** : "Votre position approximative a été enregistrée. Pour les études solaires, placez le pin sur le bâtiment."

### 4.4 Option "Pin carte" (recommandée)

- Carte centrée sur l’adresse postale (si dispo) ou sur la commune.
- L’utilisateur déplace le pin sur le bâtiment.
- Au clic "Valider" : `POST /addresses/verify-pin`.
- Enregistrement : `geo_source=manual_pin`, `geo_precision_level=MANUAL_PIN_BUILDING`, `is_geo_verified=true`, `geo_verification_method=pin_confirmed`.

### 4.5 États d’erreur et messages UX

| Situation | Message |
|-----------|---------|
| Pas de suggestion sélectionnée, action aval | "Adresse non confirmée au niveau bâtiment. Sélectionnez une suggestion ou placez le pin sur la carte." |
| Précision insuffisante pour PVGIS | "Adresse non confirmée au niveau bâtiment. Sélectionnez une suggestion ou placez le pin sur la carte." |
| Pas de site_address_id sur la fiche | "Veuillez renseigner l’adresse du site d’installation." |
| Lat/lon manquants | "Coordonnées manquantes. Géocodez l’adresse ou placez le pin." |
| Zone LIDAR indisponible (ombre lointaine) | "Horizon simplifié utilisé (LIDAR non disponible pour cette zone)." |

---

## 5. GARANTIE "LAT/LON AU NIVEAU BÂTIMENT"

**Condition** : `geo_precision_level ∈ {ROOFTOP_BUILDING, MANUAL_PIN_BUILDING}`.

**Obtention rooftop** :
- Via provider si disponible (BAN rooftop, Google rooftop, etc.).
- Sinon via pin manuel (utilisateur place le point sur le bâtiment).

**Audit** : `geo_source`, `geo_provider`, `geo_place_id`, `geo_verification_method`, `geo_updated_at` permettent de tracer la provenance.

---

## 6. RÈGLES DE BLOCAGE

| Module | Conditions | Action | Message |
|--------|------------|--------|---------|
| **PVGIS** | lat/lon non null ET precision ≥ ROOFTOP_BUILDING | Autorisé | — |
| **PVGIS** | lat/lon null OU precision < ROOFTOP_BUILDING | Bloqué | "Adresse non confirmée au niveau bâtiment. Sélectionnez une suggestion ou placez le pin sur la carte." |
| **Ombre proche** | lat/lon non null ET (rooftop OU pin) ET site_address_id présent | Autorisé | — |
| **Ombre proche** | Sinon | Bloqué | "Adresse du site requise et géolocalisation au niveau bâtiment." |
| **Ombre lointaine / LIDAR** | rooftop/pin ET département/zone LIDAR dispo | Autorisé (horizon LIDAR) | — |
| **Ombre lointaine / LIDAR** | rooftop/pin ET zone LIDAR indispo | Fallback horizon simplifié | "Horizon simplifié utilisé (LIDAR non disponible pour cette zone)." |
| **Ombre lointaine / LIDAR** | Pas rooftop/pin | Bloqué | "Géolocalisation au niveau bâtiment requise." |
| **Calpinage** | lat/lon requis + rooftop/pin recommandé | Autorisé si lat/lon | Accepté avec avertissement si precision < rooftop |
| **DP** | Adresse postale (CP, ville, pays) requise | Autorisé même sans géoloc | — |
| **DP** | Adresse postale incomplète | Bloqué | "Adresse postale incomplète (CP, ville, pays requis)." |

---

## 7. CONTRATS API (JSON)

### 7.1 `GET /geo/autocomplete?q={query}&country=FR&limit=10`

**Réponse 200** :

```json
{
  "suggestions": [
    {
      "place_id": "ban_75101_12345",
      "label": "12 rue de Rivoli, 75001 Paris",
      "provider": "BAN",
      "precision_level": "ROOFTOP_BUILDING",
      "confidence": 95,
      "lat": 48.8566,
      "lon": 2.3522,
      "components": {
        "address_line1": "12 rue de Rivoli",
        "address_line2": null,
        "postal_code": "75001",
        "city": "Paris",
        "country_code": "FR"
      }
    }
  ]
}
```

### 7.2 `POST /geo/resolve`

**Corps** :

```json
{
  "place_id": "ban_75101_12345",
  "provider": "BAN"
}
```

**Réponse 200** :

```json
{
  "place_id": "ban_75101_12345",
  "provider": "BAN",
  "lat": 48.8566,
  "lon": 2.3522,
  "precision_level": "ROOFTOP_BUILDING",
  "confidence": 95,
  "components": {
    "address_line1": "12 rue de Rivoli",
    "address_line2": null,
    "postal_code": "75001",
    "city": "Paris",
    "country_code": "FR"
  },
  "formatted_address": "12 rue de Rivoli, 75001 Paris, France",
  "bbox": [2.351, 48.855, 2.353, 48.858]
}
```

### 7.3 `POST /addresses/verify-pin`

**Corps** :

```json
{
  "address_id": "uuid-de-l-adresse",
  "lat": 48.8567,
  "lon": 2.3523
}
```

**Réponse 200** :

```json
{
  "id": "uuid-de-l-adresse",
  "lat": 48.8567,
  "lon": 2.3523,
  "geo_precision_level": "MANUAL_PIN_BUILDING",
  "geo_source": "manual_pin",
  "is_geo_verified": true,
  "geo_verification_method": "pin_confirmed",
  "geo_updated_at": "2026-02-16T10:30:00.000Z"
}
```

---

## 8. EDGE CASES

| Cas | Décision |
|-----|----------|
| **Adresse incomplète (pas de numéro)** | Acceptée en brouillon postal. Pas de lat/lon. Blocage aval. Message : "Adresse partielle. Pour les études, sélectionnez une suggestion ou placez le pin." |
| **Commune nouvelle / lieu-dit** | Provider peut ne pas retourner rooftop. Proposer pin manuel. Si pas de suggestion : brouillon postal. |
| **Bâtiment collectif** | Lat/lon doit pointer le bâtiment, pas l’entrée. Pin manuel recommandé. Règle : le point doit être sur l’emprise du bâtiment (contrôle visuel utilisateur). |
| **Adresse pro / site industriel** | Même logique. Pin sur le bâtiment principal ou le hangar concerné. |
| **Différence facturation vs site** | `site_address_id` ≠ `billing_address_id`. Fallback facturation = site si billing null. |
| **Export/import CSV** | Colonne `geo_precision_level` mappée. Valeurs inconnues → `UNKNOWN`. Valeurs invalides → `UNKNOWN`. Import ne force jamais ROOFTOP/MANUAL_PIN sans preuve (place_id ou lat/lon + flag). |
| **Adresse à l’étranger** | Même enum. Providers varient (Nominatim, Google). Si provider ne donne pas rooftop → proposer pin. |
| **Doublon adresse** | Pas de déduplication automatique. Une adresse par fiche/usage. Réutilisation possible via `address_id` si même organisation. |

---

## 9. SCHÉMA RELATIONNEL RÉCAPITULATIF

```
organizations (id)
    │
    ├── addresses (organization_id)
    │       └── id (PK)
    │
    └── leads / contacts (organization_id)
            ├── site_address_id (FK → addresses.id)
            └── billing_address_id (FK → addresses.id, nullable)
```

**Contraintes** :
- `addresses.organization_id` NOT NULL, CASCADE on delete org.
- `leads.site_address_id` nullable (peut être renseigné plus tard).
- `leads.billing_address_id` nullable ; si null, utiliser site_address pour facturation.

---

*Document de spécification — aucune implémentation. Architecture provider-agnostic.*
