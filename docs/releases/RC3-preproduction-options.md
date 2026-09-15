# Préproduction future — aucune création ni connexion distante à cette étape

Le VPS de production reste exclu : les quelque 1,98 Gio libres relevés ne permettent pas d'ajouter sereinement base, builds, navigateur PDF et journaux. Aucune ressource, achat, changement DNS/Cloudflare ou opération Vercel n'a été lancé.

## Débloquer Vercel

Métadonnées locales des deux liens Vercel concordantes :

- Projet : **solarnext-crm**, `prj_19C3XtXM2HBSRA0udzKsoeFQBWeN`, racine `frontend`.
- Équipe : `team_M3SAAe88XSyNKf9hkk57wpmz`.
- Identifiant du compte conservé par la CLI locale : `2Zv8qGIsxDdhcH9cN92h48an`. Son adresse et son nom ne sont pas présents dans les métadonnées consultées. Aucun token n'a été affiché.

Le 403 précédent provenait du connecteur. Il ne prouve pas à lui seul que le compte CLI est incorrect ni quel rôle manque. La capacité non vérifiée est l'accès au projet et à sa configuration Preview, y compris les valeurs nécessaires au contrôle privé de destination. Le rôle Developer d'une équipe Pro permet la gestion de Preview ; un Owner peut inviter le compte approprié. Sur Enterprise, des rôles limités au projet sont également possibles. Il n'est pas nécessaire d'accorder un droit de promotion production. [Rôles Vercel](https://vercel.com/docs/rbac/access-roles).

Actions pour Benoit, avant toute livraison :

1. Ouvrir le tableau de bord Vercel avec le compte membre de l'équipe ci-dessus, vérifier le projet et demander à son Owner l'accès s'il n'apparaît pas.
2. Reconnecter le connecteur Vercel dans Codex avec ce même compte et autoriser cette équipe. La connexion du connecteur et celle de la CLI sont distinctes.
3. Si la CLI doit servir ensuite : `vercel login`, puis `vercel whoami` et `vercel teams ls`. Vérifier l'identité et l'équipe ; conserver les liens projet actuels. Ne pas lancer de déploiement, de liaison à un autre projet ou de push. [Connexion CLI](https://vercel.com/docs/cli/login).
4. Autoriser une inspection en lecture seule des paramètres du projet, de la branche de production, des déclenchements Git, des réécritures et de **toutes** les variables Preview effectives : générales, partagées et propres à la branche RC3. Relever les noms/types/cibles seulement dans le rapport.
5. Contrôler les valeurs en mémoire privée : `VITE_API_URL`, proxy, réécritures et autres URL doivent correspondre à une liste explicite de ressources de recette ; aucune URL production, clé production ou fallback production. Ne pas lancer l'application sous ces variables avant validation. Le validateur ne doit produire que nom de variable et verdict, jamais valeur, hash de secret ou connexion complète. Si une valeur sensible est non relisible, la faire remplacer par une valeur de recette explicitement connue et recontrôler ; ne pas conclure « sûr » sur son seul nom.
6. Vérifier qu'un futur push ne peut pas construire une Preview reliée à la production. Tant que ce point ou la rotation coordonnée de la clé exposée n'est pas traité, **publication interdite**. Seul le SHA candidat exact pourra ensuite être construit en Preview ; jamais `--prod` ni promotion.

## Deux architectures chiffrées à approuver

Prix de catalogue affichés au moment de la consultation, **à partir de**, à confirmer pour durée d'engagement, région et disponibilité dans le récapitulatif avant achat. Aucun panier n'a été créé. Ce ne sont pas des tarifs garantis sans engagement.

| Proposition | Ressources proposées | Infrastructure hors Vercel |
| --- | --- | --- |
| Temporaire, une recette à la fois | Un VPS-2 distinct : 4 vCPU, 8 Go RAM, 75 Go NVMe. Base PostgreSQL 14.24 locale à ce VPS, API et rendu PDF limités à un worker. Builds préparés localement depuis le SHA. | À partir de **7,21 € HT / 8,65 € TTC par mois** ; prévoir un mois entier, pas de prorata supposé. |
| Durable, application et base séparées | VPS-3 application : 6 vCPU, 12 Go RAM, 100 Go NVMe ; VPS-1 PostgreSQL : 2 vCPU, 4 Go RAM, 40 Go NVMe. Liaison privée chiffrée entre les deux ; aucune ouverture PostgreSQL publique. | 10,40 + 3,81 = **14,21 € HT / 17,05 € TTC par mois** au tarif d'entrée affiché. |

Ces offres annoncent une sauvegarde automatisée incluse. Sa rétention et les options hors site sont à valider avant commande ; aucune option payante supplémentaire n'est incluse dans les montants. [Catalogue officiel OVHcloud](https://www.ovhcloud.com/fr/vps/).

Dans les deux cas, frontend sur un projet Vercel séparé, construit comme Preview du SHA RC3. Si un abonnement Pro existant et ses quotas couvrent ce projet, coût fixe supplémentaire Vercel estimé à zéro ; cette éligibilité reste non vérifiée. Sinon, ajouter **20 USD/mois pour Pro avec un siège**, plus éventuels dépassements et taxes, sans conversion EUR inventée. Un siège Developer supplémentaire peut aussi être facturé 20 USD/mois. Le plan Hobby est réservé à l'usage personnel non commercial : il n'est pas retenu pour ce CRM. [Tarifs Vercel](https://vercel.com/pricing), [conditions Hobby](https://vercel.com/docs/plans/hobby).

Isolation commune : utilisateur système `solarnext-preprod` sans accès aux secrets production ; répertoire `/srv/solarnext-preprod/releases/<SHA>`, processus et journaux dédiés, API sur port privé 4128 derrière TLS/authentification, rôle PostgreSQL limité à `solarnext_preprod`, stockage et caches sous `/srv/solarnext-preprod/data`. Aucun montage de production, aucun rôle partagé, aucune copie de base réelle. Secrets fictifs, fixtures métier fictives et météo locale. SMTP/IMAP/OAuth/Enedis/SMS/webhooks et workers sortants arrêtés ; réseau sortant interdit sauf opérations d'administration expressément approuvées. La configuration applicative seule ne suffit pas : le filtrage réseau doit rendre la production inaccessible.

La solution temporaire partage application et base entre processus de recette ; la solution durable les sépare sur deux machines. Les deux restent entièrement séparées de la production. Des plafonds de taille pour les logs, caches et PDF, une purge des fixtures, une surveillance disque et une sauvegarde restaurable sont requis.

## Autorisations encore nécessaires

- Connexion au bon compte Vercel et audit privé Preview en lecture seule.
- Budget fournisseur exact, durée/région, éventuel siège Vercel ; puis création des serveurs et du projet isolé. Aucun coût supplémentaire n'est approuvé implicitement.
- Adresse TLS/DNS et éventuelle configuration Cloudflare, ainsi que l'accès réseau de recette.
- Récupération de la migration historique manquante et approbation distincte de toute réconciliation sur production, après nouvelle répétition concluante.
- Séquence mail coordonnée approuvée séparément : lecteur V2 → génération privée de nouvelle clé → rotation contrôlée → renouvellement SMTP/IMAP et révocations OAuth pertinentes → vérification → retrait de l'ancienne clé. Rien de cette séquence n'est effectué ici.

Retour arrière futur : mettre la recette en maintenance, arrêter API/worker, revenir ensemble aux artefacts backend/frontend/PDF du SHA précédemment qualifié et à leurs variables de recette, vérifier santé et export avant réouverture. Ne pas descendre automatiquement les migrations ni restaurer isolément une base qui contiendrait des écritures plus récentes. Après une rotation V2, tout backend de repli doit savoir lire V2 et conserver les clés encore requises ; revenir à un lecteur V1 seul serait incorrect.
