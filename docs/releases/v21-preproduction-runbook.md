# Release V21 / finance 2.2.1 — préproduction et retour arrière

## État au 15 septembre 2026

**Release autorisée pour qualification technique ; déploiement en préproduction arrêté faute de cible isolée vérifiée. Aucun déploiement ni migration distante n'a été effectué. Production : NO-GO en attendant cette qualification.**

L'audit en lecture seule de l'hébergement connu a constaté :

- Sur le VPS, seules les bases PostgreSQL non modèles `postgres` et `solarnext_prod` existent. Le catalogue a été interrogé avec `default_transaction_read_only=on`.
- La configuration nginx activée expose uniquement l'API de production, vers le port local 3000. La sauvegarde PM2 décrit uniquement `solarnext-api`. Aucun service ni stockage de préproduction n'a été identifié.
- Les liens Vercel locaux désignent le projet de production. Le connecteur et l'API authentifiée refusent la lecture du projet avec HTTP 403 ; les variables Preview restent invérifiables. Les exports de variables frontend disponibles ciblent l'API de production.
- La CLI Railway est liée à l'environnement `production`.

Ces observations ne prouvent pas qu'aucune autre infrastructure n'existe. Elles signifient qu'aucune cible disponible ne permet actuellement de satisfaire les conditions de déploiement. Une Preview frontend seule reliée à l'API de production ne constitue pas une préproduction isolée.

Ne pas utiliser `.github/workflows/deploy.yml` pour cette qualification : son étape Preview peut être suivie d'un déploiement VPS puis Vercel en production. Ne pas réutiliser `infrastructure/scripts/deploy.sh` avec ses valeurs par défaut ni `backend/ecosystem.config.cjs` : ils désignent le service et les chemins de production. Un autre nom de branche ou la seule variable `PM2_SERVICE_NAME` ne suffit pas à les isoler.

## Identité obligatoire de la release

Le candidat est identifié par le tag local `SmartPitch-V21-finance-2.2.1-rc1`. Résoudre ce tag en SHA complet avant toute construction, puis utiliser exclusivement ce SHA pour backend, frontend, fichiers partagés et moteurs PDF. Le tag et la branche restent locaux tant que les conditions de publication ne sont pas remplies.

**Blocage préalable de publication :** la clé de chiffrement retirée de `infrastructure/docs/restore.md` est déjà dans l'historique distant et correspond encore à la configuration de production. Le renouvellement contrôlé de `MAIL_ENCRYPTION_KEY`, avec conservation et ré-enchiffrement des données protégées, nécessite l'accord explicite de l'opérateur. Ne pas publier ce candidat ni réutiliser cette clé en préproduction avant résolution de ce blocage. Aucun accès SMTP/IMAP ou OAuth ne doit être copié vers la recette.

| Composant | Identité à contrôler |
|---|---|
| Calcul photovoltaïque | `SmartPitch V-LIGHT V21-dated-tariffs-oa-input-dependencies` |
| Moteur financier | `2.2.1` |
| Backend | SHA Git complet de la release, installation depuis ce commit |
| Frontend | Même SHA Git complet, construction avec les variables propres à la préproduction |
| Assets PDF et fichiers partagés | Ceux du même commit et de la même construction frontend |

Le numéro `1.0.0` historique du paquet backend n'identifie pas cette release. Le frontend ne possède pas de version de paquet utilisable comme preuve de livraison : le SHA, les identifiants de déploiement et le manifeste d'artefacts sont nécessaires.

Consigner avant publication : branche, SHA complet, liste exacte des fichiers du lot, diff relu, résultat des tests, version Node cible, empreinte des artefacts backend et frontend, identifiants des ressources, URLs API/frontend/renderer, migrations prévues et paire précédente de retour. Aucun fichier privé d'environnement, document client, cache, export local ou bundle de qualification construit avec une clé factice ne doit entrer dans l'archive.

Hygiène indispensable du paquet : un littéral de clé de chiffrement préexistant dans `infrastructure/docs/restore.md` est remplacé par une référence au gestionnaire de secrets du service restauré. Seule cette ligne est modifiée dans ce document. La clé n'est pas réémise ici, aucun credential distant n'est modifié et l'historique Git n'est pas purgé. La présence passée de ce secret doit être traitée séparément par le responsable de ses accès ; l'absence dans le snapshot livré ne constitue pas une révocation.

