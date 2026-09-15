# Release SmartPitch V21 / finance 2.2.1

**Candidat : `SmartPitch-V21-finance-2.2.1-rc1`. Publication bloquée.** Le tag local de ce nom identifie le commit à utiliser pour tous les composants ; aucun push, déploiement ou promotion n'est autorisé par cette préparation.

Release assemblée le 15 septembre 2026 sur `codex/release-v21-finance-2-2-1`, depuis `f84bbbd95a25cb4b32a0e4671327c7d559bcd9b9`.

Le backend, le frontend, les services partagés et les sources des moteurs PDF doivent être construits depuis le même commit de cette branche. Le moteur de calcul est `SmartPitch V-LIGHT V21-dated-tariffs-oa-input-dependencies` ; le moteur financier est `2.2.1`. Les versions génériques des packages npm ne constituent pas une identification suffisante de cette release.

## Périmètre extrait

- Calcul énergétique avec calendrier conservé, convention d'azimut PVGIS corrigée, production mensuelle conservée, pertes et vieillissement appliqués une seule fois.
- Facturation au contrat du compteur avant projet, contrat fournisseur daté pour la batterie virtuelle, abonnement séparé et provenance explicite des estimations.
- Grille Urban applicable au 1er août 2026, distincte de la règle contractuelle mensuelle ; restitution TTC HP 0,1122, HC 0,0945 et Base 0,1110 €/kWh, CEE incluse.
- Blocage des combinaisons OA/batterie virtuelle sans sortie documentée et effective, ainsi que des contrats incomplets et géométries d'ombrage invalides.
- Sauvegarde du devis confirmée par empreinte, calcul transactionnel, fraîcheur limitée aux entrées utilisées, historique paginé et exports interdits pour les résultats anciens ou sans empreinte.
- Projections financières à 25/30 ans, financement et remplacements, graphiques avec flux négatifs, PDF fondés sur les valeurs et hypothèses sauvegardées.
- Corrections des scripts PDF servis comme HTML, du signal de disponibilité du rendu, des débordements et des libellés de provenance.

Le périmètre inclut les seules dépendances tarifaires et de compteur indispensables qui n'étaient pas présentes dans le commit de base. Les ajouts Consuel, messagerie, planning, Data Connect, équipements futurs `usage_v3`, dessin de toiture, télémétrie et configuration locale ne sont pas embarqués.

Un test PDF préexistant a été remplacé par une fixture synthétique anonymisée. Un littéral sensible préexistant dans la documentation de restauration a été retiré de la copie de release ; aucune rotation distante et aucune réécriture de l'historique Git n'ont été effectuées. Sa validité doit être vérifiée par l'opérateur avant une livraison distante.

Le précontrôle du candidat confirme que ce littéral était la clé applicative `MAIL_ENCRYPTION_KEY` utilisée pour chiffrer les identifiants de messagerie en AES-256-GCM. Il est déjà présent dans l'historique poussé et correspond encore à la configuration du backend de production. Il doit donc être traité comme potentiellement actif et exposé. Sa valeur et son empreinte ne sont pas publiées dans ce rapport. Le retrait du fichier courant ne révoque pas la clé.

Avant toute publication, faire approuver un renouvellement coordonné de cette clé avec ré-enchiffrement des données qu'elle protège, vérification de déchiffrement et mise à jour des configurations de reprise. Un simple remplacement de variable rendrait les identifiants existants illisibles. L'inventaire des secrets SMTP/IMAP et jetons OAuth concernés doit déterminer les accès à révoquer ou renouveler si leur confidentialité ne peut être établie. Aucun secret n'a été déchiffré pour ce précontrôle ; aucune rotation ou réécriture d'historique n'a été réalisée.

La liste exacte des chemins se trouve dans `v21-files.txt`. Le classement et les portions modifiées sont détaillés dans `v21-scope.json`. Les preuves de l'état initial, de la préservation du dossier d'origine et le diff final complet sont conservés séparément, hors paquet livré.

## Migrations du lot

1. `1790400000000_current_electricity_subscription.js` : abonnement TTC mensuel sur lead et compteur.
2. `1790400100000_current_electricity_annual_bill.js` : facture annuelle TTC sur lead et compteur.
3. `1790400200000_monthly_consumption_meter_scope.js` : rattachement des mois au compteur, unicité compteur/année/mois, contrôle conjoint du compteur, du lead et de l'organisation.

