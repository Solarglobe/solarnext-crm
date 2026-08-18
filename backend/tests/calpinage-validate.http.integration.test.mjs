import assert from "node:assert/strict";
import { describe, test } from "node:test";
import express from "express";
import request from "supertest";

import { createValidateCalpinageHandler } from "../controllers/calpinageValidate.controller.js";
import { createCalpinageValidateService } from "../services/calpinage/calpinageValidate.service.js";
import { sanitizeCalpinageGeometryForPersistence } from "../services/calpinage/calpinageCommercialIntegrity.js";

const ERROR_CODES = {
  NO_CALPINAGE_DATA: "NO_CALPINAGE_DATA",
  CALPINAGE_INCOMPLETE: "CALPINAGE_INCOMPLETE",
  SHADING_NOT_COMPUTED: "SHADING_NOT_COMPUTED",
  SNAPSHOT_TOO_RECENT: "SNAPSHOT_TOO_RECENT",
  CALPINAGE_INVALID_JSON: "CALPINAGE_INVALID_JSON",
};

function hasShadingNormalized(geometryJson) {
  const shading = geometryJson?.shading;
  if (!shading || typeof shading !== "object") return false;
  if (shading.normalized != null) return true;
  if (typeof shading.totalLossPct === "number") return true;
  if (shading.combined && typeof shading.combined.totalLossPct === "number") return true;
  return Boolean(
    shading.near &&
      typeof shading.near === "object" &&
      shading.far &&
      typeof shading.far === "object" &&
      shading.combined &&
      typeof shading.combined === "object" &&
      Object.prototype.hasOwnProperty.call(shading.combined, "totalLossPct") &&
      shading.shadingQuality &&
      typeof shading.shadingQuality === "object",
  );
}

function minimalValidGeometryJson(overrides = {}) {
  return {
    roofState: { gps: { lat: 48.8566, lon: 2.3522 } },
    gps: { lat: 48.8566, lon: 2.3522 },
    validatedRoofData: {
      pans: [{ id: "PAN_HTTP_1", roofKind: "UNKNOWN", roofKindProvenance: "UNRESOLVED" }],
      scale: 1,
      north: 0,
    },
    pvParams: { panelSpec: { powerWc: 500 } },
    frozenBlocks: [],
    shading: {
      normalized: { totalLossPct: 0, panelCount: 0, perPanel: [] },
      totalLossPct: 0,
    },
    ...overrides,
  };
}

function makeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createStrictRepository({ geometry = minimalValidGeometryJson(), mode = "ok" } = {}) {
  const events = [];
  return {
    events,
    async resolveStudyVersionId({ versionNumber }) {
      events.push(["resolve", versionNumber]);
      return versionNumber === 1 ? "version-from-number" : null;
    },
    async commitCalpinageValidation({ organizationId, studyId, studyVersionId, layoutSnapshotBase64 }) {
      events.push(["begin", studyId, studyVersionId, organizationId]);
      try {
        if (mode === "no-data") {
          throw makeError(ERROR_CODES.NO_CALPINAGE_DATA, "Calpinage non enregistré pour cette version.");
        }
        if (mode === "not-found") {
          throw makeError("NOT_FOUND", "Étude ou version non trouvée");
        }
        if (mode === "mismatch") {
          throw makeError("MISMATCH", "studyVersionId ne correspond pas à studyId");
        }
        if (layoutSnapshotBase64) {
          events.push(["layout", layoutSnapshotBase64.startsWith("data:") ? "data-url" : "raw-base64"]);
        }
        events.push(["commit"]);
        return structuredClone(geometry);
      } catch (error) {
        events.push(["rollback", error.code]);
        throw error;
      }
    },
  };
}

function createStrictSnapshotService({ mode = "ok" } = {}) {
  const snapshots = [];
  return {
    snapshots,
    async createCalpinageSnapshot(studyId, studyVersionId, organizationId, userId, options = {}) {
      if (mode === "too-recent") {
        throw makeError(ERROR_CODES.SNAPSHOT_TOO_RECENT, "Un snapshot a déjà été créé à l'instant. Veuillez patienter.");
      }
      const geometry = sanitizeCalpinageGeometryForPersistence(options.geometryJson);
      if (!geometry?.gps && !geometry?.roofState?.gps) {
        throw makeError(ERROR_CODES.CALPINAGE_INCOMPLETE, "Données calpinage incomplètes");
      }
      if (!geometry?.validatedRoofData?.pans || !geometry?.pvParams || !Array.isArray(geometry?.frozenBlocks)) {
        throw makeError(ERROR_CODES.CALPINAGE_INCOMPLETE, "Données calpinage incomplètes");
      }
      if (geometry.shading != null && !hasShadingNormalized(geometry)) {
        throw makeError(ERROR_CODES.SHADING_NOT_COMPUTED, "Ombrage non calculé");
      }
      const snapshot = {
        studyId,
        studyVersionId,
        organizationId,
        userId,
        geometry,
      };
      snapshots.push(snapshot);
      return { snapshotId: "snapshot-http-1", version_number: snapshots.length };
    },
  };
}

function createTestApp({ repository, snapshotService }) {
  const service = createCalpinageValidateService({
    repository,
    snapshotService,
    logAuditEvent: () => Promise.resolve(),
    auditActions: { CALPINAGE_VALIDATED: "CALPINAGE_VALIDATED" },
  });
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use((req, _res, next) => {
    req.user = {
      id: "user-http-1",
      organizationId: "org-http-1",
      emailVerified: true,
    };
    next();
  });
  app.post("/api/studies/:studyId/calpinage/validate", createValidateCalpinageHandler(service));
  return app;
}

