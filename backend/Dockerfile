# Backend Node (SmartPitch / SolarNext CRM) — image runtime production.
# Variables obligatoires au run (ex. Railway) : DATABASE_URL, JWT_SECRET (ou JWT_SECRET_KEY).
# Recommandées : CORS_ORIGIN (liste d’origines autorisées, virgules), PDF_RENDERER_BASE_URL (URL Vercel du front, Playwright + PDF, sans slash final), PORT (sinon 3000).

FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
# Même logique que Nixpacks/Railway : `npm run build` installe uniquement Chromium (+ deps OS via --with-deps)
RUN npm ci --omit=dev && npm run build && (ls -la /root/.cache/ms-playwright/ 2>/dev/null; npx playwright --version)

COPY . .

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server.js"]
