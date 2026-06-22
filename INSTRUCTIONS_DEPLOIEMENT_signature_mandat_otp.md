# Fiche de déploiement — Signature sécurisée du mandat (aperçu PDF + OTP e-mail/SMS)

**Commit :** `feat(dp): signature mandat securisee - apercu PDF + OTP email/SMS + garde-fou tampon`
**Destinataire :** personne qui administre le serveur backend Infomaniak (accès SSH) + déploiement frontend Vercel.

---

## Contexte en une phrase

La signature du mandat de représentation (module DP) passe désormais par : **lecture du PDF entier du mandat** → **code de vérification (OTP) envoyé au client par e-mail ou SMS** → **signature**. Le backend refuse d'horodater la signature si l'OTP n'a pas été vérifié.

---

## ⚠️ Règle critique — backend + frontend INDISSOCIABLES

Le garde-fou backend (`/pdf/render/mandat/signature-stamp`) exige maintenant un `leadId` + un OTP vérifié.
- Déployer le **backend seul** = la signature du mandat **casse** (403) tant que le frontend n'est pas à jour.
- Déployer le **frontend seul** sans la migration = l'envoi du code échoue (table SQL absente).

➡️ **Migration + backend + frontend doivent partir ensemble**, dans cet ordre : migration → backend → frontend.

---

## Pré-requis

- Accès SSH au serveur backend Infomaniak (API `api.solarnext-crm.fr`).
- Le dépôt git du backend sur le serveur ; `backend/.env` présent (contient `DATABASE_URL`).
- PM2 gère le process (`solarnext-api`).
- Une **boîte mail CRM active** dans l'organisation (pour l'envoi du code e-mail) ; pour le SMS, **SMS Partner** doit être configuré côté serveur (sinon utiliser l'e-mail).

---

## Procédure (dans l'ordre, sur le serveur, dossier `backend/`)

### 1. Sauvegarde de la base (obligatoire)
```bash
cd /chemin/vers/solarnext-crm/backend
npm run backup:db
```

### 2. Récupérer le code
```bash
cd /chemin/vers/solarnext-crm
git pull
```

### 3. Dépendances (aucune nouvelle ici, mais par sécurité)
```bash
cd backend
npm install --omit=dev
```

### 4. Appliquer la migration
```bash
npm run migrate
```
Migration attendue : `1782900000000_dp_mandat_signature_otps` (crée la table `dp_mandat_signature_otps`).

### 5. Redémarrer l'API
```bash
pm2 restart solarnext-api
pm2 logs solarnext-api --lines 50
```

### 6. Frontend (Vercel)
Le `git push` déclenche le redéploiement Vercel automatiquement (si connecté au dépôt). Sinon, redéployer depuis le dashboard Vercel après le push.

---

## Vérification migration (psql)

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'dp_mandat_signature_otps'
ORDER BY ordinal_position;
```
Colonnes attendues : `id, organization_id, lead_id, channel, destination, email, code_hash, attempts, expires_at, verified_at, created_by, created_at`.

---

## Recette fonctionnelle (à faire après déploiement)

Sur un **lead de test** ayant un e-mail (et idéalement un mobile) renseigné :

1. Ouvrir le dossier DP → page **Mandat** → « Signer le mandat ».
2. **Étape 1** : l'**aperçu PDF du mandat** s'affiche dans le modal ; cocher « lu et accepté ».
3. **Étape 2** : choisir **E-mail** (ou SMS) → « Envoyer le code » → vérifier que le client reçoit le code 6 chiffres → le saisir → « Vérifier » → badge « ✓ Identité vérifiée ».
4. **Test du garde-fou** : avant de vérifier l'OTP, la zone signature reste verrouillée ; tenter de valider sans OTP doit être refusé (message clair).
5. **Étape 3** : saisir prénom/nom, signer, « Valider la signature » → succès → le bouton « Voir / Télécharger le mandat signé » apparaît → le PDF signé se génère.
6. Vérifier qu'un code expiré / faux est bien rejeté (5 essais max, validité 10 min).

---

## Rollback (en cas de problème)

```bash
cd /chemin/vers/solarnext-crm/backend
npm run migrate:down      # supprime la table dp_mandat_signature_otps
pm2 restart solarnext-api
```
Et revenir au commit précédent côté code (`git revert` du commit signature mandat) + redéploiement, si nécessaire. Restauration complète possible via la sauvegarde de l'étape 1.

---

## Limites connues / points de vigilance

- **E-mail** envoyé via la boîte mail CRM de l'organisation (repli SMTP système). **SMS** via SMS Partner uniquement s'il est configuré ; sinon l'option SMS renverra une erreur claire — utiliser l'e-mail.
- L'**horodatage** reste renvoyé au navigateur puis retransmis (pas de scellement cryptographique) — valeur probante perfectible, chantier séparé si besoin.
- Fenêtre de validité de l'OTP vérifié pour signer : 45 min (constante `VERIFIED_MAX_AGE_MIN` du service).
- Comme pour tout ce module : repo en CRLF, ne jamais `git stash` dans ce repo.
