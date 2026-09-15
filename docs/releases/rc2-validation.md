# SmartPitch-V21-finance-2.2.1-rc2 — validation locale

Date : 15 septembre 2026. Base immuable RC1 : `743ad454aafe10a52f05bfc7e1b3173b85c65e91`. Branche locale : `codex/release-v21-finance-2-2-1-rc2`. Le SHA définitif du candidat est porté par le tag annoté `SmartPitch-V21-finance-2.2.1-rc2` et son reçu externe. Le tag RC1 n'est pas déplacé.

**NO-GO production et publication distante.** La clé mail exposée n'a pas été remplacée, la quatrième provenance de migration reste manquante et aucune préproduction isolée n'est qualifiée. Ce document constate les résultats locaux ; il n'autorise aucune intervention distante.

## Périmètre

Diff par rapport à RC1 limité au trousseau mail versionné, à l'outil transactionnel de rotation, à la conservation des credentials en cas d'erreur de lecture, aux trois restaurations historiques sourcées, au contrôle des migrations avant écriture et à leurs tests/documents. Liste exhaustive : `rc2-files.txt`. Aucun changement de formule, de SmartPitch, du moteur financier, du frontend, des fichiers partagés ou des moteurs/assets PDF par rapport à RC1. Aucune migration de schéma nouvelle dans RC2.

Versions attendues : SmartPitch `V-LIGHT V21-dated-tariffs-oa-input-dependencies`, finance `2.2.1`, paquet backend `1.0.0` (version générique, insuffisante sans le SHA). Le frontend ne possède pas de version de paquet dédiée ; son identifiant de release est le même SHA. Tous les composants devront être construits depuis ce SHA unique. Runtime de qualification locale : Node 24.13.0, PostgreSQL 17.11. PostgreSQL cible réel : 14.24, qualification de cette version encore à faire.

## Résultats des contrôles

| Contrôle | Résultat local |
|---|---|
| Suite backend unitaire complète | 803 réussis, 0 échec, 10 ignorés |
| Suite backend intégration complète | 99 réussis, 0 échec, 23 ignorés |
| Nouveaux tests RC2, exécutés explicitement | 44 réussis, 0 échec, 0 ignoré ; inclus dans les deux lignes précédentes |
| Frontend, périmètre RC1 exact | 19 fichiers, 99 tests réussis |
| Contrôles critiques des calculateurs | 21 contrôles réussis |
| Lint, TypeScript, compatibilité des schémas partagés | Réussis |
| Build frontend de qualification locale | Réussi avec API localhost et clés de test |
| Test HTTP des assets PDF Vite | Réussi |
| Base vierge | 215 migrations exécutées, 215 références vérifiées |
| Historique de production reproduit localement | 215 entrées/145 références identiques ; quatrième divergence refusée avant le runner et avant la migration V21 en attente |

Les tests ignorés sont signalés par les suites existantes ; ils ne sont pas assimilés à des tests réussis. Les 44 nouveaux contrôles comprennent 20 tests chiffrement/CLI/protection des credentials, 11 tests transactionnels PostgreSQL de rotation, 8 tests d'intégrité de migrations et 5 tests PostgreSQL de l'historique et du démarrage. Ils utilisent uniquement des clés et secrets fictifs.

Cas couverts : V1/V2 et anciens encodages de clé, authentification du `kid`, altération du tag/version/payload, clé retirée, configuration ambiguë, lecture nouvelle clé seule, IV aléatoires, absence de remplacement après erreur, dry-run réellement READ ONLY, toutes les colonnes, format ancien inconnu, JSON null, corruption de trigger, concurrence, verrouillage, annulation de lot, interruption/reprise, relance idempotente, CLI réel et validation du rapport préalable. Aucun secret réel n'a été déchiffré pour ces tests.

### Échec conservé hors périmètre

