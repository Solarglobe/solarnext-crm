# SmartPitch-V21-finance-2.2.1-rc3 — qualification locale

Parent RC2 immuable : `331e8d2d0b0d895a4ee32ef31cfcce1a1c82cc91`. Branche `codex/release-v21-finance-2-2-1-rc3`. Le tag annoté RC3 et le reçu externe portent le SHA définitif ; RC1 et RC2 ne sont pas déplacés. **NO-GO production et publication distante.**

## Comparaison Vitest de référence

Deux nouveaux worktrees propres au lancement, Node **24.13.0**, Vitest **1.6.1**, copies indépendantes des mêmes dépendances : 51 260 fichiers comparés octet par octet, mêmes lockfiles et même exécutable Node. Même commande globale `vitest run`, mêmes reporters, aucun filtre, même environnement de test. Les chemins de sortie seuls diffèrent.

| Version | Fichiers trouvés | Fichiers en échec | Assertions réussies | Assertions en échec |
| --- | ---: | ---: | ---: | ---: |
| Base `f84bbbd95a25cb4b32a0e4671327c7d559bcd9b9` | 293 | 44 | 1824 | 47 |
| RC2 `331e8d2d0b0d895a4ee32ef31cfcce1a1c82cc91` | 310 | 46 | 1909 | 47 |

**Les 44 échecs précédemment annoncés ne sont pas démontrés identiques.** Cette répétition comporte 43 assertions échouant identiquement, quatre échecs nouveaux/différents et quatre échecs de la base déjà corrigés dans RC1. Trois écarts nouveaux sont des timeouts de SettingsHubPage sous charge : ils passent isolément sur les deux versions, sans changer les tests. Le quatrième concerne l'ancien contrat d'affichage de ScenariosPage et sa réponse HTTP fictive incomplète.

`RC3-vitest-differential.json` liste chaque fichier et chaque assertion en échec, les états des deux versions, la catégorie et l'examen. Les JSON complets, journaux, preuves des dépendances et états initiaux restent hors Git dans le dossier de preuves RC3. Les erreurs DOM sont abrégées dans le document livré ; leur comparaison complète a été conservée.

RC3 distingue les lanceurs : Vitest conserve **toutes** les assertions Vitest de `src` et de `calpinage/engine`, Node exécute les tests d'ombrage et d'assets, tsx le test de géométrie autonome. Les 94 tests Playwright de 19 fichiers sont inventoriés par Playwright ; ils ne sont pas assimilés à 94 tests navigateur exécutés. La recette navigateur complète de cette mission est exécutée séparément. Quatre workers maximum évitent la saturation observée ; aucun délai d'assertion n'est augmenté.

## Corrections supplémentaires

- Restaurer la phase électrique explicitement enregistrée même sans coût installateur ; le choix n'est plus effacé à la réouverture. La confirmation d'une différence avec le compteur reste requise et expire si la détection change. Un nouveau test et le parcours navigateur couvrent ce cas réel trouvé pendant la recette.
- Fixturer l'authentification PDF en mémoire et les Response HTTP correctement ; vérifier l'ancien calcul lisible, l'export interdit, l'absence de chargement d'historique et le retour à la sélection après recalcul.
- Corriger les chemins des audits source indépendamment du dossier de lancement.
- Tester la production multi-pan en mode hors ligne explicite, avec conservation des cibles énergétiques au centième après redistribution horaire. Le test précédent dépendait du réseau et d'une égalité JSON stricte entre deux arrondis flottants. Aucune formule n'est modifiée.
- Fixturer les Pointer Events absents de jsdom ; cela révèle un vrai défaut de notification : le geste vers la droite effaçait aussi le toast. Le seuil respecte maintenant le geste vers la gauche prévu. Assertions de gauche, droite, petit mouvement et annulation conservées.
- Ajouter l'outil de réconciliation ciblée et ses contrôles PostgreSQL, SQL de revue et procédures. Aucun changement historique de migration ni de checksum réel.

