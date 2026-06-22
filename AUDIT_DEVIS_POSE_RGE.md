# AUDIT — Devis SolarGlobe : ligne « Main-d'œuvre (partenaire RGE) » incluse dans le Total HT

**Date :** 22/06/2026
**Périmètre :** chaîne complète création devis → base de données → PDF → facture
**Statut :** diagnostic uniquement — aucune modification de code effectuée.

---

## 0. Synthèse exécutive

La contradiction contractuelle est **réelle et systémique**, pas un accident d'affichage.

Le système ne possède **aucune notion de ligne « externe / installateur / hors-périmètre SolarGlobe »**. Toutes les lignes d'un devis vivent dans une seule table `quote_lines`, et le moteur de totaux additionne **toutes** les lignes actives sans distinction (seule exception : les lignes de remise `DOCUMENT_DISCOUNT`). La ligne « Installation photovoltaïque – Main-d'œuvre (partenaire RGE) » à 2 100 € HT est donc une ligne ordinaire : elle est sommée dans le Total HT/TVA/TTC SolarGlobe, rendue dans le même tableau PDF que le matériel, **figée dans le snapshot contractuel**, puis **reprise telle quelle dans la facture**.

Les CGV (texte juridique disant « pose non réalisée / non facturée / non encaissée par SolarGlobe ») sont **fusionnées en pages séparées** ou injectées comme bloc HTML indépendant, sans aucun lien avec le calcul des lignes. D'où la contradiction : un total qui inclut la pose, à côté d'un texte qui dit que SolarGlobe ne facture pas la pose.

**Cause racine :** absence d'attribut de catégorisation de ligne (type d'émetteur / inclusion dans le total) dans le modèle de données, le moteur de calcul, le template PDF et la facture.

---

## 1. Carte des fichiers impliqués

### 1.1 Modèle de données / base

| Fichier | Rôle |
|---|---|
| `backend/migrations/1771160200000_cp-quote-004-quote-lines-catalog-snapshot.js` | Colonnes `quote_lines` : `catalog_item_id`, `snapshot_json`, `purchase_unit_price_ht_cents`, `vat_rate_bps`, `pricing_mode`, `is_optional`, `is_active`, `updated_at` |
| `backend/migrations/1771160300000_cp-quote-005-snapshot-hardening.js` | Durcissement snapshot devis |
| `backend/migrations/1771180000000_cp-financial-pole-schema.js` | Schéma financier (quotes / lignes / invoices) |
| Table `quote_lines` | Lignes devis. **Aucune** colonne `is_external`, `third_party`, `source_type`, `line_kind` réelle |
| Table `quote_catalog_items` | Catalogue d'articles (source des lignes « catalog ») |
| Table `invoices` / `invoice_lines` | Facture et ses lignes (copie du devis) |

### 1.2 Frontend (création / édition)

