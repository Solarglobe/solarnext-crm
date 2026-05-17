/**
 * Pass 5 — pose PV 3D produit : passerelles typées vers le legacy (même chaîne que Phase 3 2D).
 */

export type PvHitFromImage = { readonly blockId: string; readonly panelId: string };

type LegacyHitFn = (img: { x: number; y: number }) => PvHitFromImage | null;

export type PvLayout3dOverlayPoint = { readonly x: number; readonly y: number };

export type PvLayout3dOverlayPanel = {
  readonly id: string;
  readonly blockId: string;
  readonly panelId: string;
  readonly panId: string | null;
  readonly points: readonly PvLayout3dOverlayPoint[];
  readonly selected: boolean;
  readonly invalid: boolean;
  readonly enabled: boolean;
};

export type PvLayout3dOverlayGhost = {
  readonly id: string;
  readonly blockId: string;
  readonly panId: string | null;
  readonly center: PvLayout3dOverlayPoint;
  readonly points: readonly PvLayout3dOverlayPoint[];
  readonly valid?: boolean;
  readonly excluded?: boolean;
  readonly source?: "expansion" | "autofill";
};

export type PvLayout3dOverlaySafeZone = {
  readonly panId: string;
  readonly polygons: readonly (readonly PvLayout3dOverlayPoint[])[];
};

export type PvLayout3dOverlayHandles = {
  readonly blockId: string;
  readonly rotate: PvLayout3dOverlayPoint;
  readonly move: PvLayout3dOverlayPoint;
  readonly topOfBlock: PvLayout3dOverlayPoint;
};

export type PvLayout3dOverlayState = {
  readonly focusBlockId: string | null;
  readonly activeBlockId: string | null;
  readonly selectedPanelId: string | null;
  readonly selectedPanelCount: number;
  readonly selectedPowerKwc: number | null;
  readonly handles: PvLayout3dOverlayHandles | null;
  readonly panels: readonly PvLayout3dOverlayPanel[];
  readonly ghosts: readonly PvLayout3dOverlayGhost[];
  readonly safeZones: readonly PvLayout3dOverlaySafeZone[];
  /**
   * Vrai si window.CALPINAGE_IS_MANIPULATING — bloc en cours de drag (déplacement / rotation).
   * Utilisé pour gater le live overlay 3D : les panneaux ne sont rendus en overlay qu'pendant
   * la manipulation active, évitant tout Z-fighting avec l'InstancedMesh quand le bloc est
   * simplement sélectionné (sans être déplacé).
   */
  readonly isManipulating?: boolean;
};

type LegacyBeginFn = (
  blockId: string,
  startImg: { x: number; y: number },
  pointerId: number,
) => { ok?: boolean; code?: string; message?: string };

type LegacyFinalizeOpts = {
  releaseCaptureEl?: Element | null;
  pointerId?: number | null;
  skipUxToast?: boolean;
};

type LegacyBeginRotateFn = (
  blockId: string,
  startImg: { x: number; y: number },
  pointerId: number,
) => { ok?: boolean; code?: string; message?: string; centerImg?: PvLayout3dOverlayPoint | null };

type LegacyApplyMoveFn = (dxImg: number, dyImg: number) => boolean;
type LegacyApplyTransformFn = (dxImg: number, dyImg: number, rotationDeg: number) => boolean;
type LegacyCancelFn = () => boolean;
type LegacyFinalizeFn = (opts?: LegacyFinalizeOpts) => boolean;
type LegacyGetOverlayStateFn = () => PvLayout3dOverlayState | null;
type LegacySelectBlockFn = (blockId: string, panelId?: string | null) => boolean;
type LegacyAddPanelFn = (imgPt: { x: number; y: number }) => boolean;
type LegacyRemovePanelFn = (blockId: string, panelId: string) => boolean;
type LegacyRemoveSelectedFn = () => boolean;
type LegacyClearSelectionFn = () => boolean;

export type PvLayout3dProductCapability =
  | "hitTest"
  | "beginMove"
  | "beginRotate"
  | "applyMove"
  | "applyTransform"
  | "cancel"
  | "finalize"
  | "overlay"
  | "select"
  | "addPanel"
  | "removePanel"
  | "removeSelected"
  | "clearSelection";

export type PvLayout3dProductCapabilityReport = {
  readonly ready: boolean;
  readonly missing: readonly PvLayout3dProductCapability[];
};

function readHit(): LegacyHitFn | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { __calpinageHitTestPvBlockPanelFromImagePoint?: LegacyHitFn };
  return typeof w.__calpinageHitTestPvBlockPanelFromImagePoint === "function"
    ? w.__calpinageHitTestPvBlockPanelFromImagePoint
    : null;
}

function readBegin(): LegacyBeginFn | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { __calpinageBeginPhase3PvMoveFrom3d?: LegacyBeginFn };
  return typeof w.__calpinageBeginPhase3PvMoveFrom3d === "function" ? w.__calpinageBeginPhase3PvMoveFrom3d : null;
}

