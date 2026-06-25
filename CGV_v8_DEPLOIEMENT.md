# CGV v8 — Déploiement (25/06/2026)

## 1. CGV annexée dans le PDF devis (pages 5-11) — c'est une DONNÉE d'organisation, pas du code

Le composant `PdfCgvSection.tsx` injecte la CGV depuis `organizations.settings_json.legal.cgv` (service backend `legalCgv.service.js`), en mode `html`, `pdf` ou `url`. **Il n'existe aucun texte CGV codé en dur** : la CGV annexée affichée aujourd'hui est l'ancienne version stockée dans l'organisation. Pour rendre les pages 5-11 conformes :

- **Mode `html`** (recommandé, rendu inline) : coller le contenu de **`CGV-SolarGlobe-2026-06-25-v8-org-settings.html`** dans le réglage CGV de l'organisation (Réglages → Légal → CGV, mode HTML). Le backend retire automatiquement les `<script>`.
- **Mode `pdf`** (fusion serveur) : uploader **`CGV-SolarGlobe-2026-06-25-v8-FINAL.pdf`** comme document CGV de l'organisation et le sélectionner.

> Tant que ce réglage n'est pas mis à jour, le devis continuera d'annexer l'ancienne CGV, même si le code est correct.

## 2. Devis (pages 1-3) — code corrigé

`frontend/src/modules/quotes/QuoteDocumentView.tsx` : Section B, Section C, Consuel, paiement pose, encadré signature, demande expresse — **corrigés**. **Rebuild frontend requis** pour que le PDF généré change.

## 3. Section A (page 1) — DONNÉES catalogue, à corriger dans Organisation → Catalogue devis

Les descriptions Section A viennent de `payload.lines[].description` (table catalogue, champ `description`, `billing_party` = `SOLARGLOBE`). Remplacements à appliquer :

| Ancienne formulation | Nouvelle formulation |
|---|---|
| Structure de fixation adaptée à une pose en toiture inclinée. | Structure de fixation fournie pour une pose en toiture inclinée, sous réserve de validation technique et de mise en œuvre par l'installateur RGE indépendant. |
| Matériel sélectionné selon les exigences électriques applicables, notamment la norme NF C 15-100. | Matériel sélectionné sur la base des documentations fabricants et des exigences usuelles applicables aux installations photovoltaïques, la conformité d'exécution, le raccordement et les vérifications réglementaires relevant exclusivement de l'installateur RGE indépendant. |
| analyse de l'implantation | analyse prévisionnelle d'implantation, à finaliser et valider techniquement par l'installateur RGE indépendant avant pose. |
| coordination du projet | coordination commerciale et documentaire du projet sur le seul périmètre SolarGlobe. |

Phrase de fin de Section A à garder : « La pose, le raccordement électrique d'exécution, la mise en service technique et les vérifications sur chantier sont réalisés et facturés directement par un installateur RGE indépendant, juridiquement distinct de SolarGlobe. »

## 4. Bloc « Informations réglementaires & conformité » du devis — paramètre d'organisation

Vient de `payload.regulatory_document_text` (Organisation → Catalogue devis → Document PDF). Texte v8 recommandé : voir `REFONTE_CGV_v8_SECTION_A_ET_CATALOGUE.md` § 3.

## 5. Fichiers livrés (dossier CRM)

- `CGV-SolarGlobe-2026-06-25-v8.md` — source CGV v8 (master).
- `CGV-SolarGlobe-2026-06-25-v8-FINAL.pdf` — CGV v8 PDF (à valider avocat ; pour upload mode `pdf`).
- `CGV-SolarGlobe-2026-06-25-v8-org-settings.html` — CGV v8 HTML (pour coller en mode `html`).
- Page site : `Site Solarglobe/cgv/index.html` (déployer le site).

> Rappel : faire valider par avocat (droit conso/construction), assureur (RC pro) et comptable (TVA) avant diffusion contractuelle.
