# Sentry error tracking

## Variables

Backend:

- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `SENTRY_RELEASE`
- `SENTRY_TRACES_SAMPLE_RATE`

Frontend:

- `VITE_SENTRY_DSN`
- `VITE_SENTRY_RELEASE`
- `VITE_SENTRY_TRACES_SAMPLE_RATE`
- `VITE_SENTRY_REPLAY_SAMPLE_RATE` defaults to `0.05`
- `VITE_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE` defaults to `1`

## Contextes metier PV

Les erreurs backend capturees via Express, `uncaughtException` ou `unhandledRejection` sont enrichies avec `userId`, `organizationId`, `role`, puis avec le contexte PV disponible :

- `study_id`
- `scenario_version`
- `engine_version`
- `geometry_hash`
- `calculation_type` (`shading`, `financial`, `roi`)

Pour enrichir explicitement une erreur de moteur pur, utiliser :

```js
import { withPvEngineContext } from "../services/sentry.service.js";

throw withPvEngineContext(error, {
  study_id,
  scenario_version,
  geometry_hash,
  calculation_type: "financial",
});
```

## Alertes Sentry

Configurer cote Sentry :

- nouvelle erreur : email immediat ;
- `calculation_type:financial` ou `calculation_type:roi` : Slack/email priorite haute ;
- Apdex `< 0.8` : alerte performance.
