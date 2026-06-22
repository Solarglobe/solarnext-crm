# Fiche de déploiement — séparation pose installateur RGE (billing_party)

**Commit :** `fix(quotes): separate installer RGE labor from SolarGlobe billable totals`
**Destinataire :** personne qui administre le serveur backend Infomaniak (accès SSH).
**Nature du changement :** ajout de colonnes (additif, **non rétroactif**) + nouveau code backend/frontend. Aucune donnée existante n'est modifiée ou supprimée.

---

## Contexte en une phrase

La ligne « pose / main-d'œuvre installateur RGE » est désormais séparée du total facturable SolarGlobe (nouvelle colonne `billing_party`). La migration ajoute des colonnes avec valeur par défaut `SOLARGLOBE`, donc **tous les devis existants restent strictement identiques**.

---

## Pré-requis

- Accès SSH au serveur Infomaniak qui héberge le backend (API `api.solarnext-crm.fr`).
- Le dépôt git du backend sur ce serveur (chemin habituel de déploiement ; dans la config PM2 d'exemple : `…/solarnext-crm/backend`).
- Le fichier `backend/.env` est déjà présent sur le serveur (il contient `DATABASE_URL`). Rien à configurer.
- PM2 gère le process (`solarnext-api`).

---

## Procédure (dans l'ordre)

> Adapter le chemin du dépôt à l'installation réelle. Toutes les commandes se lancent **sur le serveur**, dans le dossier `backend/`.

### 1. Sauvegarde de la base (obligatoire avant migration)

```bash
cd /chemin/vers/solarnext-crm/backend
npm run backup:db
```

### 2. Récupérer le code à jour

```bash
cd /chemin/vers/solarnext-crm
git pull
```

### 3. Installer d'éventuelles dépendances (sans risque, aucune nouvelle dépendance ici)

```bash
cd backend
npm install --omit=dev   # ou `npm ci` selon l'habitude
```

### 4. Appliquer la migration

```bash
npm run migrate
```

Migration attendue : `1782800000000_quote_billing_party_installer_split`.
Elle est **idempotente** (`ADD COLUMN IF NOT EXISTS`) : rejouable sans danger.

### 5. Redémarrer l'API

```bash
pm2 restart solarnext-api
pm2 logs solarnext-api --lines 50   # vérifier l'absence d'erreur au démarrage
```

---

## Vérification (la migration a bien fonctionné)

Se connecter à la base (psql) et vérifier la présence des colonnes :

```sql
-- colonnes billing_party
SELECT table_name, column_name
FROM information_schema.columns
WHERE column_name = 'billing_party'
  AND table_name IN ('quote_lines','quote_catalog_items','invoice_lines');

-- colonnes estimation pose sur quotes
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'quotes'
  AND column_name IN ('total_installer_ht','total_installer_vat','total_installer_ttc');
```

Résultat attendu : `billing_party` sur les 3 tables + les 3 colonnes `total_installer_*` sur `quotes`.

---

## Frontend (Vercel)

Le frontend se redéploie automatiquement au `git push` (si le projet Vercel est connecté au dépôt). Aucune action manuelle nécessaire. Si le déploiement est manuel : redéployer depuis le dashboard Vercel après le push.

---

## Rollback (en cas de problème uniquement)

```bash
cd /chemin/vers/solarnext-crm/backend
npm run migrate:down      # annule la dernière migration
pm2 restart solarnext-api
```

La migration possède une fonction `down` testée (supprime les colonnes ajoutées). Restauration complète possible via la sauvegarde de l'étape 1 si nécessaire.

---

## Recette fonctionnelle (après déploiement)

1. Admin → Catalogue devis : marquer l'article « Installation photovoltaïque – Main-d'œuvre (partenaire RGE) » en **Installateur RGE indépendant** (champ « Facturation »).
2. Créer un devis test : matériel SolarGlobe + ajouter la ligne pose depuis le catalogue.
   - Vérifier le badge « Hors total SolarGlobe — Installateur RGE » sur la ligne.
   - Vérifier le résumé : Total SolarGlobe / Estimation pose / Coût global indicatif.
3. Générer le PDF : sections **A — Prestations SolarGlobe**, **B — Pose installateur RGE**, **C — Coût global indicatif**.
4. Créer une facture depuis ce devis : la ligne pose ne doit **pas** apparaître, et le total facture = total SolarGlobe.