## Ressources et configuration à fournir

| Élément | Exigence et preuve avant lancement |
|---|---|
| Backend | Instance ou isolation système explicite, utilisateur et service dédiés, répertoire de release et journaux séparés. Le compte d'exécution et celui de déploiement ne doivent pouvoir écrire ni dans l'application, ni dans les documents, ni dans la base de production. |
| PostgreSQL | Base distincte avec rôle dédié et connexion vérifiée. Contrôler les droits, l'instance, la base et le schéma réellement résolus ; aucun droit d'écriture dans la base de production. |
| Stockage | Volume/répertoire ou bucket dédié, credentials limités à cette ressource, caches séparés et sauvegarde propre. Aucun montage du stockage de production. |
| API | Domaine HTTPS distinct, proxy vers le service dédié, accès restreint aux opérateurs de recette et CORS limité aux origines nécessaires. |
| Frontend | Projet et domaine de préproduction identifiés ; droits de lecture des variables et déploiements rétablis. La configuration construite doit appeler uniquement l'API de préproduction. |
| Renderer PDF | URL de ce frontend, incluant ses scripts et assets ; autorisation du renderer si la Preview est protégée. Ne jamais utiliser le renderer de production comme solution de secours. |
| Comptes et données | Comptes fictifs ; jeu neuf ou anonymisation attestée avant chargement. Supprimer les coordonnées réelles, PRM/PDL, tokens, comptes mail et documents privés des fixtures. Un clone brut de production est interdit. |
| Communications sortantes | Aucun SMTP/IMAP client ni clé SMS réelle. Collecteur de mails de test ou absence de SMTP, workers désactivés et contrôle des sorties réseau permettant de prouver qu'aucun vrai client ne peut être contacté. |

Le service doit recevoir ses propres variables par le mécanisme privé de l'hébergeur. Ne pas recopier les fichiers d'environnement de production. Les chargeurs du dépôt peuvent compléter des variables absentes depuis un fichier local : une injection partielle dans une copie du répertoire de production n'est pas une isolation sûre.

Inventaire à valider sans imprimer les valeurs secrètes :

- Connexion : `DATABASE_URL`, et tous les `DB_HOST`, `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` ou autres paramètres PostgreSQL effectivement présents. Dans la configuration actuelle, `DB_HOST` puis `PGHOST` peuvent remplacer l'hôte de l'URL ; vérifier la connexion résolue, pas seulement le texte de `DATABASE_URL`.
- API : `NODE_ENV` selon le mode supporté, `PORT`, `JWT_SECRET`, `MAIL_ENCRYPTION_KEY`, `RBAC_ENFORCE`, `TRUST_PROXY` si nécessaire, `STORAGE_ROOT`, `CORS_ORIGIN`, `PDF_RENDERER_BASE_URL`, `FRONTEND_URL` et toutes les URLs publiques utilisées (`APP_BASE_URL`, `PUBLIC_APP_URL` si définies).
- Frontend : `VITE_API_URL` vers l'origine HTTPS de l'API de recette, sans `/api`, vraie `VITE_GOOGLE_MAPS_API_KEY` autorisée sur son domaine, `VITE_MAPTILER_KEY` et `VITE_MAPTILER_STYLE_URL` si utilisés. Aucun secret backend dans une variable `VITE_*`.
- Communications : aucun accès SMTP/IMAP réel dans l'environnement ou les comptes mail en base ; `SMS_PARTNER_API_KEY` absente ; paramètres d'un éventuel collecteur SMTP limités à la recette.

Définir les options réelles suivantes à `0` :

```text
MAIL_OUTBOX_WORKER
MAIL_SYNC_WORKER
MAIL_DRAFT_SYNC_WORKER
MAIL_SENT_ARCHIVE_WORKER
MAIL_MOVE_MUTATION_WORKER
MAIL_FLAG_MUTATION_WORKER
MAIL_ACCOUNT_DELETION_WORKER
MAIL_ATTACHMENT_SCAN_WORKER_ENABLED
```

