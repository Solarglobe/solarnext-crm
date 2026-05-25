# SolarNext — Guide de restauration

> **Principe** : la valeur de l'entreprise est dans la base de données.
> Ce guide couvre deux scénarios distincts : restaurer uniquement la DB,
> et reconstruire le serveur complet depuis zéro.

---

## Sommaire

1. [Scénario A — Restauration DB seule](#scénario-a--restauration-db-seule)
2. [Scénario B — Reconstruction VPS complet](#scénario-b--reconstruction-vps-complet)
3. [Tester la restauration (mensuel)](#tester-la-restauration-mensuel)
4. [Références backup](#références-backup)

---

## Scénario A — Restauration DB seule

**Quand l'utiliser** : corruption d'une table, suppression accidentelle de données,
mauvaise migration. Le VPS tourne toujours.

**Durée estimée : 5–15 minutes**

### 1. Identifier le bon backup

```bash
# Voir les backups locaux disponibles
ls -lh /home/ubuntu/backups/

# Voir les backups R2 (daily)
rclone ls r2:solarnext-backups/daily/ --s3-no-check-bucket

# Voir les backups R2 weekly (dimanche, 4 semaines)
rclone ls r2:solarnext-backups/weekly/ --s3-no-check-bucket

# Voir les backups R2 monthly (1er du mois, 6 mois)
rclone ls r2:solarnext-backups/monthly/ --s3-no-check-bucket
```

### 2. Télécharger depuis R2 si nécessaire

```bash
# Exemple : récupérer le backup du 2026-05-20
rclone copy r2:solarnext-backups/daily/solarnext_2026-05-20.dump.gz \
  /home/ubuntu/backups/ --s3-no-check-bucket
```

### 3. Stopper l'API

```bash
pm2 stop solarnext-api
```

### 4. Renommer la DB actuelle (précaution)

```bash
# Créer une copie de sauvegarde avant d'écraser
PGHOST=/var/run/postgresql psql -U postgres -c \
  "ALTER DATABASE solarnext_prod RENAME TO solarnext_prod_backup_$(date +%Y%m%d);" postgres
```

### 5. Restaurer

```bash
# Créer une DB vide
PGHOST=/var/run/postgresql createdb -U postgres solarnext_prod

# Décompresser et restaurer
gunzip -c /home/ubuntu/backups/solarnext_YYYY-MM-DD.dump.gz | \
  PGHOST=/var/run/postgresql pg_restore \
    -U postgres \
    -d solarnext_prod \
    --no-owner \
    --no-privileges
```

### 6. Vérifier rapidement

```bash
PGHOST=/var/run/postgresql psql -U postgres -d solarnext_prod -c "
  SELECT
    (SELECT COUNT(*) FROM organizations)  AS orgs,
    (SELECT COUNT(*) FROM users)          AS users,
    (SELECT COUNT(*) FROM leads)          AS leads,
    (SELECT COUNT(*) FROM studies)        AS studies,
    (SELECT COUNT(*) FROM quotes)         AS quotes,
    (SELECT COUNT(*) FROM invoices)       AS invoices;
"
```

### 7. Relancer l'API

```bash
pm2 start solarnext-api
pm2 logs solarnext-api --lines 20
```

### 8. Nettoyer la vieille DB (une fois validé)

```bash
PGHOST=/var/run/postgresql dropdb -U postgres solarnext_prod_backup_YYYYMMDD
```

---

## Scénario B — Reconstruction VPS complet

**Quand l'utiliser** : le VPS est mort, hacké, ou tu déménages chez un autre hébergeur.

**Durée estimée : 20–40 minutes**

### Prérequis

- Accès à la console Infomaniak (pour créer un nouveau VPS)
- Les secrets de production (voir `.env` template dans `infrastructure/vps-setup-env.example.sh`)
- Accès à GitHub (le code source)
- Accès à Cloudflare R2 (les backups DB)

### Étape 1 — Créer un nouveau VPS

Sur [manager.infomaniak.com](https://manager.infomaniak.com) :
- Ubuntu 22.04 LTS 64-bit
- Même région si possible
- Noter la nouvelle IP publique

Mettre à jour le DNS de `api.solarnext.fr` vers la nouvelle IP :
- **Cloudflare DNS** → A record `api` → nouvelle IP
- TTL 1 min pendant la migration, puis repasser à 1h

### Étape 2 — Setup initial

```bash
ssh ubuntu@NOUVELLE_IP

# Mise à jour système
sudo apt-get update && sudo apt-get upgrade -y

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs postgresql postgresql-client nginx certbot \
  python3-certbot-nginx git

# PM2
sudo npm install -g pm2

# rclone (pour accéder aux backups R2)
sudo apt-get install -y rclone
```

### Étape 3 — Configurer rclone → R2

```bash
mkdir -p ~/.config/rclone
cat > ~/.config/rclone/rclone.conf << 'EOF'
[r2]
type = s3
provider = Cloudflare
access_key_id = CLOUDFLARE_R2_ACCESS_KEY
secret_access_key = CLOUDFLARE_R2_SECRET_KEY
endpoint = https://efe163e64405f7a76213ed1ec2f155b5.r2.cloudflarestorage.com
EOF
```

> Les clés R2 sont dans le gestionnaire de tokens Cloudflare.

### Étape 4 — Restaurer la DB

```bash
# Créer la DB
sudo -u postgres createdb solarnext_prod

# Télécharger le dernier backup
rclone ls r2:solarnext-backups/daily/ --s3-no-check-bucket | sort | tail -5
rclone copy r2:solarnext-backups/daily/solarnext_YYYY-MM-DD.dump.gz \
  /home/ubuntu/ --s3-no-check-bucket

# Restaurer
gunzip -c /home/ubuntu/solarnext_YYYY-MM-DD.dump.gz | \
  PGHOST=/var/run/postgresql pg_restore \
    -U postgres \
    -d solarnext_prod \
    --no-owner \
    --no-privileges
```

### Étape 5 — Déployer le code

```bash
mkdir -p /home/ubuntu/app
git clone https://github.com/TON_ORG/solarnext.git /home/ubuntu/app
cd /home/ubuntu/app/backend
npm install --production
```

### Étape 6 — Créer le .env production

```bash
cat > /home/ubuntu/app/backend/.env << 'EOF'
NODE_ENV=production
DATABASE_URL=postgresql://postgres@localhost/solarnext_prod
JWT_SECRET=<valeur depuis Railway ou secret manager>
MAIL_ENCRYPTION_KEY=89c5c684831b7e0d02c9ce2bcdf058ffac079ed845000116bbde3d42aa5e3cb6
# ... autres variables (voir vps-setup-env.example.sh)
EOF
```

> ⚠️ **CRITIQUE** : `MAIL_ENCRYPTION_KEY` doit être exactement `89c5c684831b7e0d02c9ce2bcdf058ffac079ed845000116bbde3d42aa5e3cb6`.
> Ne jamais régénérer cette clé — elle chiffre les credentials mail en DB.

### Étape 7 — PM2

```bash
cd /home/ubuntu/app/backend
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup  # suivre les instructions affichées
```

### Étape 8 — Nginx + HTTPS

```bash
sudo cp /home/ubuntu/app/infrastructure/nginx/solarnext.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/solarnext.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# HTTPS
sudo certbot --nginx -d api.solarnext.fr --non-interactive --agree-tos \
  -m direction.solarglobe@gmail.com
```

### Étape 9 — Remettre le cron backup

```bash
sudo cp /home/ubuntu/app/infrastructure/scripts/backup-postgres.sh \
  /home/ubuntu/scripts/backup-postgres.sh
sudo chmod +x /home/ubuntu/scripts/backup-postgres.sh

crontab -e
# Ajouter : 0 2 * * * /home/ubuntu/scripts/backup-postgres.sh
```

### Étape 10 — Vérifications finales

```bash
# Santé API
curl https://api.solarnext.fr/health

# Logs PM2
pm2 logs solarnext-api --lines 30

# Test auth
curl -X POST https://api.solarnext.fr/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"TON_EMAIL","password":"TON_PASSWORD"}'
```

---

## Tester la restauration (mensuel)

Un backup non testé n'est pas un backup. Exécuter ce script une fois par mois :

```bash
/home/ubuntu/scripts/test-restore.sh
```

Le script :
1. Prend le dernier backup local (ou télécharge depuis R2)
2. Restaure sur une DB temporaire `solarnext_restore_test`
3. Vérifie la présence et le contenu des ~18 tables critiques
4. Vérifie les foreign keys (pas de leads orphelins)
5. Supprime la DB temporaire
6. Retourne exit 0 (succès) ou exit 1 (échec)

Consulter les résultats dans `/home/ubuntu/logs/test-restore.log`.

### Automatiser le test mensuel (optionnel)

```bash
crontab -e
# Ajouter (1er du mois à 3h du matin, après le backup de 2h) :
# 0 3 1 * * /home/ubuntu/scripts/test-restore.sh
```

---

## Références backup

| Emplacement | Rétention | Accès |
|---|---|---|
| `/home/ubuntu/backups/` | 7 jours | `ls /home/ubuntu/backups/` |
| R2 `daily/` | 8 jours | `rclone ls r2:solarnext-backups/daily/` |
| R2 `weekly/` | 4 semaines | `rclone ls r2:solarnext-backups/weekly/` |
| R2 `monthly/` | 6 mois | `rclone ls r2:solarnext-backups/monthly/` |

**Logs backup** : `/home/ubuntu/logs/backup.log`
**Logs test restore** : `/home/ubuntu/logs/test-restore.log`

**Bucket R2** : `solarnext-backups` (Cloudflare, compte `efe163e64405f7a76213ed1ec2f155b5`)

**RPO** (perte de données max) : 24h (cron à 2h00 chaque nuit)
**RTO** (temps de remise en route) : 15–30 min (scénario B complet)