| Fichier | Rôle |
|---|---|
| `frontend/src/modules/quotes/QuoteBuilderPage.tsx` | Écran principal devis : chargement, sauvegarde, ajout de lignes |
| `frontend/src/modules/quotes/QuoteLinesTable.tsx` | Tableau d'édition des lignes |
| `frontend/src/modules/quotes/quote.types.ts` | Type `QuoteLine` (champs d'une ligne) |
| `frontend/src/modules/quotes/quoteCalc.ts` | Calcul HT / TVA / TTC côté front |
| `frontend/src/modules/quotes/QuoteBuilderStore.ts` | Sérialisation des lignes pour l'API |
| `frontend/src/modules/quotes/quotePrepImport.ts` | Import lignes depuis l'étude (quote-prep) |
| `frontend/src/modules/quotes/QuoteSummaryPanel.tsx` | Affichage des totaux |
| `frontend/src/services/financial.api.ts` | Appels API devis/facture |

### 1.3 Backend (services / endpoints)

| Fichier | Rôle |
|---|---|
| `backend/domains/quotes/quotes.router.js` | Endpoints `/api/quotes/*` |
| `backend/domains/quotes/quotes.repository.js` | Persistance devis + déclenchement PDF + fusion CGV |
| `backend/services/quoteEngine.service.js` | **Calcul des totaux** (`computeQuoteTotalsFromLines`) |
| `backend/services/financialDocumentSnapshot.service.js` | Mapping des lignes + snapshot contractuel figé |
| `backend/services/financialDocumentPdfPayload.service.js` | Payload PDF |
| `backend/services/invoices.service.js` | Création facture depuis devis |
| `backend/routes/invoices.routes.js` | Endpoints `/api/invoices/*` |

### 1.4 Génération PDF + CGV

| Fichier | Rôle |
|---|---|
| `backend/services/pdfGeneration.service.js` | Rendu Playwright → PDF (`generatePdfFromFinancialQuoteUrl`, l.315) |
| `backend/controllers/internalFinancialQuotePdf.controller.js` | Endpoint interne payload PDF devis |
| `frontend/src/financial-quote-pdf-render.tsx` | Page de rendu PDF (montage) |
| `frontend/src/pages/pdf/FinancialQuotePdfPage.tsx` | Récupère le payload et monte la vue |
| `frontend/src/modules/quotes/QuoteDocumentView.tsx` | **Template devis** : tableau des lignes + totaux |
| `frontend/src/pages/pdf/PdfLegacyPort/PdfCgvSection.tsx` | Rendu CGV inline (mode html/url) |
| `backend/services/legalCgv.service.js` | Lecture des CGV (`organizations.settings_json.legal.cgv`) |
| `backend/services/legalCgvPdfMerge.service.js` | **Fusion** des CGV PDF en pages séparées |

> Note : `pdf-template/smartpitch-solarglobe.html` (qui contient « Pose par partenaire RGE », « Pose & mise en service ») est le **PDF de proposition commerciale / étude**, *distinct* du PDF de devis financier. Ne pas confondre les deux documents.

---

## 2. Flux actuel : devis → base → PDF → facture

```
SAISIE (commercial)
  • Catalogue (quote_catalog_items)  ── addCatalogLine()
  • Ligne libre                      ── addFreeLine()
  • Remise                           ── addDiscountLine()  (line_kind=DOCUMENT_DISCOUNT)
  • Import étude (quote-prep)        ── quotePrepImport.ts
        │   QuoteBuilderPage.tsx → linesToSaveItems() (QuoteBuilderStore.ts)
        ▼
API  PATCH /api/quotes/:id  (items[])
        ▼
BASE  quote_lines (1 ligne = 1 row ; aucune notion d'émetteur/externe)
        ▼
TOTAUX  quoteEngine.service.js → computeQuoteTotalsFromLines()
        Σ total_line_ht/vat/ttc WHERE is_active IS DISTINCT FROM false
        → écrit quotes.total_ht / total_vat / total_ttc
        ▼
SNAPSHOT  financialDocumentSnapshot.service.js
        mapQuoteLine() (toutes lignes) + computeQuoteTotalsFromSnapshotLines()
        → document_snapshot_json (figé à l'acceptation)
        ▼
PDF  pdfGeneration.service.js (Playwright)
        → /financial-quote-pdf-render.html
        → QuoteDocumentView.tsx : lineTbodies() rend TOUTES les lignes,
          totaux = payload.totals (= Σ toutes lignes)
        → CGV ajoutées : legalCgvPdfMerge.service.js (pages séparées)
        ▼
FACTURE  invoices.service.js → createInvoiceFromQuote()
        copie les lignes / le total du devis (pose incluse)
```

---

## 3. Localisation exacte du problème

### 3.1 Le calcul des totaux additionne tout

`backend/services/quoteEngine.service.js`, fonction `computeQuoteTotalsFromLines` (lignes 97-153) :

```sql
-- lignes 127-135
SELECT
  COALESCE(SUM(total_line_ht)  FILTER (WHERE is_active IS DISTINCT FROM false), 0) AS th,
  COALESCE(SUM(total_line_vat) FILTER (WHERE is_active IS DISTINCT FROM false), 0) AS tv,
  COALESCE(SUM(total_line_ttc) FILTER (WHERE is_active IS DISTINCT FROM false), 0) AS ttc
FROM quote_lines
WHERE quote_id = $1 AND organization_id = $2
```

Commentaire du code lui-même (l.92) : *« Source de vérité unique : Σ quote_lines (lignes actives) → quotes.total_* »*. **Aucun filtre** par type/émetteur. Le seul cas spécial est `DOCUMENT_DISCOUNT` (lignes 106-125), uniquement pour valider une remise d'en-tête. La colonne `is_optional` existe mais **n'exclut rien** du total.

### 3.2 Le snapshot fige le même total « tout inclus »

`backend/services/financialDocumentSnapshot.service.js` :
- `mapQuoteLine` (l.117-139) : mappe chaque ligne ; le seul attribut « type » est `line_kind` lu depuis `snapshot_json` (JSON), jamais positionné à autre chose que `DOCUMENT_DISCOUNT`.
- `computeQuoteTotalsFromSnapshotLines` (l.160-174) : **somme inconditionnelle** de `total_line_ht/vat/ttc` de toutes les lignes.

### 3.3 Le modèle de données n'a pas la notion

`backend/migrations/1771160200000_cp-quote-004-quote-lines-catalog-snapshot.js` : la table `quote_lines` n'a **ni** `is_external`, **ni** `third_party`, **ni** `source_type`. `line_kind` n'est **pas une colonne** : c'est une clé dans le JSONB `snapshot_json` (`snapshot_json->>'line_kind'`), utilisée seulement pour les remises.

### 3.4 Le PDF rend tout dans un seul tableau, sans séparation

`frontend/src/modules/quotes/QuoteDocumentView.tsx`, `lineTbodies()` (l.211-251) : boucle sur **toutes** `lines` et les rend dans une seule table (label, qté, PU HT, total ligne HT). Aucune section A/B, aucune exclusion. Les totaux affichés proviennent de `payload.totals` (déjà « tout inclus »).

### 3.5 Les CGV sont indépendantes du calcul

CGV stockées dans `organizations.settings_json.legal.cgv` (`backend/services/legalCgv.service.js`), 3 modes :
- `pdf` → fusionnées en **pages séparées** après le devis (`backend/services/legalCgvPdfMerge.service.js`, `mergeOrganizationCgvPdfAppend`) ;
- `html` → bloc HTML rendu par `PdfCgvSection.tsx` ;
- `url` → lien + QR code.

Dans tous les cas, le texte CGV **ne corrige jamais** les lignes ni les totaux. → contradiction structurelle.

### 3.6 Origine concrète de la ligne « Main-d'œuvre (partenaire RGE) »

La chaîne `"Main-d'œuvre"` / `"partenaire RGE"` **n'existe nulle part dans le code** backend/JS (hors l'ancien `smartpitch-solarglobe.html`). La ligne est donc **soit un article du catalogue** `quote_catalog_items` (créé en admin), **soit une ligne saisie manuellement** par le commercial, **soit importée** de l'étude. Dans tous les cas elle entre dans `quote_lines` comme une ligne normale → sommée dans le total. Il n'y a donc **pas de bug ponctuel** à patcher : c'est l'architecture qui manque d'une catégorie.

