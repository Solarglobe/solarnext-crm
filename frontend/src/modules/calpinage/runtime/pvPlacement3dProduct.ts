/**
 * Pass 5 — pose PV 3D produit : passerelles typées vers le legacy (même chaîne que Phase 3 2D).
 */

export type PvHitFromImage = { readonly blockId: string; readonly panelId: string };

type LegacyHitFn = (img: { x: number; y: number }) => PvHitFromImage | null;

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