Un lancement initial trop large de `vitest run` a découvert 310 fichiers : **45 fichiers en échec, 265 réussis ; 44 tests en échec, 1 912 réussis**. Il inclut des fichiers Playwright exécutés par Vitest ainsi que des échecs canonical3d/runtime/roof extensions. Le journal complet est conservé. Ce lancement ne constitue pas une validation globale réussie du dépôt et ces échecs ne sont pas masqués. Les 19 fichiers du périmètre RC1 ont ensuite été rejoués explicitement avec succès. RC2 ne modifie aucun fichier frontend ; aucune correction hors mission n'est incorporée. Un snapshot généré par ce lancement a été conservé dans les preuves puis retiré du diff de la release.

## Parcours HTTP et navigateur réel, uniquement local

Fixture entièrement fictive, backend dédié en localhost et base dédiée. Pour 25 puis 30 ans : modification du devis, sauvegarde, consultation du résultat devenu ancien, refus d'export, recalcul des quatre scénarios, comparaison, sélection physique, génération du PDF et consultation de l'historique. Les essais négatifs ne créent aucun document.

OA actif interdit BV/hybride avec réponse 409. Deux scénarios 8 kWc sans plages HC restent incomplets et non exportables. Ombrage incomplet bloque le PDF. Un ancien calcul sans empreinte reste consultable, exige un recalcul pour exporter. Aucun accès ni changement du dossier réel de Michel : aucune exception introduite pour son ombrage.

Les contrôles Urban datés vérifient les TTC de restitution HP 0,1122, HC 0,0945 et BASE 0,1110, distincts de la version contractuelle. Les six scripts PDF sont servis en HTTP 200, avec le bon type MIME et des octets identiques aux sources de la release.

Les deux PDF produits ont 12 pages. Leur page de gains contient 35 tracés vectoriels ; les pages de gains et d'hypothèses ont aussi été rendues en images et inspectées. Le flux cumulé à l'année 15 est négatif (−9 347,64 €) et visible. La fixture donne 746,06 € d'économie de facture en année 1, un investissement de 16 800 €, un gain net à 25 ans de 7 148,18 € et à 30 ans de 18 731,41 €. Ces nombres qualifient la fixture, **pas Michel**. La consommation annuelle et le profil horaire reconstruit sont explicitement indiqués ; hypothèses et empreinte finale apparaissent.

Fraîcheur : cinq GET réels de 587 octets, médiane 30,76 ms en localhost. Lecture minimale de l'étude : 748 octets contre 4 794 232 octets pour la lecture historique complète. Sur une fenêtre de 32 secondes : un seul GET périodique de fraîcheur, zéro chargement automatique d'historiques complets et zéro rechargement périodique de tous les scénarios. Aucune extrapolation de ces temps à la production.

Les assertions du parcours navigateur et de contrôle des scripts n'ont remonté aucune erreur. Aucun événement fatal du backend et aucune erreur dans le journal Vite. Le journal backend conserve les refus d'export attendus, dont `PDF_BLOCKED_CALCULATION_CONFIDENCE` pour le cas d'ombrage ; ces refus constituent les résultats attendus des tests négatifs.

## Exploitation et décisions nécessaires

L'état initial, le diff final, la liste de fichiers/blobs et les journaux sont conservés dans les preuves locales hors Git. Les bundles, caches, PDF de test, fichiers d'environnement et anciennes preuves contenant le secret retiré n'entrent pas dans RC2.

Voir `rc2-mail-key-rotation.md` pour l'inventaire, les commandes futures, la reprise et le rollback compatible V2 ; `rc2-migration-provenance.md` pour chacune des quatre références et la réconciliation soumise à validation ; `rc2-preproduction-proposal.md` pour l'architecture, les accès et le coût non confirmé.

Autorisations encore nécessaires : accès Vercel permettant la lecture des réglages ; choix d'un artefact historique supplémentaire ou accord de préparation d'une réconciliation strictement ciblée pour la quatrième migration ; validation du plan de capacité et des créations/configurations distantes de préproduction ; puis, après qualification et présentation des opérations exactes, autorisations distinctes pour la maintenance, génération de clé, sauvegarde, rotation réelle et renouvellement des accès mail externes. Aucun accord de production n'est demandé sur la seule base de ce candidat local.
