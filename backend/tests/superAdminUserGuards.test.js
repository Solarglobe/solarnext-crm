/**
 * Garde-fous SUPER_ADMIN — pas d’escalade via user.manage / API rôles.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  isJwtSuperAdmin,
  rbacRoleIdsIncludeSuperAdmin,
  userHasSuperAdminRbacRole,
  userIsLiveSuperAdminByDb,
  sqlAndUserNotSuperAdmin,
} from "../lib/superAdminUserGuards.js";

test("isJwtSuperAdmin détecte le JWT", () => {
  assert.equal(isJwtSuperAdmin({ user: { role: "SUPER_ADMIN" } }), true);
  assert.equal(isJwtSuperAdmin({ user: { role: "ADMIN" } }), false);
  assert.equal(isJwtSuperAdmin({}), false);
});

test("rbacRoleIdsIncludeSuperAdmin : tableau vide → false", async () => {
  const pool = {
    async query() {
      throw new Error("ne doit pas appeler la base");
    },
  };
  assert.equal(await rbacRoleIdsIncludeSuperAdmin(pool, []), false);
  assert.equal(await rbacRoleIdsIncludeSuperAdmin(pool, null), false);
});

test("rbacRoleIdsIncludeSuperAdmin : ligne trouvée → true", async () => {
  const pool = {
    async query(_sql, _params) {
      return { rows: [{ x: 1 }] };
    },
  };
  assert.equal(await rbacRoleIdsIncludeSuperAdmin(pool, ["00000000-0000-4000-8000-000000000001"]), true);
});

test("userHasSuperAdminRbacRole : aucune ligne → false", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };
  assert.equal(await userHasSuperAdminRbacRole(pool, "u1", "00000000-0000-4000-8000-000000000099"), false);
});

test("userHasSuperAdminRbacRole : filtre organization_id (param $3)", async () => {
  let captured = /** @type {{ sql?: string, params?: unknown[] } | null} */ (null);
  const pool = {
    async query(sql, params) {
      captured = { sql, params };
      return { rows: [{ x: 1 }] };
    },
  };
  const org = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const ok = await userHasSuperAdminRbacRole(pool, "user-1", org);
  assert.equal(ok, true);
  assert.ok(captured?.sql?.includes("organization_id IS NULL") || captured?.sql?.includes("organization_id is null"));
  assert.ok(captured?.sql?.includes("organization_id = $3"));
  assert.ok(captured?.sql?.includes("rr.") && captured?.sql?.includes("COALESCE"));
  assert.deepEqual(captured?.params, ["user-1", "SUPER_ADMIN", org]);
});

test("userIsLiveSuperAdminByDb : effectif SUPER_ADMIN en base", async () => {
  const pool = {
    async query() {
      return { rows: [{ role: "SUPER_ADMIN" }] };
    },
  };
  assert.equal(await userIsLiveSuperAdminByDb(pool, "u1"), true);
});

test("userIsLiveSuperAdminByDb : JWT obsolète — effectif ADMIN", async () => {
  const pool = {
    async query() {
      return { rows: [{ role: "ADMIN" }] };
    },
  };
  assert.equal(await userIsLiveSuperAdminByDb(pool, "u1"), false);
});

test("sqlAndUserNotSuperAdmin contient les deux exclusions legacy/RBAC", () => {
  const s = sqlAndUserNotSuperAdmin("u");
  assert.match(s, /rbac_user_roles/);
  assert.match(s, /user_roles/);
  assert.match(s, /SUPER_ADMIN/);
});
