/**
 * Page de rendu calpinage pour capture Playwright.
 * URL : /calpinage-render?studyId=...&versionId=...&renderToken=...
 * Affiche uniquement le plan (map + calpinage). Expose #calpinage-render-ready quand prêt.
 * La page pré-charge les données via l'API interne et les stocke en localStorage.
 * Le moteur calpinage reste pur (aucune logique de capture).
 */

import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import CalpinageApp from "./modules/calpinage/CalpinageApp";
import { setCalpinageItem } from "./modules/calpinage/calpinageStorage";

const API_BASE = import.meta.env?.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

function logRender(msg: string) {
  if (typeof console !== "undefined") console.log("[CALPINAGE_RENDER]", msg);
}

function CalpinageRenderPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const mapReadyRef = useRef(false);
  const overlaysReadyRef = useRef(false);
  const readySetRef = useRef(false);

  useEffect(() => {
    logRender("RENDER_PAGE_MOUNTED");
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const studyId = params.get("studyId") || "";
    const versionId = params.get("versionId") || "";
    const renderToken = params.get("renderToken") || "";

    if (!studyId || !versionId || !renderToken) {
      setError("Paramètres manquants (studyId, versionId, renderToken)");
      return;
    }

    (window as unknown as { CALPINAGE_API_BASE?: string }).CALPINAGE_API_BASE = API_BASE;

    const url = `${API_BASE}/api/internal/calpinage-render-data/${encodeURIComponent(studyId)}/${encodeURIComponent(versionId)}?renderToken=${encodeURIComponent(renderToken)}`;

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`API ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (json?.ok && json?.calpinageData?.geometry_json) {
          setCalpinageItem("state", studyId, versionId, JSON.stringify(json.calpinageData.geometry_json));
          setDataLoaded(true);
        } else {
          setError("Données calpinage invalides");
        }
      })
      .catch((e) => {
        setError(e?.message || "Erreur chargement calpinage");
      });
  }, []);

  useEffect(() => {
    if (error || !dataLoaded) return;

    const checkAndSetReady = () => {
      if (readySetRef.current) return;

      const mapContainer = document.querySelector("#map-container") as HTMLElement | null;
      const canvasEl = document.querySelector("#calpinage-canvas-el") as HTMLCanvasElement | null;
      const calpinageMap = (window as unknown as { calpinageMap?: unknown }).calpinageMap;

      const rect = mapContainer?.getBoundingClientRect();
      const mapVisible =
        !!mapContainer &&
        !!rect &&
        rect.width > 100 &&
        rect.height > 100;

      if (mapVisible && calpinageMap && !mapReadyRef.current) {
        mapReadyRef.current = true;
        logRender("RENDER_MAP_READY");
      }

      const overlaysVisible =
        (!!canvasEl && canvasEl.width > 0 && canvasEl.height > 0) ||
        (mapReadyRef.current && !canvasEl);

      if (overlaysVisible && !overlaysReadyRef.current) {
        overlaysReadyRef.current = true;
        logRender("RENDER_OVERLAYS_READY");
      }

      if (mapReadyRef.current && overlaysReadyRef.current) {
        setReady(true);
      }
    };

    const interval = setInterval(checkAndSetReady, 150);
    const timeout = setTimeout(() => {
      clearInterval(interval);
      if (!readySetRef.current && mapReadyRef.current) {
        setReady(true);
      }
    }, 20000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [error, dataLoaded]);

  useEffect(() => {
    if (!ready || readySetRef.current) return;
    readySetRef.current = true;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        let el = document.getElementById("calpinage-render-ready");
        if (!el) {
          el = document.createElement("div");
          el.id = "calpinage-render-ready";
          document.body.appendChild(el);
        }
        el.setAttribute("data-status", "ready");
        logRender("RENDER_READY_SET");
      });
    });
  }, [ready]);

  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const studyId = params?.get("studyId") || "";
  const versionId = params?.get("versionId") || "";

  if (error) {
    return (
      <div style={{ padding: 20, color: "#ef4444" }}>
        {error}
      </div>
    );
  }

  if (!dataLoaded) {
    return (
      <div style={{ padding: 20, color: "#64748b" }}>
        Chargement du calpinage…
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }}>
      <CalpinageApp studyId={studyId} versionId={versionId} />
    </div>
  );
}

const rootEl = document.getElementById("calpinage-render-root");
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(
    <React.StrictMode>
      <CalpinageRenderPage />
    </React.StrictMode>
  );
}
