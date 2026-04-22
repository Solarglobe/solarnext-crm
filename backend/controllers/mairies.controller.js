/**
 * CP-MAIRIES-002 — CRUD API Mairies / portails DP.
 * CP-MAIRIES-HARDENING — 409 structuré, logs dev sur doublon.
 */

import {
  parseCreatePayload,
  parsePatchPayload,
  isUuid,
} from "../services/mairies/mairies.validation.js";
import {
  listMairies,
  getMairieById,
  insertMairie,
  updateMairie,
  deleteMairie,
} from "../services/mairies/mairies.service.js";

const orgId = (req) => req.user?.organizationId ?? req.user?.organization_id;

const MSG_DUPLICATE = "Une mairie similaire existe déjà pour cette organisation";

function jsonError(res, status, payload) {
  return res.status(status).json(payload);
}

/**
 * @param {unknown} err
 * @param {string | null} [organizationId]
 * @param {Record<string, unknown> | null} [attemptedPayload] — données normalisées soumises (POST/PATCH)
 */
function mapMairieDuplicateError(err, organizationId, attemptedPayload) {
  if (!err || typeof err !== "object" || err.code !== "23505") {
    return null;
  }
  if (process.env.NODE_ENV !== "production") {
    console.warn("[MAIRIES_DUPLICATE]", {
      organizationId,
      name: attemptedPayload?.name,
      postal_code: attemptedPayload?.postal_code,
    });
  }
  const suggestion =
    attemptedPayload &&
    (attemptedPayload.name != null ||
      attemptedPayload.postal_code != null ||
      attemptedPayload.city !== undefined);
  return {
    status: 409,
    body: {
      error: MSG_DUPLICATE,
      message: MSG_DUPLICATE,
      code: "MAIRIE_ALREADY_EXISTS",
      /** @deprecated Utiliser `code: MAIRIE_ALREADY_EXISTS` — conservé pour compat scripts / clients historiques. */
      legacy_code: "DUPLICATE_MAIRIE",
      ...(suggestion
        ? {
            suggestion: {
              name: attemptedPayload?.name ?? null,
              postal_code: attemptedPayload?.postal_code ?? null,
              city: attemptedPayload?.city ?? null,
            },
          }
        : {}),
    },
  };
}

export async function getList(req, res) {
  try {
    const org = orgId(req);
    if (!org) {
      return jsonError(res, 403, { error: "FORBIDDEN", code: "MISSING_ORGANIZATION" });
    }
    const result = await listMairies({ organizationId: org, query: req.query || {} });
    return res.json(result);
  } catch (e) {
    const mapped = mapMairieDuplicateError(e, orgId(req), null);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    console.error("mairies.getList", e);
    return jsonError(res, 500, { error: "Erreur serveur" });
  }
}

export async function getOne(req, res) {
  try {
    const org = orgId(req);
    if (!org) {
      return jsonError(res, 403, { error: "FORBIDDEN", code: "MISSING_ORGANIZATION" });
    }
    const id = req.params.id;
    if (!isUuid(id)) {
      return jsonError(res, 400, { error: "Identifiant invalide", code: "INVALID_ID" });
    }
    const row = await getMairieById(org, id);
    if (!row) {
      return jsonError(res, 404, { error: "Mairie introuvable", code: "NOT_FOUND" });
    }
    return res.json(row);
  } catch (e) {
    const mapped = mapMairieDuplicateError(e, orgId(req), null);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    console.error("mairies.getOne", e);
    return jsonError(res, 500, { error: "Erreur serveur" });
  }
}

export async function create(req, res) {
  const org = orgId(req);
  if (!org) {
    return jsonError(res, 403, { error: "FORBIDDEN", code: "MISSING_ORGANIZATION" });
  }
  const parsed = parseCreatePayload(req.body);
  if (parsed.error) {
    return jsonError(res, 400, {
      error: parsed.error,
      code: parsed.code || "VALIDATION",
    });
  }
  try {
    const row = await insertMairie(org, parsed.data);
    return res.status(201).json(row);
  } catch (e) {
    const mapped = mapMairieDuplicateError(e, org, parsed.data);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    console.error("mairies.create", e);
    return jsonError(res, 500, { error: "Erreur serveur" });
  }
}

export async function patch(req, res) {
  const org = orgId(req);
  if (!org) {
    return jsonError(res, 403, { error: "FORBIDDEN", code: "MISSING_ORGANIZATION" });
  }
  const id = req.params.id;
  if (!isUuid(id)) {
    return jsonError(res, 400, { error: "Identifiant invalide", code: "INVALID_ID" });
  }
  const parsed = parsePatchPayload(req.body);
  if (parsed.error) {
    return jsonError(res, 400, {
      error: parsed.error,
      code: parsed.code || "VALIDATION",
    });
  }
  try {
    const row = await updateMairie(org, id, parsed.data);
    if (!row) {
      return jsonError(res, 404, { error: "Mairie introuvable", code: "NOT_FOUND" });
    }
    return res.json(row);
  } catch (e) {
    const mapped = mapMairieDuplicateError(e, org, parsed.data);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    console.error("mairies.patch", e);
    return jsonError(res, 500, { error: "Erreur serveur" });
  }
}

export async function remove(req, res) {
  try {
    const org = orgId(req);
    if (!org) {
      return jsonError(res, 403, { error: "FORBIDDEN", code: "MISSING_ORGANIZATION" });
    }
    const id = req.params.id;
    if (!isUuid(id)) {
      return jsonError(res, 400, { error: "Identifiant invalide", code: "INVALID_ID" });
    }
    const ok = await deleteMairie(org, id);
    if (!ok) {
      return jsonError(res, 404, { error: "Mairie introuvable", code: "NOT_FOUND" });
    }
    return res.status(204).send();
  } catch (e) {
    const mapped = mapMairieDuplicateError(e, orgId(req), null);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    console.error("mairies.remove", e);
    return jsonError(res, 500, { error: "Erreur serveur" });
  }
}
