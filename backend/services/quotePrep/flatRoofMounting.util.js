/**
 * LOT D — MATÉRIEL DE POSE TOIT PLAT (lecture seule du snapshot Lot A).
 * Module PUR (aucun import db/config) — partagé par quotePrep.service.js (devis technique)
 * et pdfViewModel.service.js (PDF), testable sans DATABASE_URL.
 *
 * Extrait, pour chaque pan FLAT porteur d'un snapshot `flatRoofConfig.mountingSystem`
 * VALIDE, les infos d'affichage. Aucune re-résolution catalogue, aucun calcul :
 * on recopie le snapshot figé à la validation du calepinage.
 *
 * Garde structurelle (état persisté manipulé / ancien) :
 *   - arrangement DOIT être "SOUTH_SINGLE" — un snapshot est-ouest injecté n'est
 *     JAMAIS affiché comme système valide (le moteur l'a de toute façon purgé) ;
 *   - brand + label + tiltDeg requis, sinon entrée ignorée (snapshot incomplet).
 *
 * @param {Array<object>|null|undefined} pansArray payload.validatedRoofData.pans
 * @returns {Array<object>|null} null si aucun système — l'affichage existant ne change pas
 */
export function extractFlatRoofMountingFromPans(pansArray) {
  if (!Array.isArray(pansArray) || pansArray.length === 0) return null;
  const out = [];
  for (const p of pansArray) {
    if (!p || p.roofType !== "FLAT") continue;
    const fc = p.flatRoofConfig;
    const ms = fc && typeof fc === "object" ? fc.mountingSystem : null;
    if (!ms || typeof ms !== "object") continue;
    const brand = typeof ms.brand === "string" && ms.brand.trim() ? ms.brand.trim() : null;
    const label = typeof ms.label === "string" && ms.label.trim() ? ms.label.trim() : null;
    const tiltDeg = Number(ms.tiltDeg ?? fc.supportTiltDeg);
    if (ms.arrangement !== "SOUTH_SINGLE") continue; // E-O ou inconnu : jamais affiché comme valide
    if (!brand || !label || !Number.isFinite(tiltDeg)) continue; // snapshot incomplet : ignoré
    out.push({
      pan_id: p.id != null ? String(p.id) : null,
      system_id: typeof ms.id === "string" ? ms.id : null,
      brand,
      label,
      arrangement: "SOUTH_SINGLE",
      tilt_deg: tiltDeg,
      layout_orientation:
        fc.layoutOrientation === "landscape" || fc.layoutOrientation === "portrait"
          ? fc.layoutOrientation
          : null,
      row_spacing_cm: Number.isFinite(Number(ms.rowSpacingCm ?? fc.rowSpacingCm))
        ? Number(ms.rowSpacingCm ?? fc.rowSpacingCm)
        : null,
      ballast_note: typeof ms.ballastNote === "string" && ms.ballastNote.trim() ? ms.ballastNote : null,
      calculator_url:
        typeof ms.calculatorUrl === "string" && /^https:\/\//.test(ms.calculatorUrl)
          ? ms.calculatorUrl
          : null,
      calculator_label:
        typeof ms.calculatorLabel === "string" && ms.calculatorLabel.trim() ? ms.calculatorLabel : null,
      quote_notes: Array.isArray(ms.quoteNotes)
        ? ms.quoteNotes.filter((n) => typeof n === "string" && n.trim()).slice(0, 4)
        : [],
    });
  }
  return out.length > 0 ? out : null;
}

/**
 * Lignes d'affichage PDF (section Configuration) depuis le résultat d'extraction.
 * Une ligne par pan si plusieurs systèmes ; le libellé porte déjà marque + config + inclinaison.
 * @param {Array<object>|null} mountingList sortie d'extractFlatRoofMountingFromPans
 * @returns {{ lines: string[], note: string }}
 */
export function formatFlatRoofMountingForPdf(mountingList) {
  if (!Array.isArray(mountingList) || mountingList.length === 0) {
    return { lines: [], note: "" };
  }
  const orientationFr = (o) => (o === "landscape" ? "paysage" : o === "portrait" ? "portrait" : null);
  const lines = mountingList.map((m, i) => {
    const parts = [m.label];
    const or = orientationFr(m.layout_orientation);
    if (or) parts.push(`pose ${or}`);
    if (m.row_spacing_cm != null) parts.push(`inter-rangées ${m.row_spacing_cm} cm`);
    const line = parts.join(" — ");
    return mountingList.length > 1 ? `Pan ${i + 1} : ${line}` : line;
  });
  // Mention demandée (Benoit 02/07) — complétée par l'outil fabricant si présent dans le snapshot.
  const calc = mountingList[0].calculator_label;
  const note = `Lestage définitif à confirmer via l'outil fabricant${calc ? ` (${calc})` : ""} / étude technique dédiée.`;
  return { lines, note };
}
