/**
 * Phase B8 — Modeleur réaliste niveau 1 (option B : pente max) + cohérence
 * `validateCanonicalScene3DInput` après édition sommet (Z / XY).
 *
 * Aucune mutation du runtime : le caller applique l’édition puis valide ; en cas d’échec il restaure `pans`.
 *
 * Même chaîne que le viewer officiel : RoofTruth + pans dérivés des patches (pas le chemin
 * `buildCanonicalPans3DFromRuntime` seul).
 *
 * `scopePanGeometryErrorsToEditedPanId` : n’a d’effet qu’en échec **avant** dérivation toit
 * (`pre_roof_validation`). Après dérivation, les erreurs sont globales — alignement produit / viewer 3D.
 */

import { CANONICAL_SCENE_VALIDATION_CODES } from "../canonical3d/validation/validateCanonicalScene3DInput";
import { buildValidatedCanonicalScene3DInputWithOfficialRoofTruth } from "../canonical3d/scene/buildValidatedCanonicalScene3DInputWithOfficialRoofTruth";

/** Pente surface / horizontal (0° = plat, 90° = mur) — au-delà, rejet côté modeleur. */
export const ROOF_MODELING_MAX_SLOPE_DEG = 72;

export type ValidateCalpinageRuntimeAfterRoofEditArgs = {
  readonly editedPanId: string;
  readonly getAllPanels?: () => unknown[] | null | undefined;
  /**
   * Si true (défaut) : pour l’étape **pre_roof_validation** uniquement, ignore
   * `PAN_DEGENERATE` / `PAN_INVALID_GEOMETRY` pour les pans **autres** que `editedPanId`.
   * Après dérivation RoofTruth, toute erreur de scène bloque (comme le build 3D officiel).
   */
  readonly scopePanGeometryErrorsToEditedPanId?: boolean;
  /**
   * Édition hauteur **structurelle** (ex. faîtage) : recalcule tous les pans — vérifier la pente sur **chaque** pan dérivé.
   * Si true : ignore `editedPanId` pour la vérification de pente max (on teste tous les `pipe.scene.roof.pans`).
   */
  readonly validateSlopeOnAllPans?: boolean;
};

export type ValidateCalpinageRuntimeAfterRoofEditResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly userMessage: string; readonly codes: readonly string[] };

function filterPanGeometryErrorsToEditedPan(
  errors: readonly { readonly code: string; readonly message: string; readonly context?: unknown }[],
  editedPanId: string,
): typeof errors {
  return errors.filter((e) => {
    if (
      e.code !== CANONICAL_SCENE_VALIDATION_CODES.PAN_DEGENERATE &&
      e.code !== CANONICAL_SCENE_VALIDATION_CODES.PAN_INVALID_GEOMETRY
    ) {
      return true;
    }
    const ctx = e.context as { panId?: unknown } | undefined;
    const pid = ctx != null && typeof ctx.panId === "string" ? ctx.panId : null;
    if (pid == null) return true;
    return pid === editedPanId;
  });
}

function finalizeRoofEditUserMessage(messages: string[], codes: readonly string[]): string {
  const uniqueMsg = [...new Set(messages)];
  let base = uniqueMsg.slice(0, 6).join(" — ");
  if (
    codes.some(
      (c) =>
        c === CANONICAL_SCENE_VALIDATION_CODES.PAN_DEGENERATE ||
        c === CANONICAL_SCENE_VALIDATION_CODES.PAN_INVALID_GEOMETRY,
    )
  ) {
    base +=
      " Astuce : chaque pan doit former un plan cohérent ; ajustez les autres sommets ou corrigez un pan voisin si le relevé bloque.";
  }
  return base;
}

/**
 * Construit la scène canonique depuis le runtime courant (déjà synchronisé miroir / contrat si besoin)
 * via le pipeline toit officiel, puis vérifie la pente max du pan édité (`slopeDeg`) sur les pans dérivés.
 */
export function validateCalpinageRuntimeAfterRoofEdit(
  runtime: unknown,
  args: ValidateCalpinageRuntimeAfterRoofEditArgs,
): ValidateCalpinageRuntimeAfterRoofEditResult {
  if (!runtime || typeof runtime !== "object") {
    return {
      ok: false,
      userMessage: "État calpinage absent ou invalide.",
      codes: ["RUNTIME_MISSING"],
    };
  }

  let pipe;
  try {
    pipe = buildValidatedCanonicalScene3DInputWithOfficialRoofTruth(runtime, {
      getAllPanels: args.getAllPanels,
      placementEngine: null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      userMessage: `Impossible de reconstruire la scène 3D : ${msg}`,
      codes: ["SCENE_BUILD_THROW"],
    };
  }

  const panId = String(args.editedPanId);
  const scope = args.scopePanGeometryErrorsToEditedPanId !== false;
  const slopeAll = args.validateSlopeOnAllPans === true;

  if (!pipe.ok) {
    const raw = pipe.diagnostics.errors;
    const filtered =
      scope && pipe.stage === "pre_roof_validation" ? filterPanGeometryErrorsToEditedPan(raw, panId) : raw;
    if (filtered.length > 0) {
      const messages: string[] = [];
      const codes: string[] = [];
      for (const e of filtered) {
        messages.push(e.message);
        codes.push(e.code);
      }
      return {
        ok: false,
        userMessage: finalizeRoofEditUserMessage(messages, codes),
        codes,
      };
    }
    if (pipe.stage === "pre_roof_validation" && raw.length > 0) {
      return { ok: true };
    }
    return {
      ok: false,
      userMessage: finalizeRoofEditUserMessage(
        raw.map((e) => e.message),
        raw.map((e) => e.code),
      ),
      codes: raw.map((e) => e.code),
    };
  }

  const pansForSlope = slopeAll
    ? pipe.scene.roof.pans
    : pipe.scene.roof.pans.filter((p) => String(p.panId) === panId);

  const messages: string[] = [];
  const codes: string[] = [];

  for (const pan of pansForSlope) {
    if (pan && typeof pan.slopeDeg === "number" && Number.isFinite(pan.slopeDeg)) {
      if (pan.slopeDeg > ROOF_MODELING_MAX_SLOPE_DEG) {
        const label = slopeAll ? `pan ${String(pan.panId)}` : "pan";
        messages.push(
          `Pente du ${label} trop forte (${pan.slopeDeg.toFixed(1)}°, maximum ${ROOF_MODELING_MAX_SLOPE_DEG}° pour le modeleur).`,
        );
        codes.push("ROOF_MODELING_SLOPE_EXCEEDED");
      }
    }
  }

  if (messages.length === 0) return { ok: true };

  return {
    ok: false,
    userMessage: finalizeRoofEditUserMessage(messages, codes),
    codes,
  };
}
