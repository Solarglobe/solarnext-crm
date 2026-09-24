/**
 * CP-014 — Overlay Calpinage intégré au CRM (React)
 * Affiche le composant natif CalpinageApp (plus d'iframe) avec :
 * - persistance via API sur validation
 * - fermeture overlay et refresh study
 * - Rendu via React Portal dans document.body pour éviter clipping (overflow parent)
 *
 * Note: initCalpinage n'est pas appelé ici — il est géré par CalpinageApp (hasInitializedRef, retry).
 */

import React, { useEffect, useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBlocker, useNavigate } from "react-router-dom";
import { getCrmApiBaseWithWindowFallback } from "@/config/crmApiBase";
import { apiFetch } from "../services/api";
import CalpinageApp from "../modules/calpinage/CalpinageApp";
import { getCalpinageItem, setCalpinageItem } from "../modules/calpinage/calpinageStorage";
import { CalpinageSaveError, CalpinageSaveSession, type CalpinageGeometry } from "../modules/calpinage/calpinageSaveSession";
import type { CalpinageLoadState } from "../modules/calpinage/calpinageLoadPolicy";

const MAX_SNAPSHOT_WIDTH = 2200;

function calpinageTraceEnabled(): boolean {
  return typeof window !== "undefined" && (window as unknown as { __SN_CALPINAGE_TRACE__?: boolean }).__SN_CALPINAGE_TRACE__ === true;
}

function emitCalpinageTrace(event: string, payload: Record<string, unknown>) {
  if (!calpinageTraceEnabled()) return;
  const row = { ts: new Date().toISOString(), event, ...payload };
  console.warn("[SN-CALPINAGE-TRACE]", JSON.stringify(row));
  const w = window as unknown as { __SN_CALPINAGE_TRACE_LOG__?: unknown[] };
  w.__SN_CALPINAGE_TRACE_LOG__ = w.__SN_CALPINAGE_TRACE_LOG__ || [];
  w.__SN_CALPINAGE_TRACE_LOG__.push(row);
  if (w.__SN_CALPINAGE_TRACE_LOG__.length > 80) w.__SN_CALPINAGE_TRACE_LOG__.shift();
}

/**
 * Capture du canvas de dessin calpinage uniquement (pas Google Maps — évite canvas « tainted » / CORS).
 * Ordre : #calpinage-canvas-el, puis canvas sous #calpinage-render-root (hors carte).
 */
