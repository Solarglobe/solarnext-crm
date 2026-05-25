# Matrice actions dangereuses CRM

Positionnement : les actions ci-dessous doivent toujours combiner permission backend, confirmation UI non native, message d'erreur clair et audit log pour les mutations sensibles.

| Domaine | Action | Permission backend | Confirmation frontend | Audit log | Etat |
| --- | --- | --- | --- | --- | --- |
| Organisations super admin | Impersonation organisation | `SUPER_ADMIN` requis en controller | `ConfirmModal` sur la liste organisations | `SUPER_ADMIN_ORG_IMPERSONATE` | Couvert |
| Organisations super admin | Archivage organisation | `SUPER_ADMIN` requis en controller | `ConfirmModal` | `ORG_ARCHIVED` | Couvert |
| Organisations super admin | Suppression organisation | `SUPER_ADMIN` requis en controller + garde SolarGlobe/JWT + conflit factures/paiements/clients | `ConfirmModal` danger | `ORG_DELETED` | Couvert |
| Organisations super admin | Restauration organisation | `SUPER_ADMIN` requis en controller | Action directe depuis archive | `ORG_RESTORED` | Couvert |
| Utilisateurs admin org | Suppression utilisateur | `user.manage` | `ConfirmModal` danger | `USER_DELETED` | Couvert |
| Utilisateurs admin org | Impersonation utilisateur | `user.manage` route + `SUPER_ADMIN` controller | `ConfirmModal` warning | `SUPER_ADMIN_USER_IMPERSONATE` | Couvert |
| Equipes/agences | Suppression structure | Endpoints admin protégés par RBAC admin | `ConfirmModal` danger | Non critique | Corrigé UI |
| Paramètres entreprise | Suppression logo/couverture PDF | Endpoints admin org | `ConfirmModal` danger | Via settings/media backend existant | Corrigé UI |
| Factures | Suppression facture | `invoice.manage` + `immutabilityGuard` | `ConfirmModal` existant | `INVOICE_DELETED` | Couvert |
| Paiements | Enregistrement paiement | `invoice.manage` | Parcours facture existant | `PAYMENT_RECORDED` | Corrigé audit |
| Paiements | Annulation paiement | `invoice.manage` | `ConfirmModal` existant côté facture | `PAYMENT_CANCELLED` | Corrigé audit |
| Devis | Suppression devis | `quote.manage` | A migrer sur `ConfirmModal` si encore natif dans `QuoteBuilderPage` | `QUOTE_DELETED` | Priorité suivante |
| Mail | Envoi email | `requireMailUseStrict` | Erreurs toast à généraliser | `EMAIL_SENT` | Partiel |
| Mail | Archivage thread | `requireMailUseStrict` + contrôle compte accessible | Confirmation à valider selon écran | Non critique | A suivre |

Décision produit : les confirmations natives `window.alert/window.confirm` sont interdites sur les actions destructives ou sensibles prioritaires. Les prochains lots doivent terminer les devis, leads/clients et mail sans changer les URLs existantes.
