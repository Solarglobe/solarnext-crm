# Recette CERFA — protocole de validation finale

Référence code : `dp-app.js` (bloc CERFA), `pages/cerfa.html`, PDF source `photos/cerfa_16702-02.pdf`, inventaire champs `list-cerfa-fields.js`.

## Outils

| Outil | Usage |
|--------|--------|
| `node list-cerfa-fields.js` | Liste les 375 champs du PDF (vérification noms) |
| `window.__solarnextCerfaApi` | Helpers + `validateCerfaPreExport` en console |
| `window.__SOLARNEXT_CERFA_LAST_REPORT` | Dernier rapport de remplissage |
| `window.__solarnextCerfaRecetteFixtures` | Scénarios données (fichier `cerfa-recette-fixtures.js`) |
| Mode debug | `?cerfaDebug=1` ou `localStorage SOLARNEXT_CERFA_DEBUG=1` → pas de `flatten` |

## Table — champs PDF réellement branchés

### Champs texte (remplissage automatique)

| Nom PDF | Source / règle |
|---------|------------------|
| `N1FCA_formulaire` | Constant `DPC` |
| `D1N_nom`, `D1P_prenom`, `D1E_pays` | CRM / `DP1_CONTEXT` + `SMARTPITCH_CTX.client` ; pays défaut FRANCE |
| `D3N_numero`, `D3V_voie`, `D3L_localite`, `D3C_code` | Adresse parsée + cp + ville |
| `D3T_telephone`, `D3K_indicatif` | Téléphone normalisé FR ; indicatif 33 |
| `D5GE1_email`, `D5GE2_email` | Partie locale / domaine |
| `T2Q_numero`, `T2V_voie`, `T2L_localite`, `T2C_code` | Même adresse que D3* |
| `T2S_section`, `T2N_numero`, `T2T_superficie` | `DP1_STATE.selectedParcel` |
| `D5T_total` | Surface parcelle arrondie si > 0 |
| `C2ZA7_autres` | Libellé travaux (défaut pose PV) ou `CERFA_STATE.c2za7AutresLabel` |
| `C2ZD1_description` | `buildCerfaDescriptionText(CERFA_STATE)` uniquement |
| `C2ZP1_crete` | Puissance kWc formatée (`formatPowerCerfa`) |
| `C2ZE1_puissance` | `0` si `forcePuissanceElecZero` |
| `C2ZR1_destination` | Texte dérivé de `energyManagement` |
| `W3ES2_creee`, `W3ES3_supprimee` | `0` ou valeurs `CERFA_STATE` |
| `E1L_lieu`, `E1D_date` | Ville + `formatDateCerfa` (JJ/MM/AAAA) |
| `E1S_signature` | **Toujours vidé** (réservé signature manuscrite) |

### Cases à cocher (branchement explicite)

| Nom(s) PDF | Condition |
|------------|-----------|
| `D5A_acceptation` | `CERFA_STATE.declarantAcceptEmailContact === true` |
| `T3A_CUoui` / `T3H_CUnon` / `T3B_CUnc` | `urbanismeCU` = oui \| non \| nc |
| `T3I_lotoui` / `T3L_lotnon` / `T3S_lotnc` | `urbanismeLot` |
| `T3J_ZACoui` / `T3Q_ZACnon` / `T3T_ZACnc` | `urbanismeZAC` |
| `T3G_AFUoui` / `T3R_AFUnon` / `T3E_AFUnc` | `urbanismeAFU` |
| `T3P_PUPoui` / `T3C_PUPnon` / `T3F_PUPnc` | `urbanismePUP` |
| `C2ZA1_nouvelle` | `constructionType` new / nouvelle |
| `C2ZB1_existante` | `constructionType` existing / existante |
| `C5ZD1_personnel` / `C5ZD2_vente` / `C5ZD3_location` | `occupationMode` |
| `C2ZF1_principale` / `C2ZF2_secondaire` | `residenceType` |
| `X1V_toiture` | `installationOnRoof === true` **ou** `roofOrientation` non vide |
| `X1V0_toiture` | `installationOnRoof === false` |

