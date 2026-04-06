# DSM réel — Far Shading (CP-FAR-008)

## Variables d'environnement

| Variable | Défaut | Description |
|---------|--------|-------------|
| `HORIZON_DSM_ENABLED` | `false` | Feature flag. **OFF par défaut** — aucun impact si non activé. |
| `DSM_PROVIDER` | `AUTO` | `AUTO` \| `IGN` \| `LOCAL`. Sans effet si `HORIZON_DSM_ENABLED=false`. |
| `DSM_MAX_TILES` | `500` | Limite cache tuiles DSM. |
| `DSM_TILE_CACHE_TTL` | (30 j) | TTL cache en secondes. Alias: `DSM_CACHE_TTL_MS` (ms). |
| `DSM_DEBUG` | - | `true` pour logs debug (pas de spam console par défaut). |

## Comportement fallback

1. **`HORIZON_DSM_ENABLED=false`** → Comportement identique à avant : `RELIEF_ONLY` uniquement.
2. **`HORIZON_DSM_ENABLED=true` + `DSM_PROVIDER=LOCAL`** → Utilise fixtures DSM locales. Si échec → fallback `RELIEF_ONLY`.
3. **`HORIZON_DSM_ENABLED=true` + HTTP_GEOTIFF configuré** → Télécharge tuiles. Si échec → fallback `RELIEF_ONLY`.
4. **`DSM_PROVIDER=IGN` / `AUTO`** → Non implémenté (LOCAL uniquement pour l’instant).

## Champs optionnels (non-breaking)

- `meta.source` : `"DSM_REAL"` \| `"RELIEF_ONLY"`
- `meta.qualityScore` : score qualité optionnel (0–1)

## Tests

```bash
npm run test-horizon-dsm-real
```
