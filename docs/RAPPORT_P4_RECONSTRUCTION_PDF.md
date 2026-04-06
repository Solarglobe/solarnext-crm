# Rapport d'exécution — Reconstruction P4 PDF Production annuelle

## 1. Ancienne architecture P4 identifiée

### Flux legacy
- **PdfPage4** : composant React sans props, structure HTML statique (IDs `p4_client`, `p4_ref`, `p4_date`, `p4_chart_zone`, `p4-chart`, `p4_numbers`, etc.)
- **engine-p4.js** : script legacy chargé dans `pdf-render.html`, écoutait `p4:update`, hydratait le DOM (meta, drawChart, tableau)
- **engine-bridge.js** : émettait `p4:update` avec `fullReport.p4`
- **useLegacyPdfEngine** : appelait `bindEngineP4(Engine)` et `emitPdfViewData(legacyVM)`
- **pdfViewModel.mapper** : produisait `p4: { meta, production_kwh, consommation_kwh, autoconso_kwh, batterie_kwh }` (12 valeurs mensuelles chacune)

### Problèmes
- Conso mensuelle : formule sinusoïdale artificielle (pas de données réelles)
- Pas d'injection/surplus dans le tableau
- Pas de synthèse (taux auto, couverture, économies)
- CTA bandeau "Saisissez ou collez vos données..." (mode outil)
- Titre "Estimation de la production" (technique)
- Pas de phrase d'intro ni de texte pédagogique

---

## 2. Nouvelle architecture retenue

### Flux actuel
- **PdfPage4** : composant React qui reçoit `viewModel` et `organization`, rend tout en React (comme P1, P2, P3)
- **ChartP4Production** : composant React SVG premium (Catmull-Rom → Bézier, gradients)
- **engine-p4.js** : supprimé du chargement (`pdf-render.html`), plus de `bindEngineP4` dans `useLegacyPdfEngine`
- **pdfViewModel.mapper** : enrichi avec `production_annuelle`, `consommation_annuelle`, `energie_consommee_directement`, `energie_injectee`, `taux_autoconsommation_pct`, `couverture_besoins_pct`, `autonomie_pct`, `economie_annee_1`, `surplus_kwh` mensuel

### Données mensuelles
- Priorité : `options.scenarios_v2[selected].energy.monthly` si disponible (prod, conso, auto, surplus réels)
- Fallback : formule sinusoïdale pour conso, `min(prod, conso)` pour auto, `prod - auto` pour surplus

---

## 3. Fichiers modifiés

| Fichier | Modification |
|---------|--------------|
| `backend/services/pdf/pdfViewModel.mapper.js` | Enrichissement p4 (synthèse, surplus mensuel, priorité energy.monthly) |
| `frontend/src/pages/pdf/PdfLegacyPort/PdfPage4.tsx` | Réécriture complète : viewModel, titre, intro, chart, légende, synthèse, texte pédagogique |
| `frontend/src/pages/pdf/PdfLegacyPort/ChartP4Production.tsx` | **Nouveau** : graphique SVG premium React |
| `frontend/src/pages/pdf/PdfLegacyPort/index.tsx` | Passage de `organization` et `viewModel` à PdfPage4, typage PdfLegacyPortProps |
| `frontend/pdf-render.html` | Suppression du script `engine-p4.js` |
| `frontend/src/pages/pdf/hooks/useLegacyPdfEngine.ts` | Suppression de `bindEngineP4` |
| `frontend/src/pages/pdf/PdfLegacyPort/PdfPage3.tsx` | Correction typage `fullReport.p3b.p3b_auto` |

---

## 4. Logique de données retenue

### fullReport.p4 (nouveau format)
```javascript
{
  meta: { client, ref, date_display },
  production_kwh: [12],
  consommation_kwh: [12],
  autoconso_kwh: [12],
  surplus_kwh: [12],
  batterie_kwh: [12],
  production_annuelle: number,
  consommation_annuelle: number,
  energie_consommee_directement: number,
  energie_injectee: number,
  taux_autoconsommation_pct: number | null,
  couverture_besoins_pct: number | null,
  autonomie_pct: number | null,
  economie_annee_1: number,
}
```

### Sources
- `energy.production_kwh`, `energy.consumption_kwh`, `energy.autoconsumption_kwh`, `energy.surplus_kwh`, `energy.import_kwh`, `energy.independence_pct`
- `finance.economie_year_1`
- `production.monthly_kwh`
- `options.scenarios_v2[selected].energy.monthly` (si disponible)

---

## 5. Legacy supprimés

- **engine-p4.js** : plus chargé dans le renderer PDF
- **bindEngineP4** : plus appelé
- CTA bandeau "Saisissez ou collez vos données..."
- Titre "Estimation de la production" (remplacé par "Votre production solaire sur une année")
- Tableau technique "Chiffres validés (kWh)" (remplacé par synthèse KPI)

---

## 6. Structure cible de la page P4

1. **Header** : Logo, badge "Votre production solaire sur une année", meta (Client, Réf., Date)
2. **Phrase d'intro** : "Sur une année complète, votre production et votre consommation s'équilibrent de manière à réduire durablement votre dépendance au réseau."
3. **Graphique** : Répartition mensuelle (production, consommation, énergie utilisée directement, batterie si > 0)
4. **Légende** : Consommation du foyer, Production solaire, Énergie utilisée directement, Énergie stockée (si batterie)
5. **Synthèse annuelle** : Production, Consommation, Énergie consommée directement, Énergie injectée, Taux d'autoconsommation, Couverture des besoins, Économies 1re année (si > 0)
6. **Texte pédagogique** : "Votre installation produit une énergie adaptée à votre profil..."

---

## 7. Validation

- **Build frontend** : OK
- **Tests pdf-viewmodel-mapper** : 5 passés
- **Tests pdf-pipeline** : OK

### Pour valider manuellement
1. Démarrer le frontend : `npm run dev` (port 5173)
2. Ouvrir : `http://localhost:5173/pdf-render?studyId=...&versionId=...` (avec une étude ayant un snapshot)
3. Vérifier que la page P4 affiche le nouveau contenu
4. Générer un PDF via l'API ou le CRM et vérifier que P4 est correcte dans le PDF exporté
