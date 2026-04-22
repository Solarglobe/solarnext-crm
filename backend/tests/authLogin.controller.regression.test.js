/**
 * Régression : login ne doit plus dépendre d’un filtre rbac_roles.organization_id
 * ni d’une seule ligne utilisateur quand le même email existe dans plusieurs orgs.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { test } from "node:test";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const controllerPath = join(__dirname, "../auth/auth.controller.js");

test("auth.controller.js : mot de passe avant rôle, pas de rbac org_id=$2", () => {
  const src = readFileSync(controllerPath, "utf8");
  assert.ok(
    src.includes("for (const row of result.rows)") &&
      src.includes("comparePassword(password, row.password_hash)"),
    "boucle candidats + vérif mot de passe attendue"
  );
  assert.ok(
    src.includes("LOWER(TRIM(u.email))"),
    "recherche email insensible à la casse / espaces"
  );
  assert.ok(
    src.includes("resolveLoginRole(client, user.id)") &&
      !src.includes("resolveLoginRole(client, user.id, user.organization_id)"),
    "resolveLoginRole ne doit pas filtrer RBAC par organization_id du user"
  );
  assert.ok(
    !src.match(/rbac_roles rr[\s\S]*organization_id = \$2/),
    "pas de filtre rbac organization_id = $2 (source de LOGIN_NO_ROLE)"
  );
});
