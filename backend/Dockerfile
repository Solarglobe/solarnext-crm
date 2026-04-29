# Backend Node (SmartPitch / SolarNext CRM) — image runtime production.
# Variables obligatoires au run (ex. Railway) : DATABASE_URL, JWT_SECRET (ou JWT_SECRET_KEY).
# Recommandées : CORS_ORIGIN (liste d’origines autorisées, virgules), PDF_RENDERER_BASE_URL (URL Vercel du front, Playwright + PDF, sans slash final), PORT (sinon 3000).

FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./

RUN apt-get update && apt-get install -y \
  wget \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libexpat1 \
  libfontconfig1 \
  libgbm1 \
  libgcc1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  && rm -rf /var/lib/apt/lists/*

# Installe uniquement Chromium Playwright (pas Firefox/Webkit)
RUN npm ci --omit=dev && npx playwright install chromium --with-deps && npx playwright --version

COPY . .

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server.js"]
