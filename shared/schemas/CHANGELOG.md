# CHANGELOG — shared/schemas

> Historique des changements de contrats de donnees SolarNext.
> Format : [VERSION] - DATE - TYPE - Description.
> Types : BREAKING | MINOR | PATCH
> Tout BREAKING doit referencer la migration SQL correspondante.

---

## [1.0.0] - 2026-05-15 - Initial release

### Schemas crees
- `geometry.schema.ts` : Point2D/3D, GpsCoordinates, SatelliteCalibration, RoofPan, PanelLayout, ShadingResult, HorizonMask
- `scenario.schema.ts` : VirtualBatteryConfig (contrainte MYSMARTBATTERY), ConsumptionMode, EnergyScenario, FinancialSnapshot (hash SHA-256)
- `lead.schema.ts` : LeadShapeSchema + Create/Update/Response + validation PRO superRefine
- `study.schema.ts` : MeterSnapshot, StudyCalcResult, StudyVersionDataJson, StudyVersion/Response
- `quote.schema.ts` : QuoteLine + Quote Create/Update/Response
- `invoice.schema.ts` : InvoiceLine + Payment + Invoice Create/Update/Response

### Infrastructure
- Snapshots JSON Schema 2020-12 generes pour 9 schemas Response
- Script de detection des breaking changes : `shared/schemas/scripts/check-breaking.mts`
- CI GitHub Actions : `.github/workflows/schema-check.yml`
- Backend middleware : `backend/middleware/schemaVersion.middleware.js`
- Frontend reload guard : `frontend/src/utils/schemaVersionCheck.ts`

---

## Template pour les prochaines entrees

<!--
## [X.Y.Z] - YYYY-MM-DD - BREAKING|MINOR|PATCH

### Changed / Added / Removed
- `<fichier>` : description du changement

### Migration SQL requise
- Fichier : `backend/migrations/<timestamp>_<description>.sql`
- Colonnes affectees : `<table>.<colonne>`

### Action frontend requise
- [x] Snapshot regenere
- [x] SCHEMA_VERSION bumpe
- [x] Hook frontend mis a jour si necessaire
-->
