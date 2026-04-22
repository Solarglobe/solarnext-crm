#!/usr/bin/env node
/**
 * CP-081 — Tests templates mail.
 * Usage : node --env-file=./.env scripts/test-mail-templates.js
 */

import assert from "assert";
import "../config/load-env.js";
import { pool } from "../config/db.js";
import {
  createTemplate,
  deleteTemplate,
  getAvailableTemplates,
  renderTemplate,
  replaceTemplateVariables,
} from "../services/mail/mailTemplate.service.js";

async function pickOrgUser() {
  const org = await pool.query(`SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1`);
  if (!org.rows.length) return null;
  const organizationId = org.rows[0].id;
  const u = await pool.query(
    `SELECT id FROM users WHERE organization_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [organizationId]
  );
  if (!u.rows.length) return null;
  return { organizationId, userId: u.rows[0].id };
}

async function cleanup(ids) {
  if (!ids.length) return;
  await pool.query(`DELETE FROM mail_templates WHERE id = ANY($1::uuid[])`, [ids]);
}

async function main() {
  const ctx = await pickOrgUser();
  if (!ctx) {
    console.log("skip (no org/user)");
    process.exit(0);
  }
  const { organizationId, userId } = ctx;
  const createdIds = [];

  try {
    const orgTpl = await createTemplate({
      organizationId,
      userId,
      kind: "organization",
      name: "T org",
      subjectTemplate: "Sujet {{client.name}}",
      bodyHtmlTemplate: "<p>Org {{missing.x}}</p>",
      category: "devis",
    });
    createdIds.push(orgTpl.id);

    const userTpl = await createTemplate({
      organizationId,
      userId,
      kind: "user",
      name: "T user",
      subjectTemplate: "Hello {{lead.name}}",
      bodyHtmlTemplate: "<p>User {{user.name}} — {{date}}</p>",
      category: "relance",
    });
    createdIds.push(userTpl.id);

    const list = await getAvailableTemplates({ userId, organizationId });
    assert.ok(list.length >= 2);
    assert.strictEqual(list[0].user_id, userId, "priorité user > org (premier = user)");

    const r1 = renderTemplate({
      subject_template: "X{{client.name}}Y",
      body_html_template: "<b>{{lead.name}}</b>",
      context: { client: { name: "C" }, lead: { name: "L" } },
    });
    assert.strictEqual(r1.subject, "XCY");
    assert.strictEqual(r1.bodyHtml, "<b>L</b>");

    const r2 = renderTemplate({
      subject_template: "{{nope}}",
      body_html_template: "{{client.email}}",
      context: {},
    });
    assert.strictEqual(r2.subject, "");
    assert.strictEqual(r2.bodyHtml, "");

    const r3 = replaceTemplateVariables("a {{unknown.deep}} b", { date: "jour" });
    assert.strictEqual(r3, "a  b");

    await deleteTemplate({ templateId: userTpl.id, organizationId });
    const row = await pool.query(`SELECT is_active FROM mail_templates WHERE id = $1`, [userTpl.id]);
    assert.strictEqual(row.rows[0].is_active, false);

    console.log("MAIL TEMPLATES OK");
  } finally {
    await cleanup(createdIds);
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
