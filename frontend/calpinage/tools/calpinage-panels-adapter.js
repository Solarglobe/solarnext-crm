/**
 * CalpinagePanelsAdapter — Pont unique entre le comportement DP2 et le moteur (pvPlacementEngine).
 * Aucune mutation directe des panneaux. Pose = uniquement via addPanelAtCenter(block, ghost.center) dans calpinage.html.
 *
 * API (pont moteur uniquement) :
 * - listPanelRefs(): Array<{ blockId, panelIndex }>
 * - getPanel(ref): panel natif { center, projection, localRotationDeg }
 * - getBlockRotationDeg(ref): number
 * - getActiveBlock(): Object|null
 * - getBlockById(id): Object|null
 * - getBlockCenter(block): { x, y }|null → centre du bloc (pivot rotation)
 * - setManipulationTransform(dx, dy, rotationDeg): void → moteur
 * - commitManipulation(): void → moteur + recompute + save + requestRender
 * - requestRender(): void
 *
 * @param {{
 *   getFrozenBlocks: function(): Array,
 *   getActiveBlock: function(): Object|null,
 *   getBlockById: function(string): Object|null,
 *   getBlockCenter: function(Object): {x,y}|null,
 *   setManipulationTransform: function(number, number, number): void,
 *   commitManipulation: function(): void,
 *   recomputeAllPlacementBlocksFromRules: function(boolean): void,
 *   saveCalpinageState: function(): void,
 *   requestRender: function(): void
 * }} deps
 */
(function (global) {
  "use strict";

  function createCalpinagePanelsAdapter(deps) {
    if (!deps) return null;

    var getFrozenBlocks = deps.getFrozenBlocks;
    var getActiveBlock = deps.getActiveBlock;
    var getBlockById = deps.getBlockById;
    var getBlockCenterEngine = deps.getBlockCenter;
    var requestRender = deps.requestRender;
    var setManipulationTransform = deps.setManipulationTransform;
    var commitManipulationEngine = deps.commitManipulation;
    var recomputeAllPlacementBlocksFromRules = deps.recomputeAllPlacementBlocksFromRules;
    var saveCalpinageState = deps.saveCalpinageState;

    function listPanelRefs() {
      var refs = [];
      var frozen = Array.isArray(getFrozenBlocks) && typeof getFrozenBlocks === "function" ? getFrozenBlocks() : [];
      var active = typeof getActiveBlock === "function" ? getActiveBlock() : null;
      var blocks = frozen.slice();
      if (active) blocks.push(active);
      for (var bi = 0; bi < blocks.length; bi++) {
        var bl = blocks[bi];
        if (!bl || !bl.panels) continue;
        for (var pi = 0; pi < bl.panels.length; pi++) {
          refs.push({ blockId: bl.id, panelIndex: pi });
        }
      }
      return refs;
    }

    function getPanel(ref) {
      if (!ref || typeof ref.blockId !== "string" || typeof ref.panelIndex !== "number") return null;
      var block = typeof getBlockById === "function" ? getBlockById(ref.blockId) : null;
      if (!block || !block.panels || ref.panelIndex < 0 || ref.panelIndex >= block.panels.length) return null;
      return block.panels[ref.panelIndex];
    }

    function getBlockRotationDeg(ref) {
      var block = ref && typeof getBlockById === "function" ? getBlockById(ref.blockId) : null;
      if (!block) return 0;
      var r = block.rotation;
      return typeof r === "number" ? r : 0;
    }

    function getBlockCenterFn(block) {
      if (!block) return null;
      if (typeof getBlockCenterEngine === "function") return getBlockCenterEngine(block);
      return null;
    }

    function requestRenderFn() {
      if (typeof requestRender === "function") requestRender();
    }

    /** En fin d’interaction DP2 (pointerup) :  */

    function setManipulationTransformFn(dx, dy, rotationDeg) {
      if (typeof setManipulationTransform === "function") setManipulationTransform(dx, dy, rotationDeg);
    }

    function commitManipulationFn() {
      if (typeof commitManipulationEngine === "function") commitManipulationEngine();
      if (typeof recomputeAllPlacementBlocksFromRules === "function") recomputeAllPlacementBlocksFromRules(true);
      if (typeof saveCalpinageState === "function") saveCalpinageState();
      if (typeof requestRender === "function") requestRender();
    }

    return {
      listPanelRefs: listPanelRefs,
      getPanel: getPanel,
      getBlockRotationDeg: getBlockRotationDeg,
      getActiveBlock: getActiveBlock,
      getBlockById: getBlockById,
      getBlockCenter: getBlockCenterFn,
      requestRender: requestRenderFn,
      setManipulationTransform: setManipulationTransformFn,
      commitManipulation: commitManipulationFn,
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { createCalpinagePanelsAdapter: createCalpinagePanelsAdapter };
  } else {
    global.CalpinagePanelsAdapter = { create: createCalpinagePanelsAdapter };
  }
})(typeof window !== "undefined" ? window : this);
