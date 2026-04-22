/**
 * Régression : login avec email partagé entre orgs — boucle candidats + bcrypt,
 * désambiguïsation si plusieurs comptes valident le même mot de passe.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { test } from "node:test";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const controllerPath = join(__dirname, "../auth/auth.controller.js");

test("auth.controller.js : candidats multiples, rôle sans filtre org RBAC", () => {
  const src = readFileSync(controllerPath, "utf8");
  assert.ok(
    src.includes("passwordMatches") && src.includes("comparePassword(password, row.password_hash)"),
    "collecte des lignes dont le hash valide le mot de passe"
  );
  assert.ok(
    src.includes("LOWER(TRIM(u.email))"),
    "recherche email insensible à la casse / espaces"
  );
  assert.ok(
    src.includes("LOGIN_ORG_AMBIGUOUS") && src.includes("organizationId"),
    "409 + organizationId attendus pour désambiguïsation"
  );
  assert.ok(
    src.includes("resolveEffectiveHighestRole(client, user.id)") &&
      !src.includes("resolveEffectiveHighestRole(client, user.id, user.organization_id)"),
    "rôle effectif : pas de 3e argument organization_id"
  );
  assert.ok(
    !src.match(/rbac_roles rr[\s\S]*organization_id = \$2/),
    "pas de filtre rbac organization_id = $2 (source historique de LOGIN_NO_ROLE)"
  );
});
