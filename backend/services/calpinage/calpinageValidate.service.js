import { ERROR_CODES } from "./calpinageSnapshotErrors.js";

const orgId = (user) => user?.organizationId ?? user?.organization_id;
const userId = (user) => user?.id ?? user?.userId ?? null;

export function createCalpinageValidateService({ repository, snapshotService, logAuditEvent, auditActions, debug = false }) {
  if (!repository?.commitCalpinageValidation) {
    throw new Error("calpinage validate repository manquant");
  }
  if (!snapshotService?.createCalpinageSnapshot) {
    throw new Error("calpinage snapshot service manquant");
  }

  return {
    async validate({ studyId, body = {}, query = {}, user, req = null }) {
      const studyVersionIdIn = body.studyVersionId ?? query?.studyVersionId;
      const versionIdIn = body.versionId ?? query?.versionId;

      try {
        const organizationId = orgId(user);
        if (!organizationId) {
          return { status: 401, body: { error: "Non authentifié" } };
        }

        let studyVersionId = studyVersionIdIn;
        if (!studyVersionId && (versionIdIn != null || query?.versionId != null)) {
          const versionNum = parseInt(versionIdIn ?? query?.versionId, 10);
          if (!Number.isNaN(versionNum) && versionNum >= 1) {
            studyVersionId = await repository.resolveStudyVersionId?.({
              studyId,
              organizationId,
              versionNumber: versionNum,
            });
          }
        }

        if (!studyVersionId || typeof studyVersionId !== "string") {
          return { status: 400, body: { error: "studyVersionId (UUID) requis" } };
        }

        const layoutSnapshotBase64 = body.layout_snapshot_base64;
        const committedGeometryJson = await repository.commitCalpinageValidation({
          organizationId,
          studyId,
          studyVersionId,
          layoutSnapshotBase64,
        });

        const result = await snapshotService.createCalpinageSnapshot(
          studyId,
          studyVersionId,
          organizationId,
          userId(user),
          { geometryJson: committedGeometryJson },
        );

        if (debug) {
          console.log("[calpinageValidate] studyId=" + studyId + " studyVersionId=" + studyVersionId + " ok=1");
        }
        console.log("VALIDATE_RETURN_200");
        if (logAuditEvent && auditActions?.CALPINAGE_VALIDATED) {
          void logAuditEvent({
            action: auditActions.CALPINAGE_VALIDATED,
            entityType: "study_version",
            entityId: studyVersionId,
            organizationId,
            userId: userId(user),
            req,
            statusCode: 200,
            metadata: {
              study_id: studyId,
              snapshot_id: result.snapshotId,
            },
          });
        }

        return {
          status: 200,
          body: {
            snapshotId: result.snapshotId,
            version_number: result.version_number,
            status: "validated",
          },
        };
      } catch (e) {
        const code = e.code || e.name;
        const message = e.message || "Erreur inattendue";

        if (debug) {
          console.log(
            "[calpinageValidate] studyId=" +
              studyId +
              " studyVersionId=" +
              (studyVersionIdIn || versionIdIn) +
              " error=" +
              (code || "INTERNAL"),
          );
        }

        if (code === "NOT_FOUND" || code === "MISMATCH") {
          return { status: 404, body: { error: message } };
        }
        if (code === ERROR_CODES.NO_CALPINAGE_DATA) {
          return {
            status: 400,
            body: { error: "Calpinage non enregistré pour cette version. Enregistrez d'abord le calpinage." },
          };
        }
        if (code === ERROR_CODES.CALPINAGE_INCOMPLETE) {
          return { status: 400, body: { error: message } };
        }
        if (code === ERROR_CODES.SHADING_NOT_COMPUTED) {
          return { status: 400, body: { error: "Ombrage non calculé. Lancez le calcul d'ombrage avant de valider." } };
        }
        if (code === ERROR_CODES.SNAPSHOT_TOO_RECENT) {
          return { status: 429, body: { error: message } };
        }
        if (code === ERROR_CODES.CALPINAGE_INVALID_JSON) {
          return { status: 400, body: { error: message } };
        }

        console.error("[calpinageValidate.service] validate:", e?.stack || e);
        return { status: 500, body: { error: "INTERNAL" } };
      }
    },
  };
}
