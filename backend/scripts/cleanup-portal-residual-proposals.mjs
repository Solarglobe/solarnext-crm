#!/usr/bin/env node
/**
 * Nettoyage des propositions commerciales résiduelles affichées sur le portail client
 * (dry-run par défaut).
 *
 * Contexte : une proposition commerciale existe en double dans entity_documents —
 *   - le miroir attaché au lead (entity_type='lead'), visible dans l'onglet Documents,
 *   - la source study_version (entity_type='study_version'), affichée par le portail.
 * Archiver le miroir dans l'onglet Documents ne touche pas la source, que le portail
 * réaffiche via son repli. Ce script supprime DÉFINITIVEMENT (fichier + BDD) les sources
 * study_version encore visibles côté client dont le miroir lead a été archivé ou supprimé.
 *
 * Cible : un lead précis, identifié par son token de portail (celui de l'URL) ou par lead-id.
 * La suppression réutilise deleteDocument → cascade sur d'éventuels miroirs restants.
 *
 * Usage :
 *   cd backend && node scripts/cleanup-portal-residual-proposals.mjs --token=<TOKEN_URL>
 *   cd backend && node scripts/cleanup-portal-residual-proposals.mjs --lead=<LEAD_UUID> --org=<ORG_UUID>
 *   ... ajouter --apply pour exécuter réellement.
 *   ... ajouter --all pour inclure aussi les sources dont un miroir lead ACTIF existe encore
 *       (par défaut on ne supprime que les résiduelles : miroir archivé/absent).
 */
import "../config/register-local-env.js";
import { writeSync } from "fs";

writeSync(1, `[cleanup-portal-proposals] START ${new Date().toISOString()}\n`);