## Échecs anciens examinés, toujours bloquants pour une validation globale

Le périmètre métier de la mission passe, mais le dépôt n'est pas entièrement vert. Les échecs Vitest anciens restants sont 25 assertions :

- 13 contrôles de panneaux dans les fixtures canonical3d et de parité. Les diagnostics montrent `PV_REJECT_COMMERCIAL_GEOMETRY_INVALID` et `COMMERCIAL_ROOF_KIND_UNRESOLVED`. Les scénarios de fixture attendent des panneaux alors que leur contrat géométrique commercial n'est pas établi. Ni les attentes ni le filtre de sécurité ne sont abaissés ; leur qualification complète reste nécessaire.
- Sept contrôles de maillage/hauteur/validation de lucarne P3 restent divergents. Aucun changement des maillages n'entre dans RC3 et aucune extrapolation aux obstacles réels n'est faite.
- Un seuil exact de clustering angulaire dépasse epsilon par l'arrondi `acos`. Défaut ancien non corrigé dans ce lot ; une tolérance doit être justifiée par des cas limites avant modification.
- Quatre tests de contrat ancien : façade runtime de validation, abonnement Zustand utilisé comme si un middleware de sélection existait, ancien titre de confirmation et ancien titre de page de développement. Examinés, sans changement de règles métier pour les satisfaire.

Les modules canonical3d, l'ancien prédicat et le store concernés sont identiques entre la base et RC2. Les quatre tests Node de `zBaseConsistency` échouent eux aussi de la même façon sur base/RC2/RC3 (17 réussis sur 21) : export `polygonCentroid` absent, ancien champ `baseZ` et ancien paramètre callback attendus par le test. Ils ne prouvent pas le calcul d'ombrage actuel ; la suite partagée officielle et les refus d'export sont contrôlés séparément. L'ombrage réel incomplet reste bloquant.

## PostgreSQL 14.24 et comparaison 17.11

Instance Windows PostgreSQL **14.24 exacte**, extraite des binaires officiels EDB, écoute uniquement 127.0.0.1:55438, sans service système. Les bases locales, rôles, organisations, coordonnées de fixture, comptes et clés de test sont fictifs. Aucun dump métier ni accès à la production pour cette qualification. Les connexions sortantes sont bloquées pendant la recette finale ; les références météo de fixture déjà en cache sont réutilisées.

| Contrôle | Résultat |
| --- | --- |
| Base vierge | 215 migrations exécutées et 215 empreintes enregistrées |
| Historique observé reproduit | 215 lignes/145 références exactes ; divergence ciblée refusée avant écriture |
| Intégration RC1/RC2 | 99 réussis, 23 ignorés, aucun échec |
| Nouveaux contrôles de réconciliation RC3 | 25 réussis, aucun ignoré |
| Intégration totale RC3 | 124 réussis, 23 ignorés |
| Backend unitaire | 803 réussis, 10 ignorés |
| Périmètre frontend RC1 | 19 fichiers, 100 réussis (99 précédents + nouveau cas de phase) |
| Chiffrement/migrations RC2 explicites | 44 tests : clés fictives, V1/V2, dry-run, apply, interruption/reprise, lecture nouvelle clé seule |
| Critiques, types, lint, schémas, assets | Vérifiés ; résultats et sorties complètes dans le reçu |

Les deux migrations tarifaires RC1 passent sur la base vierge et sont déjà appliquées dans l'historique observé. La troisième, portée compteur des consommations mensuelles, passe sur base vierge et en intégration : reprise des mois sans changer les kWh, séparation des compteurs, rejet des doublons et des références inter-lead/organisation, relance sûre.

