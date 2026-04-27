#!/usr/bin/env node
/**
 * CP-080 — Vérifie signatures mail (service + priorité).
 * Usage : node --env-file=./.env scripts/test-mail-signatures.js
 */

import assert from "assert";
import "../config/register-local-env.js";
import "../config/script-env-tail.js";
import { pool } from "../config/db.js";
import {
  createSignature,
  deleteSignature,
  getAvailableSignatures,
  getDefaultSignature,
  setDefaultSignature,
  updateSignature,
} from "../services/mail/mailSignature.service.js";

async function pickOrgUserAccount() {
  const org = await pool.query(`SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1`);
  if (!org.rows.length) return null;
  const organizationId = org.rows[0].id;

  const u = await pool.query(
    `SELECT id FROM users WHERE organization_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [organizationId]
  );
  if (!u.rows.length) return null;
  const userId = u.rows[0].id;

  const ma = await pool.query(
    `SELECT id FROM mail_accounts WHERE organization_id = $1 AND is_active = true ORDER BY created_at ASC LIMIT 1`,
    [organizationId]
  );
  const mailAccountId = ma.rows[0]?.id ?? null;
  return { organizationId, userId, mailAccountId };
}

async function cleanup(ids) {
  if (!ids.length) return;
  await pool.query(`DELETE FROM mail_signatures WHERE id = ANY($1::uuid[])`, [ids]);
}

async function main() {
  const ctx = await pickOrgUserAccount();
  if (!ctx) {
    console.log("skip (no org/user)");
    process.exit(0);
  }
  const { organizationId, userId, mailAccountId } = ctx;
  const createdIds = [];

  try {
    const orgSig = await createSignature({
      organizationId,
      userId,
      kind: "organization",
      name: "Test org",
      signatureHtml: "<p>Org</p>",
      isDefault: true,
    });
    createdIds.push(orgSig.id);

    const userSig = await createSignature({
      organizationId,
      userId,
      kind: "user",
      name: "Test user",
      signatureHtml: "<p>User</p>",
      isDefault: true,
    });
    createdIds.push(userSig.id);

    let accountSig = null;
    if (mailAccountId) {
      accountSig = await createSignature({
        organizationId,
        userId,
        kind: "account",
        name: "Test compte",
        signatureHtml: "<p>Compte</p>",
        mailAccountId,
        isDefault: true,
      });
      createdIds.push(accountSig.id);
    }

    const list = await getAvailableSignatures({ userId, organizationId, mailAccountId: mailAccountId || undefined });
    assert.ok(list.length >= 2, "liste signatures");

    if (mailAccountId) {
      const def = await getDefaultSignature({ userId, organizationId, mailAccountId });
      assert.strictEqual(def?.signature_html?.includes("Compte"), true, "priorité compte");
    } else {
      const def2 = await getDefaultSignature({ userId, organizationId, mailAccountId: null });
      assert.strictEqual(def2?.signature_html?.includes("User"), true, "priorité user sans compte");
    }

    await updateSignature({
      signatureId: userSig.id,
      organizationId,
      name: "Test user MAJ",
      signatureHtml: "<p>User MAJ</p>",
    });
    const u2 = await pool.query(`SELECT name, signature_html FROM mail_signatures WHERE id = $1`, [userSig.id]);
    assert.strictEqual(u2.rows[0].name, "Test user MAJ");

    await setDefaultSignature({ signatureId: orgSig.id, organizationId, userId });
    const orgRow = await pool.query(`SELECT is_default FROM mail_signatures WHERE id = $1`, [orgSig.id]);
    assert.strictEqual(orgRow.rows[0].is_default, true);

    await deleteSignature({ signatureId: userSig.id, organizationId });
    const inactive = await pool.query(`SELECT is_active FROM mail_signatures WHERE id = $1`, [userSig.id]);
    assert.strictEqual(inactive.rows[0].is_active, false);

    console.log("MAIL SIGNATURES OK");
  } finally {
    await cleanup(createdIds);
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
