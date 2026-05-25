# Plan de simplification des pages CRM

## Positionnement

Objectif : rendre chaque page plus lisible sans retirer de fonctionnalite. Les actions principales restent visibles, les details de verification passent en panneaux repliables, et les textes longs ne sont plus affiches en permanence.

## Pages prioritaires

| Page | Probleme observe | Action principale cible | Patch applique | Suite proposee |
| --- | --- | --- | --- | --- |
| Documents | Recherche, filtres et contexte visibles en meme temps. | Rechercher un document. | Description retiree, filtres secondaires replies derriere un bouton `Filtres`. | Ajouter un panneau lateral de detail document si les lignes gagnent encore des actions. |
| Mail | H1, aide syntaxe, filtres et bouton composer se concurrencent. | Nouveau message. | `Nouveau message` remonte dans le `PageHeader`, aide syntaxe repliee. | Replier les filtres avances quand aucun filtre n'est actif. |
| Facture | Beaucoup de blocs avant les lignes et trop de descriptions permanentes. | Enregistrer / emettre la facture selon statut. | Rattachements, liens et synthese dossier replies; textes longs de section retires. | Mettre documents et origine devis dans des onglets si la page reste dense. |
| Configuration | Cartes utiles mais matrice permissions tres technique. | Ouvrir une section de configuration. | Matrice permissions repliee. | Grouper les cartes Organisation dans un panneau si plus de 8 sections visibles. |
| Clients | KPI, filtres, liste et detail sont visibles ensemble. | Ouvrir ou filtrer un dossier client. | Non touche dans ce patch. | Replier les KPI en mobile et faire des actions groupees un bandeau contextuel plus compact. |
| Devis | Builder tres dense, nombreuses actions de statut et PDF. | Modifier le devis puis generer/envoyer le PDF. | Non touche dans ce patch. | Aligner sur la facture : origine, documents et actions secondaires en panneau repliable. |

## Regles UX a conserver

- Un H1 par page, puis une action principale visible.
- Les actions destructives restent confirmees par `ConfirmModal`.
- Les filtres et details secondaires restent accessibles, mais ne doivent pas pousser le contenu principal sous la ligne de flottaison.
- Les pages CRM gardent des libelles SaaS B2B courts, orientés tache.
