/**
 * domains/leads/leads.validator.js — Middleware de validation Zod pour le domaine Leads.
 *
 * Utilise Zod (disponible dans backend/node_modules/zod) pour valider
 * les payloads entrants avant qu'ils atteignent le controller.
 *
 * Usage dans le router :
 *   import { validateCreateLead, validatePatchLead } from "./leads.validator.js";
 *   router.post("/", verifyJWT, validateCreateLead, controller.createLead);
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema de création d'un lead
// ---------------------------------------------------------------------------
const CreateLeadSchema = z.object({
  first_name:    z.string().min(1).max(100),
  last_name:     z.string().min(1).max(100),
  email:         z.string().email().optional().nullable(),
  phone:         z.string().max(30).optional().nullable(),
  address:       z.string().max(500).optional().nullable(),
  city:          z.string().max(100).optional().nullable(),
  zip:           z.string().max(20).optional().nullable(),
  lat:           z.number().optional().nullable(),
  lng:           z.number().optional().nullable(),
  status:        z.string().optional(),
  source:        z.string().optional().nullable(),
  notes:         z.string().optional().nullable(),
  assigned_to:   z.string().uuid().optional().nullable(),
});

// ---------------------------------------------------------------------------
// Schema de mise à jour partielle (tous les champs optionnels)
// ---------------------------------------------------------------------------
const PatchLeadSchema = CreateLeadSchema.partial();

// ---------------------------------------------------------------------------
// Middleware factories
// ---------------------------------------------------------------------------

/**
 * Valide req.body contre CreateLeadSchema.
 * Renvoie 422 avec les erreurs Zod si invalide.
 */
export function validateCreateLead(req, res, next) {
  const result = CreateLeadSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(422).json({
      error: "Données de création invalides",
      details: result.error.flatten().fieldErrors,
    });
  }
  req.validatedBody = result.data;
  next();
}

/**
 * Valide req.body contre PatchLeadSchema.
 */
export function validatePatchLead(req, res, next) {
  const result = PatchLeadSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(422).json({
      error: "Données de mise à jour invalides",
      details: result.error.flatten().fieldErrors,
    });
  }
  req.validatedBody = result.data;
  next();
}
