/**
 * CP-DSM-016 — Bridge DSM Overlay
 * Ajoute le bouton « Analyse d’ombrage » dans la topbar Phase 3 et gère l'overlay.
 */

import { useEffect, useRef, useState } from "react";
import { createDsmOverlayManager, getDsmOverlayManager } from "../dsmOverlay";
import "../dsmOverlay/dsmOverlay.css";

const SATELLITE_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';

export function DsmOverlayBridge({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const topbar = container.querySelector("#p3-topbar");
    if (!topbar) return;

    let btn = topbar.querySelector(".dsm-analyse-btn") as HTMLButtonElement | null;
    if (!btn) {
      const scrollWrap = topbar.querySelector(".calpinage-toolbar-scroll");
      const target = scrollWrap || topbar;
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "p3-pill-btn dsm-analyse-btn";
      btn.setAttribute("aria-label", "Analyse d’ombrage — visualisation et lecture des estimations");
      btn.title =
        "Visualisation DSM : masque d’horizon, pertes modélisées et synthèse (estimations, pas mesure sur site).";
      btn.innerHTML = `<span class="sg-icon-wrapper" aria-hidden="true">${SATELLITE_ICON}</span><span class="p3-pill-label">Analyse d’ombrage</span>`;
      target.appendChild(btn);
    }

    const manager = createDsmOverlayManager(container);

    const handleClick = () => {
      manager.toggle();
      setActive(manager.isEnabled());
      btn?.classList.toggle("active", manager.isEnabled());
    };

    btn.addEventListener("click", handleClick);
    buttonRef.current = btn;

    return () => {
      btn?.removeEventListener("click", handleClick);
      const m = getDsmOverlayManager();
      if (m?.isEnabled()) m.disable();
    };
  }, [containerRef]);

  return null;
}
