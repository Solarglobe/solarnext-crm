# Preuve verticale locale : végétation réelle

Le serveur de preuve utilise un clone JSON géolocalisé du calepinage. Il n’importe ni le bootstrap CRM, ni `.env`, ni PostgreSQL. Écoute exclusivement sur `127.0.0.1:4188`, sans données ni accès de production. Le code reste sur la branche courante, sans déploiement.

## Exécution

Installer les dépendances Python de `requirements.txt` dans un environnement local puis, depuis la racine du dépôt :

```text
node backend/scripts/tree-shading-local.mjs CHEMIN_ABSOLU_CACHE_LOCAL CHEMIN_ABSOLU_CLONE_JSON --acquire
```

`TREE_PYTHON` sélectionne l’exécutable Python ; `PYTHONPATH` permet un répertoire de dépendances séparé. Le clone contient `geometry.roofState`, `geometry.pans` et `geometry.frozenBlocks`. Les acquisitions et corrections restent dans le répertoire local fourni, hors Git. Sans `--acquire`, le serveur rouvre les données et corrections existantes ; le résultat annuel est volontairement à recalculer.

Ouvrir `http://127.0.0.1:4188`. « Charger les arbres IGN » fait l’acquisition ou réutilise le cache COPC. Sélectionner un volume mesuré pour le déplacer et modifier ses dimensions. Les corrections invalident immédiatement le résultat et le PDF. Le PDF Chromium utilise la même scène et le même résultat, avec son empreinte ; un seul rendu simultané. Les écritures sont bloquées pendant le rendu.

## Géométrie et énergie

- WFS IGN : couche effective `IGNF_LIDAR-HD_METADONNEE:metadata`.
- Requêtes HTTP Range sur les octrees COPC : carré de 300 m, résolution demandée 0,5 m, plafond 120 Mo. Cache des points réellement recadrés.
- Classes 2 (terrain), 3/4/5 (végétation), 6 (bâtiment) séparées. Volumes regroupés par maxima de hauteur ; ce ne sont pas nécessairement des arbres botaniques individuels.
- Colonnes de végétation de 1 m, entre les quantiles 2 % et 98 % des altitudes observées dans chaque cellule. Les espaces vides restent vides. Les arbres manuels utilisent des couronnes ellipsoïdales opaques dans le même traceur de rayons.
- Panneaux projetés depuis leurs quadrilatères enregistrés, avec le centre de carte et son échelle, en Lambert-93. Plan du toit ajusté aux seuls points de bâtiment ; altitude IGN69. Sans plan fiable, l’altitude manuelle est obligatoire.
- Position solaire UTC existante ; nord géographique converti en Lambert-93. Seize rayons par panneau et heure. Diffus : intégration isotrope sur 480 directions du ciel. Rayonnement réfléchi du sol conservé.
- PVGIS SARAH3, 8 760 heures de 2023, irradiation dans le plan du toit. Perte annuelle = irradiation interceptée / irradiation de référence ; pondération par surface des panneaux.

## Portée

Cette preuve est une interface locale du module calepinage, pas un déploiement du CRM ni une modification des PDF historiques. La perte calculée est une perte d’irradiation, pas un rendement électrique certifié. Le LiDAR de février 2022 ne reconstitue pas le feuillage estival ni les changements récents. Le montage à 10 cm du toit est une hypothèse explicite à confirmer. Les obstacles au-delà de 150 m ne sont pas qualifiés. Les données manquantes, l’absence d’irradiation et une scène vide non attestée ne produisent jamais automatiquement 0 %.

## Contrôles

```text
node --test backend/tests/tree-shading.test.mjs
```

La validation finale doit utiliser les acquisitions IGN réelles, les modifications depuis l’interface et le PDF. Les tests unitaires synthétiques ne suffisent pas.

## Intégration CRM sur la base RC4

La page protégée `/studies/:studyId/versions/:versionId/tree-shading` est accessible depuis la comparaison des scénarios. Elle réutilise l’éditeur avec le client authentifié du CRM. Aucune URL de localhost ni identité de test n’est intégrée dans ce parcours.

Les routes `/api/studies/:studyId/versions/:versionId/tree-shading/*` vérifient JWT, permission `study.manage`, email vérifié et appartenance de l’étude à l’organisation. Elles chargent le calepinage en base. Scènes, cache et résultats sont conservés sous `TREE_SHADING_DATA_DIR` (défaut `backend/storage/tree-shading`), avec un répertoire distinct par organisation/version. Les corrections invalident le résultat et le PDF. Une modification du calepinage, une révision d’éditeur périmée ou une version verrouillée bloque les opérations concernées. Aucun changement de schéma ni migration requis.

Le calcul 8×8, avec 1 920 directions de ciel, s’exécute dans un worker limité à 384 Mo et 180 secondes. Un seul calcul, téléchargement ou PDF est accepté simultanément par processus API. Le rendu Chromium utilise une copie mémoire du résultat et intercepte toutes les ressources : aucune connexion au CRM de production ni jeton dans une URL de rendu.

Le résultat central et le PDF présentent aussi les scénarios bas et haut. `uncertainty.js` documente les opacités saisonnières et les sources. L’opacité effective s’applique une seule fois par direction masquée, sans multiplication selon le découpage arbitraire des volumes. Ce sont des scénarios de sensibilité, pas un intervalle de confiance de terrain. Le scénario opaque reste disponible comme diagnostic. L’analyse optique et son PDF annexe sont distincts des calculs financiers RC4 et de leurs attestations existantes.

```text
node --test backend/tests/tree-shading.test.mjs backend/tests/tree-shading-crm.test.mjs
```
