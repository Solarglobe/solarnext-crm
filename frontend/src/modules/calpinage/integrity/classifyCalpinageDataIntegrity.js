/**
 * Classification officielle de l'intégrité d'un dossier calpinage.
 *
 * Fonction pure — zéro effet de bord, zéro recalcul, zéro mutation.
 *
 * Couvre :
 * - anciens JSON sans calpinage_meta (LEGACY)
 * - GPS absent ou invalide (MISSING / INVALID)
 * - shading absent, partiel, stale, non-fiable (GPS douteux)
 * - géométrie absente, partielle, ancien format
 * - frozenBlocks absents, partiels, orphelins
 *
 * RÈGLES ABSOLUES :
 * - Jamais de valeur par défaut métier inventée
 * - Jamais de fallback GPS arbitraire (map.centerLatLng n'est pas un GPS confirmé)
 * - Jamais de recalcul shading
 * - Jamais de crash — défensif sur toute entrée nulle/malformée
 * - Jamais de modification des données en entrée
 */

/**
 * @typedef {'COMPLETE'|'PARTIAL'|'LEGACY'|'INVALID'} DataLevel
 * @typedef {'OK'|'PARTIAL'|'MISSING'|'LEGACY_FORMAT'} GeometryStatus
 * @typedef {'OK'|'PARTIAL'|'MISSING'} PanelsStatus
 * @typedef {'OK'|'MISSING'|'INVALID'} GpsStatus
 * @typedef {'OK'|'STALE'|'MISSING'|'PARTIAL'|'UNTRUSTED'} ShadingStatus
 *
 * @typedef {{
 *   dataLevel: DataLevel,
 *   geometryStatus: GeometryStatus,
 *   panelsStatus: PanelsStatus,
 *   gpsStatus: GpsStatus,
 *   shadingStatus: ShadingStatus,
 *   canTrustForDisplay: boolean,
 *   canTrustForShading: boolean,
 *   canTrustForValidation: boolean,
 *   reason: string
 * }} CalpinageIntegrity
 */

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Latitude/longitude valide : nombre fini, non-NaN, dans la plage géographique légale.
 * Pas de filtre géographique métier (ex : "pas en France") — juste cohérence mathématique.
 */
