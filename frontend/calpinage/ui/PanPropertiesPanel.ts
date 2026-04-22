/**
 * UI Propriétés du pan (étape 6.2).
 * S'affiche uniquement si un pan est sélectionné.
 * Azimut (0–360°) et inclinaison (0–90°) éditables, synchronisés et persistés dans panState.
 * Si un sommet est actif : id du point, hauteur (m) éditable (champ + boutons ±), lock / min-max.
 */

import type { Pan, Point2D, ActivePoint } from "../state/panState";
import type { CalpinageStateLike } from "../state/panPhysical";

export type PanPropertiesPanelOptions = {
  container: HTMLElement;
  panState: { pans: Pan[]; activePanId: string | null; activePoint: ActivePoint };
  /** Pour affichage optionnel (flèche orientation). */
  roofState?: { roof: { north: { angleDeg: number } | null } | null };
  onRedraw: () => void;
  /** État complet pour recalcul physique après modification de hauteur. */
  getCalpinageState?: () => CalpinageStateLike | null;
  /** Appelé après modification de hauteur d’un sommet (recalcul pente/orientation). */
  onHeightsChanged?: (pan: Pan) => void;
  /** Appelé quand l’utilisateur impose une pente manuelle (ajuste les hauteurs). */
  onApplyManualSlope?: (pan: Pan, desiredSlopeDeg: number) => void;
};

const HEIGHT_STEP_M = 0.1;
const HEIGHT_DEFAULT = 0;

const AZIMUTH_MIN = 0;
const AZIMUTH_MAX = 360;
const TILT_MIN = 0;
const TILT_MAX = 90;
const TILT_SLIDER_MAX = 60;

function clampAzimuth(v: number): number {
  return Math.max(AZIMUTH_MIN, Math.min(AZIMUTH_MAX, Math.round(v)));
}

function clampTilt(v: number): number {
  return Math.max(TILT_MIN, Math.min(TILT_MAX, Math.round(v)));
}

/**
 * Crée le panneau Propriétés du pan : affichage conditionnel, azimut (presets + slider + input), inclinaison (slider + input).
 * Retourne update() pour rafraîchir l'UI quand la sélection ou les valeurs changent, et destroy().
 */
