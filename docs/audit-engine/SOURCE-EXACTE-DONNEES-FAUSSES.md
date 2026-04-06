# Source exacte des données fausses — Audit du flux PDF

**Date :** 2026-03-09  
**Mode :** Audit strict — aucune modification

---

## 1️⃣ Flux complet tracé

```
study_versions.selected_scenario_snapshot (DB)
    ↓
getSelectedScenarioSnapshotRow(versionId)
    ↓
row.selected_scenario_snapshot
    ↓
mapSelectedScenarioSnapshotToPdfViewModel(snapshot, { studyId, versionId })
    ↓
viewModel (objet complet avec fullReport)
    ↓
res.json({ ok: true, viewModel })
    ↓
fetch / apiFetch → data = { ok: true, viewModel }
    ↓
setViewModel(data.viewModel)
    ↓
PdfLegacyPort(viewModel)
    ↓
useLegacyPdfEngine(viewModel)
    ↓
buildLegacyPdfViewModel(viewModel)  [pass-through, retourne viewModel tel quel]
    ↓
emitPdfViewData(legacyVM)
    ↓
Engine._emit("pX:update", fr.pX)  [fr.pX = viewModel.fullReport.pX]
    ↓
engine-pX handler(payload)  [payload = fr.pX]
    ↓
set(id, val) / DOM manipulation
    ↓
DOM final
```

---

## 2️⃣ Snapshot réel (exemple)

Source : `backend/tests/pdf-pipeline/fixtures.js` (MINIMAL_SNAPSHOT) + `backend/scripts/test-pdf-viewmodel-mapper.js` (buildFullSnapshot)

### MINIMAL_SNAPSHOT (fixtures)

```json
{
  "scenario_type": "BASE",
  "created_at": "2025-03-09T...",
  "client": { "nom": "Test", "prenom": "Pipeline" },
  "site": { "lat": 48.85, "lon": 2.35 },
  "installation": { "puissance_kwc": 6, "panneaux_nombre": 12 },
  "production": { "annual_kwh": 7200, "monthly_kwh": [600,600,...] },
  "equipment": {},
  "shading": { "total_loss_pct": 5 },
  "energy": {},
  "finance": {},
  "cashflows": [],
  "assumptions": {}
}
```

### Snapshot complet (test-pdf-viewmodel-mapper)

```json
{
  "scenario_type": "BASE",
  "created_at": "2025-03-06T12:00:00.000Z",
  "client": { "nom": "Dupont", "prenom": "Jean", "adresse": "12 rue de la Paix", "cp": "75001", "ville": "Paris" },
  "site": { "lat": 48.8566, "lon": 2.3522, "orientation_deg": 180, "tilt_deg": 30, "puissance_compteur_kva": 9, "type_reseau": "mono" },
  "installation": { "panneaux_nombre": 12, "puissance_kwc": 5.82, "production_annuelle_kwh": 7200, "surface_panneaux_m2": null },
  "equipment": {
    "panneau": { "marque": "LONGi", "modele": "Hi-MO 5", "puissance_wc": 485 },
    "onduleur": { "marque": "ATMOCE", "modele": "Micro", "quantite": 12 },
    "batterie": { "capacite_kwh": null, "type": null }
  },
  "energy": {
    "production_kwh": 7200,
    "consumption_kwh": 13000,
    "autoconsumption_kwh": 3500,
    "surplus_kwh": 3700,
    "import_kwh": 9500,
    "independence_pct": 26.9
  },
  "finance": {
    "capex_ttc": 15000,
    "economie_year_1": 850,
    "economie_total": 18500,
    "roi_years": 12,
    "irr_pct": 5.2,
    "facture_restante": 2200,
    "revenu_surplus": 148
  },
  "production": {
    "annual_kwh": 7200,
    "monthly_kwh": [320, 480, 620, 680, 720, 750, 740, 700, 580, 420, 350, 330]
  }
}
```

---

## 3️⃣ JSON envoyé par l'API

**Fichiers :**
- `getPdfViewModel.controller.js` L57 : `return res.status(200).json({ ok: true, viewModel: result.viewModel });`
- `internalPdfViewModel.controller.js` L59 : `return res.status(200).json({ ok: true, viewModel: result.viewModel });`
- `pdfViewModel.service.js` L39-42 : `viewModel = mapSelectedScenarioSnapshotToPdfViewModel(snapshot, { studyId, versionId }); return { viewModel };`

