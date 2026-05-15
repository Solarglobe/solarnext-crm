/**
 * backend/middleware/validate.middleware.js
 *
 * Middleware factory générique de validation Zod pour les entrées API.
 *
 * Usage :
 *   import { validate } from "../middleware/validate.middleware.js";
 *   import { CreateLeadSchema, LeadParamsSchema } from "../lib/schemas/index.js";
 *
 *   router.post("/", verifyJWT, validate({ body: CreateLeadSchema }), controller.create);
 *   router.get("/:id", verifyJWT, validate({ params: LeadParamsSchema }), controller.getById);
 *   router.get("/", verifyJWT, validate({ query: LeadListQuerySchema }), controller.list);
 *
 * Comportement :
 *   - Si valide   : req.body / req.params / req.query sont remplacés par les données
 *                   parsées et nettoyées par Zod (strip des clés inconnues).
 *   - Si invalide : 422 Unprocessable Entity avec le détail des erreurs par champ.
 *
 * Format d'erreur (422) :
 *   {
 *     "error": "Validation failed",
 *     "details": {
 *       "roof_polygon": ["Minimum 3 points requis"],
 *       "peak_power_kwp": ["Expected number, received string"]
 *     }
 *   }
 *
 * Note sur les schemas partagés :
 *   Les schemas viennent de backend/lib/schemas/ (JS pur, Zod runtime).
 *   Ils sont maintenus en parallèle avec shared/schemas/*.ts (TypeScript frontend).
 *   Lorsqu'un build step TS sera ajouté au backend, l'import pourra pointer
 *   directement vers shared/schemas/ sans changer l'interface du middleware.
 */

/**
 * Formate les erreurs Zod en un objet lisible par champ.
 *
 * @param {import("zod").ZodError} zodError
 * @returns {Record<string, string[]>}
 */
function formatZodErrors(zodError) {
  const details = {};
  for (const issue of zodError.issues) {
    // Construire le chemin lisible (ex: "lines.0.unit_price")
    const field = issue.path.length > 0
      ? issue.path.map(String).join(".")
      : "_root";
    if (!details[field]) details[field] = [];
    details[field].push(issue.message);
  }
  return details;
}

/**
 * Valide une valeur contre un schema Zod et retourne le résultat.
 * Utilise .safeParse() pour ne jamais lever d'exception.
 *
 * @param {import("zod").ZodTypeAny} schema
 * @param {unknown} value
 * @returns {{ ok: true, data: unknown } | { ok: false, details: Record<string, string[]> }}
 */
function parseWith(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, details: formatZodErrors(result.error) };
}

/**
 * Middleware factory de validation Zod.
 *
 * @param {{ body?: import("zod").ZodTypeAny, params?: import("zod").ZodTypeAny, query?: import("zod").ZodTypeAny }} schemas
 * @returns {import("express").RequestHandler}
 *
 * @example
 * // Valider body + params simultanément
 * router.patch("/:id", validate({ body: PatchLeadSchema, params: UuidParamsSchema }), controller.patch);
 *
 * @example
 * // Valider query string
 * router.get("/", validate({ query: LeadListQuerySchema }), controller.list);
 */
export function validate(schemas = {}) {
  const { body: bodySchema, params: paramsSchema, query: querySchema } = schemas;

  if (!bodySchema && !paramsSchema && !querySchema) {
    throw new Error(
      "[validate.middleware] Aucun schéma fourni. Passer au moins { body }, { params } ou { query }."
    );
  }

  return function validateMiddleware(req, res, next) {
    const allErrors = {};

    // --- body ---
    if (bodySchema) {
      const result = parseWith(bodySchema, req.body);
      if (!result.ok) {
        Object.assign(allErrors, result.details);
      } else {
        // Remplacer req.body par les données nettoyées (clés inconnues supprimées)
        req.body = result.data;
      }
    }

    // --- params ---
    if (paramsSchema) {
      const result = parseWith(paramsSchema, req.params);
      if (!result.ok) {
        // Préfixer les erreurs params pour les distinguer des erreurs body
        for (const [field, msgs] of Object.entries(result.details)) {
          allErrors[`params.${field}`] = msgs;
        }
      } else {
        req.params = result.data;
      }
    }

    // --- query ---
    if (querySchema) {
      const result = parseWith(querySchema, req.query);
      if (!result.ok) {
        for (const [field, msgs] of Object.entries(result.details)) {
          allErrors[`query.${field}`] = msgs;
        }
      } else {
        req.query = result.data;
      }
    }

    // --- Réponse si erreurs ---
    if (Object.keys(allErrors).length > 0) {
      return res.status(422).json({
        error: "Validation failed",
        details: allErrors,
      });
    }

    next();
  };
}

/**
 * Variante raccourcie pour valider uniquement req.body.
 *
 * @param {import("zod").ZodTypeAny} schema
 * @returns {import("express").RequestHandler}
 *
 * @example
 * router.post("/", validateBody(CreateLeadSchema), controller.create);
 */
export function validateBody(schema) {
  return validate({ body: schema });
}

/**
 * Variante raccourcie pour valider uniquement req.params.
 *
 * @param {import("zod").ZodTypeAny} schema
 * @returns {import("express").RequestHandler}
 *
 * @example
 * router.get("/:id", validateParams(UuidParamsSchema), controller.getById);
 */
export function validateParams(schema) {
  return validate({ params: schema });
}