**Ces options ne neutralisent pas à elles seules tous les envois.** Les mails système et certaines fiches techniques disposent de chemins SMTP directs ; les OTP SMS peuvent être envoyés lorsqu'une clé SMS Partner existe. Vérifier les credentials absents ou de test et les règles réseau. Aucun envoi à un vrai destinataire ne doit être utilisé pour tester ce blocage.

## Audit des migrations

Le lot contient deux migrations tarifaires additives et un prérequis minimal de rattachement des consommations au compteur :

| Fichier | Effet |
|---|---|
| `1790400000000_current_electricity_subscription.js` | Ajoute `electricity_subscription_ttc_month numeric(10,2)` nullable et non négatif dans `leads` et `lead_meters`. |
| `1790400100000_current_electricity_annual_bill.js` | Ajoute `electricity_annual_bill_ttc numeric(12,2)` nullable et non négatif dans les mêmes tables. |
| `1790400200000_monthly_consumption_meter_scope.js` | Ajoute si nécessaire `lead_consumption_monthly.meter_id`, crée le compteur principal manquant pour les anciennes lignes non rattachées, puis rattache ces lignes au compteur principal du même lead et de la même organisation. Rend le rattachement obligatoire, ajoute la clé étrangère de propriété et remplace l'unicité par lead/mois par une unicité par compteur/mois. Conserve les kWh et les liens existants. |

Le troisième fichier rend la release autonome sur une base issue du schéma de référence : les anciennes migrations multi-compteurs de cette référence étaient des placeholders `SELECT 1` et ne créaient pas le lien nécessaire. Il n'intègre aucun autre lot métier. Une propriété historique incohérente provoque un échec au lieu de deviner un rattachement. Son `down` ne supprime volontairement pas la colonne, afin de ne pas fusionner des historiques de compteurs distincts.

Les contrats, projections, empreintes et traces du calcul utilisent les champs JSON existants ; aucune migration supplémentaire n'est prévue pour eux.

Avant tout lancement de migration ou du serveur :

1. Lire sur la cible distincte l'historique des migrations et leurs checksums, les colonnes existantes et les contraintes. Comparer avec les fichiers du SHA candidat.
2. Consigner la liste exacte des migrations en attente. Si l'une des trois migrations est déjà appliquée, la conserver et contrôler sa conformité ; ne pas la désinstaller pour la rejouer.
3. Si la cible n'a pas encore le schéma de référence du backend, qualifier sa création séparément. Ne pas présenter une installation de toutes les anciennes migrations comme l'application de ces trois seuls fichiers.
4. Vérifier une sauvegarde restaurable de la cible de recette. Appliquer les seuls ajouts approuvés et conserver le reçu d'exécution.

`npm --prefix backend run migrate:up` applique les migrations en attente, pas uniquement les trois fichiers de cette table. Ne lancer cette commande qu'après contrôle de la liste complète. Une divergence de checksum exige une analyse ; ne pas l'effacer ou la réparer automatiquement pour forcer le passage. Aucun `migrate:down` n'appartient à cette procédure de livraison.

## Déploiement isolé

Cette procédure devient exécutable seulement lorsque l'hôte, les services, les ressources et les variables ci-dessus ont été identifiés et vérifiés. Aucun nom de service, URL ou identifiant manquant ne doit être deviné.