**Non branchés (volontairement)** : grilles P4/P5/P6 et autres cases du formulaire non listées ci-dessus — pas d’automatisme sans cahier des charges détaillé.

### Divergences PDF ↔ code

Aucune au regard de `list-cerfa-fields.js` pour les noms ci-dessus (l’ancien code référençait `P5PA1` qui **n’existe pas** sur ce modèle ; corrigé depuis).

---

## Erreurs bloquantes (export refusé)

| Code | Condition |
|------|-----------|
| `DECLARANT_NOM_MANQUANT` | Nom vide |
| `ADRESSE_POSTALE_INCOMPLETE` | CP ou ville vide |
| `DESCRIPTION_VIDE` | Texte description vide |
| `PUISSANCE_CRETE_INCOMPLETE` | Panneaux ou Wc unitaire invalides |
| `PUISSANCE_KWC_VIDE` | kWc non calculée |

## Avertissements (confirm utilisateur puis PDF)

| Code | Comportement |
|------|----------------|
| `TELEPHONE_ABSENT` | D3T vide |
| `PARCELLE_MANQUANTE` | Pas de section/numéro parcelle |
| `DP1_NON_VALIDE` | Parcelle présente mais `isValidated === false` |
| `GESTION_ENERGIE_NON_RENSEIGNEE` | C2ZR1 sera vide |

## Garde-fou post-remplissage

Si `missingRequired` ou `fieldErrors` dans le rapport après `fillCerfaFields` → alerte, **pas** d’ouverture du PDF (ex. renommage champ AcroForm).

---

## Protocole scénarios (10 + debug)

Pour chaque scénario : appliquer la fixture si dispo → **Générer la description** → **Créer le CERFA (PDF)** → contrôler visuel + console.

| # | Scénario | Données min. | Attendu | Blocage |
|---|-----------|--------------|---------|---------|
| 1 | Client standard | Fixture `scenario1` + description | PDF complet, cases existant / perso / princ. cochées si UI | Non |
| 2 | Adresse complexe | `scenario2` | Numéro/voie parsés ou voie pleine | Non si cp/ville OK |
| 3 | Téléphone absent | `scenario3` | Warning téléphone, D3T vide | Non |
| 4 | Parcelle absente | `scenario4` | Warning parcelle, T2* vides | Non |
| 5 | Puissance absente | `scenario5` | **Bloqué** | Oui |
| 6 | Construction neuve | `scenario6` | `C2ZA1_nouvelle` cochée | Non |
| 7 | Construction existante | `scenario7` | `C2ZB1_existante` cochée | Non |
| 8a–c | Occupation | `scenario8a/b/c` | Case C5ZD* correspondante | Non |
| 9a–b | Résidence | `scenario9a/b` | C2ZF1 ou C2ZF2 | Non |
| 10a | Mode final | Sans `cerfaDebug` | `flatten` appliqué | Sauf erreur flatten |
| 10b | Mode debug | `enableDebugMode()` + recharger ou `?cerfaDebug=1` | Pas de flatten, champs éditables | Non |

---

## Points sécurisés (verrouillage qualité)

- Aucune lecture DOM dans `buildCerfaDescriptionText` (seulement état passé / `CERFA_STATE`).
- Aucune coche urbanisme / P* « en masse » sans valeur `oui|non|nc`.
- Zone signature : texte effacé, pas de nom du déclarant dans `E1S_signature`.
- Champs critiques : nom, cp, ville, description, puissance — plus garde-fou rapport PDF.

## Points non automatisés (assumés)

- Triplets urbanisme (CU, lot, ZAC, AFU, PUP) sans UI dédiée : à renseigner via `CERFA_STATE` ou à la main sur le PDF.
- Grilles annexes CERFA (nombreux champs W2*, P4*, etc.).
- Mandataire / personne morale (champs D2*, V1*, etc.).
