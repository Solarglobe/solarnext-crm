# Modules extraits de calpinage.module.js

Stratégie : **strangler fig** — extraction progressive, module par module, sans modifier le comportement.
Règle : l'interface existante reste fonctionnelle après chaque extraction.

---

## État actuel

### `calpinage.module.js` — 25 280 lignes (après Phase 1)

Fichier monolithique. Structure interne :

| Section | Lignes (approx.) | Nature |
|---------|-----------------|--------|
| Imports ES natifs | 1–130 | Déjà des modules ES — aucune action nécessaire |
| `readNorthAngleDegFromCalpinageRoof` | ~132–145 | Fonction pure, module-level — **candidat Phase 2** |
| `debugStateConsistency` | ~148–185 | Utilise `getInteractionState()` + `window.*` — reporter |
| `_calpinageInitInFlight` flag | ~187 | Variable de guard — laisser en place |
| `export function initCalpinage(…)` | ~189–25280 | Closure de 25 000 lignes — extraction progressive |
| `CALPINAGE_STYLES` (CSS string) | ~320–2025 | ~1700 lignes de CSS inline — candidat Phase 3 |
| `CALPINAGE_HTML` (HTML string) | ~2025–2475 | ~450 lignes de HTML inline — candidat Phase 3 |
| Logique métier (nested IIFEs) | ~2475–25275 | Closure principale — découpage par domaine |
| `cleanup()` | ~25280 | Teardown listeners + reset window — laisser en place |

---

## Modules extraits

### Phase 1 — `flatRoofConfig.js` ✅

**Fichier** : `legacy/flatRoofConfig.js`
**Tests** : `legacy/__tests__/flatRoofConfig.test.js`

**Ce qui a été extrait :**

| Symbole | Type | Avant | Après |
|---------|------|-------|-------|
| `FLAT_ROOF_ROW_SPACING_CM` | `const` | Dupliqué (module-level + closure-level) | Unique, exporté |
| `FLAT_ROOF_ROW_SPACING_MM` | `const` | Dupliqué | Unique, exporté |
| `normalizeFlatRoofConfig` | `function` | Dupliqué (`__safeNormalizeFlatRoofConfig` module-level + closure-level) | Unique, exportée |
| `getAutoRowSpacingCmFromTilt` | `function` | Module-level, non testée | Exportée, testée |

**Avant l'extraction :** 2 copies identiques de `normalizeFlatRoofConfig` dans le fichier :
- `__safeNormalizeFlatRoofConfig` (module-level, fallback) — **supprimée**
- `normalizeFlatRoofConfig` (closure-level, ~20 appels internes) — **supprimée, remplacée par l'import**

**Gain :**
- Zéro duplication de logique
- Testabilité unitaire (fonctions pures, pas de `window.*`)
- Tree-shaking possible pour les consommateurs TypeScript

---

## Candidats Phase 2

Par ordre de priorité (isolement décroissant) :

| Candidat | Fichier cible | Effort | Dépendances fermeture |
|----------|--------------|--------|----------------------|
| `readNorthAngleDegFromCalpinageRoof` | `legacy/roofNorthAngle.js` | Très faible | Aucune (pure) |
| `CALPINAGE_STYLES` (CSS) | `legacy/calpinageStyles.css` | Faible | Nécessite import CSS via bundler |
| `CALPINAGE_HTML` (HTML template) | `legacy/calpinageTemplate.html` | Moyen | Nécessite transformation au build |
| Moteur obstacles 2D | `legacy/obstacle2DEngine.js` | Élevé | Dépend de `CALPINAGE_STATE`, `drawState` |
| Moteur pans | `legacy/pansEngine.js` | Très élevé | Dépend fortement de la closure |

---

## Règles de migration (rappel)

1. **Jamais de changement de comportement** dans un ticket d'extraction — refactoring pur.
2. **Tests unitaires obligatoires** pour tout module extrait (cf. `__tests__/`).
3. **Interface identique** — les noms de fonctions exportées correspondent aux noms utilisés dans la closure.
4. **Double-write interdit** — ne pas laisser les deux copies (module + closure) actives simultanément.
5. **Une extraction = un commit** — facilite le bisect si régression.

---

_Dernière mise à jour : 2026-05-18 — Phase 1 : `flatRoofConfig.js` extrait._
