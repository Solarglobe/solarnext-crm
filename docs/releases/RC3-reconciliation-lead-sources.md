# Proposition de réconciliation — autorisation préalable obligatoire

Cette procédure n'a été exécutée que sur PostgreSQL **14.24 local**, avec des organisations et leads fictifs. Elle n'est appelée ni au démarrage, ni par le runner. Aucun fichier de migration historique n'est modifié. RC1 et RC2 restent immuables.

## Provenance et limites

La recherche antérieure dans les artefacts du backend et les anciennes releases n'avait retrouvé aucune version correspondant à la référence. Cette étape réutilise ses preuves en lecture seule ; aucune connexion au VPS n'a été renouvelée. Recherche locale supplémentaire : 92 028 fichiers, 10 archives, 4 versions Git, aucun résultat exact. Le script et les origines examinées sont dans le dossier de preuves RC3.

Migration concernée exclusivement : `1776600000000_lead_sources_acquisition_canonical`.

| Référence | SHA-256 du code de migration (aucun secret mail) |
| --- | --- |
| Ancienne empreinte brute enregistrée | `ddb257c4c0810f4c7b61bb05827d4dbacd104bfc96db7c53431a9a3932736959` |
| Ancienne empreinte normalisée enregistrée | `be9e86615c6334ed907795a77f8e6ea6081df755b3df9990a87dba57ed32468e` |
| Version Git actuelle normalisée | `ebeb92491bb5658564a28affdc537f959e2c8b67ef8d50e620bacadaaca1705a` |

L'empreinte brute de destination est calculée sur le fichier du candidat effectivement installé ; sa version normalisée est fixée dans le code. Ce n'est pas une preuve que ce fichier a été exécuté autrefois. C'est une proposition explicite d'accepter sa sémantique au vu de l'état constaté, sans rejouer ses fusions/suppressions de données.

État observé : 14 sources canoniques, aucune source `retour_flyer`, aucune référence inter-organisation. Le retrait de `retour_flyer` est expliqué par `1776700000000_lead_sources_drop_retour_flyer`; le défaut 99 de `sort_order` par `1781900000000_ci_schema_defaults_and_financial_lead_links`.

La fixture recopie exactement les 215 lignes de `pgmigrations` et les 145 références capturées, sans données clients. Le schéma local est construit par les migrations puis ajusté pour les différences observées (contrainte/index de propriété compteur absents). Il **ne s'agit pas d'un dump intégral de production**. La précision `varchar(150)` du nom, les définitions complètes des fonctions/triggers et des métadonnées n'étaient pas toutes présentes dans le relevé distant : le contrat strict inclut la version issue du code. Ces points restent à confirmer par un futur dry-run autorisé, qui refusera toute différence. Aucun blanc n'est traité comme une équivalence acquise.

## Contrôles avant toute modification

- Historique complet et ordre des 215 lignes identiques à la capture ; 145 références identiques, à l'exception de la seule substitution autorisée lors du postcontrôle.
- Ancienne paire d'empreintes et nom complet exacts, PostgreSQL 14.24, base explicitement confirmée.
- Colonnes, types, nullabilité, défauts, contraintes et validation, index et validité, triggers actifs, fonctions : égalité avec `leadSourcesExpectedSchema.json`.
- Tables ordinaires, sans RLS, règles de réécriture ou trigger utilisateur sur les métadonnées ; contrôle des références entrantes aux tables de migrations.
- Catalogue complet de 14 noms/slugs/ordres par organisation ; aucune source manquante, supplémentaire, dupliquée ou sans organisation ; chaque lead pointe vers une source de sa propre organisation.
- Nouveau fichier toujours conforme à l'empreinte normalisée approuvée.

Les lectures prennent les verrous PostgreSQL `AccessShare` habituels. Le seul verrou explicite de ligne est `FOR UPDATE NOWAIT` sur la référence visée. Aucun `LOCK TABLE`, verrou global ou advisory lock. Les écrivains applicatifs doivent être arrêtés lors de la future opération : une transaction SERIALIZABLE de maintenance ne remplace pas cette précaution face à des écrivains ordinaires concurrents.

## Séquence à valider, non exécutée à distance

