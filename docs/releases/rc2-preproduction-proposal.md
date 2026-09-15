# RC2 — préproduction proposée, non activée

Aucune ressource, variable distante, règle réseau, entrée DNS, publication Git ou Preview n'a été créée ou modifiée. Cette proposition attend l'autorisation de sa mise en place.

## Faisabilité constatée

Le VPS existant expose 2 vCPU, environ 3,82 Gio de RAM dont 1,76 Gio disponibles à l'instant de lecture, et seulement **1,98 Gio de disque disponibles** sur environ 58 Gio. La charge processeur est faible à cet instant ; cela ne mesure pas la pointe d'un rendu Chromium/PDF. La place disponible ne permet pas de qualifier sereinement des releases séparées, PostgreSQL, le stockage, Chromium et leurs journaux. Aucune suppression n'a été faite. Un plan de capacité et, selon le choix retenu, un nettoyage approuvé ou une extension sont nécessaires avant création.

Réutiliser le VPS et PostgreSQL libre pourrait ne pas ajouter de coût d'abonnement si une capacité suffisante est libérée et mesurée. **Le coût supplémentaire nul n'est pas établi.** Une extension du VPS ou un service distinct doit faire l'objet d'un devis/accord. L'accès au projet Vercel renvoie `403 Forbidden` ; ni le quota, ni la facturation, ni les variables Preview ne sont vérifiés. Aucun prix ou avantage de forfait n'est supposé.

## Architecture à créer après validation

Les noms et ports suivants sont proposés, pas des ressources existantes ou des disponibilités vérifiées.

| Élément | Isolation proposée |
|---|---|
| Frontend | Projet Vercel séparé de préférence, déploiement **Preview** depuis le SHA exact RC2 ; jamais `--prod`, jamais de promotion. Accès restreint à l'équipe de validation. |
| Backend | Service `solarnext-preprod-rc2`, utilisateur système `solarnext-preprod` sans sudo, processus indépendant, écoute locale proposée `127.0.0.1:4127`, répertoire `/srv/solarnext-preprod/releases/<SHA>`, lien `current` distinct. Ne pas reprendre PM2, le compte système ou le `.env` de production. |
| API publique de test | URL HTTPS dédiée à autoriser et configurer, pointant exclusivement vers ce processus. Domaine, certificat et éventuelle règle reverse proxy/DNS/Cloudflare à valider séparément. Aucun chemin qui redirige vers l'API de production. |
| PostgreSQL | Cluster PostgreSQL **14.24** séparé, port proposé `55437`, répertoire de données dédié. Base `solarnext_preprod_rc2`, rôle applicatif limité sans superuser, création de rôle/base ou accès interbase ; rôle de migration distinct limité à cette base. Le cluster de production doit refuser toute connexion depuis ce service. |
| Stockage | `/srv/solarnext-preprod/storage`, fichiers et répertoires temporaires/PDF séparés ; aucune liaison ou montage vers les documents de production. Droits limités à l'utilisateur de préproduction. |
| Caches et journaux | Cache mémoire ou répertoire propre ; aucun Redis partagé. Journaux `/var/log/solarnext-preprod/`, rotation et quotas propres. Pas de journalisation de credentials. |
| Limites de ressources | Budget CPU/RAM/processus/stockage à fixer après mesure ; un rendu PDF à la fois au départ. Limites systemd/cgroup et journalisation bornée pour préserver les services existants. |
| Données et secrets | Fixtures intégralement fictives, clés locales de test distinctes, JWT distinct ; aucune copie des credentials, lignes métier, pièces jointes ou sauvegardes de production. Métadonnées de migrations seules autorisées pour le test d'historique. |

Les numéros de port proposés doivent être vérifiés avant création. L'absence d'accès en écriture à la production doit être imposée par les droits PostgreSQL, l'utilisateur système et le réseau, pas seulement par une variable déclarative.

## Intégrations et configuration

Produire une liste explicite de variables depuis les lecteurs du SHA candidat. Le fichier de préproduction ne doit pas être une copie du fichier de production. Valider le schéma des URLs, hôtes, bases et chemins ; refuser toute cible inconnue ou de production, y compris les valeurs de repli du code.

SMTP, IMAP, OAuth Microsoft, Enedis, SMS et webhooks doivent être désactivés aux points d'entrée et dans les workers ; fournir des fixtures pour les parcours qui en ont besoin. Ne pas considérer les seuls drapeaux des workers comme un coupe-circuit universel. Prévoir un refus réseau des connexions sortantes non autorisées depuis le service, avec accès à sa seule base et à son renderer. Les données météo/PVGIS et autres dépendances réseau nécessaires aux calculs doivent être fournies localement ou explicitement autorisées comme lectures publiques après revue. Aucune action de qualification ne doit contacter un compte mail réel ou un client.

Avant activation, contrôler en pratique le refus des sorties, la séparation du stockage, l'absence de droit du rôle de test sur la base réelle et l'absence de secrets de production dans l'environnement effectif. Les réglages de confinement et le fichier d'environnement seront préparés pour revue avant leur installation distante.

## Barrière avant push

Le workflow GitHub du dépôt observé ne déploie que sur `main`. **Cela ne démontre pas qu'une branche RC2 est sans risque** : l'intégration Git propre à Vercel peut créer automatiquement une Preview. L'API du projet Vercel retourne 403 ; les variables Preview, leurs portées et les déclencheurs restent inconnus.

Il faut obtenir l'accès en lecture au bon projet/équipe, inspecter les déclencheurs et les variables effectives, puis faire approuver les éventuelles modifications : désactivation des Previews sur le projet de production pour cette branche ou utilisation d'un projet séparé sans héritage. Vérifier qu'aucune variable Preview ni valeur de repli du frontend ne pointe vers l'API de production. **En attendant, aucun push n'est autorisé ni sûr à confirmer.** Aucun contournement du 403 et aucun push « pour tester ».

## Construction, qualification et retour arrière coordonné

Après ces autorisations et après résolution de la quatrième migration : construire backend, frontend, fichiers partagés, moteurs et assets PDF depuis un seul SHA candidat. Capturer SHA source, lockfiles, versions Node/PostgreSQL, variables non sensibles et empreintes des artefacts. Le build local de cette étape contient une API localhost et des valeurs de test : il ne constitue pas un bundle à livrer tel quel.

Sur la préproduction isolée, rejouer la base vierge et l'historique de production avec la réconciliation approuvée, puis le parcours devis/sauvegarde/péremption/refus d'export/recalcul/quatre scénarios/sélection/PDF 25 et 30 ans/historique. Vérifier les scripts réellement servis, les graphiques négatifs, les données de consommation, Urban TTC daté, OA/BV, les heures creuses manquantes et l'ombrage incomplet. Michel et les deux scénarios 8 kWc ne reçoivent aucune exception. Contrôler les journaux et les destinations réseau effectives.

Retour arrière : fermer l'accès à la Preview et arrêter le seul backend de préproduction ; conserver logs et reçus. Rétablir ensemble le frontend et le backend d'un même SHA antérieur **compatible avec le format de chiffrement déjà écrit**. Ne pas associer un frontend ancien à un backend nouveau pour poursuivre les tests. Ne pas restaurer automatiquement une base ou une clé ancienne. À défaut de version compatible qualifiée, maintenir la préproduction arrêtée. Aucun rollback de cette préproduction ne touche aux services, à la base ou aux fichiers de production.