function createCompositeCalpinageCanvas(baseCanvas: HTMLCanvasElement): HTMLCanvasElement | null {
  const overlayCanvases = Array.from(
    document.querySelectorAll<HTMLCanvasElement>(".konvajs-content canvas")
  ).filter((canvas) => canvas !== baseCanvas && canvas.width > 0 && canvas.height > 0);

  if (overlayCanvases.length === 0) return null;

  const baseRect = baseCanvas.getBoundingClientRect();
  if (!baseRect.width || !baseRect.height || !baseCanvas.width || !baseCanvas.height) return null;

  const composite = document.createElement("canvas");
  composite.width = baseCanvas.width;
  composite.height = baseCanvas.height;
  const ctx = composite.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(baseCanvas, 0, 0);

  const scaleX = baseCanvas.width / baseRect.width;
  const scaleY = baseCanvas.height / baseRect.height;

  overlayCanvases.forEach((overlayCanvas) => {
    const rect = overlayCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (rect.left - baseRect.left) * scaleX;
    const y = (rect.top - baseRect.top) * scaleY;
    const w = rect.width * scaleX;
    const h = rect.height * scaleY;
    try {
      ctx.drawImage(overlayCanvas, x, y, w, h);
    } catch (e) {
      emitCalpinageTrace("capture_konva_overlay_draw_error", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  emitCalpinageTrace("capture_composite_canvas_created", {
    overlayCanvasCount: overlayCanvases.length,
    width: composite.width,
    height: composite.height,
  });
  return composite;
}

/**
 * VALIDATE-3D-FIX — Le snapshot PDF capture le canvas de dessin 2D (#calpinage-canvas-el).
 * En vue 3D ce canvas est masqué (display:none) → capture impossible, validation interrompue.
 * On rebascule donc en vue plan et on attend que le canvas soit réaffiché et dimensionné avant
 * la capture (réplique automatique du contournement manuel « repasser en vue plan »).
 */
async function ensurePlanViewForSnapshot(): Promise<void> {
  const w = window as unknown as {
    __CALPINAGE_VIEW_MODE__?: string;
    __calpinageSwitchTo2D?: () => void;
  };
  if (w.__CALPINAGE_VIEW_MODE__ !== "3D") return;
  if (typeof w.__calpinageSwitchTo2D !== "function") return;
  w.__calpinageSwitchTo2D();
  // Attendre (max ~30 frames) que le canvas 2D soit visible et dimensionné avant capture.
  for (let i = 0; i < 30; i++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const c = document.querySelector<HTMLCanvasElement>("#calpinage-canvas-el");
    if (!c) continue;
    const rect = c.getBoundingClientRect();
    if (c.width > 0 && c.height > 0 && rect.width > 0 && rect.height > 0) break;
  }
}

async function captureCalpinageSnapshot(): Promise<string | null> {
  emitCalpinageTrace("capture_called", {});
  const canvas =
    document.querySelector<HTMLCanvasElement>("#calpinage-canvas-el") ??
    document.querySelector<HTMLCanvasElement>("#calpinage-render-root canvas");

  if (typeof console !== "undefined") {
    console.log("[CALPINAGE SNAPSHOT]", {
      canvasFound: !!canvas,
      width: canvas?.width,
      height: canvas?.height,
    });
  }

  if (!canvas) {
    emitCalpinageTrace("capture_canvas_missing", {
      selectorTried: "#calpinage-canvas-el | #calpinage-render-root canvas",
    });
    console.error(
      "[CalpinageOverlay] CALPINAGE_SNAPSHOT_CANVAS_MISSING — canvas de dessin introuvable (#calpinage-canvas-el ou #calpinage-render-root canvas)"
    );
    return null;
  }
  if (canvas.width === 0 || canvas.height === 0) {
    emitCalpinageTrace("capture_canvas_invalid_dims", {
      width: canvas.width,
      height: canvas.height,
    });
    console.error("[CalpinageOverlay] CALPINAGE_SNAPSHOT_CANVAS_INVALID — largeur ou hauteur nulle", {
      width: canvas.width,
      height: canvas.height,
    });
    return null;
  }

  emitCalpinageTrace("capture_canvas_found", {
    width: canvas.width,
    height: canvas.height,
    id: canvas.id || null,
  });

  const captureCanvas = createCompositeCalpinageCanvas(canvas) ?? canvas;

  let snapshot: string;
  try {
    snapshot = captureCanvas.toDataURL("image/png");
    emitCalpinageTrace("capture_toDataURL_ok", {
      dataUrlChars: snapshot.length,
      head: snapshot.slice(0, 32),
      composite: captureCanvas !== canvas,
    });
  } catch (e) {
    emitCalpinageTrace("capture_toDataURL_error", {
      error: e instanceof Error ? e.message : String(e),
    });
    console.error("[CalpinageOverlay] CANVAS_TAINTED", e);
    return null;
  }

  if (captureCanvas.width > MAX_SNAPSHOT_WIDTH) {
    try {
      const ratio = MAX_SNAPSHOT_WIDTH / captureCanvas.width;
      const w = Math.round(captureCanvas.width * ratio);
      const h = Math.round(captureCanvas.height * ratio);
      const optimizedCanvas = document.createElement("canvas");
      optimizedCanvas.width = w;
      optimizedCanvas.height = h;
      const ctx = optimizedCanvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(captureCanvas, 0, 0, w, h);
        snapshot = optimizedCanvas.toDataURL("image/png");
        emitCalpinageTrace("capture_resized", { dataUrlChars: snapshot.length, w, h });
      }
    } catch (e) {
      emitCalpinageTrace("capture_resize_error", {
        error: e instanceof Error ? e.message : String(e),
      });
      console.error("[CalpinageOverlay] CANVAS_TAINTED", e);
      return null;
    }
  }

  return snapshot;
}

/** Shading valide pour le backend : vérité globale = combined.totalLossPct (prioritaire) ou miroir racine / normalized. Voir docs/shading-kpi-contract.md */
function isValidShading(sh: unknown): boolean {
  if (!sh || typeof sh !== "object") return false;
  const s = sh as Record<string, unknown>;
  const combined = s.combined as Record<string, unknown> | undefined;
  if (combined && typeof combined.totalLossPct === "number") return true;
  if (typeof s.totalLossPct === "number") return true;
  const normalized = s.normalized as Record<string, unknown> | undefined;
  if (normalized && typeof normalized === "object") {
    const nc = normalized.combined as Record<string, unknown> | undefined;
    if (nc && typeof nc.totalLossPct === "number") return true;
    if (typeof normalized.totalLossPct === "number") return true;
  }
  return false;
}

const API_BASE = getCrmApiBaseWithWindowFallback();

export interface CalpinageOverlayProps {
  studyId: string;
  versionId: string;
  /** UUID de la version (study_versions.id) pour l’API validate. Si absent, versionId (numéro) est envoyé. */
  studyVersionId?: string;
  geometryJson?: unknown;
  calpinageData?: unknown;
  onClose: () => void;
  onSaved: () => void;
}

function showToast(message: string, success = true) {
  const toast = document.createElement("div");
  toast.className = "calpinage-overlay-toast";
  toast.textContent = message;
  toast.setAttribute("role", "alert");
  toast.style.cssText = success
    ? "position:fixed;top:20px;right:20px;z-index:99999;padding:14px 20px;background:linear-gradient(135deg,#22c55e,#16a34a);color:rgb(255,255,255);border-radius:var(--sg-radius-md);font-weight:500;box-shadow:var(--sg-shadow-soft);"
    : "position:fixed;top:20px;right:20px;z-index:99999;padding:14px 20px;background:linear-gradient(135deg,#dc2626,#b91c1c);color:rgb(255,255,255);border-radius:var(--sg-radius-md);font-weight:500;box-shadow:var(--sg-shadow-soft);";
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

export default function CalpinageOverlay(props: CalpinageOverlayProps) {
  // A pending save retains its immutable identity when the route switches studies.
  return <CalpinageOverlaySession key={JSON.stringify([props.studyId, props.versionId])} {...props} />;
}

function CalpinageOverlaySession({
  studyId,
  versionId,
  studyVersionId,
  onClose,
  onSaved,
}: CalpinageOverlayProps) {
  const navigate = useNavigate();
  const isValidatingRef = useRef(false);
  const [validating, setValidating] = useState(false);
  const [hasActiveStudy, setHasActiveStudy] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const callbacks = useRef({ onClose, onSaved });
  callbacks.current = { onClose, onSaved };
  const mounted = useRef(true);
  const allowLeave = useRef(false);
  const [loadState, setLoadState] = useState<CalpinageLoadState | null>(null);
  const [exitWarning, setExitWarning] = useState(false);
  const [closing, setClosing] = useState(false);
  const [session] = useState(() => {
    const url = `${API_BASE}/api/studies/${encodeURIComponent(studyId)}/versions/${encodeURIComponent(versionId)}/calpinage`;
    return new CalpinageSaveSession({
      scope: { studyId, versionId },
      readLocal: () => {
        const raw = getCalpinageItem("state", studyId, versionId);
        return raw ? JSON.parse(raw) : null;
      },
      writeLocal: (geometry) => setCalpinageItem("state", studyId, versionId, JSON.stringify(geometry)),
      readServer: async () => {
        const response = await apiFetch(url, { skipErrorToast: true });
        if (response.status === 404) return { geometry: null, serverRevision: null };
        if (!response.ok) throw new CalpinageSaveError(`Lecture serveur échouée (${response.status}).`);
        const body = await response.json();
        const geometry = body.calpinageData?.geometry_json ?? null;
        if (geometry && typeof body.serverRevision !== "string") throw new CalpinageSaveError("Version serveur non vérifiable. Gardez le brouillon ouvert.");
        return { geometry, serverRevision: body.serverRevision ?? null };
      },
      post: async (geometry_json, expectedRevision) => {
        const response = await apiFetch(url, {
          method: "POST", skipErrorToast: true,
          body: JSON.stringify({ geometry_json, expectedRevision }),
        });
        const body = await response.json().catch(() => ({}));
        if (response.status === 409) throw new CalpinageSaveError(
          "Conflit : une autre version a été enregistrée sur le serveur. Votre brouillon est conservé. Exportez-le puis rechargez pour comparer les versions.", true,
        );
        if (!response.ok) throw new CalpinageSaveError(body.error || `Sauvegarde serveur échouée (${response.status}).`);
        return { geometry: body.calpinageData?.geometry_json ?? null, serverRevision: body.serverRevision ?? null };
      },
      onConfirmed: () => { if (mounted.current) callbacks.current.onSaved(); },
    });
  });
  const [saveState, setSaveState] = useState(session.getState);
  const blocker = useBlocker(useCallback(() => !allowLeave.current && (session.hasUnconfirmedChanges() || isValidatingRef.current), [session]));

  const handleDirty = useCallback((geometry: CalpinageGeometry) => {
    if (isValidatingRef.current) return;
    if (session.capture(geometry) && session.getState().revision > 0) setIsDirty(true);
  }, [session]);
  const handleLoadState = useCallback((event: CalpinageLoadState) => {
    if (event.scope.studyId !== studyId || String(event.scope.versionId) !== versionId) return;
    setLoadState(event);
    if (event.status === "ready") {
      session.adopt(event.geometry ?? null, event.source ?? "empty", event.serverRevision, event.serverAvailable);
      setIsDirty(event.source === "local");
    } else session.pause(event.status === "conflict");
  }, [session, studyId, versionId]);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = session.subscribe(setSaveState);
    const win = window as unknown as {
      CALPINAGE_STUDY_ID?: string; CALPINAGE_VERSION_ID?: string;
      notifyCalpinageDirty?: () => void;
      getCalpinageGeometryForPersist?: () => { geometry_json?: CalpinageGeometry } | null;
    };
    const dirty = () => {
      if (win.CALPINAGE_STUDY_ID !== studyId || String(win.CALPINAGE_VERSION_ID) !== versionId) return;
      const geometry = win.getCalpinageGeometryForPersist?.()?.geometry_json;
      if (geometry) handleDirty(geometry);
    };
    win.notifyCalpinageDirty = dirty;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!session.hasUnconfirmedChanges()) return;
      void session.flush(); // Best effort only; the browser may terminate this request.
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      mounted.current = false;
      unsubscribe();
      if (win.notifyCalpinageDirty === dirty) delete win.notifyCalpinageDirty;
      window.removeEventListener("beforeunload", beforeUnload);
      // Captured data and identity remain valid even after the global editor has changed.
      void session.flush();
    };
  }, [session, handleDirty, studyId, versionId]);

  useEffect(() => {
    if (blocker.state !== "blocked" || validating) return;
    let cancelled = false;
    setClosing(true);
    void session.flush().then((saved) => {
      if (cancelled || !mounted.current) return;
      setClosing(false);
      if (saved) blocker.proceed();
      else setExitWarning(true);
    });
    return () => { cancelled = true; };
  }, [blocker, session, validating]);

  useEffect(() => {
    if (saveState.server !== "confirmed" || saveState.confirmedRevision !== saveState.revision) return;
    setExitWarning(false);
    if (blocker.state === "blocked" && !validating) blocker.proceed();
  }, [saveState.server, saveState.confirmedRevision, saveState.revision, blocker, validating]);

  const requestClose = useCallback(async () => {
    if (isValidatingRef.current) return;
    setClosing(true);
    const saved = await session.flush();
    if (!mounted.current) return;
    setClosing(false);
    if (saved || (!session.hasUnconfirmedChanges() && loadState?.status !== "conflict")) {
      allowLeave.current = true;
      callbacks.current.onClose();
    } else setExitWarning(true);
  }, [session, loadState]);

  const downloadDraft = (geometry: unknown = session.getGeometry(), suffix = "brouillon") => {
    if (!geometry) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(geometry, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `calpinage-${studyId}-${versionId}-${suffix}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // has-active-study au mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(
          `${API_BASE}/api/studies/${encodeURIComponent(studyId)}/has-active-study`
        );
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as { hasActiveStudy?: boolean };
        if (!cancelled) setHasActiveStudy(!!data.hasActiveStudy);
      } catch {
        if (!cancelled) setHasActiveStudy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [studyId]);

  const saveToBackend = useCallback(
    async (geometry_json: unknown, opts?: { silent?: boolean }) => {
      if (!geometry_json || typeof geometry_json !== "object" || !session.capture(geometry_json as CalpinageGeometry)) {
        showToast("Données calpinage invalides", false);
        return false;
      }
      const saved = await session.flush();
      if (!saved) showToast(session.getState().error || "Sauvegarde serveur non confirmée", false);
      else if (!opts?.silent) showToast("Révision courante enregistrée sur le serveur");
      return saved;
    },
    [session]
  );

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  const handleValidate = useCallback(
    async (data: unknown) => {
      if (isValidatingRef.current || !session.getState().ready || session.getState().server === "conflict") return;
      isValidatingRef.current = true;
      setValidating(true);
      const btn = document.getElementById("btn-validate-calpinage");
      if (btn && "disabled" in btn) (btn as HTMLButtonElement).disabled = true;
      const debugValidate = typeof window !== "undefined" && !!(window as unknown as { CALPINAGE_VALIDATE_DEBUG?: boolean }).CALPINAGE_VALIDATE_DEBUG;

      try {
        if (debugValidate) {
          console.groupCollapsed("[VALIDATE] start (overlay)");
          console.log("data keys", data && typeof data === "object" ? Object.keys(data as object) : []);
          console.groupEnd();
        }
        const d = data as { geometry_json?: unknown; calpinage_data?: unknown };
        let geom = d?.geometry_json ?? d?.calpinage_data;
        if (!geom || typeof geom !== "object") {
          if (debugValidate) console.groupCollapsed("[VALIDATE] catch"); console.error("[VALIDATE] invalid data", typeof geom); if (debugValidate) console.groupEnd();
          showToast("Données calpinage invalides", false);
          return;
        }
        /* RÈGLE PRODUIT : pas de recalcul shading. On réutilise geom.shading ou CALPINAGE_STATE.shading.normalized ; sinon shading: null et on valide quand même. */
        const geomShading = (geom as Record<string, unknown>).shading;
        const stateNormalized =
          typeof window !== "undefined" && (window as unknown as { CALPINAGE_STATE?: { shading?: { normalized?: unknown } } }).CALPINAGE_STATE?.shading?.normalized;

        if (geomShading != null && isValidShading(geomShading)) {
          /* geom a déjà un shading valide */
        } else if (stateNormalized != null && isValidShading(stateNormalized)) {
          geom = { ...(geom as Record<string, unknown>), shading: stateNormalized };
        } else {
          geom = { ...(geom as Record<string, unknown>), shading: null };
        }

        /* 1. Sauvegarder calpinage (sans layout_snapshot — capturé côté frontend) */
        if (debugValidate) {
          console.groupCollapsed("[VALIDATE] saveToBackend start");
          console.log("URL", `${API_BASE}/api/studies/${encodeURIComponent(studyId)}/versions/${encodeURIComponent(versionId)}/calpinage`);
          console.groupEnd();
        }
        const ok = await saveToBackend(geom, { silent: true });
        if (!ok) {
          if (debugValidate) console.error("[VALIDATE] saveToBackend failed");
          return;
        }
        if (debugValidate) console.log("[VALIDATE] saveToBackend end (status 200/201)");

        /* 2. Capture canvas de dessin calpinage (pas la carte — requis pour le PDF) */
        // VALIDATE-3D-FIX : garantir la vue plan (canvas 2D visible) avant la capture snapshot.
        await ensurePlanViewForSnapshot();
        const layoutSnapshotBase64 = await captureCalpinageSnapshot();
        if (!layoutSnapshotBase64) {
          emitCalpinageTrace("validate_aborted_no_snapshot", { studyId, versionId });
          showToast(
            "Impossible de capturer le plan du calpinage pour le PDF. Attendez le chargement complet de l’affichage puis réessayez.",
            false
          );
          return;
        }

        /* 3. Appel validate endpoint */
        const body: {
          studyVersionId?: string;
          versionId?: number;
          layout_snapshot_base64?: string;
        } = studyVersionId
          ? { studyVersionId }
          : { versionId: typeof versionId === "string" ? parseInt(versionId, 10) : Number(versionId) };
        if (layoutSnapshotBase64) {
          body.layout_snapshot_base64 = layoutSnapshotBase64;
        }
        emitCalpinageTrace("validate_post_body", {
          studyId,
          studyVersionId: studyVersionId ?? null,
          versionId: body.versionId ?? null,
          hasLayoutSnapshotBase64: !!body.layout_snapshot_base64,
          layoutSnapshotBase64Chars: body.layout_snapshot_base64?.length ?? 0,
        });
        if (debugValidate) {
          console.groupCollapsed("[VALIDATE] validate endpoint start");
          console.log("URL", `${API_BASE}/api/studies/${encodeURIComponent(studyId)}/calpinage/validate`);
          console.groupEnd();
        }
        const res = await apiFetch(
          `${API_BASE}/api/studies/${encodeURIComponent(studyId)}/calpinage/validate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
        emitCalpinageTrace("validate_response", {
          studyId,
          httpStatus: res.status,
          ok: res.ok,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          const errMsg = (err as { error?: string }).error || `Erreur ${res.status}`;
          const code = (err as { code?: string }).code;
          if (typeof errMsg === "string" && errMsg.includes("ombrage") && typeof console !== "undefined") {
            console.log("[CALPINAGE_VALIDATE] validate refused (shading): geom.shading=", !!geomShading, "CALPINAGE_STATE.shading.normalized=", !!stateNormalized, "bodyHasShading=", !!(geom as Record<string, unknown>).shading);
          }
          if (debugValidate) console.error("[VALIDATE] validate endpoint status", res.status, errMsg);
          const userMsg =
            res.status === 503 || code === "SNAPSHOT_GENERATION_FAILED"
              ? "La validation a échoué lors de la génération de l'aperçu technique. Réessayez."
              : errMsg;
          throw new Error(userMsg);
        }
        if (debugValidate) console.log("[VALIDATE] validate endpoint end (status", res.status, ")");
        await res.json().catch(() => ({}));
        setIsDirty(false);
        setBannerDismissed(false);

        /* Redirection immédiate vers le devis (pas d’overlay / toast de succès) */
        const target = studyVersionId
          ? `/studies/${studyId}/versions/${studyVersionId}/quote-builder`
          : `/studies/${studyId}/quote-builder`;
        if (typeof console !== "undefined" && console.log) {
          console.log("[CALPINAGE] validated → redirect devis", { target });
        }
        if (debugValidate) console.log("[VALIDATE] redirect target", target);
        allowLeave.current = true;
        navigate(target);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erreur validation snapshot";
        if (typeof console !== "undefined" && console.error) {
          console.error("[CALPINAGE] validation failed", msg);
        }
        if (debugValidate) {
          console.groupCollapsed("[VALIDATE] catch");
          console.error("name", e instanceof Error ? e.name : "");
          console.error("message", msg);
          console.error("stack", e instanceof Error ? e.stack : "");
          console.groupEnd();
        }
        showToast(msg, false);
      } finally {
        isValidatingRef.current = false;
        if (mounted.current) setValidating(false);
        if (btn && "disabled" in btn) (btn as HTMLButtonElement).disabled = false;
        try {
          window.dispatchEvent(new Event("calpinage:validate-finished"));
        } catch {
          /* ignore */
        }
      }
    },
    [saveToBackend, session, studyId, versionId, studyVersionId, navigate]
  );

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isValidatingRef.current) return;
    if (e.target === e.currentTarget) {
      void requestClose();
    }
  };

  const portalRootRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  return createPortal(
    <div
      ref={portalRootRef}
      style={{
        position: "fixed",
        inset: 0,
        minHeight: "100vh", /* Fix overlay 50%: garantir hauteur viewport (parent body/html peut ne pas fournir height) */
        background: "rgba(0,0,0,0.85)",
        zIndex: 999999,
        display: "flex",
        flexDirection: "column",
      }}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
    >
      <style>{`
        .calpinage-overlay-wrapper { display: flex; flex-direction: column; height: 100%; min-height: 0; }
        .calpinage-overlay-wrapper > div { flex: 1; min-height: 0; display: flex; flex-direction: column; height: 100%; }
        .calpinage-overlay-wrapper #calpinage-root { flex: 1; min-height: 0; display: flex; flex-direction: column; height: 100%; }
        .calpinage-overlay-wrapper main.calpinage-root { min-height: 0 !important; }
        .calpinage-active-study-banner { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; background: #f59e0b; color: #1c1917; font-size: 13px; font-weight: 500; flex-shrink: 0; }
        .calpinage-active-study-banner button { background: none; border: none; cursor: pointer; padding: 4px; color: #1c1917; opacity: 0.8; line-height: 1; }
        .calpinage-active-study-banner button:hover { opacity: 1; }
        .calpinage-save-status, .calpinage-persistence-warning { flex: 0 0 auto !important; height: auto !important; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 10px 14px; color: #f8fafc; background: #172033; font-size: 13px; }
        .calpinage-persistence-warning { background: #713f12; }
        .calpinage-save-status button, .calpinage-persistence-warning button { padding: 6px 10px; border: 1px solid #94a3b8; border-radius: 5px; background: #1e293b; color: #fff; cursor: pointer; }
        .calpinage-save-status button:disabled, .calpinage-persistence-warning button:disabled { opacity: .5; cursor: wait; }
        .calpinage-editor-content { position: relative; }
      `}</style>
      <div
        ref={wrapperRef}
        className="calpinage-overlay-wrapper"
        style={{
          flex: 1,
          minHeight: 0,
          height: "100%",
          margin: "2.5vh 2.5vw",
          background: "#0e0e1a",
          borderRadius: "var(--sg-radius-lg)",
          overflow: "hidden",
          position: "relative",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <section className="calpinage-save-status" aria-label="État de sauvegarde du calpinage">
          <span role="status" aria-live="polite">
            Révision {saveState.revision} · Copie locale : {saveState.local === "saved" && saveState.localRevision === saveState.revision ? "enregistrée" : saveState.local === "failed" ? "échec — dernière copie conservée" : "non vérifiée"}
            {" · "}Serveur : {saveState.server === "confirmed" && saveState.confirmedRevision === saveState.revision
              ? "révision courante confirmée"
              : ({ loading: "chargement", idle: "aucune modification", pending: "en attente", saving: "enregistrement en cours", confirmed: "révision courante non confirmée", failed: "échec — non confirmé", conflict: "conflit — sauvegarde suspendue" }[saveState.server])}
          </span>
          <button type="button" disabled={!saveState.ready || validating || saveState.server === "conflict" || saveState.server === "saving"} onClick={() => { void session.flush(); }}>Réessayer la sauvegarde</button>
          <button type="button" disabled={!session.hasGeometry()} onClick={() => downloadDraft()}>Exporter le brouillon</button>
          <button type="button" disabled={closing || validating} onClick={() => { void requestClose(); }}>Fermer le calpinage</button>
        </section>
        {(saveState.local === "failed" || saveState.error) && (
          <section className="calpinage-persistence-warning" role="alert">
            {saveState.local === "failed" && <span>La copie locale de cette révision n’a pas pu être enregistrée (stockage plein ou indisponible). La dernière copie disponible n’a pas été supprimée.</span>}
            {saveState.error && <span>{saveState.error}</span>}
          </section>
        )}
        {loadState?.status === "conflict" && loadState.conflict && (
          <section className="calpinage-persistence-warning" role="alert">
            <span>{loadState.conflict.reason === "geometry-load-failed"
              ? "Le dessin n’a pas pu être restauré. La sauvegarde est suspendue pour préserver les copies. Exportez-les avant de quitter."
              : "Conflit entre le brouillon local et la version serveur. Les deux versions sont conservées ; choisissez celle à reprendre. Aucune fusion automatique."}</span>
            {loadState.conflict.reason === "unscoped-legacy-identity-unknown" && <span>Ce brouillon ancien ne précise pas son étude d’origine. Reprenez-le uniquement si vous reconnaissez le dessin de cette étude.</span>}
            {loadState.conflict.reason.endsWith("scope-mismatch") && <span>Une copie appartient à une autre étude ou version : sa reprise est désactivée.</span>}
            {loadState.conflict.reason === "local-json-unreadable" && <span>Le brouillon local est illisible. Ses données brutes restent disponibles dans l’export.</span>}
            <button type="button" onClick={() => downloadDraft(loadState.conflict, "conflit-deux-versions")}>Exporter les deux versions</button>
            <button type="button" disabled={!loadState.resolve || loadState.conflict.reason === "server-scope-mismatch"} onClick={() => loadState.resolve?.("server")}>Reprendre la version serveur</button>
            <button type="button" disabled={!loadState.resolve || !loadState.conflict.local || loadState.conflict.reason === "local-scope-mismatch"} onClick={() => loadState.resolve?.("local")}>Reprendre le brouillon local</button>
          </section>
        )}
        {exitWarning && (
          <section className="calpinage-persistence-warning" role="alert">
            <span>Les dernières modifications ne sont pas confirmées sur le serveur. {saveState.local === "failed" ? "La copie locale a aussi échoué : quitter peut les perdre. Exportez le brouillon avant de partir." : "Quitter maintenant laisse un brouillon local, sans garantie de synchronisation."}</span>
            <button type="button" onClick={() => { setExitWarning(false); if (blocker.state === "blocked") blocker.reset(); }}>Rester dans le calpinage</button>
            <button type="button" onClick={() => {
              allowLeave.current = true;
              if (blocker.state === "blocked") blocker.proceed();
              else callbacks.current.onClose();
            }}>Quitter sans confirmation serveur</button>
          </section>
        )}
        {hasActiveStudy && isDirty && !bannerDismissed && (
          <div className="calpinage-active-study-banner" role="alert">
            <span>⚠️ Une étude active existe. Toute modification nécessitera la création d'une nouvelle étude.</span>
            <button type="button" onClick={() => setBannerDismissed(true)} aria-label="Fermer">✕</button>
          </div>
        )}
        <div className="calpinage-editor-content"
          style={{ pointerEvents: !saveState.ready || validating || closing ? "none" : undefined }}
          onKeyDownCapture={(event) => { if (!saveState.ready || validating || closing) { event.preventDefault(); event.stopPropagation(); } }}
          aria-disabled={!saveState.ready || validating || closing}>
          <CalpinageApp
            studyId={studyId}
            versionId={versionId}
            onValidate={handleValidate}
            onDirty={handleDirty}
            onLoadState={handleLoadState}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