function readBeginRotate(): LegacyBeginRotateFn | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { __calpinageBeginPhase3PvRotateFrom3d?: LegacyBeginRotateFn };
  return typeof w.__calpinageBeginPhase3PvRotateFrom3d === "function" ? w.__calpinageBeginPhase3PvRotateFrom3d : null;
}

function readApplyMoveLive(): LegacyApplyMoveFn | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { __calpinageApplyPhase3PvMoveLiveFrom3d?: LegacyApplyMoveFn };
  return typeof w.__calpinageApplyPhase3PvMoveLiveFrom3d === "function"
    ? w.__calpinageApplyPhase3PvMoveLiveFrom3d
    : null;
}

function readApplyTransformLive(): LegacyApplyTransformFn | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { __calpinageApplyPhase3PvTransformLiveFrom3d?: LegacyApplyTransformFn };
  return typeof w.__calpinageApplyPhase3PvTransformLiveFrom3d === "function"
    ? w.__calpinageApplyPhase3PvTransformLiveFrom3d
    : null;
}

function readCancel(): LegacyCancelFn | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { __calpinageCancelPhase3PvMoveFrom3d?: LegacyCancelFn };
  return typeof w.__calpinageCancelPhase3PvMoveFrom3d === "function" ? w.__calpinageCancelPhase3PvMoveFrom3d : null;
}

function readFinalize(): LegacyFinalizeFn | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { __calpinageFinalizePhase3PvHandleManipulation?: LegacyFinalizeFn };
  return typeof w.__calpinageFinalizePhase3PvHandleManipulation === "function"
    ? w.__calpinageFinalizePhase3PvHandleManipulation
    : null;
}

function readGetOverlayState(): LegacyGetOverlayStateFn | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { __calpinageGetPhase3Pv3dOverlayState?: LegacyGetOverlayStateFn };
  return typeof w.__calpinageGetPhase3Pv3dOverlayState === "function"
    ? w.__calpinageGetPhase3Pv3dOverlayState
    : null;
}

function readSelectBlock(): LegacySelectBlockFn | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { __calpinageSelectPvBlockFrom3d?: LegacySelectBlockFn };
  return typeof w.__calpinageSelectPvBlockFrom3d === "function" ? w.__calpinageSelectPvBlockFrom3d : null;
}

function readAddPanel(): LegacyAddPanelFn | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { __calpinageAddPvPanelFrom3dImagePoint?: LegacyAddPanelFn };
  return typeof w.__calpinageAddPvPanelFrom3dImagePoint === "function" ? w.__calpinageAddPvPanelFrom3dImagePoint : null;
}

function readRemovePanel(): LegacyRemovePanelFn | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { __calpinageRemovePvPanelFrom3d?: LegacyRemovePanelFn };
  return typeof w.__calpinageRemovePvPanelFrom3d === "function" ? w.__calpinageRemovePvPanelFrom3d : null;
}

function readRemoveSelected(): LegacyRemoveSelectedFn | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { __calpinageRemoveSelectedPvPanelFrom3d?: LegacyRemoveSelectedFn };
  return typeof w.__calpinageRemoveSelectedPvPanelFrom3d === "function"
    ? w.__calpinageRemoveSelectedPvPanelFrom3d
    : null;
}

function readClearSelection(): LegacyClearSelectionFn | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { __calpinageClearPvSelectionFrom3d?: LegacyClearSelectionFn };
  return typeof w.__calpinageClearPvSelectionFrom3d === "function" ? w.__calpinageClearPvSelectionFrom3d : null;
}

/** Contrat produit minimal : pose, sélection, déplacement, rotation, suppression et overlay doivent être branchés. */
export function getPvLayout3dProductCapabilityReport(): PvLayout3dProductCapabilityReport {
  const required: readonly [PvLayout3dProductCapability, () => unknown][] = [
    ["hitTest", readHit],
    ["beginMove", readBegin],
    ["beginRotate", readBeginRotate],
    ["applyMove", readApplyMoveLive],
    ["applyTransform", readApplyTransformLive],
    ["cancel", readCancel],
    ["finalize", readFinalize],
    ["overlay", readGetOverlayState],
    ["select", readSelectBlock],
    ["addPanel", readAddPanel],
    ["removePanel", readRemovePanel],
    ["removeSelected", readRemoveSelected],
    ["clearSelection", readClearSelection],
  ];
  const missing = required
    .filter(([, read]) => read() == null)
    .map(([name]) => name);
  return {
    ready: missing.length === 0,
    missing,
  };
}

/** Hit-test px image → bloc + panneau (focus puis blocs figés). */
export function hitTestPvBlockPanelFromImagePoint(img: { readonly x: number; readonly y: number }): PvHitFromImage | null {
  const fn = readHit();
  if (!fn) return null;
  try {
    return fn({ x: img.x, y: img.y });
  } catch {
    return null;
  }
}

