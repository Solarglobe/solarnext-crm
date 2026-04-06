# CP-PDF — Portage pixel-parfait P3/P3B/P4/P5 — Analyse de blocage

## Contexte

Le prompt demande un portage pixel-parfait en réutilisant :
- Le HTML exact des sections #p3, #p3b, #p4, #p5
- Les engines legacy (engine-p3, engine-p3b, engine-p4, engine-p5)
- Sans modifier le code des engines

## Blocage architectural

### 1. engine-main.js est indispensable mais incompatible

Les engines legacy sont conçus pour fonctionner avec **engine-main.js** qui :

- Récupère le scénario via `?scenario=A1` dans l’URL
- Charge les données via `/api/view/p1`, `/api/view/p2`, … `/api/view/p14`
- Émet `p3:update`, `p4:update`, etc. vers les engines

**Problème :** Ces routes `/api/view/pX` n’existent pas dans le projet actuel.  
Le système actuel fournit un viewModel unifié via `/api/internal/pdf-view-model/:studyId/:versionId?renderToken=...`.

### 2. engine-p3b s’attache à Engine au chargement

```javascript
// engine-p3b.js ligne 129
if (window.Engine) {
  Engine.on("p3b:update", payload => { ... });
}
```

engine-p3b s’enregistre dès son chargement. Si `Engine` n’existe pas encore, aucun handler n’est enregistré.

### 3. engine-p4 et engine-p5 dépendent de bindEngine

```javascript
// engine-p4.js
window.API.bindEngineP4 = function (Engine) {
  Engine.on("p4:update", (payload) => { ... });
};
```

Quelque chose doit appeler `API.bindEngineP4(Engine)` avec une instance d’Engine.  
Actuellement, seul engine-main crée `window.Engine`.

### 4. engine-p4 : bug et dépendances

- Ligne 90 : `store` est utilisé dans `openOverlay()` mais n’est pas défini dans la fonction (référence à une variable globale).
- Utilise `localStorage`, `window.SMARTPITCH_DISABLE_OVERLAYS`, `window.ViewPayload`.
- Gère des overlays de saisie (non utilisés en mode PDF Playwright).

### 5. Pas de fichier pdf.css séparé

Le prompt mentionne « Copier pdf.css ».  
Dans `pdf-template/`, il n’y a **pas** de fichier `pdf.css` : les styles sont dans une balise `<style>` inline dans `smartpitch-solarglobe.html`.

## Conclusion

La stratégie « React = container, HTML legacy = rendu, engine JS = logique » **ne peut pas être appliquée telle quelle** car :

1. **engine-main** ne peut pas être réutilisé sans modification (routes inexistantes).
2. Les engines supposent un flux de données différent (fetch par page vs viewModel unifié).
3. Un pont (bridge) est nécessaire pour injecter le viewModel et émettre les événements.

## Pistes de solution

### Option A — Bridge sans engine-main

1. Créer `engine-bridge.js` qui :
   - Expose `window.Engine` avec `.on()` et `.emit()`
   - Expose `window.emitPdfViewData(viewModel)` pour émettre p3:update, p4:update, etc.
2. Charger engine-p3, engine-p3b, engine-p4, engine-p5 **après** le bridge.
3. Adapter engine-p3b pour qu’il s’enregistre via `API.bindEngineP3B` (comme p4/p5) ou s’assurer que Engine existe avant son chargement.

### Option B — Portage fidèle des graphiques en React

1. Garder les composants React actuels (PdfPage3, PdfPage3b, PdfPage4, PdfPage5).
2. Remplacer ChartP4 et ChartP5 par des implémentations qui reproduisent **exactement** la logique des engines (splines, gradients, dimensions).
3. Extraire la logique de dessin de engine-p4 et engine-p5 et la réécrire en React/TypeScript.

### Option C — iframe legacy

1. Servir `smartpitch-solarglobe.html` dans une iframe.
2. Créer des routes backend `/api/view/pX` qui renvoient le JSON attendu à partir du viewModel.
3. Adapter l’URL de l’iframe pour passer `?scenario=...` ou un équivalent.

---

**Recommandation :** L’option A (bridge) est la plus proche du prompt initial tout en restant réalisable. Elle suppose toutefois de ne pas charger engine-main et de fournir un équivalent minimal.

---

## Implémentation réalisée (Option A)

- `frontend/public/pdf-engines/engine-bridge.js` : crée `window.Engine` et `window.emitPdfViewData(viewModel)`
- `frontend/public/pdf-engines/engine-p3.js`, `engine-p3b.js`, `engine-p4.js`, `engine-p5.js` : copiés depuis `pdf-template/engines/`
- `frontend/pdf-render.html` : scripts chargés (bridge, p3, p3b, p4, p5) + `SMARTPITCH_DISABLE_OVERLAYS=true`
- `frontend/src/pages/pdf/hooks/useLegacyPdfEngine.ts` : bind engines + émet viewModel
- `PdfPage3`, `PdfPage3b`, `PdfPage4`, `PdfPage5` : HTML exact du legacy, hydratation par engines
- `ChartP4.tsx`, `ChartP5.tsx` : supprimés (PdfLegacyPort)
