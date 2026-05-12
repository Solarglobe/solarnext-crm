/**
 * heightSanityFilter.ts — Filtre de plausibilité pour les hauteurs retournées
 * par `window.getHeightAtXY` / `fitPlaneWorldENU`.
 *
 * `fitPlaneWorldENU` produit des coefficients aberrants pour certaines géométries
 * de pans (bug pans-bundle connu : valeurs ~47m ou ~-320m au lieu de 4–7m).
 * Ces fonctions permettent de détecter et corriger ces valeurs avant qu'elles
 * ne corrompent la reconstruction 3D du patch (résidu > RESIDUAL_HIGH → INCOHERENT)
 * ou le Z centre des panneaux.
 *
 * Utilisé dans :
 *   - buildCanonicalPlacedPanelsFromRuntime.ts  (Z centre panneau)
 *   - calpinageStateToLegacyRoofInput.ts        (Z coins patch → reconstruction plane)
 */

/**
 * Retourne la hauteur moyenne (m) des coins `h` du pan identifié par `panId`
 * dans le state brut (CALPINAGE_STATE ou objet runtimeRootForOfficialPans).
 *
 * @returns Hauteur moyenne ou `defaultH` si le pan est introuvable / aucun h valide.
 */
export function meanPanHFromState(state: unknown, panId: string, defaultH: number): number {
  if (!state || typeof state !== "object") return defaultH;
  const pans = (state as Record<string, unknown>).pans;
  if (!Array.isArray(pans)) return defaultH;
  const pan = pans.find((p: unknown) => {
    if (!p || typeof p !== "object") return false;
    return (p as Record<string, unknown>).id === panId;
  });
  if (!pan || typeof pan !== "object") return defaultH;
  const points: unknown[] =
    (pan as Record<string, unknown[]>).points ??
    (pan as Record<string, unknown[]>).polygonPx ??
    [];
  const hs: number[] = [];
  for (const pt of points) {
    if (!pt || typeof pt !== "object") continue;
    const h = (pt as Record<string, unknown>).h;
    if (typeof h === "number" && Number.isFinite(h)) hs.push(h);
  }
  if (!hs.length) return defaultH;
  return hs.reduce((a, b) => a + b, 0) / hs.length;
}

/**
 * Valide et corrige une hauteur retournée par `resolveHeightAtXY` / `window.getHeightAtXY`.
 *
 * Si la valeur résolue dépasse le seuil de plausibilité par rapport aux coins
 * connus du pan (±10m par rapport à [minH, maxH] du pan), on retourne la moyenne
 * des coins `h` comme meilleure estimation.
 *
 * @param resolved  Hauteur retournée par le résolveur (peut être undefined ou aberrante).
 * @param state     CALPINAGE_STATE ou objet racine contenant `pans[]`.
 * @param panId     Identifiant du pan porteur (null = pas de filtre par pan).
 * @param defaultH  Valeur de secours si resolved est invalide ET aucun h explicite.
 */
export function sanePanHeightM(
  resolved: number | undefined,
  state: unknown,
  panId: string | null,
  defaultH: number,
): number {
  if (resolved === undefined || !Number.isFinite(resolved)) return defaultH;
  if (!panId) return resolved;

  const panMean = meanPanHFromState(state, panId, NaN);
  if (!Number.isFinite(panMean)) return resolved; // pan inconnu → confiance résolveur

  const st = state as Record<string, unknown>;
  const pans = Array.isArray(st.pans) ? st.pans : [];
  const pan = pans.find((p: unknown) =>
    p && typeof p === "object" && (p as Record<string, unknown>).id === panId,
  );
  const points: unknown[] = pan
    ? ((pan as Record<string, unknown[]>).points ??
       (pan as Record<string, unknown[]>).polygonPx ??
       [])
    : [];
  const hs = points
    .map((pt: unknown) =>
      pt && typeof pt === "object" ? (pt as Record<string, unknown>).h : undefined,
    )
    .filter((h): h is number => typeof h === "number" && Number.isFinite(h));
  const minH = hs.length ? Math.min(...hs) : panMean;
  const maxH = hs.length ? Math.max(...hs) : panMean;
  const lo = minH - 10;
  const hi = maxH + 10;

  if (resolved < lo || resolved > hi) {
    // Valeur hors plage de plausibilité → retourner la moyenne des coins
    return panMean;
  }
  return resolved;
}
