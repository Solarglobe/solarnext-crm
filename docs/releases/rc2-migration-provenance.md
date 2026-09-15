# RC2 — provenance des quatre divergences

État du 15 septembre 2026 : trois versions de référence retrouvées et restaurées localement ; quatrième provenance non résolue, garde bloquante conservée. Aucune modification du schéma ou des métadonnées de production. Aucune nouvelle migration de schéma ajoutée dans RC2.

## Méthode et limites de preuve

Les lectures SQL utilisent `default_transaction_read_only=on`, une transaction `REPEATABLE READ READ ONLY`, des délais de requête/verrou de 15 s/1 s, et se terminent par ROLLBACK. Aucun runner applicatif ou de migrations n'a été lancé en production. Seuls catalogues, agrégats et métadonnées de migration ont été récupérés.

L'inventaire préserve exactement 215 entrées ordonnées de `pgmigrations` et 145 références de `migration_checksums` dans `backend/tests/fixtures/migrations/production-history-2026-09-15.json`. Ce fichier ne contient aucune ligne métier, donnée client ou valeur chiffrée mail.

Recherche des quatre fichiers dans le backend courant, les releases et sauvegardes connues du VPS, six archives de code, les objets Git locaux et les objets Git du backend : 192 copies de fichiers, soit 48 par migration, plus 12 versions supplémentaires issues du Git distant. Les copies de releases accessibles ne correspondent pas aux anciennes références. Trois manifestes de déploiement ne donnent pas de SHA exploitable. Les journaux examinés ne fournissent pas de preuve d'exécution : journal d'erreurs complet de 928 octets et derniers 5 Mo du journal de sortie de 408 Mo. Cette recherche est bornée aux répertoires, archives et journaux accessibles ; elle ne prouve pas qu'aucune autre sauvegarde n'existe.

Pour les trois premières migrations, le Git local **et** le Git du backend contiennent une version dont l'empreinte normalisée correspond exactement à celle enregistrée. Source restaurée : `7bb281c9a89dc8168be2f2d7c21aa7102f5efa52`, également présente dans `e4058ebbb1b3d5f58757d92f08e3b238a77296ec`. Les octets bruts ne correspondent pas à l'ancienne empreinte brute. La normalisation historique retire commentaires, lignes vides et variations de fins de ligne. On retrouve donc le **contenu de référence normalisé**, sans prétendre retrouver l'artefact exécuté octet pour octet ni disposer d'un journal indépendant prouvant chaque instruction exécutée.

## Références enregistrées

Les valeurs ci-dessous sont des empreintes de fichiers de migration publics, jamais des empreintes de secrets.

| Migration | Empreinte brute enregistrée | Empreinte normalisée enregistrée |
|---|---|---|
| `1775930001000_reconcile_mail_fulltext_migration_checksum` | `9d8dda4c9cb2e9f03aa90690f9d4395d26de96776e112aafecad7d26cdcf3123` | `9bc6c9e04338e02da0de06f2a4399237f80f7a81186a1653329896db6ce385ec` |
| `1775930002000_sync_mail_fulltext_migration_checksum_refs` | `572b004c2530b19fb31db30b5edc627570d33aa8c89ce9e1f65f8a815484297e` | `1aeaf66a5f77a6a2a270ea7e327e492b1c44332f9d3dadcbcce54f60055218c2` |
| `1776300001000_sync_leads_assigned_user_source_normalize_checksum` | `b57be811ba3320dbd4eae98ac0a9c8402285f9bda4c228d89c055dff2a7d19af` | `3d612274fc311703dd0a509f947f9df8f33d41f08afc76fecd9b1561f60bbd45` |
| `1776600000000_lead_sources_acquisition_canonical` | `ddb257c4c0810f4c7b61bb05827d4dbacd104bfc96db7c53431a9a3932736959` | `be9e86615c6334ed907795a77f8e6ea6081df755b3df9990a87dba57ed32468e` |

## Analyse par migration

1. **1775930001000**, entrée appliquée n° 138, 15 avril 2026 à 22:38:45 UTC. Le contenu de référence inscrit ou met à jour uniquement la référence de `1775930000000_mail_messages_fulltext_search`. Il ne crée pas de colonne ou d'index. La référence ciblée existe ; l'index GIN `idx_mail_messages_search_vector` existe dans le schéma actuel, comme effet de la migration source distincte. La version RC1/courante du VPS ajoute cinq lignes de sortie anticipée lorsque `migration_checksums` est absente. RC2 restaure le contenu Git de référence, sans rejouer cette migration déjà appliquée.

2. **1775930002000**, entrée n° 139, 15 avril 2026 à 22:41:27 UTC. Le contenu de référence synchronise les références de `1775930000000_mail_messages_fulltext_search` et `1775930001000_reconcile_mail_fulltext_migration_checksum`. Aucun effet métier ou DDL propre. Les références ciblées sont présentes. Même divergence de cinq lignes de sortie anticipée dans RC1 ; même restauration locale depuis le Git de référence, sans modification de la table réelle.

3. **1776300001000**, entrée n° 175, 16 avril 2026 à 09:52:28 UTC. Le contenu de référence synchronise uniquement la référence de `1776300000000_leads_assigned_user_source_normalize`, présente dans les métadonnées. Aucun DDL ni normalisation de leads par cette migration de checksum elle-même. Même ajout tardif de cinq lignes dans RC1 ; contenu normalisé d'origine restauré localement.

