# Cursor Prompt 0 — Persistance des données d'ombrage jusqu'au snapshot PDF

> **Nature de la modification :** ajouts purement additifs dans 3 fichiers.
> Aucune suppression. Aucune modification de logique existante.
> Les 3 fichiers doivent être modifiés dans l'ordre indiqué.

---

## Contexte

Le moteur d'ombrage (`calpinageShading.service.js`) calcule et retourne 4 champs riches :
- `monthlyFactors` — facteurs de perte par mois (toujours présent)
- `monthlyKwhStats` — kWh produits/perdus par mois (présent si peakPowerKwc > 0 et GPS valide)
- `annualLossKwh` — kWh perdus par an (présent si peakPowerKwc > 0 et GPS valide)
- `pvgisReference` — référence PVGIS utilisée (présent si peakPowerKwc > 0 et GPS valide)

Ces 4 champs sont calculés et présents dans la variable `shadingResult` brute,
mais ils sont perdus à 3 points successifs avant d'atteindre le snapshot PDF.

**Flux de correction à implémenter :**
```
shadingResult (brut) → payload.installation.shading  [Fix 1]
                     → scenario.shading (V2)          [Fix 2]
                     → snapshot.shading (PDF)         [Fix 3]
```

---

## Fix 1 — `backend/services/solarnextPayloadBuilder.service.js`

**Objectif :** injecter les 4 champs dans `payload.installation.shading`
afin qu'ils soient disponibles dans `ctx.shading` pour la suite de la chaîne.

**Instructions :**

Ouvre `backend/services/solarnextPayloadBuilder.service.js`.

Cherche la ligne où `payload.installation.shading` est construit ou assigné.
C'est aux alentours de la ligne 946, quelque chose de ce style :
```javascript
shading: {
  ...shading,
  // ou des champs explicites near_loss_pct, far_loss_pct, total_loss_pct
}
```

La variable `shadingResult` (résultat brut de `computeCalpinageShading`, ligne ~314-320)
est disponible dans le même scope. Elle contient les 4 champs.

Modifie uniquement l'objet `shading` assigné à `payload.installation.shading`
pour y ajouter les 4 champs depuis `shadingResult` :

```javascript
// Ajouter ces 4 champs à l'objet shading existant (ne pas supprimer les champs existants)
monthlyFactors:  shadingResult?.monthlyFactors  ?? null,
monthlyKwhStats: shadingResult?.monthlyKwhStats ?? null,
annualLossKwh:   shadingResult?.annualLossKwh   ?? null,
pvgisReference:  shadingResult?.pvgisReference  ?? null,
```

**Contrainte :** ne pas toucher aux 3 champs existants (`near_loss_pct`, `far_loss_pct`,
`total_loss_pct`). Ne modifier que cet unique objet. Ne pas toucher au reste du fichier.

---

## Fix 2 — `backend/services/scenarioV2Mapper.service.js`

**Objectif :** propager les 4 champs depuis `shadingSrc` (= `ctx.shading`)
vers l'objet `shading` du scénario V2.

**Instructions :**

Ouvre `backend/services/scenarioV2Mapper.service.js`.

Cherche la construction de l'objet `shading` (autour de la ligne 326-332).
Le code actuel ressemble à ceci :
```javascript
const shadingSrc = ctx?.shading ?? ctx?.form?.installation?.shading ?? {};
const shading = {
  near_loss_pct:  shadingSrc.nearLossPct ?? shadingSrc.near_loss_pct ?? null,
  far_loss_pct:   shadingSrc.farLossPct  ?? shadingSrc.far_loss_pct  ?? null,
  total_loss_pct: resolveShadingTotalLossPct(shadingSrc, ctx?.form)  ?? null,
  quality:        shadingSrc.shadingQuality ?? shadingSrc.quality    ?? null,
};
```

Ajoute les 4 champs à cet objet `shading`, en les lisant depuis `shadingSrc` :

```javascript
const shading = {
  near_loss_pct:  shadingSrc.nearLossPct ?? shadingSrc.near_loss_pct ?? null,
  far_loss_pct:   shadingSrc.farLossPct  ?? shadingSrc.far_loss_pct  ?? null,
  total_loss_pct: resolveShadingTotalLossPct(shadingSrc, ctx?.form)  ?? null,
  quality:        shadingSrc.shadingQuality ?? shadingSrc.quality    ?? null,
  // ── champs enrichis (ajout) ───────────────────────────────────────────────
  monthlyFactors:  shadingSrc.monthlyFactors  ?? null,
  monthlyKwhStats: shadingSrc.monthlyKwhStats ?? null,
  annualLossKwh:   shadingSrc.annualLossKwh   ?? null,
  pvgisReference:  shadingSrc.pvgisReference  ?? null,
};
```

**Contrainte :** ne pas modifier les 4 champs existants. Ne modifier que cet unique objet.
Ne pas toucher au reste du fichier.

---

## Fix 3 — `backend/services/selectedScenarioSnapshot.service.js`

**Objectif :** inclure les 4 champs dans le snapshot final enregistré en base.

**Instructions :**

Ouvre `backend/services/selectedScenarioSnapshot.service.js`.

Cherche la construction de l'objet `shading` (lignes 234-238).
Le code actuel est exactement :
```javascript
const shading = {
  near_loss_pct:  scenario.shading?.near_loss_pct  ?? null,
  far_loss_pct:   scenario.shading?.far_loss_pct   ?? null,
  total_loss_pct: scenario.shading?.total_loss_pct ?? null,
};
```

Remplace-le par :
```javascript
const shading = {
  near_loss_pct:  scenario.shading?.near_loss_pct  ?? null,
  far_loss_pct:   scenario.shading?.far_loss_pct   ?? null,
  total_loss_pct: scenario.shading?.total_loss_pct ?? null,
  // ── champs enrichis (ajout) ───────────────────────────────────────────────
  monthlyFactors:  scenario.shading?.monthlyFactors  ?? null,
  monthlyKwhStats: scenario.shading?.monthlyKwhStats ?? null,
  annualLossKwh:   scenario.shading?.annualLossKwh   ?? null,
  pvgisReference:  scenario.shading?.pvgisReference  ?? null,
};
```

**Contrainte :** ne modifier que cet unique objet `shading`. Ne pas toucher au reste du fichier.

---

## Vérification

Après les 3 fixes, vérifier dans `selectedScenarioSnapshot.service.js`
que la constante `shading` contient bien 7 champs (3 existants + 4 nouveaux).

Vérifier également que les 3 fichiers ne présentent aucune erreur de syntaxe.

**Aucun test à écrire dans ce prompt. Aucune migration de base. Aucun autre fichier.**
Le champ `selected_scenario_snapshot` en base est déjà `jsonb` libre —
les nouveaux champs seront stockés automatiquement dès le prochain recalcul.