1. Archiver l'état et l'identité de la paire précédente si elle existe. Préparer le SHA candidat dans un répertoire de release neuf, depuis Git, avec uniquement les fichiers suivis de ce commit. Vérifier le manifeste et l'absence de secrets/artefacts locaux.
2. Sur la machine de construction isolée, installer les dépendances verrouillées avec `npm ci --prefix backend` et `npm ci --prefix frontend`. Qualifier la version Node réellement utilisée par la cible ; consigner toute différence avec celle des tests locaux.
3. Exécuter avec une base de test dédiée les contrôles `ci:lint`, `ci:typecheck`, `ci:unit`, `ci:integration`, `ci:schema`, `ci:financial-regression`, `ci:financial-health` et les tests frontend du lot. Un succès de compilation ne remplace pas `ci:typecheck` : le script de build peut poursuivre malgré une erreur TypeScript.
4. Construire le frontend depuis le SHA candidat avec ses vraies variables de préproduction. Vérifier la cible `VITE_API_URL`, le runtime public, les assets PDF et le répertoire généré `frontend/dist-crm`. Conserver le manifeste et les empreintes des fichiers générés.
5. Publier le frontend uniquement dans le projet/slot de préproduction explicitement identifié. Pour une Preview Vercel qualifiée, utiliser le circuit Preview de ce projet sans `--prod`, et ne jamais lancer le workflow « Deploy Main » pour cette étape. Consigner l'URL et l'ID retournés.
6. Configurer le backend dédié avec l'URL réelle du renderer de cette publication. Effectuer l'audit SQL puis les seules migrations approuvées. Installer et démarrer le backend du même SHA dans son service de préproduction. Ne pas utiliser l'ecosystem PM2 de production sans configuration distincte validée.
7. Contrôler `/api/health/ready` et `/api/health/financial-engine` sur l'API de recette. Vérifier finance `2.2.1`, puis la version SmartPitch et le SHA dans les preuves de calcul/déploiement. Vérifier les origines API et renderer réellement utilisées, y compris lorsque le frontend est ouvert dans un navigateur neuf.
8. Arrêter la qualification et maintenir les exports indisponibles sur cette cible en cas de version différente, variable ambiguë, appel à une ressource de production ou défaut d'isolation. Ne pas corriger un endpoint en pointant temporairement vers la production.

## Parcours de qualification sur la cible

Utiliser une fixture positive entièrement fictive, avec géométrie et hauteur d'obstacles complètes, contrat compatible, consommation connue, horaires HC lorsque requis et devis enregistrable. Conserver séparément les contre-exemples de blocage.

| Étape | Résultat attendu et preuve |
|---|---|
| Modification du devis | Changer une valeur économique ou technique utilisée ; conserver la valeur avant/après. |
| Sauvegarde | Attendre l'accusé de sauvegarde de la version exacte ; vérifier la relecture de cette valeur. |
| Invalidation | Le résultat précédent devient ancien sans être effacé. Aucun recalcul automatique ne doit masquer cet état. |
| Export avant recalcul | L'API refuse le nouvel export ; aucun nouveau document n'est enregistré. |
| Recalcul | Les quatre scénarios sont recalculés avec SmartPitch V21, finance 2.2.1 et l'empreinte des valeurs utiles courantes. |
| Comparaison | Vérifier économies, factures, CAPEX, flux annuels et consommation affichés ; aucun ancien montant n'est réutilisé silencieusement. |
| Sélection | Choisir un scénario valide, sauvegarder, puis vérifier la sélection en relecture. Un scénario bloqué reste non sélectionnable pour un document commercial. |
| PDF 25 ans | Générer et ouvrir le vrai PDF ; conserver son hash, son nombre de pages et les contrôles de contenu/rendu. |
| PDF 30 ans | Générer puis contrôler la période, la dernière année et les valeurs financières ; ne pas réutiliser le graphique 25 ans par erreur. |
| Historique | Consulter l'index puis une archive, vérifier l'ancien devis/calcul et l'absence de modification de l'archive. |

Contrôles supplémentaires obligatoires :