describe("POST /api/studies/:studyId/calpinage/validate (HTTP injecté, sans PostgreSQL)", () => {
  test("traverse HTTP -> controller -> service -> repository et persiste un snapshot sanitise", async () => {
    const repository = createStrictRepository({
      geometry: minimalValidGeometryJson({
        officialPvPlacementAllowed: true,
        officialNearShadingAllowed: true,
        commercialGeometryVerdict: { status: "VALID" },
      }),
    });
    const snapshotService = createStrictSnapshotService();
    const app = createTestApp({ repository, snapshotService });

    const res = await request(app)
      .post("/api/studies/study-http-1/calpinage/validate")
      .send({ studyVersionId: "version-http-1", layout_snapshot_base64: "abc123" });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, "validated");
    assert.deepEqual(repository.events.map((event) => event[0]), ["begin", "layout", "commit"]);
    const geometry = snapshotService.snapshots[0].geometry;
    assert.equal(geometry.officialPvPlacementAllowed, undefined);
    assert.equal(geometry.officialNearShadingAllowed, undefined);
    assert.equal(geometry.commercialGeometryVerdict, undefined);
    assert.equal(geometry.backendCommercialGeometry.status, "INVALID");
    assert.equal(geometry.backendCommercialGeometry.officialPvPlacementAllowed, false);
    assert.equal(geometry.backendCommercialGeometry.officialNearShadingAllowed, false);
  });

  test("resout versionId numerique via repository et conserve roofKind/provenance", async () => {
    const repository = createStrictRepository({
      geometry: minimalValidGeometryJson({
        validatedRoofData: {
          pans: [{ id: "PAN_FLAT", roofKind: "FLAT", roofKindProvenance: "EXPLICIT" }],
          scale: 1,
          north: 0,
        },
      }),
    });
    const snapshotService = createStrictSnapshotService();
    const app = createTestApp({ repository, snapshotService });

    const res = await request(app)
      .post("/api/studies/study-http-1/calpinage/validate")
      .send({ versionId: 1 });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(repository.events[0], ["resolve", 1]);
    const pan = snapshotService.snapshots[0].geometry.validatedRoofData.pans[0];
    assert.equal(pan.roofKind, "FLAT");
    assert.equal(pan.roofKindProvenance, "EXPLICIT");
    assert.equal(snapshotService.snapshots[0].geometry.backendCommercialGeometry.status, "UNCERTIFIED");
  });

  test("body incomplet -> 400 sans transaction", async () => {
    const repository = createStrictRepository();
    const app = createTestApp({ repository, snapshotService: createStrictSnapshotService() });

    const res = await request(app).post("/api/studies/study-http-1/calpinage/validate").send({});

    assert.equal(res.status, 400);
    assert.equal(repository.events.length, 0);
  });

  test("repository no-data -> rollback puis 400", async () => {
    const repository = createStrictRepository({ mode: "no-data" });
    const app = createTestApp({ repository, snapshotService: createStrictSnapshotService() });

    const res = await request(app)
      .post("/api/studies/study-http-1/calpinage/validate")
      .send({ studyVersionId: "version-http-1" });

    assert.equal(res.status, 400);
    assert.deepEqual(repository.events.map((event) => event[0]), ["begin", "rollback"]);
  });

  test("repository mismatch/not-found -> 404", async () => {
    const repository = createStrictRepository({ mode: "mismatch" });
    const app = createTestApp({ repository, snapshotService: createStrictSnapshotService() });

    const res = await request(app)
      .post("/api/studies/study-http-1/calpinage/validate")
      .send({ studyVersionId: "version-other-study" });

    assert.equal(res.status, 404);
  });

  test("snapshot trop recent -> 429", async () => {
    const repository = createStrictRepository();
    const app = createTestApp({
      repository,
      snapshotService: createStrictSnapshotService({ mode: "too-recent" }),
    });

    const res = await request(app)
      .post("/api/studies/study-http-1/calpinage/validate")
      .send({ studyVersionId: "version-http-1" });

    assert.equal(res.status, 429);
  });

  test("NaN, Infinity et payload incoherent sont rejetes en HTTP 400", async () => {
    const cases = [
      minimalValidGeometryJson({ invalidNumber: Number.NaN }),
      minimalValidGeometryJson({ nested: { invalidNumber: Number.POSITIVE_INFINITY } }),
      { gps: { lat: 48.8566, lon: 2.3522 }, validatedRoofData: { pans: [] }, pvParams: {} },
    ];

    for (const geometry of cases) {
      const repository = createStrictRepository({ geometry });
      const app = createTestApp({ repository, snapshotService: createStrictSnapshotService() });
      const res = await request(app)
        .post("/api/studies/study-http-1/calpinage/validate")
        .send({ studyVersionId: "version-http-1" });
      assert.equal(res.status, 400, JSON.stringify({ body: res.body, geometry }));
    }
  });

  test("payload JSON roundtrip conserve le verdict backend et retire les champs officiels client", async () => {
    const raw = minimalValidGeometryJson({
      officialPvPlacementAllowed: true,
      officialNearShadingAllowed: true,
    });
    const sanitized = sanitizeCalpinageGeometryForPersistence(raw);
    const roundtrip = JSON.parse(JSON.stringify(sanitized));

    assert.equal(roundtrip.officialPvPlacementAllowed, undefined);
    assert.equal(roundtrip.officialNearShadingAllowed, undefined);
    assert.equal(roundtrip.backendCommercialGeometry.contractVersion, "backend-commercial-geometry-v1");
    assert.equal(roundtrip.backendCommercialGeometry.status, "INVALID");
  });
});
