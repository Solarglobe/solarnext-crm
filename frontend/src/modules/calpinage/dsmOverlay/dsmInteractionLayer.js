/**
 * CP-DSM-UI-002 — Interaction layer pour tooltip panneau lossPct
 * Couche transparente séparée : hit-test + tooltip premium.
 * N'affecte pas roofHeatmap, RAF DSM, pointer-events existants.
 */

import { getTotalLossPctFromShading } from "./buildShadingSummary.js";

/**
 * Point-in-polygon (ray casting).
 * @param {{ x: number, y: number }} pt
 * @param {Array<{ x: number, y: number }>} polygon
 * @returns {boolean}
 */
function isPointInPolygon(pt, polygon) {
  if (!pt || !polygon || polygon.length < 3) return false;
  const x = pt.x;
  const y = pt.y;
  const n = polygon.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    if (yi === yj) continue;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function getPanels() {
  const eng = typeof window !== "undefined" && window.pvPlacementEngine;
  if (!eng?.getAllPanels) return [];
  return (eng.getAllPanels() || []).filter(
    (p) => p.enabled !== false && Array.isArray(p.polygonPx) && p.polygonPx.length >= 3
  );
}

function getShadingData() {
  const state = typeof window !== "undefined" && window.CALPINAGE_STATE;
  if (!state?.shading?.normalized) return null;
  return state.shading.normalized;
}

function buildPanelsWithLoss() {
  const shading = getShadingData();
  const panels = getPanels();
  if (panels.length === 0) return [];
  const globalLoss = getTotalLossPctFromShading(shading);
  if (!shading?.perPanel?.length) {
    return panels.map((p) => ({ id: p.id, polygonPx: p.polygonPx, lossPct: globalLoss }));
  }
  const byId = new Map();
  for (const p of shading.perPanel) {
    const id = p.panelId ?? p.id;
    if (id != null) byId.set(String(id), p.lossPct ?? 0);
  }
  return panels.map((p) => ({
    id: p.id,
    polygonPx: p.polygonPx,
    lossPct: byId.get(String(p.id)) ?? globalLoss,
  }));
}

/**
 * Crée et attache la couche d'interaction + tooltip.
 * @param {HTMLElement} overlayRoot - #dsm-overlay-container
 * @returns {{ destroy: () => void }}
 */
export function createDsmInteractionLayer(overlayRoot) {
  if (!overlayRoot || !overlayRoot.isConnected) return { destroy: () => {} };

  const overlayCanvas = overlayRoot.querySelector("#dsm-overlay-canvas");
  if (!overlayCanvas) return { destroy: () => {} };

  const layer = document.createElement("div");
  layer.id = "dsm-interaction-layer";
  layer.className = "dsm-interaction-layer";
  layer.setAttribute("aria-label", "Zone de survol panneaux pour afficher la perte ombrage");

  const tooltip = document.createElement("div");
  tooltip.id = "dsm-panel-tooltip";
  tooltip.className = "dsm-panel-tooltip";
  tooltip.setAttribute("aria-live", "polite");
  tooltip.style.display = "none";
  document.body.appendChild(tooltip);

  let _raf = null;
  let _lastPanelId = null;
  let _lastMouseX = -1;
  let _lastMouseY = -1;
  let _resizeObserver = null;

  function syncLayerSize() {
    const rect = overlayCanvas.getBoundingClientRect();
    layer.style.width = Math.max(1, Math.round(rect.width)) + "px";
    layer.style.height = Math.max(1, Math.round(rect.height)) + "px";
  }

  function updateTooltip(panelId, lossPct, clientX, clientY) {
    if (!panelId) {
      tooltip.style.display = "none";
      return;
    }
    const pctStr = typeof lossPct === "number" && !isNaN(lossPct)
      ? lossPct.toFixed(2)
      : "—";
    tooltip.innerHTML = `
      <span class="dsm-panel-tooltip-title">Panneau #${String(panelId)}</span>
      <span class="dsm-panel-tooltip-value">Perte ombres : ${pctStr} %</span>
    `;
    tooltip.style.display = "block";
    tooltip.style.left = clientX + "px";
    tooltip.style.top = clientY + "px";
  }

  function processHitTest(clientX, clientY) {
    const rect = overlayCanvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) {
      if (_lastPanelId != null) {
        _lastPanelId = null;
        updateTooltip(null);
      }
      return;
    }

    const panelsWithLoss = buildPanelsWithLoss();
    const pt = { x: localX, y: localY };
    let hit = null;
    for (const p of panelsWithLoss) {
      const poly = p.polygonPx;
      if (!Array.isArray(poly) || poly.length < 3) continue;
      if (isPointInPolygon(pt, poly)) {
        hit = { id: p.id, lossPct: p.lossPct };
        break;
      }
    }

    if (hit && (hit.id !== _lastPanelId || _lastMouseX !== clientX || _lastMouseY !== clientY)) {
      _lastPanelId = hit.id;
      _lastMouseX = clientX;
      _lastMouseY = clientY;
      updateTooltip(hit.id, hit.lossPct, clientX, clientY);
    } else if (!hit && _lastPanelId != null) {
      _lastPanelId = null;
      _lastMouseX = -1;
      _lastMouseY = -1;
      updateTooltip(null);
    }
  }

  function onMove(e) {
    const clientX = e.clientX ?? e.touches?.[0]?.clientX;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY;
    if (typeof clientX !== "number" || typeof clientY !== "number") return;

    if (_raf) return;
    _raf = requestAnimationFrame(() => {
      _raf = null;
      processHitTest(clientX, clientY);
    });
  }

  function onLeave() {
    if (_raf) cancelAnimationFrame(_raf);
    _raf = null;
    _lastPanelId = null;
    _lastMouseX = -1;
    _lastMouseY = -1;
    updateTooltip(null);
  }

  syncLayerSize();
  overlayRoot.appendChild(layer);

  layer.addEventListener("mousemove", onMove, { passive: true });
  layer.addEventListener("mouseleave", onLeave);
  layer.addEventListener("touchmove", onMove, { passive: true });
  layer.addEventListener("touchend", onLeave);
  layer.addEventListener("touchcancel", onLeave);

  if (typeof ResizeObserver !== "undefined") {
    _resizeObserver = new ResizeObserver(() => {
      syncLayerSize();
    });
    _resizeObserver.observe(overlayCanvas);
  }

  return {
    destroy() {
      if (_raf) cancelAnimationFrame(_raf);
      _resizeObserver?.disconnect();
      layer.removeEventListener("mousemove", onMove);
      layer.removeEventListener("mouseleave", onLeave);
      layer.removeEventListener("touchmove", onMove);
      layer.removeEventListener("touchend", onLeave);
      layer.removeEventListener("touchcancel", onLeave);
      layer.remove();
      tooltip.remove();
    },
  };
}
