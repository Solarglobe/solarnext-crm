# RC2 — rotation de la clé mail, préparation locale

État : mécanisme et outil préparés localement. **Aucune clé de production générée, aucune rotation réelle, aucune écriture en production.** Le tag RC1 demeure inchangé. RC2 n'autorise ni un déploiement ni un changement de secret par lui-même.

## Inventaire sans valeurs sensibles

Lecture des catalogues et agrégats de production le 15 septembre 2026, en transaction PostgreSQL explicitement READ ONLY. Aucun déchiffrement de donnée réelle pour cet inventaire.

| Stockage | Contenu protégé selon les lecteurs/écrivains du code | État observé |
|---|---|---|
| `mail_accounts.encrypted_credentials` — jsonb nullable | Mot de passe ancien `password`, `imap_user`, `imap_password`, `smtp_user`, `smtp_password` ; Microsoft : `oauth_access_token`, `oauth_refresh_token`, `oauth_provider`, `oauth_scopes`, `oauth_expires_at` et noms d'utilisateur IMAP/SMTP. Les lecteurs acceptent aussi les anciens alias `imap_access_token` / `smtp_access_token`. | 1 compte PASSWORD, enveloppe AES-GCM V1 ; aucun compte Microsoft OAuth actuel |
| `mail_account_oauth_states.code_verifier_encrypted` — jsonb obligatoire | Vérificateur PKCE `codeVerifier`, temporaire, utilisé pour échanger un code OAuth Microsoft | 0 ligne |
| `email_accounts.encrypted_password` — text obligatoire | Ancienne colonne, sans lecteur/écrivain dans le code applicatif courant ; son ancien format ne peut pas être déduit d'une table vide | 0 ligne |

L'inventaire des appels et des colonnes ne trouve pas d'autre stockage utilisant `MAIL_ENCRYPTION_KEY`. Le corps des mails et leurs pièces jointes ne sont pas chiffrés par ce service. Les secrets d'application Microsoft, identifiants SMTP système, JWT, accès Enedis et autres variables d'environnement ne sont pas protégés par cette clé. Cela ne constitue pas un audit global de leur sécurité.

Le JSON interne des identifiants peut porter son propre `v:1` : cette version métier est indépendante de la version de l'enveloppe cryptographique. L'outil préserve le texte déchiffré à l'identique, sans supprimer les champs anciens ou inconnus du JSON interne.

## Format et configuration implémentés

