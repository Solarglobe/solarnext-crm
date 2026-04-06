# CP-PDF-V2-017 — Livrable : Nettoyage intégral contenu PDF V2

## Résumé

Nettoyage structurel du contenu du flux PDF V2 (StudySnapshotPdfPage) : placeholders, wording, absence de pages formulaire.

---

## 1. Périmètre PDF V2 scanné

| Fichier | Rôle |
|---------|------|
| `frontend/src/pages/pdf/StudySnapshotPdfPage.tsx` | Page principale rendu PDF |
| `frontend/src/pages/pdf/pdf-print.css` | Styles impression |
| `frontend/src/pdf-render.tsx` | Entrée Vite renderer |
| `backend/services/pdf/pdfViewModel.mapper.js` | Snapshot → ViewModel |
| `backend/services/pdf/pdfViewModel.service.js` | Service lecture snapshot |

**Note** : Aucun composant dans `frontend/src/components/pdf` — le flux V2 est autonome dans `pages/pdf`.

---

## 2. Textes corrigés

| Emplacement | Avant | Après |
|-------------|-------|-------|
| Client (nom vide) | `—` | `Non renseigné` |
| Scénario (vide) | `—` | `Non renseigné` |
| Production annuelle (null) | `—` | `Non renseigné` |
| ROI (null) | `—` | `Non renseigné` |
| Affichage scénario | `vm.meta?.scenarioType` (ex. "BASE") | `vm.selectedScenario?.label` (ex. "Sans batterie") |

**Convention adoptée** : `EMPTY_VALUE = "Non renseigné"` — ton professionnel, cohérent, lisible.

---

## 3. Composants / pages nettoyés

| Composant | Modifications |
|-----------|---------------|
| `StudySnapshotPdfPage.tsx` | Constante `EMPTY_VALUE`, remplacement des 4 placeholders "—", utilisation de `selectedScenario.label` |
| `pdf-render-v2.spec.ts` | Ajout `selectedScenario` au mock, nouveau test CP-PDF-V2-017 |

---

## 4. Preuve grep

### Caractères cassés (mojibake)

```bash
# Recherche dans frontend/src/pages/pdf et backend/services/pdf
rg "�|â€|Ã" frontend/src/pages/pdf backend/services/pdf
# → Aucun match
```

### Saisissez / Ajouter une photo / contenteditable

```bash
rg "Saisissez|Ajouter une photo" frontend/src/pages/pdf frontend/src/components/pdf
# → Aucun match (périmètre PDF V2)
```

**Conclusion** : Aucune trace de formulaire ou d’instructions utilisateur dans le flux PDF V2.

### Placeholders "—" (avant correction)

Avant : 4 occurrences dans `StudySnapshotPdfPage.tsx` (client, scénario, production, ROI).  
Après : 0 occurrence — remplacés par `Non renseigné`.

---

## 5. Rendu final nettoyé

- **Titre** : "Étude photovoltaïque" (UTF-8 correct)
- **Sections** : Client, Installation, Production, ROI
- **Champs manquants** : affichage "Non renseigné" au lieu de "—"
- **Scénario** : libellé lisible ("Sans batterie", "Batterie physique", "Batterie virtuelle") via `selectedScenario.label`
- **Aucune page formulaire** : pas de "Saisissez…", "Ajouter une photo", ni contenu hérité du template HTML

---

## 6. Tests PASS

```
npx playwright test tests/e2e/pdf-render-v2.spec.ts
# 11 passed (14.5s)
```

Nouveau test ajouté :

- **CP-PDF-V2-017 — Champs manquants affichent "Non renseigné" (pas de placeholder —)**  
  Vérifie que le ViewModel vide affiche "Non renseigné" et "Étude photovoltaïque".

---

## 7. Contraintes respectées

- Pas de refonte DA premium
- Focus sur le nettoyage structurel du contenu existant
- Uniquement le flux V2 réellement utilisé (StudySnapshotPdfPage)

---

## 8. Encodage UTF-8

- Fichiers TSX/CSS/JS du périmètre PDF : encodage UTF-8
- Texte "Étude photovoltaïque" et accents : corrects
- Données snapshot (DB) : transmises telles quelles par le mapper ; si mojibake en base, à traiter en migration données
