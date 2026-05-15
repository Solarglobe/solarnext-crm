# CONTRIBUTING — SolarNext CRM

## Regles de contribution

---

## Schema Zod : protocole de changement obligatoire

> Regle absolue : tout changement de schema impliquant une colonne DB doit avoir
> une migration SQL correspondante. Pas de changement de schema sans migration.

### Pourquoi

Les schemas Zod dans `shared/schemas/` sont le contrat entre le frontend, le backend,
et la base de donnees. Un changement non documente peut :
- corrompre des donnees React en cours de session (etat desynchronise),
- faire planter des consumers non mis a jour,
- passer en production silencieusement sans migration DB.

Le CI bloque tout merge contenant un breaking change non documente.

---

### Definition d'un breaking change

| Type                                      | Breaking ? |
|-------------------------------------------|------------|
| Champ requis supprime                     | OUI        |
| Type d'un champ requis modifie            | OUI        |
| Champ optionnel devenu requis             | OUI        |
| Nouveau champ requis ajoute               | OUI        |
| Nouveau champ optionnel ajoute            | non        |
| Contrainte plus stricte (min, max, regex) | non        |
| Ajout de description/JSDoc                | non        |

---

### Procedure obligatoire pour tout breaking change

1. **Modifier le schema** dans `shared/schemas/<entite>.schema.ts`

2. **Bumper SCHEMA_VERSION** dans `shared/schemas/version.ts` :
   - Breaking change -> bump MAJEUR (ex. `1.0.0` -> `2.0.0`)
   - Nouveau champ optionnel -> bump MINOR (ex. `1.0.0` -> `1.1.0`)
   - Correction interne -> bump PATCH (ex. `1.0.0` -> `1.0.1`)

3. **Regenerer les snapshots** :
   ```bash
   cd frontend
   npx tsx ../shared/schemas/scripts/generate-snapshots.mts
   ```

4. **Documenter dans CHANGELOG** (`shared/schemas/CHANGELOG.md`) :
   ```markdown
   ## [2.0.0] - YYYY-MM-DD - BREAKING
   ### Changed
   - `lead.schema.ts` : champ `roi_years` change de `number` -> `string`
   ### Migration SQL requise
   - Fichier : `backend/migrations/20260515_alter_leads_roi_years.sql`
   - Colonnes : `leads.roi_years` (TYPE CHANGE)
   ```

5. **Creer la migration SQL** dans `backend/migrations/` si une colonne DB est affectee.

6. **Commiter** schema + snapshots + CHANGELOG + migration dans le meme commit.

7. **Mettre a jour le middleware** (`backend/middleware/schemaVersion.middleware.js`) :
   ```js
   export const SCHEMA_VERSION = "2.0.0"; // <- nouvelle version
   ```

---

### Verifier localement avant de pousser

```bash
# 1. Generer les snapshots actuels dans un repertoire temporaire
cd frontend
npx tsx ../shared/schemas/scripts/generate-snapshots-to.mts /tmp/current-snapshots

# 2. Comparer avec les snapshots commites
npx tsx ../shared/schemas/scripts/check-breaking-ci.mts /tmp/current-snapshots
```

Si le script retourne `OK - no breaking changes`, votre PR passera le CI.

---

### En cas de breaking change involontaire detecte par le CI

Le CI affichera un message du type :
```
BREAKING [lead.LeadResponse] Field "roi_years" type changed: number -> string
```

Vous devez soit :
- **Reverter** le changement si ce n'etait pas intentionnel,
- **Suivre la procedure ci-dessus** si le changement est voulu.

---

## Autres conventions

### Branches
- `main` : production — merges via PR uniquement
- `feat/*` : nouvelles fonctionnalites
- `fix/*` : corrections de bugs
- `chore/*` : maintenance, typage, tooling

### Commits
Format Conventional Commits : `type(scope): message`
- `feat(lead): add SIRET validation`
- `fix(invoice): correct balance_due calculation`
- `chore(schemas): bump version to 1.1.0, add optional notes field`
- `BREAKING(study): remove deprecated calc_v1 field — see migration 20260515`
