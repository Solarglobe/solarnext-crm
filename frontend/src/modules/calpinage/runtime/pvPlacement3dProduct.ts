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
  const r = fn(String(blockId), { x: startImg.x, y: startImg.y }, pointerId);
  if (r && typeof r === "object" && r.ok === false) {
    return {
      ok: false,
      code: String((r as { code?: string }).code ?? "BEGIN_REJECT"),
      message: String((r as { message?: string }).message ?? "Déplacement refusé."),
    };
  }
  return { ok: true };
}

export function applyPvMoveLiveFrom3d(dxImg: number, dyImg: number): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { __calpinageApplyPhase3PvMoveLiveFrom3d?: (dx: number, dy: number) => boolean };
  return typeof w.__calpinageApplyPhase3PvMoveLiveFrom3d === "function"
    ? !!w.__calpinageApplyPhase3PvMoveLiveFrom3d(dxImg, dyImg)
    : false;
}

export function cancelPvMoveFrom3d(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { __calpinageCancelPhase3PvMoveFrom3d?: () => boolean };
  return typeof w.__calpinageCancelPhase3PvMoveFrom3d === "function" ? !!w.__calpinageCancelPhase3PvMoveFrom3d() : false;
}

export function finalizePvMoveFrom3d(opts?: LegacyFinalizeOpts): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    __calpinageFinalizePhase3PvHandleManipulation?: (o: LegacyFinalizeOpts) => boolean;
  };
  return typeof w.__calpinageFinalizePhase3PvHandleManipulation === "function"
    ? !!w.__calpinageFinalizePhase3PvHandleManipulation(opts ?? {})
    : false;
}

export function applyPvTransformLiveFrom3d(dxImg: number, dyImg: number, rotationDeg: number): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    __calpinageApplyPhase3PvTransformLiveFrom3d?: (dx: number, dy: number, rot: number) => boolean;
  };
  return typeof w.__calpinageApplyPhase3PvTransformLiveFrom3d === "function"
    ? !!w.__calpinageApplyPhase3PvTransformLiveFrom3d(dxImg, dyImg, rotationDeg)
    : false;
}

export function beginPvRotateFrom3d(
  blockId: string,
  startImg: { readonly x: number; readonly y: number },
  pointerId: number,
): { readonly ok: true; readonly centerImg: { readonly x: number; readonly y: number } | null } | { readonly ok: false; readonly code: string; readonly message: string } {
  if (typeof window === "undefined") {
    return { ok: false, code: "LEGACY_UNAVAILABLE", message: "Calpinage legacy non chargÃ©." };
  }
  const w = window as unknown as {
    __calpinageBeginPhase3PvRotateFrom3d?: (
      blockId: string,
      startImg: { x: number; y: number },
      pointerId: number,
    ) => { ok?: boolean; code?: string; message?: string; centerImg?: { x: number; y: number } | null };
  };
  const fn = w.__calpinageBeginPhase3PvRotateFrom3d;
  if (typeof fn !== "function") {
    return { ok: false, code: "LEGACY_UNAVAILABLE", message: "Calpinage legacy non chargÃ©." };
  }
  const r = fn(String(blockId), { x: startImg.x, y: startImg.y }, pointerId);
  if (r && r.ok === false) {
    return {
      ok: false,
      code: String(r.code ?? "BEGIN_REJECT"),
      message: String(r.message ?? "Rotation refusÃ©e."),
    };
  }
  return { ok: true, centerImg: r?.centerImg ?? null };
}

export function readPvLayout3dOverlayState(): PvLayout3dOverlayState | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    __calpinageGetPhase3Pv3dOverlayState?: () => PvLayout3dOverlayState | null;
  };
  if (typeof w.__calpinageGetPhase3Pv3dOverlayState !== "function") return null;
  try {
    return w.__calpinageGetPhase3Pv3dOverlayState();
  } catch {
    return null;
  }
}

export function selectPvBlockFrom3d(blockId: string, panelId?: string | null): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    __calpinageSelectPvBlockFrom3d?: (blockId: string, panelId?: string | null) => boolean;
  };
  return typeof w.__calpinageSelectPvBlockFrom3d === "function"
    ? !!w.__calpinageSelectPvBlockFrom3d(blockId, panelId ?? null)
    : false;
}

export function addPvPanelFrom3dImagePoint(img: { readonly x: number; readonly y: number }): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    __calpinageAddPvPanelFrom3dImagePoint?: (img: { x: number; y: number }) => boolean;
  };
  return typeof w.__calpinageAddPvPanelFrom3dImagePoint === "function"
    ? !!w.__calpinageAddPvPanelFrom3dImagePoint({ x: img.x, y: img.y })
    : false;
}

export function removeSelectedPvPanelFrom3d(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { __calpinageRemoveSelectedPvPanelFrom3d?: () => boolean };
  return typeof w.__calpinageRemoveSelectedPvPanelFrom3d === "function"
    ? !!w.__calpinageRemoveSelectedPvPanelFrom3d()
    : false;
}

export function removePvPanelFrom3d(blockId: string, panelId: string): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { __calpinageRemovePvPanelFrom3d?: (blockId: string, panelId: string) => boolean };
  return typeof w.__calpinageRemovePvPanelFrom3d === "function"
    ? !!w.__calpinageRemovePvPanelFrom3d(blockId, panelId)
    : false;
}

export function clearPvSelectionFrom3d(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { __calpinageClearPvSelectionFrom3d?: () => boolean };
  return typeof w.__calpinageClearPvSelectionFrom3d === "function" ? !!w.__calpinageClearPvSelectionFrom3d() : false;
}