---

## 4. Risques fonctionnels et contractuels

1. **Contradiction contractuelle / juridique** : le devis facture (au sens comptable) une prestation que les CGV déclarent non facturée par SolarGlobe. Risque de contestation client, requalification, voire risque sur la TVA réduite et le rôle de SolarGlobe (revente vs sous-traitance de pose).
2. **Total SolarGlobe surévalué** : le « Total HT SolarGlobe » englobe 2 100 € qui ne reviennent pas à SolarGlobe.
3. **Facture incohérente par héritage** : `createInvoiceFromQuote` (`invoices.service.js`, l.1206) et le contexte de facturation (Σ `quote_lines`, l.895) reprennent le total devis pose incluse → SolarGlobe risque d'**émettre une facture qui encaisse la pose**, ce que les CGV interdisent.
4. **Snapshot figé** : à l'acceptation, le total « tout inclus » est figé (`document_snapshot_json`) et hashé pour la signature → la contradiction est gravée dans le document signé.
5. **Acompte / échéancier faux** : tout acompte « % du TTC » est calculé sur un TTC gonflé par la pose.
6. **Marge faussée** : la pose n'a pas de prix d'achat (`purchase_unit_price_ht_cents`), donc elle gonfle le CA matériel apparent sans coût → indicateurs de marge biaisés.

---

## 5. Proposition d'architecture cible (à valider, non implémentée)

Introduire une **catégorisation de ligne** de bout en bout :

