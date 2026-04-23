/**
 * CP-SNAPSHOT — Validation calpinage → création snapshot versionné (verrouillé, immuable).
 * POST /api/studies/:studyId/calpinage/validate
 *
 * SOURCE DE VÉRITÉ UNIQUE : ce handler est le seul point d'entrée UI pour la validation.
 * Capture : html2canvas côté frontend (layout_snapshot_base64). Playwright non utilisé.
 * Délègue à createCalpinageSnapshot() (calpinageSnapshot.service.js).
 */

import { pool } from "../config/db.js";
import { withTx } from "../db/tx.js";
import { createCalpinageSnapshot, ERROR_CODES } from "../services/calpinage/calpinageSnapshot.service.js";
import { persistGeometryHashForStudyVersion } from "../services/calpinage/calpinageGeometryHash.js";
import { lockCalpinageVersion } from "../services/calpinage/calpinageDataConcurrency.js";
import { withPgRetryOnce } from "../utils/pgRetry.js";
import * as studiesService from "../routes/studies/service.js";
import { logAuditEvent } from "../services/audit/auditLog.service.js";
import { AuditActions } from "../services/audit/auditActions.js";

const orgId = (req) => req.user?.organizationId ?? req.user?.organization_id;
const userId = (req) => req.user?.id ?? req.user?.userId ?? null;

const DEBUG = process.env.DEBUG_CALPINAGE_VALIDATE === "1";

function traceCalpinageEnabled() {
  return process.env.SN_CALPINAGE_TRACE === "1";
}