4. **1776600000000**, entrée n° 182, 21 avril 2026 à 10:25:11 UTC. **Aucune variante retrouvée ne correspond à la référence enregistrée.** Le fichier Git courant, inchangé dans RC2, ajoute `slug varchar(64)` et `sort_order integer`, normalise les sources, repointe les leads, fusionne/supprime des doublons, complète un catalogue de 15 slugs et remplace l'unicité `(organization_id, name)` par `(organization_id, slug)`. Entre les versions Git connues, les deux `min(id)` ont été corrigés en `min(id::text)::uuid`. Cette différence technique connue n'explique pas la référence normalisée manquante. L'effet exact du backfill historiquement exécuté demeure impossible à reconstituer avec certitude à partir du seul état final.

Le schéma réel de la quatrième présente `slug varchar(64) NOT NULL`, `sort_order integer NOT NULL DEFAULT 99`, la clé primaire UUID, la FK d'organisation validée et l'index unique `(organization_id, slug)`. L'audit compte 14 slugs canoniques, zéro slug inconnu, zéro NULL, zéro doublon, zéro source absente référencée par un lead et zéro lien entre organisations différentes. Aucun `retour_flyer` ne subsiste ; les ordres sont entre 1 et 14. **Le passage de 15 à 14 est cohérent avec la migration ultérieure appliquée `1776700000000_lead_sources_drop_retour_flyer`.** Le défaut 99 vient de `1781900000000_ci_schema_defaults_and_financial_lead_links`. Ces évolutions ultérieures expliquent l'état actuel ; elles ne reconstituent pas le fichier exécuté le 21 avril.

## Corrections du runner

L'ancien démarrage pouvait exécuter les migrations en attente avant de vérifier les empreintes. Le nouveau contrôle est intégralement en lecture avant le bootstrap ou le runner. Une divergence substantielle bloque dans tous les environnements. La variable `MIGRATION_AUTO_REPAIR_CHECKSUMS` n'active plus rien : si elle est renseignée, l'exécution est refusée.

Les trois migrations de référence restaurées attendent une table de checksums existante. Le runner explicite crée cette table uniquement sur une base sans historique appliqué et sans table de checksums. Il inscrit ensuite uniquement les références des migrations nouvellement appliquées par cette exécution. Les 69 migrations appliquées sans référence enregistrée et l'entrée appliquée dont le fichier manque (`1788900000000_add_long_term_follow_up_stage`) restent signalées, sans ajout, suppression ou réparation silencieuse. RC2 n'importe pas cette fonctionnalité étrangère au lot.

Sur la copie locale exacte des métadonnées de production, la quatrième divergence est refusée **avant** la seule migration V21 en attente, `1790400200000_monthly_consumption_meter_scope`. Les deux migrations de tarifs V21 sont déjà appliquées en production. Les trois fichiers restaurés ne doivent donc pas être rejoués sur cette base.

## Réconciliation proposée pour la quatrième — non exécutée, à approuver

1. Demander en priorité un artefact de la release du 21 avril 2026 ou une sauvegarde de code antérieure aux corrections connues. Comparer son contenu sans exposer d'autres fichiers ou secrets. Une correspondance normalisée permettrait une restauration sourcée ; conserver la distinction avec une correspondance brute.
2. Si l'artefact reste introuvable, faire approuver explicitement une **réconciliation fondée sur l'état constaté**, avec perte de preuve historique déclarée pour ce seul fichier. Joindre la référence enregistrée inchangée, le fichier Git courant, les contrôles de colonnes/index/FK, les agrégats et les migrations ultérieures expliquant les 14 slugs et le défaut 99.
3. Préparer alors une opération unique et revue, ciblée sur le nom complet de cette migration et les références attendues : sauvegarde des métadonnées, assertions du schéma et des invariants métier, arrêt si la moindre assertion diffère, justification datée et preuve avant/après. Aucun mécanisme générique « accepter toutes les empreintes ». Tout remplacement explicite d'une référence existante, ou mécanisme d'exception documentée équivalent, nécessite une validation distincte du code et du SQL exacts **avant exécution**. Aucun outil permettant cette action n'est ajouté ou exécuté dans RC2.
4. Si un écart métier ou structurel apparaît, produire une migration corrective nouvelle et additive, avec le plan de données à valider. Ne pas rejouer la fusion/suppression historique sur les données présentes. Ne pas supprimer l'entrée `pgmigrations`, inventer un fichier correspondant à un hash, ou retoucher silencieusement l'historique.
5. Rejouer ensuite les contrôles sur la copie locale et une préproduction PostgreSQL 14 qualifiée avant toute demande de production. Les anciens scripts de réconciliation présents dans le dépôt ne sont pas qualifiés pour cette opération et ne doivent pas être lancés avec une option d'écriture.

## Qualification et retour arrière

Une base PostgreSQL locale vierge exécute les 215 fichiers présents et possède 215 références vérifiées. Une seconde base reproduit exactement les 215 entrées et 145 références de production ainsi que l'absence de la contrainte V21 en attente : les essais du contrôle, du CLI et du démarrage y refusent la quatrième divergence et préservent les métadonnées et la contrainte absente. Ces tests ne sont pas un clone de toutes les données et de tout le schéma métier de production.

La qualification locale utilise PostgreSQL 17.11 ; la production utilise PostgreSQL 14.24. Le test sur cette version cible reste un prérequis de préproduction. Aucune migration de production n'est appliquée ou annulée dans cette étape. Un retour de code RC2 vers RC1 ne doit jamais être utilisé après écriture d'enveloppes mail V2 ; voir le plan de rotation. Aucune commande `down` n'est prévue pour les migrations historiques.
