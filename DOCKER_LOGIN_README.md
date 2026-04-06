# SmartPitch V3 — Docker (login fonctionnel)

## Commande unique pour démarrer

```bash
docker compose up --build
```

## Identifiants admin créés

- **Email** : `b.letren@solarglobe.fr`
- **Mot de passe** : `@Goofy29041997`

## URLs

- **CRM Login** : http://localhost:5173/crm.html/login
- **Backend API** : http://localhost:3000

## Preuve que le login fonctionne

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"b.letren@solarglobe.fr","password":"@Goofy29041997"}'
```

Réponse attendue (200) :
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "71e384bf-21e6-42a7-884a-bb85f6ba91ba",
    "email": "b.letren@solarglobe.fr",
    "role": "SUPER_ADMIN",
    "organizationId": "02761d14-177d-4fe6-9ef6-4e6ee172dcfc"
  }
}
```

## En cas de conflit de ports

Si 3000 ou 5173 sont déjà utilisés, modifier les mappings dans `docker-compose.yml` :
- Backend : `"3001:3000"` au lieu de `"3000:3000"`
- Frontend : `"5174:5173"` au lieu de `"5173:5173"`