1. Autoriser séparément un relevé complémentaire en lecture seule et l'acceptation sémantique de cette migration. Résoudre d'abord le fichier historique manquant décrit ci-dessous. Vérifier une sauvegarde/restauration et réserver une fenêtre de maintenance.
2. Installer le **même SHA candidat** dans un répertoire d'opérations, sans démarrer l'application. Conserver tous les fichiers requis, y compris la fixture d'historique utilisée comme contrat. Préparer un répertoire de reçus privé (0700 Linux), sauvegardé hors du serveur. Fournir `MIGRATION_RECONCILIATION_DATABASE_URL` par environnement privé, jamais dans une ligne de commande, un rapport ou `.env` commité. Aucun héritage de `DATABASE_URL` n'est utilisé par cet outil.
3. Exécuter le dry-run ci-dessous. Examiner le rapport privé ; un seul écart implique arrêt. Ne jamais modifier un checksum pour obtenir un dry-run vert.
4. Après approbation explicite : arrêter les écrivains et workers, refaire un dry-run de moins d'une heure, puis exécuter `--apply`. Le reçu PREPARED sauvegarde la ligne précédente complète et la destination avant l'UPDATE, avec `fsync`. Accès fichier 0600/POSIX, ACL privée sous Windows ; pas d'écrasement d'un reçu existant.
5. Reconnecter et exécuter `--verify` avec le reçu. Les métadonnées autres que la référence doivent rester exactement identiques. Sauvegarder aussi le rapport de vérification. **Ce postcontrôle doit précéder toute migration supplémentaire**, car il exige encore l'historique de départ exact.
6. Une fois toutes les autres gardes résolues et approuvées, seulement alors envisager la migration en attente et le démarrage coordonné du candidat. Cette étape ne l'autorise pas.

Exemples de commandes futurs, depuis `backend/`, après injection privée de la connexion :

```sh
node scripts/reconcile-lead-sources-checksum.mjs --confirm-database solarnext_prod --confirm-migration 1776600000000_lead_sources_acquisition_canonical --report /chemin-prive/dry-01.json

node scripts/reconcile-lead-sources-checksum.mjs --apply --confirm-writers-stopped --confirm-database solarnext_prod --confirm-migration 1776600000000_lead_sources_acquisition_canonical --preflight /chemin-prive/dry-01.json --receipt /chemin-prive/receipt-01.json

node scripts/reconcile-lead-sources-checksum.mjs --verify --confirm-database solarnext_prod --confirm-migration 1776600000000_lead_sources_acquisition_canonical --receipt /chemin-prive/receipt-01.json --report /chemin-prive/verify-01.json
```

Le fichier `RC3-reconciliation-statements.sql` contient le SQL exact exporté du service, avec paramètres. Il sert à la revue ; ne pas l'exécuter comme script indépendant, car les comparaisons et la sauvegarde du reçu sont effectuées par le programme.

## Interruption et retour arrière

- Avant COMMIT : interruption ou erreur entraîne ROLLBACK ; aucune ancienne donnée n'est perdue. Conserver le reçu éventuel, refaire un dry-run et utiliser un **nouveau** nom de reçu pour reprendre.
- Après COMMIT ou accusé de réception perdu : reconnecter avec `--verify` et le reçu PREPARED. Si l'empreinte est nouvelle et tous les contrôles passent, l'application a réussi. Ne pas rejouer `--apply` ; il refuse une référence déjà changée.
- Si l'empreinte reste ancienne : le dry-run confirme l'absence d'application et une nouvelle tentative peut être approuvée. Si elle n'est ni l'ancienne ni la nouvelle, arrêt et investigation.
- Retour ciblé de l'empreinte : uniquement après approbation, écrivains arrêtés, même contrôle de schéma/historique et comparaison CAS de la paire nouvelle ; restaurer les deux valeurs exactes du reçu, sans toucher `created_at`, `pgmigrations` ni les autres références. Cette restauration réactive volontairement le blocage d'intégrité. Elle n'annule aucune migration de schéma et n'autorise aucun redémarrage qui ignorerait la garde.

SQL de l'unique retour proposé (paramètres alimentés depuis le reçu vérifié, transaction + verrou ciblé + contrôle de cardinalité 1 obligatoires) :

```sql
UPDATE public.migration_checksums
SET checksum=$2, checksum_normalized=$3
WHERE migration_name=$1 AND checksum=$4 AND checksum_normalized=$5
RETURNING migration_name, checksum, checksum_normalized;
```

## Blocage supplémentaire découvert sur la reproduction

Après application locale de la proposition et postcontrôle réussi, le runner réel refuse `checkOrder` : le fichier appliqué `1788900000000_add_long_term_follow_up_stage` manque. Les deux migrations tarifaires RC1 sont pourtant présentes dans l'historique ; la seule réellement en attente est `1790400200000_monthly_consumption_meter_scope`. L'absence du fichier ancien désaligne le contrôle d'ordre positionnel de node-pg-migrate.

La recherche Git locale sur ce nom n'a retourné aucune version. La migration en attente n'a pas été appliquée sur ce clone. Aucun `checkOrder=false`, aucune ligne supprimée, aucun faux fichier ou checksum ajouté. Il faut retrouver le fichier exécuté et sa provenance, puis qualifier à nouveau ce parcours, ou soumettre une procédure distincte strictement documentée à validation. **NO-GO pour le chemin réel de migration**, même si la réconciliation ciblée passe.
