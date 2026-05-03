# SolarNext CRM Theme Convention

Step 1 decision: the global theme convention is `html.theme-light` and
`html.theme-dark`.

The runtime already applies these classes in `frontend/src/main.tsx` and
`frontend/src/layout/AppLayout.tsx`. New CSS must target those classes, or
theme-neutral tokens, instead of `[data-theme="dark"]`.

Do not add new `[data-theme]` selectors. Existing selectors are legacy debt and
are listed below for the dark-mode cleanup phase.

## Canonical Foundation Tokens

- Gold: `--brand-gold`, `--brand-gold-hover`, `--brand-gold-soft`
- Light surfaces: `--bg-page: #F8F9FC`, `--bg-card: #FFFFFF`,
  `--surface-card: var(--bg-card)`, `--border: #E2E8F0`
- Compact UI: `--font-size-body: 13px`, `--radius-btn: 6px`,
  `--radius-input: 6px`, `--sn-saas-input-h: 32px`

## Legacy Aliases

The foundation layer keeps legacy aliases alive while the CRM is migrated:

- `--gold`, `--gold-soft`, `--gold-glow`
- `--gold-accent`, `--sn-gold`
- `--sn-accent-gold`, `--sn-accent-gold-soft`
- `--sg-brand`, `--sg-brand-hover`

## Phase 2 Primitives

New CRM UI must consume `frontend/src/design-system/primitives.css`.

- Buttons: `sn-btn`, `sg-btn`, and legacy `btn-*` render through the same
  three-variant model: primary, outline/secondary, ghost. CRM controls are
  `32px` high by default and `28px` in `*-sm`.
- Inputs: `sn-input`, `sn-saas-input`, and `sn-saas-textarea` use the shared
  `32px` control height, `6px` radius, transparent border at rest, and the
  violet focus ring.
- Cards: CRM cards should use default surfaces (`--bg-card` + border) or the
  elevated surface (`--bg-elevated` + 0 1px 3px shadow). Decorative glass or
  premium variants are legacy compatibility only.
- Shell: CRM sidebar width is `200px`, nav items are `36px`, and page padding is
  `24px` through primitive shell tokens.

## `[data-theme="dark"]` Migration Inventory

Current source inventory, excluding generated bundles and dependencies:

- `frontend/src/pages/dashboard-page.css`: 74 selectors
- `frontend/src/styles/solarnext-theme.css`: 51 selectors
- `frontend/src/pages/mairies/mairies-page.css`: 18 selectors
- `frontend/src/modules/admin/admin-tab-users.css`: 10 selectors
- `frontend/src/modules/admin/admin-tab-quote-catalog.css`: 8 selectors
- `frontend/src/modules/finance/financial-list-saas.css`: 4 selectors
- `frontend/src/pages/clients/clients-page.css`: 3 selectors
- `frontend/src/modules/admin/admin-org-structure-visual.css`: 3 selectors
- `frontend/src/components/visiteTechnique/VisiteTechniqueModal.module.css`: 2 selectors
- `frontend/src/pages/login-premium.css`: 2 selectors
- `frontend/src/design-system/saas-crm.css`: 2 selectors
- `frontend/src/pages/installation/installation-fiche-technique-page.css`: 2 selectors
- `frontend/src/components/ui/modal-shell.css`: 1 selector
- `frontend/src/components/visiteTechnique/VisiteTechniqueV2.module.css`: 1 selector

These selectors stay unchanged in step 1. They are scheduled for the dark mode
cleanup phase so the first step remains reversible and low risk.
