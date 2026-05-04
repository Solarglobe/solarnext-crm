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
import { useNavigate } from "react-router-dom";
import { getCrmApiBaseWithWindowFallback } from "@/config/crmApiBase";
import { apiFetch } from "../services/api";
import CalpinageApp from "../modules/calpinage/CalpinageApp";
import { setCalpinageItem } from "../modules/calpinage/calpinageStorage";

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

  let snapshot: string;
  try {
    snapshot = canvas.toDataURL("image/png");
    emitCalpinageTrace("capture_toDataURL_ok", {
      dataUrlChars: snapshot.length,
      head: snapshot.slice(0, 32),
    });
  } catch (e) {
    emitCalpinageTrace("capture_toDataURL_error", {
      error: e instanceof Error ? e.message : String(e),
    });
    console.error("[CalpinageOverlay] CANVAS_TAINTED", e);
    return null;
  }

  if (canvas.width > MAX_SNAPSHOT_WIDTH) {
    try {
      const ratio = MAX_SNAPSHOT_WIDTH / canvas.width;
      const w = Math.round(canvas.width * ratio);
      const h = Math.round(canvas.height * ratio);
      const optimizedCanvas = document.createElement("canvas");
      optimizedCanvas.width = w;
      optimizedCanvas.height = h;
      const ctx = optimizedCanvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(canvas, 0, 0, w, h);
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

export default function CalpinageOverlay({
  studyId,
  versionId,
  studyVersionId,
  onClose,
  onSaved,
}: CalpinageOverlayProps) {
  const navigate = useNavigate();
  const isValidatingRef = useRef(false);
  const [hasActiveStudy, setHasActiveStudy] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

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

  /** Brouillon → API (silencieux) + localStorage ; déclenché en debounce sur notifyCalpinageDirty (CFIX-2). */
  const persistDraftQuiet = useCallback(async () => {
    const win = window as unknown as {
      getCalpinageGeometryForPersist?: () => { geometry_json?: unknown } | null;
    };
    if (typeof win.getCalpinageGeometryForPersist !== "function") return;
    const pack = win.getCalpinageGeometryForPersist();
    const geometry_json = pack?.geometry_json;
    if (!geometry_json || typeof geometry_json !== "object") return;
    try {
      const res = await apiFetch(
        `${API_BASE}/api/studies/${encodeURIComponent(studyId)}/versions/${encodeURIComponent(versionId)}/calpinage`,
        { method: "POST", body: JSON.stringify({ geometry_json }) }
      );
      if (res.ok) {
        try {
          setCalpinageItem("state", studyId, versionId, JSON.stringify(geometry_json));
        } catch {
          /* ignore */
        }
        onSaved();
      }
    } catch {
      /* autosave brouillon — pas de toast */
    }
  }, [studyId, versionId, onSaved]);

  // Dirty + autosave debounced (legacy appelle notifyCalpinageDirty)
  useEffect(() => {
    let debounceId: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    (window as unknown as { notifyCalpinageDirty?: () => void }).notifyCalpinageDirty = () => {
      setIsDirty(true);
      if (debounceId) clearTimeout(debounceId);
      debounceId = setTimeout(() => {
        if (cancelled) return;
        void persistDraftQuiet();
      }, 3500);
    };
    return () => {
      cancelled = true;
      if (debounceId) clearTimeout(debounceId);
      delete (window as unknown as { notifyCalpinageDirty?: () => void }).notifyCalpinageDirty;
    };
  }, [persistDraftQuiet]);

  const saveToBackend = useCallback(
    async (geometry_json: unknown, opts?: { silent?: boolean }) => {
      if (!geometry_json || typeof geometry_json !== "object") {
        showToast("Données calpinage invalides", false);
        return false;
      }
      try {
        const res = await apiFetch(
          `${API_BASE}/api/studies/${encodeURIComponent(studyId)}/versions/${encodeURIComponent(versionId)}/calpinage`,
          {
            method: "POST",
            body: JSON.stringify({ geometry_json }),
          }
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
        }
        if (!opts?.silent) {
          showToast("Calpinage enregistré");
        }
        /* CP-004 — Cache localStorage scopé via helper centralisé */
        try {
          setCalpinageItem("state", studyId, versionId, JSON.stringify(geometry_json));
        } catch {
          /* ignore */
        }
        onSaved();
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erreur sauvegarde";
        showToast(msg, false);
        return false;
      }
    },
    [studyId, versionId, onSaved]
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
      if (isValidatingRef.current) return;
      isValidatingRef.current = true;
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
        if (btn && "disabled" in btn) (btn as HTMLButtonElement).disabled = false;
        try {
          window.dispatchEvent(new Event("calpinage:validate-finished"));
        } catch {
          /* ignore */
        }
      }
    },
    [saveToBackend, studyId, versionId, studyVersionId, navigate]
  );

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isValidatingRef.current) return;
    if (e.target === e.currentTarget) {
      onClose();
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
        {hasActiveStudy && isDirty && !bannerDismissed && (
          <div className="calpinage-active-study-banner" role="alert">
            <span>⚠️ Une étude active existe. Toute modification nécessitera la création d'une nouvelle étude.</span>
            <button type="button" onClick={() => setBannerDismissed(true)} aria-label="Fermer">✕</button>
          </div>
        )}
        <CalpinageApp
          studyId={studyId}
          versionId={versionId}
          onValidate={handleValidate}
        />
      </div>
    </div>,
    document.body
  );
}
