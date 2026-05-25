import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("admin user impersonation is guarded by RBAC and super admin controller check", () => {
  const route = read("routes/admin.users.routes.js");
  const controller = read("controllers/admin.users.controller.js");

  assert.match(
    route,
    /router\.post\("\/:id\/impersonate", verifyJWT, requirePermission\("user\.manage"\), controller\.impersonateUser\)/,
  );
  assert.match(controller, /SUPER_ADMIN_ROLE_CODE/);
  assert.match(controller, /SUPER_ADMIN_USER_IMPERSONATE/);
});

test("payments mutations are permissioned and audited", () => {
  const invoiceRoutes = read("routes/invoices.routes.js");
  const paymentRoutes = read("routes/payments.routes.js");
  const invoiceFinance = read("controllers/invoiceFinance.controller.js");
  const paymentsController = read("controllers/payments.controller.js");
  const actions = read("services/audit/auditActions.js");

  assert.match(invoiceRoutes, /"\/:invoiceId\/payments"[\s\S]*requirePermission\("invoice\.manage"\)/);
  assert.match(paymentRoutes, /"\/:id\/cancel"[\s\S]*requirePermission\("invoice\.manage"\)/);
  assert.match(actions, /PAYMENT_RECORDED/);
  assert.match(actions, /PAYMENT_CANCELLED/);
  assert.match(invoiceFinance, /AuditActions\.PAYMENT_RECORDED/);
  assert.match(paymentsController, /AuditActions\.PAYMENT_CANCELLED/);
});

test("super admin organization destructive mutations are audited", () => {
  const controller = read("controllers/admin.organizations.controller.js");
  const actions = read("services/audit/auditActions.js");

  assert.match(actions, /ORG_ARCHIVED/);
  assert.match(actions, /ORG_RESTORED/);
  assert.match(actions, /ORG_DELETED/);
  assert.match(controller, /AuditActions\.ORG_ARCHIVED/);
  assert.match(controller, /AuditActions\.ORG_RESTORED/);
  assert.match(controller, /AuditActions\.ORG_DELETED/);
});