export function renderPanPropertiesPanel(options: PanPropertiesPanelOptions): {
  update: () => void;
  destroy: () => void;
} {
  const { container, panState, onRedraw, onHeightsChanged, onApplyManualSlope } = options;

  const wrap = document.createElement("div");
  wrap.className = "pan-properties-panel";
  wrap.style.marginTop = "8px";

  let placeholderEl: HTMLElement | null = null;
  let controlsWrap: HTMLElement | null = null;
  let vertexWrap: HTMLElement | null = null;
  let azimuthPresetsWrap: HTMLElement | null = null;
  let azimuthSlider: HTMLInputElement | null = null;
  let azimuthInput: HTMLInputElement | null = null;
  let tiltSlider: HTMLInputElement | null = null;
  let tiltInput: HTMLInputElement | null = null;
  let heightInput: HTMLInputElement | null = null;
  let heightMin: number | undefined;
  let heightMax: number | undefined;

  function getActivePan(): Pan | null {
    if (!panState.activePanId) return null;
    return panState.pans.find((p) => p.id === panState.activePanId) ?? null;
  }

  function syncAzimuthFromPan(pan: Pan) {
    const raw =
      pan.physical?.orientation?.azimuthDeg != null
        ? pan.physical.orientation.azimuthDeg
        : pan.azimuthDeg != null
          ? pan.azimuthDeg
          : null;
    if (raw != null && Number.isFinite(Number(raw))) {
      const v = clampAzimuth(Number(raw));
      if (azimuthSlider) {
        azimuthSlider.disabled = false;
        azimuthSlider.value = String(v);
      }
      if (azimuthInput) {
        azimuthInput.value = String(v);
        azimuthInput.placeholder = "";
      }
    } else {
      if (azimuthSlider) {
        azimuthSlider.disabled = true;
        azimuthSlider.value = String(AZIMUTH_MIN);
      }
      if (azimuthInput) {
        azimuthInput.value = "";
        azimuthInput.placeholder = "\u2014";
      }
    }
  }

  function syncTiltFromPan(pan: Pan) {
    const slope = pan.physical?.slope;
    let raw: number | null = null;
    if (slope?.valueDeg != null && Number.isFinite(Number(slope.valueDeg))) raw = Number(slope.valueDeg);
    else if (slope && slope.mode !== "manual" && slope.computedDeg != null && Number.isFinite(Number(slope.computedDeg)))
      raw = Number(slope.computedDeg);
    else if (pan.tiltDeg != null && Number.isFinite(Number(pan.tiltDeg))) raw = Number(pan.tiltDeg);
    if (raw != null && Number.isFinite(raw)) {
      const v = clampTilt(raw);
      if (tiltSlider) {
        tiltSlider.disabled = false;
        tiltSlider.value = String(v);
      }
      if (tiltInput) {
        tiltInput.value = String(v);
        tiltInput.placeholder = "";
      }
    } else {
      if (tiltSlider) {
        tiltSlider.disabled = true;
        tiltSlider.value = String(TILT_MIN);
      }
      if (tiltInput) {
        tiltInput.value = "";
        tiltInput.placeholder = "\u2014";
      }
    }
  }

  function getActivePoint(): { pan: Pan; point: Point2D; index: number } | null {
    const ap = panState.activePoint;
    if (!ap) return null;
    const pan = panState.pans.find((p) => p.id === ap.panId);
    if (!pan || ap.index < 0 || ap.index >= pan.points.length) return null;
    return { pan, point: pan.points[ap.index], index: ap.index };
  }

  function clampHeight(v: number): number {
    if (heightMin !== undefined) v = Math.max(heightMin, v);
    if (heightMax !== undefined) v = Math.min(heightMax, v);
    return v;
  }

  function setPointHeight(pan: Pan, point: Point2D, value: number) {
    const clamped = clampHeight(value);
    point.h = clamped;
    if (heightInput) heightInput.value = String(clamped);
    onHeightsChanged?.(pan);
    onRedraw();
  }

  function buildVertexSection() {
    if (vertexWrap) return vertexWrap;
    vertexWrap = document.createElement("div");
    vertexWrap.className = "pan-properties-vertex";
    vertexWrap.style.marginTop = "16px";
    vertexWrap.style.paddingTop = "16px";
    vertexWrap.style.borderTop = "1px solid var(--line, #e4ddcc)";

    const title = document.createElement("p");
    title.style.fontSize = "13px";
    title.style.fontWeight = "600";
    title.style.marginBottom = "6px";
    title.className = "vertex-section-title";
    title.textContent = "Sommet";
    vertexWrap.appendChild(title);

    const idLine = document.createElement("p");
    idLine.style.fontSize = "12px";
    idLine.style.color = "var(--muted, #6b7280)";
    idLine.style.marginBottom = "8px";
    idLine.className = "vertex-point-id";
    vertexWrap.appendChild(idLine);

    const heightLabel = document.createElement("label");
    heightLabel.style.display = "block";
    heightLabel.style.fontSize = "12px";
    heightLabel.style.marginBottom = "4px";
    heightLabel.textContent = "Hauteur (m)";
    vertexWrap.appendChild(heightLabel);

    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "8px";
    row.style.marginBottom = "8px";

    const minusBtn = document.createElement("button");
    minusBtn.type = "button";
    minusBtn.className = "btn-measure calibration-panel";
    minusBtn.style.padding = "6px 12px";
    minusBtn.style.fontSize = "14px";
    minusBtn.textContent = "−";
    minusBtn.title = "Diminuer la hauteur";

    heightInput = document.createElement("input");
    heightInput.type = "number";
    heightInput.step = String(HEIGHT_STEP_M);
    heightInput.style.width = "72px";
    heightInput.style.padding = "6px";

    const plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.className = "btn-measure calibration-panel";
    plusBtn.style.padding = "6px 12px";
    plusBtn.style.fontSize = "14px";
    plusBtn.textContent = "+";
    plusBtn.title = "Augmenter la hauteur";

    minusBtn.className = "btn-measure calibration-panel vertex-height-minus";
    plusBtn.className = "btn-measure calibration-panel vertex-height-plus";
    minusBtn.addEventListener("click", () => {
      const data = getActivePoint();
      if (!data || data.point.constraints?.lock) return;
      const step = -HEIGHT_STEP_M;
      setPointHeight(data.pan, data.point, (data.point.h ?? HEIGHT_DEFAULT) + step);
    });
    plusBtn.addEventListener("click", () => {
      const data = getActivePoint();
      if (!data || data.point.constraints?.lock) return;
      setPointHeight(data.pan, data.point, (data.point.h ?? HEIGHT_DEFAULT) + HEIGHT_STEP_M);
    });
    heightInput.addEventListener("change", () => {
      const data = getActivePoint();
      if (!data || data.point.constraints?.lock) return;
      const v = Number(heightInput!.value);
      if (!Number.isFinite(v)) return;
      setPointHeight(data.pan, data.point, v);
    });
    heightInput.addEventListener("input", () => {
      const data = getActivePoint();
      if (!data || data.point.constraints?.lock) return;
      const v = Number(heightInput!.value);
      if (!Number.isFinite(v)) return;
      const clamped = clampHeight(v);
      data.point.h = clamped;
      onHeightsChanged?.(data.pan);
      onRedraw();
    });

    row.appendChild(minusBtn);
    row.appendChild(heightInput);
    row.appendChild(plusBtn);
    vertexWrap.appendChild(row);

    const lockNote = document.createElement("p");
    lockNote.style.fontSize = "11px";
    lockNote.style.color = "var(--muted, #6b7280)";
    lockNote.className = "vertex-lock-note";
    vertexWrap.appendChild(lockNote);

    return vertexWrap;
  }

  function syncVertexSection() {
    const data = getActivePoint();
    if (!vertexWrap) return;
    if (!data) {
      vertexWrap.style.display = "none";
      return;
    }
    vertexWrap.style.display = "block";
    const idEl = vertexWrap.querySelector(".vertex-point-id") as HTMLElement;
    if (idEl) idEl.textContent = "Id : " + (data.point.id ?? `${data.pan.id}-${data.index}`);

    const lock = data.point.constraints?.lock ?? false;
    heightMin = data.point.constraints?.minH;
    heightMax = data.point.constraints?.maxH;
    if (heightInput) {
      heightInput.disabled = lock;
      heightInput.readOnly = lock;
      if (heightMin !== undefined) heightInput.min = String(heightMin);
      else heightInput.removeAttribute("min");
      if (heightMax !== undefined) heightInput.max = String(heightMax);
      else heightInput.removeAttribute("max");
      heightInput.value = String(data.point.h ?? HEIGHT_DEFAULT);
    }
    const minusBtn = vertexWrap.querySelector(".vertex-height-minus");
    const plusBtn = vertexWrap.querySelector(".vertex-height-plus");
    if (minusBtn) (minusBtn as HTMLButtonElement).disabled = lock;
    if (plusBtn) (plusBtn as HTMLButtonElement).disabled = lock;
    const lockNote = vertexWrap.querySelector(".vertex-lock-note") as HTMLElement;
    if (lockNote) lockNote.textContent = lock ? "Sommet verrouillé (lecture seule)" : "";
  }

  function buildControls() {
    if (controlsWrap) return;
    controlsWrap = document.createElement("div");
    controlsWrap.className = "pan-properties-controls";

    const azimuthLabel = document.createElement("p");
    azimuthLabel.style.fontSize = "13px";
    azimuthLabel.style.fontWeight = "600";
    azimuthLabel.style.marginBottom = "6px";
    azimuthLabel.style.marginTop = "12px";
    azimuthLabel.textContent = "Orientation (azimut)";
    controlsWrap.appendChild(azimuthLabel);
    const azimuthNote = document.createElement("p");
    azimuthNote.style.fontSize = "11px";
    azimuthNote.style.color = "var(--muted, #6b7280)";
    azimuthNote.style.marginBottom = "8px";
    azimuthNote.textContent = "0° Nord, 90° Est, 180° Sud, 270° Ouest";
    controlsWrap.appendChild(azimuthNote);

    azimuthPresetsWrap = document.createElement("div");
    azimuthPresetsWrap.style.display = "flex";
    azimuthPresetsWrap.style.flexWrap = "wrap";
    azimuthPresetsWrap.style.gap = "6px";
    azimuthPresetsWrap.style.marginBottom = "8px";
    for (const deg of [0, 90, 180, 270]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-measure calibration-panel";
      btn.style.padding = "6px 12px";
      btn.style.fontSize = "12px";
      btn.textContent = deg + "°";
      btn.title = deg === 0 ? "Nord" : deg === 90 ? "Est" : deg === 180 ? "Sud" : "Ouest";
      btn.addEventListener("click", () => {
        const pan = getActivePan();
        if (!pan) return;
        pan.azimuthDeg = deg;
        syncAzimuthFromPan(pan);
        onRedraw();
      });
      azimuthPresetsWrap.appendChild(btn);
    }
    controlsWrap.appendChild(azimuthPresetsWrap);

    const azimuthRow = document.createElement("div");
    azimuthRow.style.display = "flex";
    azimuthRow.style.alignItems = "center";
    azimuthRow.style.gap = "10px";
    azimuthRow.style.marginBottom = "8px";
    azimuthSlider = document.createElement("input");
    azimuthSlider.type = "range";
    azimuthSlider.min = String(AZIMUTH_MIN);
    azimuthSlider.max = String(AZIMUTH_MAX);
    azimuthSlider.step = "1";
    azimuthSlider.style.flex = "1";
    azimuthSlider.style.minWidth = "80px";
    azimuthInput = document.createElement("input");
    azimuthInput.type = "number";
    azimuthInput.min = String(AZIMUTH_MIN);
    azimuthInput.max = String(AZIMUTH_MAX);
    azimuthInput.step = "1";
    azimuthInput.style.width = "56px";
    azimuthInput.style.padding = "6px";
    azimuthRow.appendChild(azimuthSlider);
    azimuthRow.appendChild(azimuthInput);
    controlsWrap.appendChild(azimuthRow);

    azimuthSlider.addEventListener("input", () => {
      const pan = getActivePan();
      if (!pan) return;
      const v = clampAzimuth(Number(azimuthSlider!.value));
      pan.azimuthDeg = v;
      if (azimuthInput) azimuthInput.value = String(v);
      if (azimuthSlider) azimuthSlider.disabled = false;
      onRedraw();
    });
    azimuthInput.addEventListener("input", () => {
      const pan = getActivePan();
      if (!pan) return;
      const rawAz = (azimuthInput!.value || "").trim();
      if (rawAz === "") return;
      const v = clampAzimuth(Number(rawAz));
      if (!Number.isFinite(v)) return;
      pan.azimuthDeg = v;
      if (azimuthSlider) {
        azimuthSlider.disabled = false;
        azimuthSlider.value = String(v);
      }
      onRedraw();
    });
    azimuthInput.addEventListener("change", () => {
      const pan = getActivePan();
      if (!pan) return;
      const rawAz = (azimuthInput!.value || "").trim();
      if (rawAz === "") {
        pan.azimuthDeg = null;
        syncAzimuthFromPan(pan);
        onRedraw();
        return;
      }
      const v = clampAzimuth(Number(rawAz));
      if (!Number.isFinite(v)) {
        syncAzimuthFromPan(pan);
        onRedraw();
        return;
      }
      pan.azimuthDeg = v;
      if (azimuthSlider) {
        azimuthSlider.disabled = false;
        azimuthSlider.value = String(v);
      }
      if (azimuthInput) azimuthInput.value = String(v);
      onRedraw();
    });

    const tiltLabel = document.createElement("p");
    tiltLabel.style.fontSize = "13px";
    tiltLabel.style.fontWeight = "600";
    tiltLabel.style.marginBottom = "6px";
    tiltLabel.style.marginTop = "16px";
    tiltLabel.textContent = "Inclinaison";
    controlsWrap.appendChild(tiltLabel);
    const tiltNote = document.createElement("p");
    tiltNote.style.fontSize = "11px";
    tiltNote.style.color = "var(--muted, #6b7280)";
    tiltNote.style.marginBottom = "8px";
    tiltNote.textContent = "0° = plat. Laisser vide tant que la pente n'est pas calculée ou saisie.";
    controlsWrap.appendChild(tiltNote);

    const tiltRow = document.createElement("div");
    tiltRow.style.display = "flex";
    tiltRow.style.alignItems = "center";
    tiltRow.style.gap = "10px";
    tiltRow.style.marginBottom = "8px";
    tiltSlider = document.createElement("input");
    tiltSlider.type = "range";
    tiltSlider.min = String(TILT_MIN);
    tiltSlider.max = String(TILT_SLIDER_MAX);
    tiltSlider.step = "1";
    tiltSlider.style.flex = "1";
    tiltSlider.style.minWidth = "80px";
    tiltInput = document.createElement("input");
    tiltInput.type = "number";
    tiltInput.min = String(TILT_MIN);
    tiltInput.max = String(TILT_MAX);
    tiltInput.step = "1";
    tiltInput.style.width = "56px";
    tiltInput.style.padding = "6px";
    tiltRow.appendChild(tiltSlider);
    tiltRow.appendChild(tiltInput);
    controlsWrap.appendChild(tiltRow);

    tiltSlider.addEventListener("input", () => {
      const pan = getActivePan();
      if (!pan) return;
      if (tiltSlider) tiltSlider.disabled = false;
      const v = clampTilt(Number(tiltSlider!.value));
      if (onApplyManualSlope) {
        onApplyManualSlope(pan, v);
      } else {
        pan.tiltDeg = v;
        if (pan.physical) {
          pan.physical.slope.mode = "manual";
          pan.physical.slope.valueDeg = v;
        }
      }
      if (tiltInput) tiltInput.value = String(v);
      onRedraw();
    });
    tiltInput.addEventListener("input", () => {
      const pan = getActivePan();
      if (!pan) return;
      const rawT = (tiltInput!.value || "").trim();
      if (rawT === "") return;
      const v = clampTilt(Number(rawT));
      if (!Number.isFinite(v)) return;
      if (onApplyManualSlope) {
        onApplyManualSlope(pan, v);
      } else {
        pan.tiltDeg = v;
        if (pan.physical) {
          pan.physical.slope.mode = "manual";
          pan.physical.slope.valueDeg = v;
        }
      }
      if (tiltSlider) {
        tiltSlider.disabled = false;
        tiltSlider.value = String(Math.min(v, TILT_SLIDER_MAX));
      }
      onRedraw();
    });
    tiltInput.addEventListener("change", () => {
      const pan = getActivePan();
      if (!pan) return;
      const rawT = (tiltInput!.value || "").trim();
      if (rawT === "") {
        pan.tiltDeg = null;
        if (pan.physical?.slope) {
          pan.physical.slope.mode = "auto";
          pan.physical.slope.valueDeg = null;
        }
        onHeightsChanged?.(pan);
        syncTiltFromPan(pan);
        onRedraw();
        return;
      }
      const v = clampTilt(Number(rawT));
      if (!Number.isFinite(v)) {
        syncTiltFromPan(pan);
        onRedraw();
        return;
      }
      if (onApplyManualSlope) {
        onApplyManualSlope(pan, v);
      } else {
        pan.tiltDeg = v;
        if (pan.physical) {
          pan.physical.slope.mode = "manual";
          pan.physical.slope.valueDeg = v;
        }
      }
      if (tiltSlider) {
        tiltSlider.disabled = false;
        tiltSlider.value = String(Math.min(v, TILT_SLIDER_MAX));
      }
      if (tiltInput) tiltInput.value = String(v);
      onRedraw();
    });
  }

  function update() {
    const pan = getActivePan();
    if (!pan) {
      if (controlsWrap) {
        controlsWrap.remove();
        controlsWrap = null;
        azimuthSlider = null;
        azimuthInput = null;
        tiltSlider = null;
        tiltInput = null;
        azimuthPresetsWrap = null;
      }
      if (vertexWrap) vertexWrap.style.display = "none";
      if (!placeholderEl) {
        placeholderEl = document.createElement("p");
        placeholderEl.className = "pan-properties-placeholder";
        placeholderEl.style.fontSize = "13px";
        placeholderEl.style.color = "var(--muted, #6b7280)";
        placeholderEl.textContent = "Sélectionnez un pan pour éditer ses propriétés";
        wrap.appendChild(placeholderEl);
      }
      return;
    }
    if (placeholderEl) {
      placeholderEl.remove();
      placeholderEl = null;
    }
    buildControls();
    if (controlsWrap && !wrap.contains(controlsWrap)) wrap.appendChild(controlsWrap);
    syncAzimuthFromPan(pan);
    syncTiltFromPan(pan);
    buildVertexSection();
    if (vertexWrap && !wrap.contains(vertexWrap)) wrap.appendChild(vertexWrap);
    syncVertexSection();
  }

  update();
  container.appendChild(wrap);

  return {
    update,
    destroy: () => wrap.remove(),
  };
}
