/**
 * Moteur de pose PV — Bloc de pose actif (Phase 3).
 *
 * UN SEUL bloc peut être actif à la fois. Plusieurs blocs peuvent exister (figés).
 * Références uniques : computeProjectedPanelRect().
 * Ce module gère UNIQUEMENT la logique du bloc actif (création, évolution, fin, manipulation).
 */
(function (global) {
  "use strict";

  function getComputeProjectedPanelRect() {
    return (typeof global !== "undefined" && global.computeProjectedPanelRect) ||
      (typeof window !== "undefined" && window.computeProjectedPanelRect);
  }

  /**
   * Crée un identifiant unique pour un bloc.
   */
  function nextBlockId() {
    return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : "block-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
  }

  /**
   * Crée un identifiant unique pour un panneau.
   */
  function nextPanelId() {
    return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : "panel-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
  }

  /**
   * Garantit qu'un panneau a un id unique (rétrocompatibilité state legacy).
   */
  function ensurePanelId(panel) {
    if (panel && typeof panel.id !== "string") {
      panel.id = nextPanelId();
    }
    return panel;
  }

  /**
   * Retourne l'index du panneau dans le bloc par son id.
   * @param {Object} block - Bloc
   * @param {string} panelId - Id du panneau
   * @returns {number} Index ou -1 si non trouvé
   */
  function getPanelIndexById(block, panelId) {
    if (!block || !block.panels || !panelId) return -1;
    for (var i = 0; i < block.panels.length; i++) {
      if (block.panels[i] && block.panels[i].id === panelId) return i;
    }
    return -1;
  }

  /**
   * Structure d'un panneau dans le bloc.
   * @typedef {{ center: {x: number, y: number}, projection: Object, state: 'valid'|'invalid' }} PanelInBlock
   */

  /**
   * Bloc de pose actif ou figé.
   * @typedef {{
   *   id: string,
   *   panId: string,
   *   panels: PanelInBlock[],
   *   rotation: number,
   *   isActive: boolean,
   *   manipulationTransform: { offsetX: number, offsetY: number, rotationDeg: number } | null
   * }} ActivePlacementBlock
   */

  var activeBlock = null;
  var frozenBlocks = [];
  /** Id du bloc actuellement actif ou sélectionné (un seul éditable à la fois). */
  var selectedBlockId = null;

  /**
   * Garantit qu'un seul bloc est actif : désactive tout autre bloc actif.
   */
  function ensureSingleActiveBlock(newActive) {
    if (activeBlock && activeBlock !== newActive && activeBlock.isActive) {
      activeBlock.isActive = false;
      frozenBlocks.push(activeBlock);
    }
    activeBlock = newActive;
  }

  /**
   * Centre du bloc (centroïde des centres des panneaux).
   */
  function getBlockCenter(block) {
    var panels = block.panels || [];
    if (panels.length === 0) return { x: 0, y: 0 };
    var sx = 0, sy = 0;
    for (var i = 0; i < panels.length; i++) {
      var c = panels[i].center;
      if (c && typeof c.x === "number" && typeof c.y === "number") {
        sx += c.x;
        sy += c.y;
      }
    }
    return { x: sx / panels.length, y: sy / panels.length };
  }

  /**
   * Tourne des points autour d'un centre (angle en degrés).
   * @param {Array<{x: number, y: number}>} points
   * @param {number} cx - centre x
   * @param {number} cy - centre y
   * @param {number} deg - angle en degrés
   * @returns {Array<{x: number, y: number}>} nouveaux points (non mutés)
   */
  function rotatePointsAround(points, cx, cy, deg) {
    var rad = (deg * Math.PI) / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    var out = [];
    for (var i = 0; i < points.length; i++) {
      var x = points[i].x - cx;
      var y = points[i].y - cy;
      out.push({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos });
    }
    return out;
  }

  /**
   * Applique la transformation de manipulation à un point (translation + rotation autour du centre du bloc).
   */
  function applyTransformToPoint(point, blockCenter, transform) {
    if (!transform || (transform.offsetX === 0 && transform.offsetY === 0 && transform.rotationDeg === 0)) {
      return { x: point.x, y: point.y };
    }
    var dx = point.x - blockCenter.x;
    var dy = point.y - blockCenter.y;
    var rad = (transform.rotationDeg || 0) * (Math.PI / 180);
    var cos = Math.cos(rad);
    var sin = Math.sin(rad);
    return {
      x: blockCenter.x + dx * cos - dy * sin + (transform.offsetX || 0),
      y: blockCenter.y + dx * sin + dy * cos + (transform.offsetY || 0),
    };
  }

  /**
   * Applique la transformation aux points d'une projection (rotation + translation).
   */
  function applyTransformToProjection(projection, blockCenter, transform) {
    if (!projection || !projection.points || projection.points.length === 0) return projection;
    if (!transform || (transform.offsetX === 0 && transform.offsetY === 0 && transform.rotationDeg === 0)) {
      return projection;
    }
    var rad = (transform.rotationDeg || 0) * (Math.PI / 180);
    var cos = Math.cos(rad);
    var sin = Math.sin(rad);
    var out = [];
    for (var i = 0; i < projection.points.length; i++) {
      var p = projection.points[i];
      var dx = p.x - blockCenter.x;
      var dy = p.y - blockCenter.y;
      out.push({
        x: blockCenter.x + dx * cos - dy * sin + (transform.offsetX || 0),
        y: blockCenter.y + dx * sin + dy * cos + (transform.offsetY || 0),
      });
    }
    return {
      points: out,
      slopeAxis: projection.slopeAxis,
      perpAxis: projection.perpAxis,
      halfLengthAlongSlopePx: projection.halfLengthAlongSlopePx,
      halfLengthPerpPx: projection.halfLengthPerpPx,
    };
  }

  /**
   * Crée un nouveau bloc actif (clic valide sur le pan).
   * Pose le panneau maître au centre donné et calcule les emplacements fantômes.
   *
   * @param {{
   *   panId: string,
   *   center: { x: number, y: number },
   *   getProjectionContext: function(): {
   *     roofPolygon: Array<{x,y}>,
   *     roofConstraints: Object,
   *     roofParams: Object,
   *     panelParams: Object,
   *     pvRules: Object,
   *     existingPanelsProjections: Array<{ points: Array<{x,y}> }>
   *   }
   * }} options
   * @returns {{ block: ActivePlacementBlock, success: boolean, reason?: string }}
   */
  function createBlock(options) {
    var panId = options.panId;
    var center = options.center;
    var getContext = options.getProjectionContext;

    if (!panId || !center || typeof center.x !== "number" || typeof center.y !== "number") {
      return { block: null, success: false, reason: "panId et center requis." };
    }
    if (typeof getContext !== "function") {
      return { block: null, success: false, reason: "getProjectionContext requis." };
    }

    var computeProjectedPanelRect = getComputeProjectedPanelRect();
    if (typeof computeProjectedPanelRect !== "function") {
      return { block: null, success: false, reason: "computeProjectedPanelRect indisponible." };
    }

    var ctx = getContext();
    if (!ctx || !ctx.roofPolygon || ctx.roofPolygon.length < 3 || !ctx.roofParams || !ctx.panelParams) {
      return { block: null, success: false, reason: "Contexte de projection incomplet." };
    }

    var projectOpts = {
      center: { x: center.x, y: center.y },
      panelWidthMm: ctx.panelParams.panelWidthMm,
      panelHeightMm: ctx.panelParams.panelHeightMm,
      panelOrientation: "PORTRAIT",
      roofSlopeDeg: ctx.roofParams.roofSlopeDeg,
      roofOrientationDeg: ctx.roofParams.roofOrientationDeg != null ? ctx.roofParams.roofOrientationDeg : 0,
      metersPerPixel: ctx.roofParams.metersPerPixel,
    };
    if (ctx.roofParams.trueSlopeAxis && ctx.roofParams.truePerpAxis) {
      projectOpts.trueSlopeAxis = ctx.roofParams.trueSlopeAxis;
      projectOpts.truePerpAxis = ctx.roofParams.truePerpAxis;
    }
    var orientationFromCtx = (ctx.panelParams && ctx.panelParams.panelOrientation) ? String(ctx.panelParams.panelOrientation).toUpperCase() : "PORTRAIT";
    var blockOrientation = (options.orientation && (options.orientation === "PORTRAIT" || options.orientation === "PAYSAGE"))
      ? options.orientation
      : (orientationFromCtx === "PAYSAGE" ? "PAYSAGE" : "PORTRAIT");
    blockOrientation = blockOrientation === "PAYSAGE" ? "PAYSAGE" : "PORTRAIT";
    projectOpts.panelOrientation = blockOrientation;
    projectOpts.localRotationDeg = 0;
    var rotationBaseDeg = 0;

    var masterProjection;
    try {
      masterProjection = computeProjectedPanelRect(projectOpts);
    } catch (e) {
      return { block: null, success: false, reason: "Projection maître invalide." };
    }
    if (!masterProjection || !masterProjection.points || masterProjection.points.length < 4) {
      return { block: null, success: false, reason: "Projection maître invalide." };
    }

    var block = {
      id: nextBlockId(),
      panId: panId,
      panels: [
        { id: nextPanelId(), center: { x: center.x, y: center.y }, projection: masterProjection, state: "valid", enabled: true, localRotationDeg: 0 },
      ],
      rotation: 0,
      isActive: true,
      manipulationTransform: null,
      orientation: blockOrientation,
      rotationBaseDeg: rotationBaseDeg,
    };

    ensureSingleActiveBlock(block);
    selectedBlockId = block.id;
    return { block: block, success: true };
  }

  /**
   * Ajoute un panneau au bloc actif au centre donné (extension OpenSolar). Le bloc doit être actif.
   *
   * @param {{ x: number, y: number }} center - Centre en image
   * @param {function(): Object} getProjectionContext - Contexte
   * @returns {{ success: boolean, reason?: string }}
   */
  function addPanelAtCenter(center, getProjectionContext) {
    if (activeBlock == null || !activeBlock.isActive) return { success: false, reason: "Aucun bloc actif." };
    if (!center || typeof center.x !== "number" || typeof center.y !== "number") return { success: false, reason: "Centre invalide." };
    if (typeof getProjectionContext !== "function") return { success: false, reason: "Contexte requis." };
    var ctx = getProjectionContext();
    if (!ctx || !ctx.roofParams || !ctx.panelParams) return { success: false, reason: "Contexte incomplet." };
    var computeProjectedPanelRect = getComputeProjectedPanelRect();
    if (typeof computeProjectedPanelRect !== "function") return { success: false, reason: "Projection indisponible." };
    var blockOrient = (activeBlock.orientation === "PAYSAGE" || activeBlock.orientation === "landscape") ? "PAYSAGE" : "PORTRAIT";
    var projectOpts = {
      center: { x: center.x, y: center.y },
      panelWidthMm: ctx.panelParams.panelWidthMm,
      panelHeightMm: ctx.panelParams.panelHeightMm,
      panelOrientation: blockOrient,
      roofSlopeDeg: ctx.roofParams.roofSlopeDeg,
      roofOrientationDeg: ctx.roofParams.roofOrientationDeg != null ? ctx.roofParams.roofOrientationDeg : 0,
      metersPerPixel: ctx.roofParams.metersPerPixel,
    };
    if (ctx.roofParams.trueSlopeAxis && ctx.roofParams.truePerpAxis) {
      projectOpts.trueSlopeAxis = ctx.roofParams.trueSlopeAxis;
      projectOpts.truePerpAxis = ctx.roofParams.truePerpAxis;
    }
    projectOpts.localRotationDeg = 0;
    var proj;
    try {
      proj = computeProjectedPanelRect(projectOpts);
    } catch (e) {
      return { success: false, reason: "Projection invalide." };
    }
    if (!proj || !proj.points || proj.points.length < 4) return { success: false, reason: "Projection invalide." };
    var rotation = (activeBlock.rotation || 0) % 360;
    if (rotation < 0) rotation += 360;
    if (rotation) proj = rotateProjectionAroundCenter(proj, center, rotation);
    activeBlock.panels.push({
      id: nextPanelId(),
      center: { x: center.x, y: center.y },
      projection: proj,
      state: "valid",
      enabled: true,
      localRotationDeg: 0,
    });
    return { success: true };
  }

  /**
   * Bascule l'état enabled d'un panneau du bloc actif (toggle on/off).
   *
   * @param {number} panelIndex - Index du panneau
   * @returns {boolean} true si le panneau a été togglé
   */
  function togglePanelEnabled(panelIndex) {
    if (activeBlock == null || !activeBlock.isActive || !activeBlock.panels) return false;
    if (panelIndex < 0 || panelIndex >= activeBlock.panels.length) return false;
    var p = activeBlock.panels[panelIndex];
    p.enabled = p.enabled === false;
    return true;
  }

  /**
   * Fin du bloc actif : clic dans le vide.
   * Supprime les emplacements fantômes, désactive le bloc, les panneaux restent posés (bloc figé).
   * Le bloc figé reste sélectionné (selectedBlockId = id du bloc figé).
   */
  function endBlock() {
    if (activeBlock == null) return;
    activeBlock.isActive = false;
    activeBlock.manipulationTransform = null;
    frozenBlocks.push(activeBlock);
    var frozenId = activeBlock.id;
    activeBlock = null;
    selectedBlockId = frozenId;
  }

  /**
   * Rend un bloc figé à nouveau actif (éditable). Un seul bloc actif à la fois.
   * @param {string} blockId - Id du bloc à activer
   * @returns {boolean} true si le bloc a été trouvé et activé
   */
  function setActiveBlock(blockId) {
    if (!blockId) return false;
    if (activeBlock && activeBlock.isActive) {
      endBlock();
    }
    var idx = -1;
    for (var i = 0; i < frozenBlocks.length; i++) {
      if (frozenBlocks[i].id === blockId) { idx = i; break; }
    }
    if (idx < 0) return false;
    var block = frozenBlocks[idx];
    frozenBlocks.splice(idx, 1);
    block.isActive = true;
    block.manipulationTransform = null;
    activeBlock = block;
    selectedBlockId = blockId;
    return true;
  }

  /**
   * Désélectionne et fige le bloc actif s'il y en a un.
   */
  function clearSelection() {
    if (activeBlock) endBlock();
    selectedBlockId = null;
  }

  /**
   * Indique si le bloc donné est celui actuellement actif/sélectionné.
   */
  function isBlockSelected(blockId) {
    return selectedBlockId === blockId;
  }

  /**
   * Supprime un bloc (actif ou figé). Ne met pas à jour CALPINAGE_STATE.placedPanels (à faire par l'appelant).
   * Après suppression, selectedBlockId = null s'il n'y a plus de bloc, sinon id du dernier bloc figé.
   * @param {string} blockId - Id du bloc à supprimer
   */
  function removeBlock(blockId) {
    if (!blockId) return;
    if (activeBlock && activeBlock.id === blockId) {
      activeBlock = null;
      selectedBlockId = frozenBlocks.length > 0 ? frozenBlocks[frozenBlocks.length - 1].id : null;
      return;
    }
    for (var i = 0; i < frozenBlocks.length; i++) {
      if (frozenBlocks[i].id === blockId) {
        frozenBlocks.splice(i, 1);
        if (selectedBlockId === blockId) {
          selectedBlockId = frozenBlocks.length > 0 ? frozenBlocks[frozenBlocks.length - 1].id : null;
        }
        return;
      }
    }
  }

  /**
   * Retourne l'id du bloc actuellement éditable (actif ou sélectionné), ou null.
   */
  function getSelectedBlockId() {
    return activeBlock ? activeBlock.id : selectedBlockId;
  }

  /**
   * Retourne le bloc "focus" : le bloc actif s'il existe, sinon le bloc figé dont l'id est selectedBlockId.
   * Utilisé pour afficher les handles et pour le hit-test des poignées (actif ou sélectionné).
   */
  function getFocusBlock() {
    if (activeBlock) return activeBlock;
    if (!selectedBlockId) return null;
    for (var i = 0; i < frozenBlocks.length; i++) {
      if (frozenBlocks[i].id === selectedBlockId) return frozenBlocks[i];
    }
    return null;
  }

  /**
   * Démarre une manipulation (rotation/déplacement) sur le bloc. À appeler avant setManipulationTransform.
   * S'assure que le bloc est actif (setActiveBlock) et réinitialise toute transformation en cours.
   * @param {string} blockId - Id du bloc à manipuler
   * @returns {boolean} true si le bloc est prêt pour la manipulation
   */
  function beginManipulation(blockId) {
    if (!blockId) return false;
    var ok = setActiveBlock(blockId);
    if (ok && activeBlock) activeBlock.manipulationTransform = null;
    return ok;
  }

  /**
   * Définit la transformation de manipulation (déplacement + rotation).
   * Pendant la manipulation, les règles de validation ne sont pas bloquantes ;
   * chaque panneau peut être marqué invalide individuellement via updatePanelValidation.
   *
   * @param {number} offsetX - Translation X (px)
   * @param {number} offsetY - Translation Y (px)
   * @param {number} rotationDeg - Rotation du bloc (degrés)
   */
  function setManipulationTransform(offsetX, offsetY, rotationDeg) {
    if (activeBlock == null || !activeBlock.isActive) return;
    activeBlock.manipulationTransform = {
      offsetX: Number(offsetX) || 0,
      offsetY: Number(offsetY) || 0,
      rotationDeg: Number(rotationDeg) || 0,
    };
  }

  /**
   * Réinitialise la transformation de manipulation (sans figer le bloc).
   */
  function clearManipulationTransform() {
    if (activeBlock == null) return;
    activeBlock.manipulationTransform = null;
  }

  /**
   * Valide chaque panneau du bloc (pendant la manipulation) et met à jour panel.state.
   * Aucune suppression automatique. Chaque panneau invalide est marqué state === 'invalid'.
   *
   * @param {function(center: {x,y}, projection: Object, panelIndex: number): boolean} validatePanel - true si pose valide
   */
  function updatePanelValidation(validatePanel) {
    if (activeBlock == null || typeof validatePanel !== "function") return;
    var blockCenter = getBlockCenter(activeBlock);
    var transform = activeBlock.manipulationTransform;

    for (var i = 0; i < activeBlock.panels.length; i++) {
      var panel = activeBlock.panels[i];
      var effectiveCenter = applyTransformToPoint(panel.center, blockCenter, transform);
      var effectiveProj = transform
        ? applyTransformToProjection(panel.projection, blockCenter, transform)
        : panel.projection;
      activeBlock.panels[i].state = validatePanel(effectiveCenter, effectiveProj, i) ? "valid" : "invalid";
    }
  }

  /**
   * Valide la transformation en cours : applique offset/rotation aux centres et projections des panneaux,
   * met à jour block.rotation (angle libre en degrés, normalisé 0–360), puis réinitialise manipulationTransform.
   * À appeler en fin de déplacement (mouseup) ou en fin de rotation manuelle.
   */
  function commitManipulation() {
    if (activeBlock == null || !activeBlock.manipulationTransform) return;
    var blockCenter = getBlockCenter(activeBlock);
    var t = activeBlock.manipulationTransform;

    for (var i = 0; i < activeBlock.panels.length; i++) {
      var p = activeBlock.panels[i];
      p.center = applyTransformToPoint(p.center, blockCenter, t);
      p.projection = applyTransformToProjection(p.projection, blockCenter, t);
      p.state = "valid";
    }
    var rotDeg = (t.rotationDeg || 0);
    var newRotation = (activeBlock.rotation || 0) + rotDeg;
    activeBlock.rotation = ((newRotation % 360) + 360) % 360;
    activeBlock.manipulationTransform = null;
  }

  /**
   * Annule la manipulation (restore positions).
   */
  function cancelManipulation() {
    if (activeBlock == null) return;
    activeBlock.manipulationTransform = null;
    for (var i = 0; i < activeBlock.panels.length; i++) {
      activeBlock.panels[i].state = "valid";
    }
  }

  /**
   * Retourne le bloc actif (référence, ne pas modifier directement la structure).
   */
  function getActiveBlock() {
    return activeBlock;
  }

  /**
   * Retourne la liste des blocs figés (référence).
   */
  function getFrozenBlocks() {
    return frozenBlocks;
  }

  /**
   * Retourne le centre effectif d'un panneau (avec transformation de manipulation si en cours).
   */
  function getEffectivePanelCenter(block, panelIndex) {
    if (!block || !block.panels || panelIndex < 0 || panelIndex >= block.panels.length) return null;
    var panel = block.panels[panelIndex];
    var blockCenter = getBlockCenter(block);
    return applyTransformToPoint(panel.center, blockCenter, block.manipulationTransform);
  }

  /**
   * Retourne la projection effective d'un panneau (transformation de manipulation + rotation locale).
   * Ne mute jamais proj.points (retourne un nouvel objet / nouveaux points si rotation appliquée).
   */
  function getEffectivePanelProjection(block, panelIndex) {
    if (!block || !block.panels || panelIndex < 0 || panelIndex >= block.panels.length) return null;
    var panel = block.panels[panelIndex];
    var blockCenter = getBlockCenter(block);
    var proj = block.manipulationTransform
      ? applyTransformToProjection(panel.projection, blockCenter, block.manipulationTransform)
      : panel.projection;
    var rot = panel && typeof panel.localRotationDeg === "number" ? panel.localRotationDeg : 0;
    if (!rot || !proj || !proj.points) return proj;
    var c = getEffectivePanelCenter(block, panelIndex);
    if (!c) return proj;
    var rotated = Object.assign({}, proj);
    rotated.points = rotatePointsAround(proj.points, c.x, c.y, rot);
    return rotated;
  }

  /**
   * Réinitialise le module (bloc actif et blocs figés). Utile pour tests ou reset complet.
   */
  function reset() {
    activeBlock = null;
    frozenBlocks = [];
    selectedBlockId = null;
  }

  function rotateProjectionAroundCenter(proj, center, deg) {
    if (!proj || !proj.points || proj.points.length === 0) return proj;
    if (!deg || deg % 360 === 0) return proj;
    var rad = (deg % 360) * (Math.PI / 180);
    var cos = Math.cos(rad), sin = Math.sin(rad);
    var cx = center.x, cy = center.y;
    var out = [];
    for (var i = 0; i < proj.points.length; i++) {
      var p = proj.points[i];
      var dx = p.x - cx, dy = p.y - cy;
      out.push({ x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos });
    }
    var rotV = function (v) {
      if (!v || typeof v.x !== "number") return v;
      return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
    };
    return {
      points: out,
      slopeAxis: proj.slopeAxis ? rotV(proj.slopeAxis) : proj.slopeAxis,
      perpAxis: proj.perpAxis ? rotV(proj.perpAxis) : proj.perpAxis,
      halfLengthAlongSlopePx: proj.halfLengthAlongSlopePx,
      halfLengthPerpPx: proj.halfLengthPerpPx,
    };
  }

  /**
   * Recalcule les projections de tous les panneaux d'un bloc à partir des règles courantes (orientation, marge, espacement).
   * Applique block.rotation à chaque projection. Les centres (image space) ne sont pas modifiés.
   *
   * @param {ActivePlacementBlock} block - Bloc (actif ou figé)
   * @param {function(): Object} getProjectionContext - Fonction retournant le contexte (roofPolygon, roofParams, panelParams, etc.)
   */
  function recomputeBlockProjections(block, getProjectionContext) {
    if (typeof window !== "undefined" && window.CALPINAGE_IS_MANIPULATING) return;
    if (!block || !block.panels || block.panels.length === 0 || typeof getProjectionContext !== "function") return;
    var ctx = getProjectionContext();
    if (!ctx || !ctx.roofParams || !ctx.panelParams) return;
    var computeProjectedPanelRect = getComputeProjectedPanelRect();
    if (typeof computeProjectedPanelRect !== "function") return;
    var rotation = (block.rotation || 0) % 360;
    if (rotation < 0) rotation += 360;

    for (var i = 0; i < block.panels.length; i++) {
      var panel = block.panels[i];
      ensurePanelId(panel);
      var center = panel.center;
      if (!center || typeof center.x !== "number" || typeof center.y !== "number") continue;
      var projectOpts = {
        center: { x: center.x, y: center.y },
        panelWidthMm: ctx.panelParams.panelWidthMm,
        panelHeightMm: ctx.panelParams.panelHeightMm,
        panelOrientation: (ctx.panelParams.panelOrientation === "PAYSAGE" || ctx.panelParams.panelOrientation === "landscape") ? "PAYSAGE" : "PORTRAIT",
        roofSlopeDeg: ctx.roofParams.roofSlopeDeg,
        roofOrientationDeg: ctx.roofParams.roofOrientationDeg != null ? ctx.roofParams.roofOrientationDeg : 0,
        metersPerPixel: ctx.roofParams.metersPerPixel,
      };
      if (ctx.roofParams.trueSlopeAxis && ctx.roofParams.truePerpAxis) {
        projectOpts.trueSlopeAxis = ctx.roofParams.trueSlopeAxis;
        projectOpts.truePerpAxis = ctx.roofParams.truePerpAxis;
      }
      if (typeof ctx.panelParams.localRotationDeg === "number") {
        projectOpts.localRotationDeg = ctx.panelParams.localRotationDeg;
      }
      try {
        var proj = computeProjectedPanelRect(projectOpts);
        if (proj && proj.points && proj.points.length >= 4) {
          if (rotation) proj = rotateProjectionAroundCenter(proj, center, rotation);
          block.panels[i].projection = proj;
        }
      } catch (e) {}
    }
  }

  /**
   * Restaure les blocs figés (après chargement state). Chaque bloc doit avoir id, panId, panels.
   * @param {Array<{ id: string, panId: string, panels: Array<{ center: {x,y}, projection: Object, state?: string }> }>} blocks
   */
  function restoreFrozenBlocks(blocks) {
    if (!Array.isArray(blocks)) return;
    frozenBlocks = [];
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (!b || !b.panId || !b.panels || !Array.isArray(b.panels)) continue;
      var panels = [];
      for (var j = 0; j < b.panels.length; j++) {
        var p = b.panels[j];
        if (p && p.center && p.projection) {
          var panelId = (typeof p.id === "string" && p.id) ? p.id : nextPanelId();
          panels.push({
            id: panelId,
            center: { x: p.center.x, y: p.center.y },
            projection: p.projection,
            state: p.state === "invalid" ? "invalid" : "valid",
            enabled: p.enabled !== false,
            localRotationDeg: typeof p.localRotationDeg === "number" ? p.localRotationDeg : 0,
          });
        }
      }
      if (panels.length === 0) continue;
      var orient = (b.orientation === "PORTRAIT" || b.orientation === "PAYSAGE") ? b.orientation : "PORTRAIT";
      var rotBase = typeof b.rotationBaseDeg === "number" ? b.rotationBaseDeg : (orient === "PAYSAGE" ? 90 : 0);
      frozenBlocks.push({
        id: b.id || nextBlockId(),
        panId: b.panId,
        panels: panels,
        rotation: b.rotation || 0,
        isActive: false,
        manipulationTransform: null,
        orientation: orient,
        rotationBaseDeg: rotBase,
      });
    }
    // Restauration de la sélection par défaut : le dernier bloc devient actif/sélectionné
    if (frozenBlocks.length > 0) {
      var lastBlock = frozenBlocks.pop();
      lastBlock.isActive = true;
      lastBlock.manipulationTransform = null;
      selectedBlockId = lastBlock.id;
      activeBlock = lastBlock;
    }
  }

  var ActivePlacementBlockModule = {
    createBlock: createBlock,
    addPanelAtCenter: addPanelAtCenter,
    togglePanelEnabled: togglePanelEnabled,
    endBlock: endBlock,
    setActiveBlock: setActiveBlock,
    beginManipulation: beginManipulation,
    clearSelection: clearSelection,
    isBlockSelected: isBlockSelected,
    getSelectedBlockId: getSelectedBlockId,
    getFocusBlock: getFocusBlock,
    removeBlock: removeBlock,
    setManipulationTransform: setManipulationTransform,
    clearManipulationTransform: clearManipulationTransform,
    updatePanelValidation: updatePanelValidation,
    commitManipulation: commitManipulation,
    cancelManipulation: cancelManipulation,
    getActiveBlock: getActiveBlock,
    getFrozenBlocks: getFrozenBlocks,
    getBlockCenter: getBlockCenter,
    getPanelIndexById: getPanelIndexById,
    getEffectivePanelCenter: getEffectivePanelCenter,
    getEffectivePanelProjection: getEffectivePanelProjection,
    reset: reset,
    restoreFrozenBlocks: restoreFrozenBlocks,
    recomputeBlockProjections: recomputeBlockProjections,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = ActivePlacementBlockModule;
  } else {
    global.ActivePlacementBlock = ActivePlacementBlockModule;
  }
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
