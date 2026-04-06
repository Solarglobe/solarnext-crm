# CP-PDF-V2-FINAL — Stabilisation du système PDF

## Objectif

Finaliser définitivement le système PDF basé sur :
- `pdf-render.html`
- `pdf-render.tsx`
- `StudySnapshotPdfPage`

et supprimer l'ancien moteur.

---

## 1. Confirmation suppression legacy

| Élément supprimé | Statut |
|------------------|--------|
| `pdf-template/smartpitch-solarglobe.html` | ✅ Supprimé |
| `pdf-template/engines/` (engine-p1.js à engine-p14.js, engine-main.js) | ✅ Supprimé |
| `pdf-template/` (dossier complet) | ✅ Supprimé |
| `tools/fix_mojibake_pdf.js` (outil obsolète) | ✅ Supprimé |

**Références restantes (sans impact) :**
- `frontend/src/pages/pdf/PdfLegacyPort/*.tsx` : commentaires de documentation sur le portage fidèle
- `backend/services/auditService.js` : commentaire "PDF SmartPitch-Solarglobe"

Aucune route ni import ne pointait vers `pdf-template`. Le backend sert uniquement le renderer React.

---

## 2. Pipeline PDF fonctionnel

| Vérification | Statut |
|--------------|--------|
| Renderer React accessible via `/pdf-render?studyId=...&versionId=...` | ✅ |
| Playwright utilise cette URL pour générer le PDF | ✅ |
| Pipeline : scenario → snapshot → renderer → PDF → document CRM | ✅ |
| Route `POST /api/studies/:studyId/versions/:versionId/generate-pdf` | ✅ |
| RenderToken JWT pour auth interne | ✅ |

---

## 3. Tests

```bash
cd backend && npm run test:pdf-pipeline
```

**Résultat :** ✔ 31 tests passés (tous)

| Test | Description |
|------|--------------|
| TEST 1 | Pipeline complet (snapshot + PDF + document) |
| TEST 2 | Snapshot absent → 400 SCENARIO_SNAPSHOT_REQUIRED |
| TEST 2b/2c | studyId/versionId absent → 400 |
| TEST 3 | Auth manquante → 401 |
| TEST 4 | Version verrouillée → 400 LOCKED_VERSION |
| TEST 5–7 | Autres validations |
| **TEST 8** | **Régénération PDF (2 documents, noms différents)** — corrigé via suffix aléatoire |
| TEST 9 | Validité PDF (%PDF-, pages) |
| TEST 10 | Intégrité document CRM |
| TEST 11 | API documents study_version |
| TEST 12–13 | Performance, memory |

---

## 4. Modifications effectuées

| Fichier | Modification |
|---------|---------------|
| `backend/services/documents.service.js` | Nom de fichier PDF : timestamp 17 chars + suffix aléatoire (6 chars) pour garantir unicité en régénération |
| `pdf-template/` | Supprimé (legacy) |
| `tools/fix_mojibake_pdf.js` | Supprimé (obsolète) |

---

## 5. Livrable

- ✅ Confirmation suppression legacy
- ✅ Pipeline PDF fonctionnel
- ✅ Tous les tests `npm run test:pdf-pipeline` passent
