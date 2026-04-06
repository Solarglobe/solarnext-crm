# CP-PDF-V2-P1 — Livrable portage fidèle Page 1 uniquement

## 1. Fichiers modifiés

| Fichier | Modification |
|---------|--------------|
| `frontend/src/pages/pdf/PdfLegacyPort/PdfPage1.tsx` | Portage fidèle : h2 9.8mm, hero texte (espace stabilité), p1_k_tri logique engine round |
| `frontend/src/pages/pdf/PdfLegacyPort/pdf-legacy-port.css` | Règle `#p1 h2` (9.8mm, line-height 1.05) |

**Aucun autre fichier modifié.**

---

## 2. Preuve que seule P1 a été modifiée

- **PdfPage2.tsx à PdfPage14.tsx** : non modifiés
- **index.tsx** : non modifié (importe PdfPage1 inchangé)
- **Backend** : non modifié
- **Pipeline Playwright** : non modifié
- **FullReport** : non utilisé (PdfLegacyPort en place)

---

## 3. Structure P1 portée fidèlement

| Élément legacy | Implémentation |
|----------------|----------------|
| Header | Logo 18mm, badge "Étude Solarglobe" 6mm, meta client/ref/date |
| Barre dorée | 1mm, gradient #C39847 → #d4af63 |
| Hero h2 | "Votre maison, vos habitudes..." — **fontSize 9.8mm** (legacy #p1 h2) |
| Hero p | "Nous analysons..." — l'autoconsommation, **stabilité** (espace corrigé) |
| Bloc Méthode | p1_m_kwc, p1_m_auto, p1_m_gain — formatKw, formatPct, formatEur |
| Bloc Pourquoi | p1_why |
| Bloc Objectifs | Liste Autonomie, Stabilité, Rentabilité |
| Image | p1_photo 68mm, accueil-pdf.png |
| Légende image | "Vue illustrative d'une installation résidentielle." |
| 4 KPI | p1_k_puissance, p1_k_autonomie, p1_k_tri, p1_k_gains |
| Paramètres | p1_param_kva, p1_param_reseau, p1_param_conso |

---

## 4. Logique engine-p1.js reprise

- **round()** : Math.ceil + toLocaleString("fr-FR") pour valeurs numériques
- **p1_k_tri** : si numérique → round() ; sinon → val() (chaîne affichée telle quelle)
- Champs : p1_client, p1_ref, p1_date, p1_why, p1_m_kwc, p1_m_auto, p1_m_gain, p1_k_puissance, p1_k_autonomie, p1_k_tri, p1_k_gains, p1_param_kva, p1_param_reseau, p1_param_conso

---

## 5. Validation visuelle

**À faire manuellement :**
1. Générer un PDF via le pipeline (generate-pdf → pdf-render → Playwright)
2. Comparer la page 1 avec `Etude-Solarglobe-Descamps-3.88kWc.pdf`
3. Vérifier : header, barre, hero, blocs, image, KPI, paramètres

---

## 6. Écarts restants (non bloquants)

| Élément | Statut | Note |
|---------|--------|------|
| Image p1_photo | À vérifier | Chemin `/pdf-assets/images/accueil-pdf.png` — résolution en contexte pdf-render |
| Police Inter | Fallback | Si Inter absente → system-ui |
| p1_k_tri | ViewModel | Mapper envoie IRR % (nombre) ; legacy PDF cible peut afficher "10 ans" (ROI) — source de données différente |

---

## 7. Confirmations

- P2 à P14 : non modifiés
- Backend : non modifié
- Pipeline Playwright : non modifié
- Couleurs : #C39847, #d4af63, #eee, rgba(195,152,71,0.25) conservées
- Ordre des blocs : identique au legacy