Le troisième ajout corrige une dépendance révélée par la base vierge : les migrations multi-compteurs historiques du commit de base étaient des placeholders. Le test SQL vérifie la reprise des mois sans modifier leurs kWh, l'isolation des propriétaires, l'idempotence et la conservation des données lors d'un retour arrière applicatif. Aucune migration Enedis ou Consuel n'est ajoutée.

Ces migrations ont été exécutées exclusivement sur une nouvelle base locale de qualification. Aucune migration distante n'a été effectuée. Avant toute cible distante, inspecter son schéma et sa liste complète de migrations en attente : ne pas lancer aveuglément l'ensemble du runner.

## Qualification de la release extraite

Les dépendances backend et frontend ont été installées avec `npm ci` dans le worktree isolé, sans copie des fichiers d'environnement du dossier d'origine. PostgreSQL local a été initialisé à vide, puis migré depuis les seuls fichiers présents dans cette release. Les fixtures de qualification sont fictives.

| Contrôle | Résultat |
|---|---|
| Tests backend unitaires | 775 réussis, 0 échec, 10 ignorés |
| Tests PostgreSQL d'intégration | 83 réussis, 0 échec, 23 ignorés |
| Tests frontend ciblés | 99 réussis, 0 échec, 19 fichiers |
| Scripts PDF servis par Vite réel | 1 test HTTP réussi |
| TypeScript et lint | Succès |
| Schémas API | 9 schémas, aucun changement cassant |
| Calculateurs critiques | 21 tests, seuil de couverture 70 % respecté |
| Contrôle du moteur financier | Version 2.2.1 et référence conformes |
| Construction frontend | Succès ; artefact local de qualification seulement |

Les tests ignorés restent des contrôles conditionnels d'autres parcours HTTP et d'IMAP externe. Ils ne sont pas comptés comme réussis. Les nombres diffèrent de la qualification du dossier initial, car les tests étrangers au lot ont été exclus et les dépendances tarifaires de cette release ont été enregistrées dans les runners.

La compilation locale utilise une clé Maps factice et une API de boucle locale. Ses fichiers générés sont exclus du commit et ne doivent pas être déployés. Une construction destinée à une préproduction doit employer les vraies variables de cette préproduction et le SHA candidat immuable.

Le parcours complet a également été rejoué sur cette release extraite, avec une base vierge et un client fictif : modification du devis, sauvegarde, ancien résultat encore consultable, export refusé 409, recalcul des quatre scénarios, comparaison, sélection, PDF 25 ans, PDF 30 ans et lecture d'une archive. Les deux documents de douze pages sont contrôlés par extraction et inspection visuelle : graphiques présents, déficit de l'année 15 conservé, hypothèses de remplacement et provenance synthétique explicites. Le gain net de cette fixture reste de 7 148,18 € à 25 ans et 18 731,41 € à 30 ans, comme dans la qualification précédente.

Les contre-exemples HTTP vérifient les refus d'un résultat sans empreinte (lecture 200, export 409), de l'OA actif incompatible, des horaires HC absents et d'une hauteur d'obstacle manquante. Les TTC Urban et leur édition datée sont également vérifiés. Ces essais n'utilisent pas les données personnelles d'un client réel.

Sur 32 secondes de page visible, une seule requête périodique de fraîcheur a été observée : aucun chargement automatique d'historique ni des scénarios complets, aucune erreur navigateur. Six scripts PDF servis par HTTP sont identiques octet par octet aux sources de la release. Mesures locales authentifiées : réponse de fraîcheur de 587 octets, médiane de 68,77 ms sur cinq lectures ; en-tête de page de 748 octets en 21,08 ms. Ces mesures ne décrivent pas un serveur de préproduction distant.

## État de livraison

**Aucun déploiement effectué. NO-GO production.** Aucune préproduction distante dont l'isolation soit vérifiée n'est disponible. Les ressources actuellement identifiées correspondent à la production ; les configurations disponibles ne doivent pas être réutilisées comme préproduction.

Le GO technique local ne lève aucun blocage métier : un obstacle sans hauteur, un ombrage incohérent, des horaires HC requis absents, un OA incompatible ou un résultat périmé doivent toujours empêcher un nouvel export. Les documents historiques restent consultables.

La création de l'environnement, sa qualification réelle et le retour arrière coordonné sont décrits dans `v21-preproduction-runbook.md`.