1. **Donnée** : ajouter à `quote_lines` une colonne `billing_party` (enum : `SOLARGLOBE` | `INSTALLER_RGE`) **ou** un booléen `excluded_from_total` + `is_informational`. Idem `quote_catalog_items` (un article peut être marqué « pose externe »). Idem `invoice_lines`.
2. **Moteur de totaux** (`quoteEngine.service.js`) : calculer **trois agrégats** :
   - `total_solarglobe_*` = Σ lignes `SOLARGLOBE` (le seul total facturé/encaissé) ;
   - `total_installer_estimate_ttc` = Σ lignes `INSTALLER_RGE` (indicatif, jamais facturé) ;
   - `total_projet_indicatif_ttc` = SolarGlobe + estimation installateur (vision globale uniquement).
3. **Snapshot** : figer ces trois blocs séparément.
4. **PDF** (`QuoteDocumentView.tsx`) : deux sections distinctes —
   - **A. Prestations SolarGlobe** (matériel, coffret, étude, démarches, raccordement si facturé, accompagnement) → Total SolarGlobe HT / TVA / TTC ;
   - **B. Pose toiture — installateur RGE indépendant** : montant estimatif, mentions « non inclus / non facturé / non encaissé par SolarGlobe, devis séparé, paiement direct client → installateur » ;
   - **C. Coût global indicatif du projet** (A + B), clairement libellé « indicatif, non facturé par SolarGlobe ».
5. **Facture** : ne **jamais** copier les lignes `INSTALLER_RGE`. Garde-fou backend qui refuse/filtre ces lignes à la création de facture.
6. **CGV** : aligner le texte avec la séparation A/B/C affichée.

---

## 6. Liste des modifications à faire ensuite (ordre recommandé)

1. **Décision métier** : enum `billing_party` vs flags ; faut-il garder l'estimation pose dans le PDF (section B) ou pas du tout. *(préalable à tout code)*
2. **Migration DB** : ajouter la colonne sur `quote_lines`, `quote_catalog_items`, `invoice_lines` avec **valeur par défaut `SOLARGLOBE`** (rétro-compatible : les devis existants restent identiques).
3. **Catalogue** : marquer l'article « Main-d'œuvre pose » comme `INSTALLER_RGE`.
4. **Moteur de totaux** : produire les 3 agrégats ; conserver `total_ht/ttc` = total **SolarGlobe** pour ne pas casser facture/acompte.
5. **Snapshot** : ajouter les blocs séparés.
6. **Backend facture** : exclure les lignes `INSTALLER_RGE`.
7. **PDF** : sections A / B / C + mentions CGV.
8. **Frontend builder** : sélecteur d'émetteur sur la ligne + affichage des totaux séparés.
9. **CGV** : harmoniser le texte.
10. **Tests** : non-régression totaux, snapshot, facture ; cas « devis avec pose externe ».

---

## 7. Points de vigilance avant toute modification

- **Snapshots déjà signés** : ne pas recalculer rétroactivement les devis signés (le hash de signature deviendrait invalide). La migration doit être **non rétroactive** (défaut `SOLARGLOBE`).
- **`total_ht/total_ttc` est consommé partout** (facture, acompte, dashboard, contexte de facturation `invoices.service.js` l.895). Si on redéfinit ce champ comme « SolarGlobe seul », vérifier chaque consommateur ; sinon garder `total_*` = SolarGlobe et ajouter des champs `*_installer` / `*_projet` séparés.
- **Repo en CRLF** ; mémo interne : éditer via bash/Edit selon le fichier, ne jamais `git stash` dans ce repo.
- **Cohérence devis ↔ facture** : tout changement de définition de total doit être testé sur le flux `createInvoiceFromQuote` + contexte de facturation (acompte/solde).
- **TVA** : si la pose sort du périmètre SolarGlobe, revoir le traitement TVA des lignes restantes (taux réduit conditionné à l'installation par RGE — à cadrer juridiquement).
- **Éléments manquants au devis** (relevés, à ajouter dans le même chantier) : échéancier en euros, identité de l'installateur RGE retenu, mention explicite du devis séparé, attestations RGE/QualiPV + décennale couvrant la pose PV, délai prévisionnel, et meilleure ventilation tarifaire (matériel / étude / démarches / raccordement / accompagnement / pose externe).

---

*Fin de l'audit — aucune correction appliquée. Prochaine étape : valider la décision métier du point 6.1 avant tout développement.*
