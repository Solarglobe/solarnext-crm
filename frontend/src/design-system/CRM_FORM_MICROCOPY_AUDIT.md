# Audit microcopy formulaires CRM

## Synthèse

Objectif : raccourcir les formulaires sans retirer de champs utiles. Les champs principaux restent visibles, les réglages techniques ou rares passent en sections repliées.

## Changements appliqués

| Surface | Ajustement |
| --- | --- |
| Onboarding | Accents corrigés, messages d'étape clarifiés, CTA harmonisés autour de `Continuer` et `Créer le premier lead`. |
| Paiement facture | Erreur de montant plus explicite, libellé `Mode de paiement`, référence et note interne repliées. |
| Avoir facture | Texte technique supprimé, motif plus concret, TVA et émission immédiate en options avancées. |
| Relance facture | Sous-titre raccourci, `Note` remplacé par `Résumé`, prochaine action repliée. |
| Notes facture | `Note client` plus clair, conditions de règlement repliées. |
| Email groupé | Suppression du jargon HTML visible, confirmation propre avant envoi, texte opt-in simplifié. |
| Composer mail | Libellés raccourcis : `Modèles`, `Message`, état d'envoi plus simple. |
| Comptes mail | Paramètres d'envoi SMTP repliés, libellés orientés usage (`Réception`, `Paramètres d'envoi`). |

## Règles à garder

- CTA primaires : `Enregistrer`, `Continuer`, `Envoyer`, `Créer`.
- CTA secondaires : `Annuler`, `Retour`, `Fermer`.
- Éviter les mots visibles `backend`, `metadata`, `JSON`, `UUID`, sauf contexte technique admin.
- Les erreurs doivent dire quoi corriger, pas seulement `Erreur`.
- Sur mobile, garder les champs avancés repliés par défaut.