import { applyResolvedDatabaseUrl } from "../config/database-url.js";
applyResolvedDatabaseUrl();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function argVal(argv, name) {
  const pref = `--${name}=`;
  const hit = argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length).trim() : null;
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const includeActiveMirror = argv.includes("--all");
  const rawToken = argVal(argv, "token");
  let leadId = argVal(argv, "lead");
  let org = argVal(argv, "org");

  const { pool } = await import("../config/db.js");
  const { findValidPortalTokenRow } = await import("../services/clientPortal.service.js");
  const { deleteDocument } = await import("../services/documents.service.js");

  try {
    // 1) Résoudre lead + org depuis le token si fourni.
    if (rawToken) {
      const row = await findValidPortalTokenRow(rawToken);
      if (!row) {
        writeSync(1, "[cleanup-portal-proposals] Token invalide, révoqué ou expiré.\n");
        process.exit(1);
      }
      leadId = String(row.lead_id);
      org = String(row.organization_id);
      writeSync(1, `[cleanup-portal-proposals] Token → lead=${leadId} org=${org}\n`);
    }

    if (!leadId || !UUID_RE.test(leadId) || !org || !UUID_RE.test(org)) {
      writeSync(1, "[cleanup-portal-proposals] Fournir --token=<...> OU --lead=<UUID> --org=<UUID>.\n");
      process.exit(1);
    }

    // 2) Contexte lead (nom + client lié).
    const leadRes = await pool.query(
      `SELECT id, full_name, client_id FROM leads WHERE id = $1 AND organization_id = $2`,
      [leadId, org]
    );
    if (leadRes.rows.length === 0) {
      writeSync(1, "[cleanup-portal-proposals] Lead introuvable pour cette organisation.\n");
      process.exit(1);
    }
    const lead = leadRes.rows[0];
    writeSync(1, `[cleanup-portal-proposals] Lead: ${lead.full_name ?? "(sans nom)"}\n`);

    // 3) Sources study_version « proposition » visibles client, encore actives,
    //    rattachées à ce lead (via studies.lead_id) — et état de leur miroir lead.
    const srcRes = await pool.query(
      `SELECT ed.id, ed.file_name, ed.display_name, ed.created_at,
              (
                SELECT COUNT(*) FROM entity_documents m
                WHERE m.organization_id = ed.organization_id
                  AND m.entity_type = 'lead'
                  AND m.document_type IN ('study_pdf','study_proposal')
                  AND m.metadata_json->>'source_study_version_document_id' = ed.id::text
                  AND m.archived_at IS NULL
              )::int AS active_mirrors,
              (
                SELECT COUNT(*) FROM entity_documents m
                WHERE m.organization_id = ed.organization_id
                  AND m.entity_type = 'lead'
                  AND m.document_type IN ('study_pdf','study_proposal')
                  AND m.metadata_json->>'source_study_version_document_id' = ed.id::text
              )::int AS total_mirrors
       FROM entity_documents ed
       WHERE ed.organization_id = $1
         AND ed.entity_type = 'study_version'
         AND ed.document_type IN ('study_pdf','study_proposal')
         AND ed.archived_at IS NULL
         AND ed.is_client_visible IS TRUE
         AND EXISTS (
           SELECT 1 FROM study_versions sv
           INNER JOIN studies s ON s.id = sv.study_id AND s.organization_id = sv.organization_id
           WHERE sv.id = ed.entity_id
             AND sv.organization_id = ed.organization_id
             AND (
               s.lead_id = $2::uuid
               OR ($3::uuid IS NOT NULL AND s.client_id = $3::uuid)
             )
         )
       ORDER BY ed.created_at DESC`,
      [org, leadId, lead.client_id ?? null]
    );

    if (srcRes.rows.length === 0) {
      writeSync(1, "[cleanup-portal-proposals] Aucune source study_version visible client pour ce lead. Rien à faire.\n");
      await pool.end();
      return;
    }

    writeSync(1, `\n[cleanup-portal-proposals] ${srcRes.rows.length} source(s) study_version visible(s) client :\n`);
    for (const r of srcRes.rows) {
      writeSync(
        1,
        `  - ${r.id} | ${(r.display_name || r.file_name || "").slice(0, 60)} | miroirs actifs=${r.active_mirrors} total=${r.total_mirrors} | ${new Date(r.created_at).toISOString().slice(0, 10)}\n`
      );
    }

    // Résiduelles = sources sans miroir lead ACTIF (miroir archivé ou jamais créé).
    // --all : inclure aussi celles dont un miroir actif existe encore.
    const targets = srcRes.rows.filter((r) => (includeActiveMirror ? true : r.active_mirrors === 0));

    if (targets.length === 0) {
      writeSync(
        1,
        "\n[cleanup-portal-proposals] Aucune source RÉSIDUELLE (toutes ont un miroir lead actif). Utiliser --all pour forcer.\n"
      );
      await pool.end();
      return;
    }

    writeSync(1, `\n[cleanup-portal-proposals] ${targets.length} source(s) à supprimer définitivement :\n`);
    for (const r of targets) {
      writeSync(1, `  → ${r.id} | ${(r.display_name || r.file_name || "").slice(0, 60)}\n`);
    }

    if (!apply) {
      writeSync(1, "\n[DRY-RUN] Aucune suppression. Relancer avec --apply pour exécuter.\n");
      await pool.end();
      return;
    }

    let ok = 0;
    for (const r of targets) {
      try {
        await deleteDocument(String(r.id), org); // cascade → supprime aussi tout miroir restant
        ok += 1;
        writeSync(1, `  [OK] supprimé ${r.id}\n`);
      } catch (e) {
        writeSync(1, `  [ERREUR] ${r.id} : ${e?.message || e}\n`);
      }
    }
    writeSync(1, `\n[cleanup-portal-proposals] Terminé : ${ok}/${targets.length} source(s) supprimée(s).\n`);
    await pool.end();
  } catch (err) {
    writeSync(1, `[cleanup-portal-proposals] FATAL : ${err?.stack || err}\n`);
    process.exit(1);
  }
}

main();
