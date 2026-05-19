# Modele client SolarNext CRM

## Decision produit

Dans SolarNext CRM, un client n'est pas une page metier separee du dossier commercial.
Le modele retenu est:

- `leads` porte le dossier operationnel visible par les equipes.
- Un dossier devient client quand le lead est converti et passe au statut `CLIENT`.
- `clients` reste la fiche canonique pour les donnees client, la facturation, les missions, les devis, les factures et les rattachements financiers.
- L'interface principale ouvre la fiche unifiee `LeadDetail`, avec un contexte explicite "Fiche client".

## Regle de navigation

- `/leads/:leadId` ouvre toujours le dossier commercial ou client.
- `/clients` affiche le portefeuille client.
- `/clients/:clientId` est une route de compatibilite: elle resout le `clientId`, cherche le dossier converti actif rattache, puis ouvre `/leads/:leadId?context=client&clientId=:clientId`.
- Si aucun dossier converti actif n'est rattache, la route affiche un message clair au lieu de rediriger vers un mauvais identifiant.

## Recherche globale

La recherche globale retourne des dossiers `lead` ou `client`.
Un resultat `client` correspond au dossier converti, avec badge `Client`, et ouvre la fiche unifiee.

## Modules lies

- Documents: accessibles depuis le dossier et rattaches par `lead_id` et/ou `client_id`.
- Devis: restent accessibles via `lead_id` avant conversion et `client_id` apres conversion.
- Factures: utilisent la fiche client canonique via `client_id`.
- Missions: utilisent `client_id` mais restent visibles dans la fiche client unifiee.

Cette decision evite deux fiches concurrentes pour la meme personne tout en conservant la table `clients` comme source canonique pour les donnees client.