Après réconciliation **locale** de la seule référence sur un clone distinct, le postcontrôle passe mais le runner refuse l'ordre à cause du fichier appliqué manquant `1788900000000_add_long_term_follow_up_stage`. La migration mensuelle en attente n'est donc pas appliquée sur ce clone. Ce blocage est conservé, documenté et ne constitue pas une différence SQL démontrée entre PostgreSQL 14 et 17. La même phase n'avait pas été atteinte sous 17, car la quatrième divergence arrêtait auparavant le runner.

La reproduction correspond au schéma relevé disponible, pas à un dump exhaustif. Les préconditions supplémentaires non relevées à distance doivent être confirmées lors d'un futur dry-run autorisé. Voir `RC3-reconciliation-lead-sources.md` pour les limites précises, le SQL et la reprise.

## Parcours et documents réels locaux

Modification devis → sauvegarde → ancien résultat consultable → export refusé 409 → recalcul quatre solutions → comparaison → sélection physique → PDF 25 ans → modification/recalcul → PDF 30 ans → lecture d'un ancien résultat : réussi avec une fixture entièrement fictive.

Les deux PDF ont 12 pages, 35 tracés vectoriels sur la page de gains et les six scripts servis correspondent octet par octet aux sources. Contrôle du contenu PDF extrait, montants, textes et aperçus rendu image : économie année 1 **746,06 €**, investissement **16 800 €**, gains nets à 25 ans **7 148,18 €** et à 30 ans **18 731,41 €** ; année 15 **−9 347,64 €**. Ces montants sont identiques à ceux de la fixture PostgreSQL 17.11 (écarts machine inférieurs au centime). Ils ne concernent pas un client réel.

Hypothèses, consommation déclarée et profil horaire reconstruit restent explicités. Tarifs Urban datés TTC vérifiés : HP 0,1122 €/kWh, HC 0,0945, BASE 0,1110. OA actif bloque BV/hybride ; horaires HC manquants et ombrage incomplet empêchent les documents. Aucun export réel ni exception pour un dossier client. Un ancien résultat sans empreinte reste lisible mais non exportable avant recalcul.

Mesure locale après recette : GET fraîcheur **587 octets**, médiane de cinq lectures **65,34 ms** ; lecture minimale de l'étude **748 octets**, contre **6 309 824 octets** pour la lecture complète contenant les anciens calculs. Sur 32 secondes : un seul contrôle de fraîcheur, aucun chargement automatique d'historique ou de tous les scénarios. Le volume de l'historique varie avec les répétitions ; ces temps localhost ne préjugent pas de la préproduction.

Les refus HTTP attendus sont conservés dans les logs. La recette finale ne remonte pas d'erreur JavaScript. Les événements HTTP réussis mais lents peuvent porter le niveau `error` du logger ; ils sont distingués des vrais échecs dans le reçu. Les premières tentatives et erreurs de fixtures sont conservées, sans être présentées comme des passes.

## Livraison locale uniquement

SmartPitch `V-LIGHT V21-dated-tariffs-oa-input-dependencies`, finance **2.2.1**, backend paquet **1.0.0** ; le SHA est l'identifiant commun frontend/backend/shared/PDF. Le backend JavaScript n'a pas de compilation (script build explicitement no-op) : son arbre de sources et la vérification syntaxique sont associés au même SHA. Build frontend et moteurs/assets PDF reconstruits après le commit ; aucun bundle local n'entre dans Git.

Le manifeste `rc3-files.txt` énumère uniquement le delta RC2→RC3. Les preuves externes conservent états initiaux, diff final, fichiers/blobs, tests, artefacts construits et état Git. Les anciennes modifications du workspace original ne sont pas embarquées. RC1 et RC2 restent inchangés.

La clé mail exposée reste à traiter comme active tant que sa révocation/rotation n'est pas attestée ; aucune nouvelle clé réelle n'a été générée. Vercel Preview et sa destination API ne sont pas vérifiés. L'historique ne permet toujours pas un passage sûr du runner. **Aucun push, déploiement, achat, écriture en production ou rotation réelle. NO-GO maintenu.** Propositions et autorisations suivantes : `RC3-preproduction-options.md`.
