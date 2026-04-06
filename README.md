# SmartPitch / SolarGlobe CRM

Monorepo SmartPitch existant avec structure CRM SaaS-ready (CP-006).

Voir `/docs/product/SOLARGLOBE_CRM_MONOREPO_STRUCTURE_V1.md` pour l'arborescence et les règles.

## Environnements

- .env.dev utilisé en local
- .env.prod utilisé en production
- Aucun secret ne doit être commit
- Copier .env.dev → .env avant run local

### Base de données

Toutes les migrations et scripts utilisent la base :
solarnext

Assurez-vous que DATABASE_URL dans .env et .env.dev pointe vers :
postgresql://postgres:postgres@localhost:5432/solarnext

## Lancer le projet en local

<!-- Migrations: cd backend && npm run migrate:up -->

1. Copier .env.dev en .env si nécessaire
2. Lancer :

```bash
docker compose up --build
```

- Backend : http://localhost:3000
- PostgreSQL : localhost:5432
- Frontend : selon configuration existante