export function beginPvMoveFrom3d(
  blockId: string,
  startImg: { readonly x: number; readonly y: number },
  pointerId: number,
): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string } {
  const fn = readBegin();
  if (!fn) {
    return { ok: false, code: "LEGACY_UNAVAILABLE", message: "Calpinage legacy non chargé." };
  }
  try {
    const res = fn(blockId, { x: startImg.x, y: startImg.y }, pointerId);
    if (res && res.ok === true) return { ok: true };
    return {
      ok: false,
      code: res?.code ?? "UNKNOWN",
      message: res?.message ?? "Erreur inconnue.",
    };
  } catch {
    return { ok: false, code: "EXCEPTION", message: "Exception lors du beginPvMoveFrom3d." };
  }
}

/** Démarre une rotation de bloc PV depuis la vue 3D. */
export function beginPvRotateFrom3d(
  blockId: string,
  centerImg: { readonly x: number; readonly y: number },
  pointerId: number,
):
  | { readonly ok: true; readonly centerImg: PvLayout3dOverlayPoint | null }
  | { readonly ok: false; readonly code: string; readonly message: string } {
  const fn = readBeginRotate();
  if (!fn) {
    return { ok: false, code: "LEGACY_UNAVAILABLE", message: "Calpinage legacy non chargé." };
  }
  try {
    const res = fn(blockId, { x: centerImg.x, y: centerImg.y }, pointerId);
    if (res && res.ok === true) return { ok: true, centerImg: res.centerImg ?? null };
    return {
      ok: false,
      code: res?.code ?? "UNKNOWN",
      message: res?.message ?? "Erreur inconnue.",
    };
  } catch {
    return { ok: false, code: "EXCEPTION", message: "Exception lors du beginPvRotateFrom3d." };
  }
}

/** Applique un déplacement live (delta px image) sans rotation. */
export function applyPvMoveLiveFrom3d(dx: number, dy: number): boolean {
  const fn = readApplyMoveLive();
  if (!fn) return false;
  try {
    return fn(dx, dy) === true;
  } catch {
    return false;
  }
}

/** Applique un déplacement + rotation live (delta px image + degrés). */
export function applyPvTransformLiveFrom3d(dx: number, dy: number, rotationDeg: number): boolean {
  const fn = readApplyTransformLive();
  if (!fn) return false;
  try {
    return fn(dx, dy, rotationDeg) === true;
  } catch {
    return false;
  }
}

/** Annule la manipulation PV en cours. */
export function cancelPvMoveFrom3d(): boolean {
  const fn = readCancel();
  if (!fn) return false;
  try {
    return fn() === true;
  } catch {
    return false;
  }
}

/** Finalise (commit) la manipulation PV en cours. */
export function finalizePvMoveFrom3d(opts?: LegacyFinalizeOpts): boolean {
  const fn = readFinalize();
  if (!fn) return false;
  try {
    return fn(opts) === true;
  } catch {
    return false;
  }
}

/** Lit l'état overlay PV 3D courant (panneaux, ghosts, handles, safe-zones). */
export function readPvLayout3dOverlayState(): PvLayout3dOverlayState | null {
  const fn = readGetOverlayState();
  if (!fn) return null;
  try {
    return fn();
  } catch {
    return null;
  }
}

/** Sélectionne un bloc PV depuis la vue 3D, avec optionnellement un panneau. */
export function selectPvBlockFrom3d(blockId: string, panelId?: string | null): boolean {
  const fn = readSelectBlock();
  if (!fn) return false;
  try {
    return fn(blockId, panelId ?? null) === true;
  } catch {
    return false;
  }
}

/** Ajoute un panneau PV à partir d'un point image 3D. */
export function addPvPanelFrom3dImagePoint(
  imagePoint: { readonly x: number; readonly y: number },
): boolean {
  const fn = readAddPanel();
  if (!fn) return false;
  try {
    return fn({ x: imagePoint.x, y: imagePoint.y }) === true;
  } catch {
    return false;
  }
}

/** Supprime un panneau PV spécifique depuis la vue 3D. */
export function removePvPanelFrom3d(blockId: string, panelId: string): boolean {
  const fn = readRemovePanel();
  if (!fn) return false;
  try {
    return fn(blockId, panelId) === true;
  } catch {
    return false;
  }
}

/** Supprime le panneau PV actuellement sélectionné depuis la vue 3D. */
export function removeSelectedPvPanelFrom3d(): boolean {
  const fn = readRemoveSelected();
  if (!fn) return false;
  try {
    return fn() === true;
  } catch {
    return false;
  }
}

/** Efface la sélection PV courante depuis la vue 3D. */
export function clearPvSelectionFrom3d(): boolean {
  const fn = readClearSelection();
  if (!fn) return false;
  try {
    return fn() === true;
  } catch {
    return false;
  }
}