**Exemple réel** (mapper exécuté avec snapshot complet ci-dessus) :

```json
{
  "ok": true,
  "viewModel": {
    "meta": { "studyId": "study-abc", "versionId": "ver-xyz", "generatedAt": "...", "scenarioType": "BASE" },
    "client": { "name": "Jean Dupont", "city": "Paris", "postalCode": "75001", "fullAddress": "12 rue de la Paix" },
    "fullReport": {
      "p1": {
        "p1_auto": {
          "p1_client": "Jean Dupont",
          "p1_ref": "SP-study-ab-ver-",
          "p1_date": "10 mars 2026",
          "p1_why": "Étude photovoltaïque personnalisée",
          "p1_m_kwc": 5.82,
          "p1_m_auto": 27,
          "p1_m_gain": 850,
          "p1_k_puissance": 5.82,
          "p1_k_autonomie": 27,
          "p1_k_tri": 5.2,
          "p1_k_gains": 21250,
          "p1_param_kva": "9 kVA",
          "p1_param_reseau": "mono",
          "p1_param_conso": "13 000 kWh/an"
        }
      },
      "p2": { "p2_auto": { ... } },
      "p3": { "meta": {...}, "offer": {...}, "finance": {...}, "tech": {} },
      "p3b": { "p3b_auto": {...} },
      "p4": { "meta": {...}, "production_kwh": [...], "consommation_kwh": [...], ... },
      "p5": { "meta": {...}, "production_kw": [...], "consommation_kw": [...], "batterie_kw": [...] },
      "p6": { "p6": { "meta": {...}, "price": 0.18, "dir": [...], "bat": [...], "grid": [...], "tot": [...] } },
      "p7": { "meta": {...}, "pct": {...}, "c_grid": 9500, "p_surplus": 3700 },
      "p8": { "meta": {...}, "year": "2026", "A": {...}, "B": {...}, "profile": {...}, ... },
      "p9": { "meta": {...}, "recommended": {...}, "compare": {...} },
      "p10": { "meta": {...}, "best": {...}, "hyp": {...} },
      "p11": { "meta": {...}, "data": {...} },
      "p12": { "meta": {...}, "env": {...}, "v_co2": "...", "v_trees": "...", ... },
      "p13": { "meta": {...} },
      "p14": { "meta": {...} }
    }
  }
}
```

**Conclusion :** Le backend envoie un viewModel complet avec fullReport correctement structuré.

---

## 4️⃣ JSON reçu par React

**Fichier :** `StudySnapshotPdfPage.tsx`

| Ligne | Code | Rôle |
|-------|------|------|
| 61-64 | URL selon renderToken ou JWT | fetch / apiFetch |
| 65-71 | `res.json()` | Parse JSON |
| 72-79 | `data?.ok === true && data.viewModel` → `setViewModel(data.viewModel)` | Stocke viewModel |
| 112 | `vm = (viewModel ?? {})` | Passe à PdfLegacyPort |
| 115 | `<PdfLegacyPort viewModel={vm} />` | Props |

**Pas de transformation.** Le viewModel reçu est identique au JSON API (même référence si pas de clone).

**Log existant :** `useLegacyPdfEngine` L57-58 : `console.log("PDF FULLREPORT SOURCE", viewModel)` — affiche le viewModel avant pass-through.

---

## 5️⃣ JSON envoyé aux engines

**Fichiers :**
- `useLegacyPdfEngine.ts` L59 : `buildLegacyPdfViewModel(viewModel)` → retourne viewModel tel quel (pass-through)
- `useLegacyPdfEngine.ts` L60 : `window.emitPdfViewData(legacyVM)`
- `engine-bridge.js` L42-61 : `emitPdfViewData(viewModel)` → `fr = viewModel.fullReport` → pour chaque pX : `Engine._emit("pX:update", fr.pX)`

**Payload envoyé à chaque engine :**

