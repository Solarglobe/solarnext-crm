# Parcours metier CRM SolarNext

## Decision produit

Le parcours principal doit rester lineaire:

1. Creer ou qualifier un lead dans `/leads`.
2. Ouvrir la fiche dossier `/leads/:id`.
3. Lancer une etude si le chiffrage technique est utile.
4. Creer le devis depuis l'onglet Financier du dossier.
5. Presenter, envoyer puis faire accepter le devis.
6. La signature convertit le dossier en client.
7. Creer les factures depuis le devis accepte, puis suivre les paiements.
8. Retrouver les PDF dans l'onglet Documents du dossier et dans `/documents`.

## CTA principaux

| Etape | CTA attendu | Destination |
| --- | --- | --- |
| Lead | Creer etude | Creation d'une etude rattachee au lead |
| Lead ou client | Creer devis | `/quotes/:id` apres creation du devis rattache |
| Devis | Presenter | `/quotes/:id/present` |
| Devis accepte | Creer facture | `/invoices/new?fromQuote=:id` ou variantes acompte/solde |
| Facture | Ouvrir | `/invoices/:id` |
| PDF devis/facture | PDF / Telecharger | Document rattache au devis/facture et visible dans `/documents` |
| Documents | Envoyer par email | `/mail` avec pre-remplissage document |

## Actions dupliquees volontairement

- `Creer devis` existe dans la fiche dossier et dans l'assistant etude: la fiche dossier est le point principal, l'assistant etude sert a pre-remplir depuis une version technique.
- `Creer facture` existe dans la liste factures et sur un devis accepte: le devis accepte reste le chemin conseille, la facture manuelle est un filet de secours.
- `Documents` existe globalement et dans la fiche: la fiche donne le contexte dossier, `/documents` donne la recherche organisation.

## Libelles harmonises

- Utiliser `devis` pour le document commercial avant facturation.
- Utiliser `facture` pour le document de paiement.
- Utiliser `documents` pour les PDF et pieces rattachees.
- Utiliser `dossier` pour la fiche unifiee lead/client.
- Utiliser `client` seulement quand le dossier est converti.

## Verifications produit

- Un commercial doit pouvoir reproduire le chemin complet depuis une fiche lead sans revenir au menu global.
- Chaque PDF genere depuis un devis ou une facture doit etre visible dans le document center et dans la fiche rattachee.
- Les pages protegees doivent rester derriere `AdminRoute` ou une route equivalente pour afficher une erreur 403 propre.
- Les routes existantes ne doivent pas etre cassees: les liens financiers gardent `lead_id`, `client_id`, `quote_id` ou `invoice_id`.