function traceCalpinageLog(event, fields) {
  if (!traceCalpinageEnabled()) return;
  console.warn("[SN-CALPINAGE-TRACE]", JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}

/**
 * POST /api/studies/:studyId/calpinage/validate
 * Body: { studyVersionId: UUID } — id de la version (study_versions.id)
 * Optionnel: { versionId: number } — numéro de version (résolution vers studyVersionId si studyVersionId absent)
 * Délègue à createCalpinageSnapshot(..., { geometryJson }) avec la géométrie lue dans la même transaction que l’écriture.
 */
export async function validateCalpinage(req, res) {
  const studyId = req.params.studyId;
  const body = req.body || {};
  const studyVersionIdIn = body.studyVersionId ?? req.query?.studyVersionId;
  const versionIdIn = body.versionId ?? req.query?.versionId;

  try {
    const org = orgId(req);
    if (!org) {
      return res.status(401).json({ error: "Non authentifié" });
    }

    let studyVersionId = studyVersionIdIn;

    if (!studyVersionId && (versionIdIn != null || req.query?.versionId != null)) {
      const versionNum = parseInt(versionIdIn ?? req.query?.versionId, 10);
      if (!Number.isNaN(versionNum) && versionNum >= 1) {
        const version = await studiesService.getVersion(studyId, versionNum, org);
        if (version) studyVersionId = version.id;
      }
    }

    if (!studyVersionId || typeof studyVersionId !== "string") {
      return res.status(400).json({ error: "studyVersionId (UUID) requis" });
    }

    const layoutSnapshotBase64 = body.layout_snapshot_base64;
    const snapIn =
      layoutSnapshotBase64 && typeof layoutSnapshotBase64 === "string"
        ? layoutSnapshotBase64.length
        : 0;
    traceCalpinageLog("validate_request", {
      studyId,
      studyVersionId: studyVersionIdIn || null,
      hasLayoutSnapshotBase64: !!(layoutSnapshotBase64 && typeof layoutSnapshotBase64 === "string"),
      layoutSnapshotBase64Chars: snapIn,
    });

    const committedGeometryJson = await withPgRetryOnce(() =>
      withTx(pool, async (client) => {
        await lockCalpinageVersion(client, org, studyVersionId);

        const locked = await client.query(
          `SELECT id FROM calpinage_data WHERE study_version_id = $1 AND organization_id = $2 FOR UPDATE`,
          [studyVersionId, org]
        );
        if (locked.rows.length === 0) {
          const err = new Error("Calpinage non enregistré pour cette version.");
          err.code = ERROR_CODES.NO_CALPINAGE_DATA;
          throw err;
        }

        if (layoutSnapshotBase64 && typeof layoutSnapshotBase64 === "string") {
          const snapshot =
            layoutSnapshotBase64.startsWith("data:") ? layoutSnapshotBase64 : `data:image/png;base64,${layoutSnapshotBase64}`;
          const upd = await client.query(
            `UPDATE calpinage_data
             SET geometry_json = jsonb_set(
               COALESCE(geometry_json, '{}'::jsonb),
               '{layout_snapshot}',
               to_jsonb($1::text)
             )
             WHERE study_version_id = $2 AND organization_id = $3`,
            [snapshot, studyVersionId, org]
          );
          traceCalpinageLog("validate_layout_jsonb_set", {
            studyId,
            studyVersionId,
            rowCount: upd.rowCount,
            snapshotDataUrlChars: snapshot.length,
          });
        } else {
          traceCalpinageLog("validate_layout_skipped", {
            studyId,
            studyVersionId,
            reason: "no_layout_snapshot_base64_string",
          });
        }

        await persistGeometryHashForStudyVersion(studyVersionId, org, client);

        const gjRes = await client.query(
          `SELECT geometry_json FROM calpinage_data WHERE study_version_id = $1 AND organization_id = $2`,
          [studyVersionId, org]
        );
        if (gjRes.rows.length === 0 || gjRes.rows[0].geometry_json == null) {
          const err = new Error("Calpinage non enregistré pour cette version.");
          err.code = ERROR_CODES.NO_CALPINAGE_DATA;
          throw err;
        }
        let gj = gjRes.rows[0].geometry_json;
        if (gj != null && typeof gj === "string") {
          try {
            gj = JSON.parse(gj);
          } catch {
            const parseErr = new Error("geometry_json invalide (JSON non parsable)");
            parseErr.code = ERROR_CODES.CALPINAGE_INVALID_JSON;
            throw parseErr;
          }
        }
        return gj;
      })
    );

    const result = await createCalpinageSnapshot(studyId, studyVersionId, org, userId(req), {
      geometryJson: committedGeometryJson,
    });

    if (DEBUG) {
      console.log("[calpinageValidate] studyId=" + studyId + " studyVersionId=" + studyVersionId + " ok=1");
    }
    console.log("VALIDATE_RETURN_200");
    void logAuditEvent({
      action: AuditActions.CALPINAGE_VALIDATED,
      entityType: "study_version",
      entityId: studyVersionId,
      organizationId: org,
      userId: userId(req),
      req,
      statusCode: 200,
      metadata: {
        study_id: studyId,
        snapshot_id: result.snapshotId,
      },
    });
    return res.status(200).json({
      snapshotId: result.snapshotId,
      version_number: result.version_number,
      status: "validated",
    });
  } catch (e) {
    const code = e.code || e.name;
    const message = e.message || "Erreur inattendue";

    if (DEBUG) {
      console.log("[calpinageValidate] studyId=" + studyId + " studyVersionId=" + (studyVersionIdIn || versionIdIn) + " error=" + (code || "INTERNAL"));
    }

    if (code === "NOT_FOUND" || code === "MISMATCH") {
      return res.status(404).json({ error: message });
    }
    if (code === ERROR_CODES.NO_CALPINAGE_DATA) {
      return res.status(400).json({ error: "Calpinage non enregistré pour cette version. Enregistrez d'abord le calpinage." });
    }
    if (code === ERROR_CODES.CALPINAGE_INCOMPLETE) {
      return res.status(400).json({ error: message });
    }
    if (code === ERROR_CODES.SHADING_NOT_COMPUTED) {
      return res.status(400).json({ error: "Ombrage non calculé. Lancez le calcul d'ombrage avant de valider." });
    }
    if (code === ERROR_CODES.SNAPSHOT_TOO_RECENT) {
      return res.status(429).json({ error: message });
    }
    if (code === ERROR_CODES.CALPINAGE_INVALID_JSON) {
      return res.status(400).json({ error: message });
    }

    console.error("[calpinageValidate.controller] validateCalpinage:", e?.stack || e);
    return res.status(500).json({ error: "INTERNAL" });
  }
}