| Event | Payload (= fr.pX) |
|-------|-------------------|
| p1:update | `{ p1_auto: { p1_client, p1_ref, ..., p1_param_conso } }` |
| p2:update | `{ p2_auto: { p2_client, ..., p2_chart_avec } }` |
| p3:update | `{ meta, offer, finance, tech }` |
| p3b:update | `{ p3b_auto: { client, ref, date, inclinaison, orientation, surface_m2, nb_panneaux } }` |
| p4:update | `{ meta, production_kwh, consommation_kwh, autoconso_kwh, batterie_kwh }` |
| p5:update | `{ meta, production_kw, consommation_kw, batterie_kw }` |
| p6:update | `{ p6: { meta, price, dir, bat, grid, tot } }` |
| p7:update | `{ meta, pct, c_grid, p_surplus }` |
| p8:update | `{ meta, year, A, B, profile, hypotheses, detailsBatterie, kpis, texteSousBarres, interpretation }` |
| p9:update | `{ meta, recommended, compare }` |
| p10:update | `{ meta, best, hyp }` |
| p11:update | `{ meta, data }` |
| p12:update | `{ meta, env, v_co2, v_trees, v_cars, v_co2_25, v_trees_25, v_cars_25 }` |
| p13:update | `{ meta }` |
| p14:update | `{ meta }` |

**Conclusion :** Les payloads sont exactement `viewModel.fullReport.pX`. Aucune altération entre API et bridge.

---

## 6️⃣ JSON reçu par les engines

Chaque engine reçoit le payload via `Engine.on("pX:update", handler)` où `handler(payload)` est appelé avec `payload = fr.pX`.

**Aucune modification du payload** entre le bridge et le handler. Le payload reçu par l'engine est identique à `fr.pX`.

**Logs existants :**
- engine-p1.js L45-47 : `console.group("📄 HYDRATATION P1"); console.log("p1_auto :", a);`
- engine-p2.js L105-106 : `console.group("📄 HYDRATATION P2"); console.log(a);`
- engine-p3.js L36 : `console.log("→ HYDRATATION P3 (engine-p3.js)", auto);`
- engine-p4.js L495 : `console.log("→ HYDRATATION P4 (engine-p4.js)", payload);`
- engine-p9.js L231 : `console.log("🔥 Hydratation P9 (engine-p9.js) :", payload);`
- engine-p10.js L82 : `console.log("🔥 ENGINE-P10 payload:", data);`

---

## 7️⃣ DOM final — où les valeurs deviennent fausses

### engine-p1.js — fonction `set(id, val)`

```javascript
// L22-31
function set(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  if (typeof val === "number" || /^[0-9\.,\s]+$/.test(String(val))) {
    el.textContent = round(val);  // ← round() = Math.ceil + toLocaleString
  } else {
    el.textContent = (val !== null && val !== undefined && val !== "") ? val : "—";
  }
}
```

**Problème :** Pour tout nombre (ou chaîne numérique), `round()` est appliqué :
- `round(5.2)` → `Math.ceil(5.2).toLocaleString("fr-FR")` → `"6"`
- `round(27)` → `"27"`
- `p1_k_tri` = 5.2 (TRI en %) → affiché **"6"** au lieu de **"5,2 %"**

**Champs impactés (P1) :** p1_m_kwc, p1_m_auto, p1_m_gain, p1_k_puissance, p1_k_autonomie, **p1_k_tri**, p1_k_gains

### engine-p2.js

Pas de `round()` sur les nombres. Utilise `set(id, val)` qui fait `el.textContent = String(val)`. Les valeurs formatées (p2_k_tri = "5.2 %", p2_k_roi = "12 ans") sont correctes.

### engine-p3.js

`setIfEmpty` + `fmt(v, u)` — `fmt` utilise `nf0.format(n)` (pas de ceil). Comportement correct.

### engine-p3b.js

`computeLocalPanelData(a)` — **calcul local** si `nb_panneaux` ou `surface_m2` manquants : lit `window.Engine.getP1()`, `localStorage.smartpitch_settings`. Peut **remplacer** les valeurs du JSON par des calculs.

### engine-p4, p5, p6

Données utilisées pour graphiques. Pas de transformation numérique abusive. **Mais** : consommation_kwh (P4), production_kw/consommation_kw (P5), dir/bat/grid/tot (P6) sont **recalculés** dans le mapper (formules sinus, etc.) — pas lues telles quelles du snapshot.

### engine-p7.js

`mergeP7` : normalisation des % à 100 % si somme ≠ 100. **Modification des valeurs** avant affichage.

### engine-p8.js

Lit A.*, B.*, hypotheses, etc. Les champs vides (hypotheses, detailsBatterie, texteSousBarres, interpretation) affichent "—". Pas de calcul faux, mais **données manquantes** dans le mapper (valeurs vides).

### engine-p9.js

