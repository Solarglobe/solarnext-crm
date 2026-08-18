# SmartPitch / SolarGlobe CRM

Monorepo SmartPitch existant avec structure CRM SaaS-ready (CP-006).

Voir `/docs/product/SOLARGLOBE_CRM_MONOREPO_STRUCTURE_V1.md` pour l'arborescence et les règles.

## Environnements

- Frontend : Vercel, projet lié dans `.vercel/project.json`
- Backend : serveur Infomaniak/VPS, service Node géré côté serveur
- Variables production : injectées sur le serveur backend, jamais déduites de `.env.dev` ou `backend/.env`
- Aucun secret ne doit être commit
- Les anciens fichiers `.env` locaux peuvent contenir des valeurs obsolètes et ne décrivent pas l'infrastructure production

### Base de données

Le backend lit PostgreSQL via `DATABASE_URL` injectée dans l'environnement réel du serveur Infomaniak.
Les anciennes URL Railway ou locales ne doivent pas être utilisées comme production.

## Déploiement

La procédure backend versionnée dans ce dépôt est :
`infrastructure/scripts/deploy.sh`

Elle exécute sur le serveur : `git pull --ff-only origin main`, `npm ci --omit=dev`,
`npm run migrate:up`, import PV idempotent, `pm2 reload solarnext-api --wait-ready`,
puis health check `http://localhost:3000/api/health/ready` depuis le serveur.
