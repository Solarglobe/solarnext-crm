SOLARGLOBE CRM
CP-004 — Dictionnaire Officiel des Statuts Projet

Version: 1.0
Statut: VALIDÉ
Date: 2026

1. OBJECTIF

Définir le workflow officiel post-signature pour le suivi projet client.

Ce statut appartient au Client (projet).
Un seul statut actif à la fois.

2. LISTE OFFICIELLE DES STATUTS

Ordre logique :

Signé

DP à déposer

DP déposée

DP acceptée

DP refusée

Installation planifiée

Installation réalisée

Consuel en attente

Consuel obtenu

Mise en service

Terminé

Annulé

3. RÈGLES GÉNÉRALES

Chaque changement de statut :

Enregistre automatiquement la date

Génère un audit log

Historique complet conservé

Retour arrière autorisé mais journalisé

Annulé = statut terminal

Terminé = projet clos mais conservé

4. RÈGLES DE TRANSITION
4.1 Flux standard

Signé
→ DP à déposer
→ DP déposée
→ DP acceptée
→ Installation planifiée
→ Installation réalisée
→ Consuel en attente
→ Consuel obtenu
→ Mise en service
→ Terminé

4.2 Cas particuliers

DP refusée peut mener vers :

Annulé

DP à déposer (nouvelle tentative)

Annulé peut être appliqué à tout moment

Retour arrière autorisé si erreur ou correction administrative

5. DATES ASSOCIÉES (RECOMMANDÉ DB)

signed_at

dp_to_submit_at

dp_submitted_at

dp_approved_at

dp_refused_at

installation_planned_at

installation_done_at

consuel_pending_at

consuel_obtained_at

grid_connection_at

completed_at

cancelled_at

6. RBAC

Peuvent modifier le statut :

ADMIN

COMMERCIAL

BACKOFFICE

Ne peuvent pas modifier :

PROSPECTEUR

CLIENT

7. IMPACT KPI

Les statuts permettent :

Calcul du délai DP

Calcul du délai installation

Taux de projets annulés

CA réellement mis en service

Pipeline projet en cours

Statut CP-004 : VALIDÉ ET FIGÉ

Toute modification future nécessite une nouvelle version documentée.
