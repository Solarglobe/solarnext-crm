SOLARGLOBE CRM
RBAC Matrix Officielle — V1

Version: 1.0
Statut: VALIDÉ
Date: 2026

1. PRINCIPES GÉNÉRAUX

Tout est interdit par défaut.

Les permissions sont explicitement accordées.

Un utilisateur peut avoir plusieurs rôles.

Les permissions sont définies par module et par action.

Certaines permissions sont limitées aux "données propres".

2. RÔLES

ADMIN

COMMERCIAL

PROSPECTEUR

BACKOFFICE

CLIENT

3. MATRICE DES PERMISSIONS
3.1 ADMIN

Accès total au système.

Peut :

Gérer utilisateurs & rôles

Voir, modifier et supprimer tous leads et clients

Créer, modifier et supprimer études

Voir toutes marges

Modifier catalogue articles

Créer devis et factures

Accéder aux logs

Gérer planning complet

Voir tous emails

Configurer paramètres organisation

Gérer apporteurs d'affaires

Supprimer toutes notes

Export global données

Restriction : Aucune

3.2 COMMERCIAL

Peut :

Voir tous clients

Modifier uniquement ses propres clients

Voir leads assignés

Modifier ses leads

Convertir lead → client

Créer études pour ses clients

Modifier études (création nouvelle version)

Accéder calpinage

Créer devis

Voir marge sur ses devis

Voir factures liées à ses clients

Voir planning global

Créer événements planning

Envoyer/recevoir emails

Voir dashboard personnel

Créer notes

Modifier ses propres notes

Ne peut pas :

Supprimer clients

Modifier catalogue articles

Supprimer notes

Accéder aux logs

Gérer utilisateurs

3.3 PROSPECTEUR

Peut :

Voir ses leads

Créer leads

Modifier ses leads

Planifier RDV

Voir planning filtré

Voir ses leads transformés en clients (lecture seule)

Créer notes sur ses leads

Modifier ses propres notes

Ne peut pas :

Voir études

Voir devis

Voir factures

Voir marges

Accéder emails globaux

Supprimer notes

Accéder dashboard financier

3.4 BACKOFFICE

Peut :

Voir tous clients

Modifier statut projet

Accéder documents

Créer et modifier devis

Créer factures

Enregistrer paiements

Gérer planning installation

Gérer DP

Voir emails liés clients

Voir dashboard global

Voir marges

Créer notes

Modifier ses propres notes

Ne peut pas :

Supprimer clients

Gérer utilisateurs

Supprimer notes

3.5 CLIENT

Peut :

Voir son étude (toutes versions)

Voir son devis

Télécharger PDF

Voir statut projet

Voir planning installation

Envoyer message

Ne peut pas :

Modifier données système

Voir marges

Voir autres clients

Accéder notes internes

4. MODULE NOTES

Règles spécifiques :

Suppression : ADMIN uniquement

Modification : auteur uniquement (sauf ADMIN)

Notes historisées (audit log obligatoire)

5. DÉCISIONS VALIDÉES

Backoffice voit la marge.

Commercial peut voir les clients des autres commerciaux (lecture seule).

Prospecteur peut voir ses leads transformés en clients (lecture seule).

Client peut voir les anciennes versions d'étude.

Admin peut déléguer ses droits via multi-rôle.