- Écriture : AES-256-GCM, IV aléatoire de 12 octets, tag de 16 octets ; enveloppe `{v:2, alg, kid, iv, tag, data}`. Le domaine applicatif, la version, l'algorithme et le `kid` sont authentifiés avec les données additionnelles GCM. Modifier le `kid` ou rétrograder la version invalide l'authentification. Voir [API crypto Node.js](https://nodejs.org/api/crypto.html).
- Lecture V2 : sélection de la clé par `kid`, sans essayer toutes les clés.
- Lecture V1 : ancien format `{v:1, alg, iv, tag, data}`, sans identifiant et sans AAD ; seule la clé explicitement désignée comme ancienne est utilisée.
- Hexadécimal 64 caractères et Base64 de 32 octets acceptés, y compris les variantes non paddées/base64url acceptées historiquement. Les caractères ignorables, bits non canoniques, longueurs incorrectes et algorithmes inconnus sont refusés.
- Pas de journalisation de clé, texte déchiffré, token, ciphertext, tag GCM ou empreinte de clé. Les erreurs cryptographiques exposent des codes fixes.

| Variable | Rôle |
|---|---|
| `MAIL_ENCRYPTION_KEYS` | Objet JSON privé associant des identifiants publics à leurs clés ; jamais dans Git ou la ligne de commande |
| `MAIL_ENCRYPTION_ACTIVE_KEY_ID` | Seule clé utilisée pour toutes les nouvelles écritures |
| `MAIL_ENCRYPTION_LEGACY_KEY_ID` | Clé de lecture des anciennes enveloppes V1 ; retirée après vérification complète |
| `MAIL_ENCRYPTION_KEY` | Ancienne configuration mono-clé, encore lisible ; les nouvelles enveloppes portent alors `kid=legacy`. Ce mode ne réalise pas une rotation et l'outil refuse de le considérer comme tel. |
| `MAIL_ROTATION_DATABASE_URL` | Connexion dédiée à l'outil ; aucune reprise de `DATABASE_URL`, `DB_*`, `PGHOST` ou des fichiers `.env` applicatifs |

Un identifiant de clé est un libellé public stable, jamais une empreinte cryptographique. **Ne jamais réutiliser un identifiant pour une autre clé.** Les doublons de libellé JSON, les clés de même contenu sous plusieurs identifiants et les configurations anciennes contradictoires sont refusés. Chaque instance de l'outil conserve une configuration immuable pendant son exécution.

La modification d'un compte mail ne transforme plus un échec de déchiffrement en identifiants vides. Elle échoue sans remplacer les données existantes.

## Outil et garanties

Entrée : `backend/scripts/rotate-mail-encryption-key.mjs`. Aucun import du serveur, des workers, du chargeur `.env` ou du runner de migrations.

Le mode par défaut est `dry-run`. Toute application exige un rapport dry-run réussi de moins d'une heure, le nom exact de la base et l'identifiant actif confirmés. Un nouveau dry-run intégral est également exécuté automatiquement juste avant l'application. Une erreur dans n'importe quelle source interdit toutes les écritures.

Les sources SQL sont une liste fixe. Les lignes sont parcourues par identifiant, sans exporter ces identifiants dans les journaux. Un ancien texte n'est traité que s'il contient une enveloppe V1/V2 reconnue ; tout autre format ancien bloque la rotation. Un `null` JSON malformé n'est pas assimilé à une absence SQL de credentials.

Chaque lot est transactionnel : verrouillage des lignes, déchiffrement en mémoire, chiffrement actif, contrôle de relecture active, mise à jour conditionnée par l'ancienne valeur, puis **nouvelle lecture depuis PostgreSQL** et comparaison avant COMMIT. Une corruption par trigger, une modification concurrente ou une erreur annule le lot. L'ancienne valeur demeure disponible par la transaction jusqu'à validation. Une sauvegarde sécurisée préalable reste nécessaire pour la reprise d'exploitation.

Un verrou applicatif PostgreSQL empêche deux rotations simultanées. Attente de verrou limitée à 1 seconde, requête à 15 secondes ; aucun enregistrement verrouillé n'est sauté silencieusement. Les compteurs exposés sont : trouvés, éligibles, migrés effectivement committés, ignorés, vérifiés, erreurs, par source. Ils portent sur l'exécution, sans constituer un inventaire nominatif.

SIGINT/SIGTERM provoque l'arrêt avant le prochain commit ; le lot en cours est annulé. En cas de coupure du processus, PostgreSQL annule la transaction ouverte. Pour reprendre, produire un nouveau dry-run et relancer depuis le début : les lignes déjà sous la clé active sont relues et ignorées, les autres sont traitées. Aucun fichier de curseur sensible ni suppression d'enregistrement n'est nécessaire. Un échec de connexion au moment du commit exige cette relecture : ne pas déduire le résultat effectif du seul dernier compteur affiché.

Après application, un passage complet `verify-active-only` vérifie la lisibilité sans recourir à une ancienne clé. Un rapport ne conclut au succès que si cette vérification finale réussit.

## Exécution future en production — autorisation préalable obligatoire

1. Résoudre ou faire approuver séparément le traitement de la quatrième migration ; qualifier RC2 dans une préproduction isolée. Examiner les reçus et le SHA exact. Autoriser ensuite explicitement la fenêtre de maintenance, la mise en place du code compatible, la création de la nouvelle clé, la sauvegarde et la rotation. L'outil autonome ne lance aucune migration de schéma.
2. Inventorier tous les écrivains de secrets : API, callbacks OAuth, rafraîchissement de tokens, workers et scripts d'administration. Préparer leur arrêt coordonné. Une coexistence avec un ancien binaire incapable de lire V2 n'est pas sûre.
3. Générer la nouvelle clé de production dans le mécanisme privé approuvé, sans l'imprimer dans un terminal ou journal. Préparer le trousseau avec `legacy` et `mail-2026-09`, la seconde active, la première désignée pour V1. Ces libellés sont proposés ; aucune clé réelle correspondante n'a été créée. Sauvegarder les configurations nécessaires dans un stockage sécurisé indépendant du dépôt.
4. Faire une sauvegarde restaurable, chiffrée et à accès restreint. Tester sa restauration isolée selon une procédure autorisée. Les sauvegardes contenant d'anciens ciphertexts restent concernées par l'exposition : inventorier leur rétention et leur re-chiffrement, sans les supprimer dans cette intervention.
5. Suspendre les écritures mail et arrêter tous leurs processus ; si leur isolation ne peut pas être prouvée, arrêter l'API et les workers pendant la maintenance. Installer le code compatible approuvé sans relancer un ancien écrivain. Utiliser un compte PostgreSQL dédié : CONNECT sur cette base, USAGE sur `public`, SELECT sur `id` et la colonne chiffrée de chacune des trois tables, UPDATE sur leurs seules colonnes chiffrées ; aucun droit d'administration, d'insertion ou de suppression. Vérifier les permissions effectives avant la fenêtre de rotation.
6. Dans un processus dédié recevant uniquement ses variables privées, depuis la racine de la release identifiée, effectuer :

```text
node backend/scripts/rotate-mail-encryption-key.mjs --dry-run --confirm-database solarnext_prod --confirm-active-key mail-2026-09 --batch-size 100 --report /CHEMIN_PRIVE/rotation-dry-run-HORODATAGE.json
```

Le répertoire privé doit être validé et préparé par l'opérateur. Le rapport est créé sans écraser un fichier existant. Examiner les compteurs : aujourd'hui, l'inventaire attend une enveloppe V1 dans `mail_accounts`, mais **les nombres doivent être relus le jour de l'intervention**. Une erreur, un format inconnu ou une base/adresse différente interdit de poursuivre.

7. Après validation du dry-run et dans la même fenêtre autorisée :

```text
node backend/scripts/rotate-mail-encryption-key.mjs --apply --confirm-database solarnext_prod --confirm-active-key mail-2026-09 --batch-size 100 --dry-run-report /CHEMIN_PRIVE/rotation-dry-run-HORODATAGE.json --report /CHEMIN_PRIVE/rotation-apply-HORODATAGE.json
```

8. Exécuter ensuite, dans **un autre processus ne recevant que la nouvelle clé**, la vérification complète :

```text
node backend/scripts/rotate-mail-encryption-key.mjs --verify-active-only --confirm-database solarnext_prod --confirm-active-key mail-2026-09 --report /CHEMIN_PRIVE/rotation-verification-HORODATAGE.json
```

Ce processus ne reçoit ni l'entrée `legacy`, ni `MAIL_ENCRYPTION_LEGACY_KEY_ID`, ni l'ancienne variable `MAIL_ENCRYPTION_KEY`. Vérifier le nombre total, zéro erreur et la lisibilité de toutes les enveloppes non nulles. Une lecture réussie d'un seul compte ne remplace pas ce passage complet.

9. Retirer alors l'ancienne clé des configurations des services actifs, y compris des sauvegardes de configuration de lancement ; relancer uniquement le code compatible V2 avec la nouvelle clé active. Contrôler les parcours mail autorisés sans envoyer de document, mail ou SMS à un vrai client pour tester. Prévoir ensuite une fenêtre distincte de révocation des credentials externes.

## Interruption et retour arrière

Avant toute enveloppe V2 persistée, le code et les données antérieurs restent techniquement restaurables ; la clé exposée conserve néanmoins son statut d'incident. **Dès qu'une enveloppe V2 existe, RC1 ne constitue plus un rollback compatible.**

En cas d'erreur, maintenir les écrivains arrêtés. Les lots déjà validés restent en V2 ; le lot en erreur reste dans son état antérieur. Reprendre avec RC2 compatible et le trousseau temporaire contenant les deux clés. Ne pas rechiffrer sous la clé exposée, restaurer automatiquement l'ancien `.env`, écraser la base courante par un ancien dump ou effacer les lignes migrées.

Un retour applicatif doit conserver le lecteur V2 et la nouvelle clé. Faute de binaire compatible qualifié, garder les opérations mail arrêtées jusqu'au correctif. Les anciennes sauvegardes doivent être restaurées dans une base isolée puis migrées/vérifiées avant toute remise en service ; leur contenu V1 ne doit pas revenir silencieusement dans la base active.

## Accès externes à renouveler séparément

- Le seul compte PASSWORD actuellement enregistré : mot de passe IMAP et mot de passe SMTP s'il est distinct ; mots de passe d'application et sessions persistantes associées. Si le même identifiant est utilisé ailleurs, traiter aussi ces usages après inventaire privé.
- Microsoft : aucun compte OAuth actuel et aucun état PKCE actuel. Inventorier néanmoins les anciens comptes/tokens pouvant figurer dans des sauvegardes ; révoquer les sessions/refresh tokens concernés et reconnecter les comptes selon la procédure du fournisseur. Ne pas affirmer qu'un access token ancien disparaît instantanément du seul fait du changement de clé locale.
- Autres alias de tokens IMAP/SMTP si retrouvés dans les données anciennes : les révoquer auprès de leur émetteur. Les vérificateurs PKCE temporaires ne sont pas des mots de passe à renouveler ; les anciens flux doivent être abandonnés et recommencés.
- Les secrets système non chiffrés par cette clé ne sont pas automatiquement compromis par cette seule exposition ; vérifier une éventuelle réutilisation de credentials ou une exposition distincte avant de décider leur renouvellement.

La rotation cryptographique protège les données courantes avec une nouvelle clé. Elle ne prouve pas que les anciens identifiants n'ont jamais été déchiffrés et ne remplace pas leur révocation externe.
