# Backend Node (SmartPitch / SolarNext CRM) — image runtime production.
# Variables obligatoires au run (ex. Railway) : DATABASE_URL, JWT_SECRET (ou JWT_SECRET_KEY).
# Recommandées : CORS_ORIGIN, PDF_RENDERER_BASE_URL (URL Vercel du front, Playwright + PDF), PORT (sinon 3000).

FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# Binaires Chromium pour Playwright (PDF études, devis, factures) — requis en prod
RUN npx playwright install --with-deps chromium

COPY . .

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server.js"]
