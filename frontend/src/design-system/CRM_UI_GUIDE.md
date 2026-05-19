# SolarNext CRM UI Guide

Ce guide définit la fondation UI officielle des pages CRM SolarNext. Il ne remplace pas le thème existant : il s'appuie sur les tokens déjà chargés dans `tokens.css`, `primitives.css`, `saas-crm.css` et `solarnext-theme.css`.

## Structure Officielle D'une Page

Une page CRM doit suivre cet ordre :

1. `PageHeader` : titre, description courte, actions haut niveau.
2. `ActionBar` : recherche, filtres principaux, actions secondaires.
3. `KpiStrip` si la page expose des indicateurs.
4. Surface de contenu : `DataTable`, formulaire, tabs ou sections.
5. `EmptyState` quand aucun résultat n'est disponible.

Les pages ne doivent pas recréer localement leur propre header si `PageHeader` suffit.

## Hiérarchie Visuelle

- Un seul `h1` visible par page.
- Descriptions courtes : deux lignes maximum sur desktop.
- Les textes d'aide longs vont dans une section ou une info contextuelle, pas dans le header.
- Les titres internes utilisent `h2` via `SettingsSection`, `DataTable title` ou composants métiers.

## Actions

- Action principale : bouton `Button variant="primary"`.
- Action destructive : `Button variant="danger"` et confirmation via `ConfirmDialog`.
- Action secondaire : `Button variant="secondary"` ou `ghost`.
- Les actions haut niveau restent dans `PageHeader`.
- Les actions liées aux filtres restent dans `ActionBar`.
- Les actions de ligne restent dans `DataTable`, alignées à droite.

## Filtres

- Les filtres fréquents restent visibles dans `ActionBar`.
- Les filtres avancés doivent être groupés ou repliables.
- Ne pas mélanger CTA métier et filtres dans le même groupe visuel.
- Une page liste doit proposer recherche, statut/période si utile, et reset.

## Tables

Utiliser `DataTable` pour les listes CRM :

- Colonnes stables.
- Alignement à droite pour montants et actions.
- `dense` seulement pour les tables très opérationnelles.
- `loading` avec skeleton.
- `EmptyState` intégré lorsque `rows.length === 0`.
- Pas de tableau custom si `DataTable` couvre le besoin.

## KPI Strips

Utiliser `KpiStrip` pour les indicateurs courts :

- 3 à 6 KPI maximum.
- Label court.
- Valeur tabulaire.
- Hint facultatif.
- Trend uniquement si elle aide la décision.

## Dialogs

- Ne plus utiliser `window.confirm`.
- Utiliser `ConfirmDialog` pour confirmation simple.
- Utiliser `ModalShell` pour formulaire, édition ou contenu long.
- Une action destructive doit toujours préciser son impact.

## Empty States

Un empty state doit dire :

- Ce qui manque.
- Pourquoi c'est normal ou bloquant.
- Quelle action faire ensuite, si une action existe.

Ne pas afficher simplement "Aucun résultat" si l'utilisateur peut agir.

## Settings

Utiliser `SettingsSection` pour les pages de paramètres :

- Une section = une intention.
- Titre court.
- Description claire.
- Actions de section à droite.
- Contenu dense, pas marketing.

## Responsive

- Les headers et actions passent en colonne sous 760px.
- Les tables scrollent horizontalement plutôt que de casser les colonnes métier.
- Les KPI passent en grille auto-fit.
- Aucun texte de bouton ne doit déborder.

## Dark / Light

- Toujours utiliser les variables existantes : `--text-primary`, `--text-muted`, `--surface`, `--surface-card`, `--surface-2`, `--border`, `--border-soft`.
- Ne pas hardcoder `#fff`, `#0f172a`, `#64748b` dans une nouvelle page sauf fallback CSS.
- Les badges utilisent les classes `sn-badge-*`.

## Migration Future

Ordre recommandé :

1. Pages simples : Paramètres, Journal d'audit, Boîte d'envoi.
2. Listes : Documents, Devis, Factures.
3. Pages denses : Mail, Finance.
4. Pages métier profondes : Lead detail, Clients.

Chaque migration doit conserver routes, APIs, permissions et actions existantes.