- **Scripts et graphiques PDF** : requêtes HTTP réelles des fichiers `pdf-engines/*.js`, contenu JavaScript et type MIME corrects, aucun HTML servi à leur place, aucune erreur navigateur bloquante. Vérifier les courbes effectivement rendues dans le PDF, pas seulement l'existence du conteneur HTML. Un PDF statique n'a pas à embarquer les scripts JavaScript qui ont servi à le rendre.
- **Flux négatifs** : utiliser une fixture présentant un déficit initial et un remplacement configuré ; conserver les valeurs négatives dans les données, le tableau et le graphique. Le zéro ne doit pas masquer un déficit. Vérifier CAPEX, calendrier de remplacement et gain net aux horizons 25 et 30 ans.
- **Hypothèses et consommation** : période réelle, provenance mesurée/importée ou synthétique, estimation éventuelle de tarif et d'abonnement, projection énergétique et inflation réellement utilisées. Vérifier la concordance entre écran et PDF, sans prétendre disposer de données horaires mesurées lorsqu'elles sont reconstruites.
- **Urban daté** : distinguer la règle `URBAN_SOLAR_2026_06_MONTHLY_HC` de l'édition tarifaire `URBAN_SOLAR_PARTICULIER_2026_08_01`. À partir de sa date d'effet, restitution TTC : HP `0,1122`, HC `0,0945`, Base `0,1110` €/kWh ; contribution CEE déjà incluse. Tester une date antérieure sans antidater cette grille ni inventer une ancienne édition.
- **OA et batterie virtuelle** : OA actif sans sortie préalable documentée → blocage explicite. Sortie future ou preuve manquante → blocage. Seule une situation compatible ou une sortie prouvée et effective avant démarrage permet le scénario et l'export.
- **Ombrage** : absence de hauteur réelle, géométrie incomplète ou incohérence bloquante → refus d'export maintenu. Ne pas ajouter une hauteur supposée, diminuer artificiellement une perte, vider les alertes ou modifier une empreinte pour obtenir un PDF. Les dossiers déjà bloqués restent bloqués jusqu'à correction réelle de leur géométrie et nouveau calcul d'ombrage.
- **Horaires HC** : les deux variantes 8 kWc sans horaires nécessaires restent incomplètes. Ne pas leur attribuer des horaires arbitraires pour obtenir un résultat commercial.
- **Ancien scénario sans empreinte** : consultation autorisée avec indication d'ancienneté ; aucun nouvel export avant recalcul. Le refus ne doit ni supprimer l'archive, ni lui créer une empreinte factice.
- **Fraîcheur** : en onglet visible, mesurer le contrôle toutes les 30 secondes et au retour de focus ; aucune requête concurrente inutile, aucun recalcul automatique. Vérifier qu'une modification hors des données réellement utilisées ne rend pas le résultat ancien.
- **Historique à la demande** : inspecter le réseau à l'ouverture et pendant les contrôles périodiques. Le contrôle de fraîcheur et le chargement courant ne renvoient pas les archives complètes ; index et détails sont chargés seulement à la demande.

Pour les mesures : même fixture et navigateur, au moins deux échauffements puis dix observations ; noter octets de réponse, encodage/transfert, temps médian et p95 du contrôle de fraîcheur, de la page initiale, de l'index et d'une archive. Noter le nombre d'archives et le volume JSON stocké. Garder les traces réseau sans tokens ni données privées. Comparer au local en mentionnant différences de serveur, réseau, nombre de versions et cache ; une mesure locale ne remplace pas une mesure de préproduction.

## Retour arrière coordonné

1. Identifier exactement la paire précédente : SHA backend, répertoire/artefact et service de recette ; ID/URL et SHA du frontend, assets PDF compris. Conserver la paire en échec et ses journaux pour diagnostic.
2. Si l'ancienne paire ne sait pas lire V21/2.2.1 ou préserver les blocages de fraîcheur, OA, ombrage et horaires, suspendre calculs, sélections et exports par une mesure opérateur explicite avant la bascule. Ne pas inventer un feature flag inexistant. En l'absence de paire compatible, garder ces opérations suspendues et préparer une correction additive.
3. Restaurer le backend précédent dans le service de préproduction uniquement, puis le frontend/PDF correspondant. Vérifier leurs URLs API/renderer et leur santé. Un rollback Vercel seul ne restaure pas le backend.
4. **Conserver la base courante, les colonnes additives, les historiques et les documents.** Ne pas lancer `migrate:down`, ne pas restaurer un ancien dump sur la base active et ne pas effacer les empreintes. Les sauvegardes servent à une restauration isolée ou une reprise de sinistre, pas à supprimer l'activité créée après publication.
5. Vérifier la consultation des archives et les refus d'export attendus avec la paire restaurée. Ne rouvrir les opérations suspendues qu'après contrôle d'une paire compatible. Si la première préproduction n'a pas de paire antérieure, arrêter la release candidate en conservant ses données et preuves, sans basculer vers la production.

## Compte rendu de qualification à compléter

Conserver avec la release : URL de préproduction, branche/SHA, identités backend/frontend/moteurs, manifeste exact des fichiers, migrations réellement appliquées, résultats détaillés des contrôles et du parcours, PDF 25/30 ans de la fixture fictive, performances, écarts par rapport au local et identité de la paire de retour.

**Tant que la cible et ce parcours n'ont pas été qualifiés : URL de préproduction indisponible, aucun déploiement, aucune migration appliquée, aucun parcours distant réussi revendiqué, NO-GO production.** Ce runbook n'autorise aucun déploiement en production.
