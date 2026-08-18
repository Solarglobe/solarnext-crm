import { pool } from "../../config/db.js";
import { withTx } from "../../db/tx.js";
import { withPgRetryOnce } from "../../utils/pgRetry.js";
import * as studiesService from "../../routes/studies/service.js";
import { persistGeometryHashForStudyVersion } from "./calpinageGeometryHash.js";
import { lockCalpinageVersion } from "./calpinageDataConcurrency.js";
import { ERROR_CODES } from "./calpinageSnapshotErrors.js";

export function createCalpinageValidatePostgresRepository(deps = {}) {
  const dbPool = deps.pool ?? pool;
  const tx = deps.withTx ?? withTx;
  const retry = deps.withPgRetryOnce ?? withPgRetryOnce;
  const studies = deps.studiesService ?? studiesService;
  const lockVersion = deps.lockCalpinageVersion ?? lockCalpinageVersion;
  const persistHash = deps.persistGeometryHashForStudyVersion ?? persistGeometryHashForStudyVersion;

  return {
    async resolveStudyVersionId({ studyId, organizationId, versionNumber }) {
      const version = await studies.getVersion(studyId, versionNumber, organizationId);
      return version?.id ?? null;
    },

    async commitCalpinageValidation({ organizationId, studyVersionId, layoutSnapshotBase64 }) {
      return retry(() =>
        tx(dbPool, async (client) => {
          await lockVersion(client, organizationId, studyVersionId);

          const locked = await client.query(
            `SELECT id FROM calpinage_data WHERE study_version_id = $1 AND organization_id = $2 FOR UPDATE`,
            [studyVersionId, organizationId],
          );
          if (locked.rows.length === 0) {
            const err = new Error("Calpinage non enregistré pour cette version.");
            err.code = ERROR_CODES.NO_CALPINAGE_DATA;
            throw err;
          }

          if (layoutSnapshotBase64 && typeof layoutSnapshotBase64 === "string") {
            const snapshot = layoutSnapshotBase64.startsWith("data:")
              ? layoutSnapshotBase64
              : `data:image/png;base64,${layoutSnapshotBase64}`;
            await client.query(
              `UPDATE calpinage_data
               SET geometry_json = jsonb_set(
                 COALESCE(geometry_json, '{}'::jsonb),
                 '{layout_snapshot}',
                 to_jsonb($1::text)
               )
               WHERE study_version_id = $2 AND organization_id = $3`,
              [snapshot, studyVersionId, organizationId],
            );
          }

          await persistHash(studyVersionId, organizationId, client);

          const gjRes = await client.query(
            `SELECT geometry_json FROM calpinage_data WHERE study_version_id = $1 AND organization_id = $2`,
            [studyVersionId, organizationId],
          );
          if (gjRes.rows.length === 0 || gjRes.rows[0].geometry_json == null) {
            const err = new Error("Calpinage non enregistré pour cette version.");
            err.code = ERROR_CODES.NO_CALPINAGE_DATA;
            throw err;
          }
          let geometryJson = gjRes.rows[0].geometry_json;
          if (geometryJson != null && typeof geometryJson === "string") {
            try {
              geometryJson = JSON.parse(geometryJson);
            } catch {
              const parseErr = new Error("geometry_json invalide (JSON non parsable)");
              parseErr.code = ERROR_CODES.CALPINAGE_INVALID_JSON;
              throw parseErr;
            }
          }
          return geometryJson;
        }),
      );
    },
  };
}