function isValidCoord(lat, lon) {
  return (
    typeof lat === "number" && Number.isFinite(lat) && !Number.isNaN(lat) &&
    lat >= -90 && lat <= 90 &&
    typeof lon === "number" && Number.isFinite(lon) && !Number.isNaN(lon) &&
    lon >= -180 && lon <= 180
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Classificateurs individuels
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GPS status.
 *
 * Source officielle : roofState.gps = { lat, lon }
 * map.centerLatLng n'est PAS un GPS confirmé du bâtiment — classifié MISSING si seul lui est présent.
 *
 * @param {Record<string, unknown>|null} roofState
 * @returns {GpsStatus}
 */
function classifyGps(roofState) {
  if (!roofState || typeof roofState !== "object") return "MISSING";

  const gps = roofState.gps;
  if (!gps || typeof gps !== "object") return "MISSING";

  const lat = gps.lat;
  // Accepter "lon" (format interne) ou "lng" (format maps) — la persistance utilise "lon"
  const lon = gps.lon != null ? gps.lon : gps.lng;

  if (lat == null || lon == null) return "INVALID";
  if (!isValidCoord(lat, lon)) return "INVALID";

  return "OK";
}

/**
 * Geometry status.
 *
 * Basé sur le vrai modèle persisté : contoursBati, traits, ridges, planes, scale, image.
 * Détection d'ancien format : "contourBati" (singulier) → LEGACY_FORMAT.
 *
 * @param {Record<string, unknown>|null} roofState
 * @returns {GeometryStatus}
 */
function classifyGeometry(roofState) {
  if (!roofState || typeof roofState !== "object") return "MISSING";

  // Détection format legacy : champ renommé de singulier → pluriel
  const hasLegacyContourField =
    !Array.isArray(roofState.contoursBati) &&
    (Array.isArray(roofState.contourBati) || Array.isArray(roofState.batiContours));

  if (hasLegacyContourField) return "LEGACY_FORMAT";

  const hasScale =
    roofState.scale && typeof roofState.scale === "object" &&
    typeof roofState.scale.metersPerPixel === "number" &&
    Number.isFinite(roofState.scale.metersPerPixel) &&
    roofState.scale.metersPerPixel > 0;

  const hasImage =
    roofState.image && typeof roofState.image === "object" &&
    typeof roofState.image.dataUrl === "string" &&
    roofState.image.dataUrl.length > 32;

  const contours = Array.isArray(roofState.contoursBati) ? roofState.contoursBati : [];
  const hasContours = contours.some(function (c) {
    return c && Array.isArray(c.points) && c.points.length >= 3;
  });

  const traits = Array.isArray(roofState.traits) ? roofState.traits : [];
  const hasTraits = traits.some(function (t) {
    return (
      t && t.a && t.b &&
      typeof t.a.x === "number" && Number.isFinite(t.a.x) &&
      typeof t.b.x === "number" && Number.isFinite(t.b.x)
    );
  });

  const ridges = Array.isArray(roofState.ridges) ? roofState.ridges : [];
  const hasRidges = ridges.length > 0;

  const hasPlanes =
    roofState.planes && typeof roofState.planes === "object" &&
    Object.keys(roofState.planes).length > 0;

  // Aucune donnée géométrique du tout
  if (!hasContours && !hasTraits && !hasRidges && !hasPlanes && !hasImage) return "MISSING";

  // Éléments présents mais sans échelle → ne peut pas calculer de dimensions réelles
  if ((hasImage || hasContours || hasTraits) && !hasScale) return "PARTIAL";

  // Structure suffisante pour travailler
  if (hasScale && (hasContours || hasTraits)) return "OK";

  // Quelque chose présent (ridges seuls, planes seuls…) mais pas suffisant pour travailler normalement
  return "PARTIAL";
}

/**
 * Panels status.
 *
 * Source : frozenBlocks (format persisté officiel).
 * Vérification défensive : panId valide, au moins un panneau avec coords finies.
 *
 * @param {Record<string, unknown>} data - Dossier complet
 * @returns {PanelsStatus}
 */
function classifyPanels(data) {
  const frozenBlocks = data.frozenBlocks;

  if (!Array.isArray(frozenBlocks) || frozenBlocks.length === 0) {
    // Format export alternatif : panels.layout
    const layout =
      data.panels && typeof data.panels === "object" &&
      Array.isArray(data.panels.layout) ? data.panels.layout : null;
    if (layout && layout.length > 0) return "PARTIAL";
    return "MISSING";
  }

  let validBlocks = 0;
  let partialBlocks = 0;
  let invalidBlocks = 0;

  for (let i = 0; i < frozenBlocks.length; i++) {
    const block = frozenBlocks[i];
    if (!block || typeof block !== "object") { invalidBlocks++; continue; }
    if (!block.panId) { invalidBlocks++; continue; }
    if (!Array.isArray(block.panels) || block.panels.length === 0) { invalidBlocks++; continue; }

    function isPanelValid(p) {
      return (
        p && p.center &&
        typeof p.center.x === "number" && Number.isFinite(p.center.x) &&
        typeof p.center.y === "number" && Number.isFinite(p.center.y)
      );
    }

    const validPanelCount = block.panels.filter(isPanelValid).length;

    if (validPanelCount === 0) {
      invalidBlocks++;
    } else if (validPanelCount < block.panels.length) {
      // Bloc partiellement valide : certains panels ont des coordonnées invalides
      partialBlocks++;
    } else {
      validBlocks++;
    }
  }

  if (validBlocks === 0 && partialBlocks === 0) return "MISSING";
  if (partialBlocks > 0 || invalidBlocks > 0) return "PARTIAL";
  return "OK";
}

/**
 * Shading status.
 *
 * Règles strictes :
 * - MISSING   : pas d'objet shading
 * - UNTRUSTED : GPS absent/invalide OU shading bloqué par GPS dans ses propres données
 * - STALE     : meta indique shadingValid=false OU shadingComputedAt absent
 * - PARTIAL   : objet présent mais structure incomplète (pas de combined/near/far)
 * - OK        : structure complète, computedAt présent, GPS OK
 *
 * Jamais de recalcul — classification pure sur données présentes.
 *
 * @param {Record<string, unknown>} data
 * @param {GpsStatus} gpsStatus
 * @returns {ShadingStatus}
 */
function classifyShading(data, gpsStatus) {
  const shading = data.shading;

  if (!shading || typeof shading !== "object") return "MISSING";

  // GPS manquant ou invalide → shading non fiable même s'il est présent
  if (gpsStatus !== "OK") return "UNTRUSTED";

  // Shading bloqué par GPS dans ses propres données (runtime marker)
  const gpsBlockedInShading =
    (shading.shadingQuality && shading.shadingQuality.blockingReason === "missing_gps") ||
    (shading.far && shading.far.source === "UNAVAILABLE_NO_GPS");
  if (gpsBlockedInShading) return "UNTRUSTED";

  // Meta V1 disponible : shading explicitement invalidé
  const meta = data.calpinage_meta;
  const hasValidMeta =
    meta && typeof meta === "object" && meta.version === "CALPINAGE_V1";
  if (hasValidMeta && meta.shadingValid === false) return "STALE";

  // Vérifier computedAt (depuis shading.computedAt ou meta.shadingComputedAt)
  const computedAt =
    shading.computedAt != null ? shading.computedAt :
    (hasValidMeta && meta.shadingComputedAt != null ? meta.shadingComputedAt : null);
  const hasComputedAt =
    computedAt != null && String(computedAt).trim().length > 0;

  // Vérifier la structure minimale
  const hasCombined =
    shading.combined && typeof shading.combined === "object" &&
    typeof shading.combined.totalLossPct === "number";
  const hasNear = shading.near && typeof shading.near === "object";
  const hasFar = shading.far && typeof shading.far === "object";
  const hasLegacyTotal =
    typeof shading.totalLossPct === "number" ||
    typeof shading.total_loss_pct === "number";

  const hasMinimalStructure = hasCombined || (hasNear && hasFar) || hasLegacyTotal;

  if (!hasMinimalStructure) return "PARTIAL";

  // Structure présente mais sans timestamp de calcul → considéré stale
  if (!hasComputedAt) return "STALE";

  return "OK";
}

/**
 * DataLevel global dérivé des statuts individuels.
 *
 * @param {GeometryStatus} geometryStatus
 * @param {PanelsStatus} panelsStatus
 * @param {GpsStatus} gpsStatus
 * @param {ShadingStatus} shadingStatus
 * @param {boolean} hasMeta
 * @returns {DataLevel}
 */
function deriveDataLevel(geometryStatus, panelsStatus, gpsStatus, shadingStatus, hasMeta) {
  // INVALID : aucune donnée exploitable
  if (geometryStatus === "MISSING" && panelsStatus === "MISSING") return "INVALID";

  // LEGACY : pas de meta V1 OU ancien format détecté
  if (!hasMeta || geometryStatus === "LEGACY_FORMAT") return "LEGACY";

  // COMPLETE : tout est exploitable
  if (
    geometryStatus === "OK" &&
    panelsStatus === "OK" &&
    gpsStatus === "OK" &&
    shadingStatus === "OK"
  ) return "COMPLETE";

  // PARTIAL : exploitable mais quelque chose manque ou est dégradé
  return "PARTIAL";
}

/**
 * Construit le champ `reason` lisible par humain et machine.
 * Format : "OK" ou liste des problèmes séparés par ";"
 */
function buildReason(geometryStatus, panelsStatus, gpsStatus, shadingStatus, hasMeta) {
  const issues = [];
  if (!hasMeta) issues.push("no_calpinage_meta");
  if (geometryStatus === "MISSING") issues.push("geometry_missing");
  if (geometryStatus === "PARTIAL") issues.push("geometry_partial");
  if (geometryStatus === "LEGACY_FORMAT") issues.push("geometry_legacy_format");
  if (panelsStatus === "MISSING") issues.push("panels_missing");
  if (panelsStatus === "PARTIAL") issues.push("panels_partial");
  if (gpsStatus === "MISSING") issues.push("gps_missing");
  if (gpsStatus === "INVALID") issues.push("gps_invalid");
  if (shadingStatus === "MISSING") issues.push("shading_missing");
  if (shadingStatus === "STALE") issues.push("shading_stale");
  if (shadingStatus === "PARTIAL") issues.push("shading_partial");
  if (shadingStatus === "UNTRUSTED") issues.push("shading_untrusted");

  if (issues.length === 0) return "OK";
  return issues.join(";");
}

// ─────────────────────────────────────────────────────────────────────────────
// API publique
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classifie l'intégrité d'un dossier calpinage.
 *
 * Accepte le format JSON persisté :
 * { roofState, frozenBlocks, shading, calpinage_meta, pans?, panels? }
 *
 * Jamais de crash — retourne INVALID sur toute entrée nulle ou malformée.
 *
 * @param {Record<string, unknown>|null|undefined} data
 * @returns {CalpinageIntegrity}
 */
export function classifyCalpinageDataIntegrity(data) {
  // Garde-fou : données complètement absentes
  if (data == null || typeof data !== "object") {
    return {
      dataLevel: "INVALID",
      geometryStatus: "MISSING",
      panelsStatus: "MISSING",
      gpsStatus: "MISSING",
      shadingStatus: "MISSING",
      canTrustForDisplay: false,
      canTrustForShading: false,
      canTrustForValidation: false,
      reason: "data_null_or_invalid",
    };
  }

  try {
    const roofState =
      data.roofState && typeof data.roofState === "object" ? data.roofState : null;

    const hasMeta =
      data.calpinage_meta != null &&
      typeof data.calpinage_meta === "object" &&
      data.calpinage_meta.version === "CALPINAGE_V1";

    const gpsStatus = classifyGps(roofState);
    const geometryStatus = classifyGeometry(roofState);
    const panelsStatus = classifyPanels(data);
    const shadingStatus = classifyShading(data, gpsStatus);
    const dataLevel = deriveDataLevel(
      geometryStatus, panelsStatus, gpsStatus, shadingStatus, hasMeta
    );

    // canTrustForDisplay : avoir quelque chose de géométrique + panneaux
    const canTrustForDisplay =
      geometryStatus === "OK" ||
      geometryStatus === "PARTIAL" ||
      (geometryStatus === "LEGACY_FORMAT" && panelsStatus !== "MISSING");

    // canTrustForShading : GPS confirmé + shading complet et non stale
    const canTrustForShading = gpsStatus === "OK" && shadingStatus === "OK";

    // canTrustForValidation : géométrie + panneaux + GPS tous exploitables
    const canTrustForValidation =
      geometryStatus === "OK" && panelsStatus === "OK" && gpsStatus === "OK";

    const reason = buildReason(
      geometryStatus, panelsStatus, gpsStatus, shadingStatus, hasMeta
    );

    return {
      dataLevel,
      geometryStatus,
      panelsStatus,
      gpsStatus,
      shadingStatus,
      canTrustForDisplay,
      canTrustForShading,
      canTrustForValidation,
      reason,
    };
  } catch (_err) {
    // Dernier garde-fou : aucun crash possible vers l'appelant
    return {
      dataLevel: "INVALID",
      geometryStatus: "MISSING",
      panelsStatus: "MISSING",
      gpsStatus: "MISSING",
      shadingStatus: "MISSING",
      canTrustForDisplay: false,
      canTrustForShading: false,
      canTrustForValidation: false,
      reason: "classification_internal_error",
    };
  }
}

/**
 * Applique la cohérence entre l'intégrité classifiée et le reload_diagnostic existant.
 *
 * Règle :
 * Si reload_diagnostic.shadingStale === true
 *   ET shading n'a pas été recalculé cette session (shadingRecomputedThisSession === false)
 *   ET integrity.shadingStatus === "OK"
 * → downgrade shadingStatus à "STALE"
 *
 * Justification : classifyCalpinageDataIntegrity ne compare pas les hashes — elle fait confiance
 * aux données présentes. Mais reload_diagnostic a détecté une dérive géométrie/panneau depuis
 * la dernière sauvegarde. Si shading n'a pas été recalculé depuis, il est objectivement stale.
 *
 * Retourne une nouvelle intégrité (pas de mutation).
 *
 * @param {CalpinageIntegrity} integrity
 * @param {{ shadingStale?: boolean }|null|undefined} reloadDiagnostic
 * @param {boolean} shadingRecomputedThisSession
 * @returns {CalpinageIntegrity}
 */
export function applyReloadDiagnosticCoherence(integrity, reloadDiagnostic, shadingRecomputedThisSession) {
  if (!integrity) return integrity;
  if (!reloadDiagnostic || reloadDiagnostic.shadingStale !== true) return integrity;
  if (shadingRecomputedThisSession) return integrity;
  if (integrity.shadingStatus !== "OK") return integrity;

  var newReason = integrity.reason === "OK"
    ? "shading_stale"
    : integrity.reason + ";shading_stale";

  return Object.assign({}, integrity, {
    shadingStatus: "STALE",
    canTrustForShading: false,
    dataLevel: integrity.dataLevel === "COMPLETE" ? "PARTIAL" : integrity.dataLevel,
    reason: newReason,
  });
}

/**
 * Logger officiel intégrité — uniquement si dossier non fiable.
 *
 * Pas de spam :
 * - COMPLETE → silence
 * - PARTIAL avec canTrustForDisplay=true → silence
 * - Tout autre cas → warn
 *
 * @param {CalpinageIntegrity} integrity
 * @param {Record<string, unknown>} [extra] - contexte additionnel (studyId, etc.)
 */
export function logIntegrityWarningIfNeeded(integrity, extra) {
  if (!integrity) return;
  if (integrity.dataLevel === "COMPLETE") return;
  if (integrity.dataLevel === "PARTIAL" && integrity.canTrustForDisplay) return;

  if (typeof console !== "undefined" && console.warn) {
    console.warn("[CALPINAGE_INTEGRITY]", Object.assign({
      dataLevel: integrity.dataLevel,
      geometryStatus: integrity.geometryStatus,
      panelsStatus: integrity.panelsStatus,
      gpsStatus: integrity.gpsStatus,
      shadingStatus: integrity.shadingStatus,
      canTrustForDisplay: integrity.canTrustForDisplay,
      canTrustForShading: integrity.canTrustForShading,
      canTrustForValidation: integrity.canTrustForValidation,
      reason: integrity.reason,
    }, extra || {}));
  }
}

/**
 * Attache le statut d'intégrité à :
 * - window.__CALPINAGE_INTEGRITY__   (référence debug globale)
 * - CALPINAGE_STATE.calpinage_integrity   (état runtime, si disponible)
 *
 * Silencieux si window non disponible (SSR, tests, etc.).
 *
 * @param {CalpinageIntegrity} integrity
 */
export function attachIntegrityToWindow(integrity) {
  try {
    var w =
      typeof window !== "undefined" ? window :
      typeof globalThis !== "undefined" ? globalThis : null;
    if (!w) return;

    w.__CALPINAGE_INTEGRITY__ = integrity;

    if (w.CALPINAGE_STATE && typeof w.CALPINAGE_STATE === "object") {
      w.CALPINAGE_STATE.calpinage_integrity = integrity;
    }
  } catch (_err) {
    // Exposition debug non critique — silencieux
  }
}

export var calpinageDataIntegrityApi = {
  classifyCalpinageDataIntegrity: classifyCalpinageDataIntegrity,
  applyReloadDiagnosticCoherence: applyReloadDiagnosticCoherence,
  logIntegrityWarningIfNeeded: logIntegrityWarningIfNeeded,
  attachIntegrityToWindow: attachIntegrityToWindow,
};
