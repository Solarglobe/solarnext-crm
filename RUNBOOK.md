# RUNBOOK.md — SolarNext CRM

> Procedures d'urgence et de rollback en production.
> Objectif : retour a un etat stable en **moins de 5 minutes** pour tout incident P0/P1.

---

## 1. Niveaux d'incident

| Niveau | Definition | Exemple | Delai de resolution cible |
|--------|-----------|---------|--------------------------|
| **P0** | Production totalement indisponible ou corruption de donnees | Backend KO, DB inaccessible, perte de donnees | **< 5 min** (rollback immediat) |
| **P1** | Fonctionnalite critique degradee, perte partielle de donnees | Migration echouee a mi-chemin, API 500 sur /quotes | **< 15 min** |
| **P2** | Dysfonctionnement mineur, aucun impact donnees | UI buggee, calcul incorrect non critique | **< 2 h** (hotfix sur PR) |

---

## 2. Rollback de migration (< 5 min)

### Etape 0 — Diagnostic rapide (< 1 min)

```bash
# Voir les dernieres migrations appliquees
cd backend
npm run audit:migrations

# Voir les logs Railway
railway logs --tail 100
```

### Etape 1 — Rollback DB (< 2 min)

```bash
# Rollback de la derniere migration
cd backend
npm run migrate:down

# Rollback de N migrations (remplacer N)
for i in $(seq 1 N); do npm run migrate:down; done
```

> La commande `migrate:down` appelle `node scripts/run-pg-migrate.cjs down`.
> Chaque migration possede une fonction `export const down` verifiee (audit Step #7 : 155/155).

### Etape 2 — Rollback du deploiement applicatif

```bash
# Railway : revenir au deploiement precedent
railway rollback

# Verifier que l'API repond
curl -sf https://api.solarnext-crm.fr/ | jq .status
```

### Etape 3 — Verification post-rollback (< 2 min)

```bash
# Verifier la version de schema exposee
curl -I https://api.solarnext-crm.fr/api/system/health | grep X-Schema-Version

# Verifier les tables critiques
npm run check:schema
```

---

## 3. Rollback depuis une sauvegarde complete

Utiliser uniquement si `migrate:down` est insuffisant (P0 avec corruption).

```bash
# 1. Lister les sauvegardes disponibles
ls -lht backend/backups/**/*.sql.gz | head -20

# 2. Restaurer la plus recente
DATABASE_URL="..." npm run restore:db -- --file backend/backups/YYYY-MM/solarnext_backup_*.sql.gz

# 3. Rejouer les migrations depuis le point stable
npm run migrate:up
```

> **Avant toute restauration** : creer un snapshot du schema actuel pour audit.
> ```bash
> npm run db:snapshot
> git diff backend/db/schema.sql
> ```

---

## 4. Regle de compatibilite ascendante — cycle 3 migrations

Pour tout changement destructif (DROP COLUMN, renommage, type change), appliquer le cycle suivant :

| Migration | Action | But |
|-----------|--------|-----|
| **M+0** (deprecation) | Rendre la colonne nullable / ajouter la nouvelle colonne | Ancienne et nouvelle apps fonctionnent |
| **M+1** (data migration) | Copier/transformer les donnees existantes | Donnees migrees sans downtime |
| **M+2** (cleanup) | DROP COLUMN / DROP CONSTRAINT | Supprimer l'ancienne colonne apres validation |

**Regles absolues :**
- Ne jamais faire `DROP COLUMN` dans la meme migration que `ADD COLUMN`
- Tester le rollback (`migrate:down`) en local avant de merger
- Committer `backend/db/schema.sql` apres chaque migration (`npm run db:snapshot`)
- Ne jamais modifier une migration deja deployee en production

---

## 5. Procedure complete post-incident

1. [ ] Rollback effectue, service restaure
2. [ ] `npm run check:schema` passe
3. [ ] `npm run db:snapshot` execute, `db/schema.sql` committe
4. [ ] Timeline de l'incident documentee (Slack #incidents ou notion)
5. [ ] Post-mortem : cause racine identifiee
6. [ ] Action corrective ajoutee au backlog (issue GitHub ou carte roadmap)
7. [ ] TECH_DEBT.md mis a jour si dette technique identifiee

---

## 6. Contacts d'urgence

| Role | Contact |
|------|---------|
| Tech lead / DBA | direction.solarglobe@gmail.com |
| Hebergement Railway | https://railway.app (support in-app) |
| DNS / Domaine | Registrar du domaine solarnext-crm.fr |

---

## 7. Commandes de reference rapide

```bash
# Snapshot schema avant intervention
npm run db:snapshot && git diff backend/db/schema.sql

# Sauvegarde complete avant intervention risquee
npm run backup:db

# Rollback 1 migration
npm run migrate:down

# Verification schema post-intervention
npm run check:schema

# Audit de toutes les migrations (presence down())
npm run audit:migrations
```