`compare` : `cumul_25y`, `roi_year`, `tri_pct` sont **simulés** (offset fixe) — pas du snapshot.

### engine-p10.js

Pas de round() abusif. `nf1.format(b.tri_pct)` pour TRI. Correct.

### engine-p11.js

Ne remplit que meta. `data` (capex, economies) n'est pas rendu sur la page (overlay désactivé).

### engine-p12.js

`set(id, v)` — pas de transformation. Correct.

---

## 8️⃣ Comparaison : snapshot → viewModel → payload → DOM

| Étape | p1_client | p1_k_tri | p1_k_gains |
|-------|-----------|----------|-------------|
| **1. Snapshot** | client.prenom + nom = "Jean Dupont" | finance.irr_pct = 5.2 | economie_year_1 * 25 = 21250 |
| **2. Mapper** | p1_auto.p1_client = "Jean Dupont" | p1_auto.p1_k_tri = 5.2 | p1_auto.p1_k_gains = 21250 |
| **3. API** | idem | idem | idem |
| **4. React** | idem | idem | idem |
| **5. emitPdfViewData** | fr.p1.p1_auto.p1_client | fr.p1.p1_auto.p1_k_tri | fr.p1.p1_auto.p1_k_gains |
| **6. engine-p1** | set("p1_client", "Jean Dupont") ✅ | set("p1_k_tri", 5.2) → round(5.2) = "6" ❌ | set("p1_k_gains", 21250) → round(21250) = "21 250" ✅ |
| **7. DOM** | "Jean Dupont" | **"6"** (faux) | "21 250" |

---

## 9️⃣ Conclusion — Où les données deviennent fausses

### Point de rupture principal : **engine-p1.js — fonction `set()`**

| Situation | Cause |
|-----------|-------|
| **p1_k_tri affiché "6" au lieu de "5,2 %"** | `set()` applique `round()` = Math.ceil à tout nombre. 5.2 → 6. |
| **Tous les nombres P1 arrondis au supérieur** | Même cause. |
| **p1_k_tri sémantique** | Le mapper envoie un TRI en % (5.2). L'engine le traite comme entier et l'arrondit. Le DOM par défaut affiche "10 ans" (ROI) — confusion TRI/ROI. |

### Autres points de rupture

| Page | Problème | Cause |
|------|----------|-------|
| **P3b** | surface_m2, nb_panneaux peuvent être calculés localement | `computeLocalPanelData()` remplace les valeurs si manquantes (localStorage + P1). |
| **P4, P5, P6** | Données modélisées | Mapper recalcule consommation_kwh, profils 24h, dir/bat/grid/tot — pas du snapshot brut. |
| **P7** | % normalisés | `mergeP7` force la somme à 100 %. |
| **P8** | Champs vides | hypotheses, detailsBatterie, texteSousBarres, interpretation = valeurs vides dans le mapper. |
| **P9** | Scénario "Avec batterie" simulé | compare.cumul_25y, roi_year, tri_pct = formules fixes, pas du snapshot. |
| **P11** | data non affiché | Overlay désactivé, p11:auto jamais émis. Seul meta est rendu. |

### Chaîne validée (données correctes jusqu'au DOM)

- **Snapshot → Mapper** : ✅ correct
- **Mapper → API** : ✅ correct
- **API → React** : ✅ correct (pas de transformation)
- **React → emitPdfViewData** : ✅ correct (pass-through)
- **Bridge → Engines** : ✅ correct (fr.pX transmis tel quel)
- **Engine → DOM** : ❌ **engine-p1.set()** modifie les nombres (round/ceil)

### Résumé

| Étape | Statut |
|-------|--------|
| 1. Snapshot | ✅ (selon contenu DB) |
| 2. Mapper | ✅ |
| 3. Payload API | ✅ |
| 4. React | ✅ |
| 5. Payload engine | ✅ |
| 6. Engine modifie | ❌ **engine-p1 : set() applique Math.ceil** |
| 7. DOM | ❌ Valeurs fausses pour les nombres P1 |

**L'endroit exact où les données deviennent fausses :**  
`frontend/public/pdf-engines/engine-p1.js`, fonction `set()`, lignes 26-27 — application de `round()` (Math.ceil) à tous les nombres, ce qui fausse notamment `p1_k_tri` (TRI en %) et les autres KPI numériques.

---

**RÈGLE RESPECTÉE :** Aucune modification de code. Analyse uniquement.
