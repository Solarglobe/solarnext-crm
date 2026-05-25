# CRM Release Quality Gate

Objectif : bloquer une mise en production si l'experience SaaS visible est cassee, meme quand le build passe.

## Responsable

Le responsable release est la personne qui declenche la mise en production. Elle coche la checklist, verifie les artefacts Playwright, et decide go/no-go.

## Commandes

Gate CI ou local avec serveurs lances par Playwright :

```powershell
$env:E2E_START_SERVERS="1"
npm run test:e2e -- --grep "release go/no-go CRM smoke"
```

Gate manuel si backend/frontend tournent deja :

```powershell
npm run test:e2e -- --grep "release go/no-go CRM smoke"
```

Temps cible : moins de 20 minutes, migrations incluses en CI.

## Checklist Go/No-Go

Go uniquement si tout est vrai :

- CI verte : lint, typecheck, backend, build frontend, Playwright.
- Onboarding : un compte incomplet est bloque sur `/onboarding`; apres completion, `/dashboard` s'ouvre.
- Navigation : menu CRM visible et stable en desktop et mobile.
- Dashboard : page chargee sans 403, page blanche, erreur runtime ou redirection inattendue.
- Leads : liste accessible, filtres/actions visibles, pas de debordement majeur.
- Clients : liste accessible, pas de doublon de navigation avec les fiches lead/client.
- Devis : liste accessible, action principale lisible.
- Factures : liste accessible, action principale lisible.
- Settings : hub accessible; Securite et Audit restent decouvrables pour admin org.
- Captures Playwright consultees : `release-desktop-dashboard` et `release-mobile-leads`.

No-go immediat si :

- `/dashboard`, `/leads`, `/clients`, `/quotes`, `/invoices` ou `/settings` renvoie 403 pour l'admin E2E.
- L'onboarding est contournable avant completion ou bloque encore apres completion.
- Le menu mobile ne permet plus d'atteindre Leads, Clients, Devis, Factures ou Parametres.
- Page blanche, erreur runtime visible, overlap majeur ou texte critique illisible.

## Couverture Smoke

Le test `e2e/release-smoke.spec.ts` couvre :

- onboarding guard;
- dashboard;
- leads;
- clients;
- devis;
- factures;
- settings;
- navigation mobile;
- screenshots desktop/mobile attaches au rapport Playwright.

Les fixtures sont isolees : organisation et utilisateur E2E crees pour le test puis nettoyes. Aucune donnee production.

## Rollback

1. Mettre la release en pause et annoncer le no-go.
2. Identifier le dernier commit de production stable.
3. Revert le commit ou redeployer l'image stable selon la plateforme.
4. Relancer migrations uniquement si elles sont reversibles et documentees; sinon appliquer un correctif forward.
5. Relancer le gate `release go/no-go CRM smoke`.
6. Documenter cause, impact, action corrective et commit de reprise.
