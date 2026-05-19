/**
 * Calcul du gain bifacial selon le modèle simplifié (IEC 60904-1-2, niveau Archelios).
 *
 * Formule :
 *   viewFactor = 0.5 × (1 - cos(tiltDeg × π/180))   — fraction du sol vue par la face arrière
 *   gainPct    = bifacialityFactor × albedo × viewFactor × 100
 *   gainFactor = 1 + gainPct/100
 *
 * ⚠️ Modèle valide uniquement si pitch ≥ 2 × panelHeight.
 *    En-dessous, l'ombrage de la face arrière n'est pas modélisé et le gain est surestimé.
 *
 * @param {object} p
 * @param {number} p.bifacialityFactor   — coefficient bifacialité panneau (0.60–0.85)
 * @param {number} p.albedo              — réflectivité sol (0.20 béton, 0.35 gravier blanc…)
 * @param {number} p.tiltDeg             — inclinaison panneau (°)
 * @param {number} [p.pitchM]            — espacement inter-rangées (m), pour le warning
 * @param {number} [p.panelHeightM]      — hauteur panneau (m), pour le warning
 * @returns {{ gainFactor: number, gainPct: number, warning: string | null }}
 */
export function computeBifacialGain(p) {
  const { bifacialityFactor, albedo, tiltDeg, pitchM, panelHeightM } = p;

  // --- Validation des entrées ---
  if (
    typeof bifacialityFactor !== "number" ||
    bifacialityFactor < 0.5 ||
    bifacialityFactor > 1.0
  ) {
    throw new Error(
      `bifacialityFactor invalide : ${bifacialityFactor} — attendu entre 0.5 et 1.0`
    );
  }
  if (typeof albedo !== "number" || albedo < 0 || albedo > 1) {
    throw new Error(
      `albedo invalide : ${albedo} — attendu entre 0 et 1`
    );
  }
  if (typeof tiltDeg !== "number" || tiltDeg < 0 || tiltDeg > 90) {
    throw new Error(
      `tiltDeg invalide : ${tiltDeg} — attendu entre 0 et 90`
    );
  }

  // --- Calcul du gain ---
  const tiltRad = (tiltDeg * Math.PI) / 180;
  const viewFactor = 0.5 * (1 - Math.cos(tiltRad));
  const gainPct = bifacialityFactor * albedo * viewFactor * 100;
  const gainFactor = 1 + gainPct / 100;

  // --- Warning si ombrage face arrière probable ---
  let warning = null;
  if (
    pitchM != null &&
    panelHeightM != null &&
    typeof pitchM === "number" &&
    typeof panelHeightM === "number" &&
    pitchM < 2 * panelHeightM
  ) {
    warning =
      `Ombrage face arrière probable : pitch (${pitchM} m) < 2 × hauteur panneau (${panelHeightM} m). ` +
      `Le gain bifacial calculé (${gainPct.toFixed(1)} %) est surestimé.`;
  }

  return { gainFactor, gainPct, warning };
}
