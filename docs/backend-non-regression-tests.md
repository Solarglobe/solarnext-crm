# Backend Non-Regression Tests

Suite ciblee pour les risques backend CRM restants : onboarding, settings legacy, pipeline SIGNED et audit log.

## Commandes

Depuis `backend` :

```powershell
node --test tests/backendRiskNonRegression.test.mjs
node --test tests/organizationSettingsSecurity.test.mjs tests/pipelineV2Contract.test.mjs tests/backendRiskNonRegression.test.mjs
```

## Perimetre

- Tests statiques et isoles : lecture du code source uniquement.
- Aucune connexion a la base, aucune donnee de production.
- Couvre les contrats backend suivants :
  - `PATCH /api/organizations/onboarding` protege par permission `org.settings.manage`.
  - `/api/organization/settings` legacy limite a `quote_pdf` et refuse les sections critiques.
  - seed pipeline V2 avec codes canoniques, `SIGNED` ouvert et `LOST` ferme.
  - conversion lead vers client uniquement via l'etape pipeline `SIGNED`.
  - audit log sur mutations sensibles.
