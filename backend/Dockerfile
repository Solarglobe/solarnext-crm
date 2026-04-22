# Backend Node (SmartPitch / SolarNext CRM) — image runtime production.
# Variables obligatoires au run (ex. Railway) : DATABASE_URL, JWT_SECRET (ou JWT_SECRET_KEY).
# Recommandées : CORS_ORIGIN (origines front, séparées par des virgules), PORT (sinon 3000).

FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server.js"]
