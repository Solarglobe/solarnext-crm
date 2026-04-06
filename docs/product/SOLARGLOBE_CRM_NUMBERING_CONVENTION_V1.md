SOLARGLOBE CRM
CP-005 — Convention Officielle de Numérotation

Version: 1.0
Statut: VALIDÉ
Date: 2026

1. OBJECTIF

Définir une convention de numérotation légale, chronologique, multi-organisation ready et compatible SaaS pour les devis et factures.

2. FORMAT OFFICIEL

Devis :

SG-D-{YYYY}-{NNNN}

Factures :

SG-F-{YYYY}-{NNNN}

Exemples :

SG-D-2026-0001
SG-D-2026-0002
SG-F-2026-0001

3. RÈGLES DE NUMÉROTATION

Compteur distinct pour devis et factures

Compteur distinct par organisation

Compteur repart à 0001 chaque 1er janvier

Année basée sur date d'émission

Numéro attribué uniquement lors du passage au statut "émis"

Brouillon = aucun numéro définitif

4. RÈGLES LÉGALES

Numéro unique et chronologique

Aucun numéro ne peut être modifié après émission

Facture émise ne peut jamais être supprimée

Facture annulée conserve son numéro

Devis annulé conserve son numéro

5. STRUCTURE DB RECOMMANDÉE

Pour quotes :

number

year

sequence

status

Pour invoices :

number

year

sequence

status

Pour organization_settings :

quote_sequence_current_year

invoice_sequence_current_year

6. CAS PARTICULIERS

Passage nouvelle année → reset automatique compteur

Multi-organisation → compteur indépendant par org

Migration historique → possibilité préfixe personnalisé (hors V1)

Statut CP-005 : VALIDÉ ET FIGÉ

Toute modification future nécessite nouvelle version documentée.
