/**
 * Overlay plein écran DP — même mécanique que CalpinageOverlay (voile assombri, marges, rayon, portail).
 * Le panneau n’utilise pas le slate #0e0e1a du calpinage : le DP suit le fond « papier » de dp-tool/style.css
 * (comme en standalone), sinon l’embed paraît « tout noir » alors que le calpinage montre surtout la carte.
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  loadDpTool,
  type DpToolHostContext,
  type DpToolLoaderHandle,
} from "../modules/dp/dpToolLoader";

export interface DpOverlayProps {
  /** Si faux, rien n’est monté (pas de portail). */
  isOpen: boolean;
  onClose: () => void;
  /** Données GET /api/leads/:id/dp ou équivalent pour le runtime DP. */
  hostPayload: DpToolHostContext;
  storageKey: string;
  apiBase?: string;
  assetBaseUrl?: string;
}

type LoadPhase = "idle" | "loading" | "ready" | "error";

/** Identique à `body` dans frontend/dp-tool/style.css — cohérent avec l’outil DP hors CRM. */
const DP_PAPER_BG = `radial-gradient(
  circle at top left,
  #fbf7ee 0%,
  #f3efe5 32%,
  #f4f1e9 55%,
  #f0ece2 100%
)`;

/** Gabarit panneau = CalpinageOverlay (marges, rayon) ; fond = papier DP, pas slate carte. */
const PANEL_STYLE: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  height: "100%",
  margin: "2.5vh 2.5vw",
  background: DP_PAPER_BG,
  borderRadius: "var(--sg-radius-lg)",
  overflow: "hidden",
  position: "relative",
  display: "flex",
  flexDirection: "column",
  boxShadow: "var(--sg-shadow-soft, 0 6px 16px rgba(0,0,0,0.06))",
};

export default function DpOverlay({
  isOpen,
  onClose,
  hostPayload,
  storageKey,
  apiBase,
  assetBaseUrl,
}: DpOverlayProps) {
  const dpMountRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<LoadPhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setPhase("idle");
      setErrorMessage(null);
      return;
    }

    const el = dpMountRef.current;
    if (!el) return;

    let dead = false;
    let handle: DpToolLoaderHandle | null = null;

    setPhase("loading");
    setErrorMessage(null);

    void (async () => {
      try {
        const h = await loadDpTool({
          container: el,
          hostPayload,
          storageKey,
          apiBase,
          assetBaseUrl,
        });
        if (dead) {
          h.destroy();
          return;
        }
        handle = h;
        setPhase("ready");
      } catch (e) {
        if (dead) return;
        const msg =
          e instanceof Error ? e.message : "Impossible de charger le dossier DP.";
        setErrorMessage(msg);
        setPhase("error");
      }
    })();

    return () => {
      dead = true;
      if (handle) {
        try {
          handle.destroy();
        } catch {
          /* ignore */
        }
        handle = null;
      }
    };
  }, [isOpen, hostPayload, storageKey, apiBase, assetBaseUrl]);

  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  const handleCloseClick = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <div
      className="dp-overlay-root"
      style={{
        position: "fixed",
        inset: 0,
        minHeight: "100vh",
        background: "rgba(0, 0, 0, 0.85)",
        zIndex: 999999,
        display: "flex",
        flexDirection: "column",
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dp-overlay-title"
      onClick={handleBackdropClick}
    >
      <style>{`
        .dp-overlay-wrapper { display: flex; flex-direction: column; height: 100%; min-height: 0; }
        .dp-overlay-wrapper > .dp-overlay-stack { flex: 1; min-height: 0; display: flex; flex-direction: column; height: 100%; }
        #dp-tool-root.dp-tool-embed-root { min-height: 0 !important; flex: 1; }
        .dp-overlay-mount { flex: 1; min-height: 0; overflow: auto; position: relative; z-index: 0; }
        .dp-overlay-chrome button:hover { background: rgba(0, 0, 0, 0.06); }
      `}</style>

      <div
        className="dp-overlay-wrapper"
        style={PANEL_STYLE}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="dp-overlay-stack"
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            height: "100%",
          }}
        >
          <div
            className="dp-overlay-chrome"
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "10px 14px",
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(255,255,255,0.88))",
              backdropFilter: "blur(14px)",
              borderBottom: "1px solid #e4ddcc",
              color: "#1f2937",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            <span id="dp-overlay-title">Dossier DP — déclaration préalable</span>
            <button
              type="button"
              onClick={handleCloseClick}
              aria-label="Fermer le dossier DP"
              style={{
                background: "transparent",
                border: "none",
                color: "#374151",
                cursor: "pointer",
                padding: "6px 10px",
                borderRadius: 8,
                fontSize: 18,
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>

          <div
            className="dp-overlay-content-wrap"
            style={{
              flex: 1,
              minHeight: 0,
              position: "relative",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {(phase === "loading" || phase === "error") && (
              <div
                className="dp-overlay-status"
                role="status"
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "column",
                  gap: 8,
                  padding: 24,
                  background: "rgba(255, 255, 255, 0.94)",
                  color: "#1f2937",
                  fontSize: 14,
                  textAlign: "center",
                  zIndex: 2,
                }}
              >
                {phase === "loading" && <p>Chargement du dossier DP…</p>}
                {phase === "error" && (
                  <>
                    <p>{errorMessage ?? "Erreur de chargement."}</p>
                    <button
                      type="button"
                      className="sn-btn sn-btn-primary"
                      onClick={handleCloseClick}
                    >
                      Fermer
                    </button>
                  </>
                )}
              </div>
            )}

            <div
              ref={dpMountRef}
              className="dp-overlay-mount"
              aria-busy={phase === "loading"}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
