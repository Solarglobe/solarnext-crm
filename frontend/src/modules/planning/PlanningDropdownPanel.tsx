/**
 * LOT C — Panneau dropdown en portail (fixed), aligné sur l’ancre.
 * Au-dessus du contenu ModalShell (1000), sous les pickers MUI planning (1300).
 */

import React, {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import "./planning-dropdown-panel.css";

export const PLANNING_DROPDOWN_Z_INDEX = 1200;

type Placement = "below" | "above";

function computePlacement(el: HTMLElement): {
  placement: Placement;
  maxHeight: number;
} {
  const r = el.getBoundingClientRect();
  const spaceBelow = window.innerHeight - r.bottom - 8;
  const spaceAbove = r.top - 8;
  const preferBelow = spaceBelow >= 160 || spaceBelow >= spaceAbove;
  const maxH = preferBelow
    ? Math.min(320, Math.max(80, spaceBelow))
    : Math.min(320, Math.max(80, spaceAbove));
  return { placement: preferBelow ? "below" : "above", maxHeight: maxH };
}

export interface PlanningDropdownPanelProps {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onRequestClose: () => void;
  children: React.ReactNode;
  closeOnEscape?: boolean;
}

const PlanningDropdownPanel = forwardRef<HTMLDivElement, PlanningDropdownPanelProps>(
  function PlanningDropdownPanel(
    { open, anchorRef, onRequestClose, children, closeOnEscape = true },
    forwardedRef,
  ) {
    const [box, setBox] = useState<{
      left: number;
      width: number;
      maxHeight: number;
      top?: number;
      bottom?: number;
    } | null>(null);

    useLayoutEffect(() => {
      if (!open) {
        setBox(null);
        return;
      }
      const el = anchorRef.current;
      if (!el) {
        setBox(null);
        return;
      }
      const run = () => {
        const anchor = anchorRef.current;
        if (!anchor) return;
        const r = anchor.getBoundingClientRect();
        const { placement, maxHeight } = computePlacement(anchor);
        if (placement === "below") {
          setBox({
            left: r.left,
            width: r.width,
            maxHeight,
            top: r.bottom + 4,
          });
        } else {
          setBox({
            left: r.left,
            width: r.width,
            maxHeight,
            bottom: window.innerHeight - r.top + 4,
          });
        }
      };
      run();
      const opts = { capture: true } as const;
      window.addEventListener("scroll", run, opts);
      window.addEventListener("resize", run);

      const cleanups: (() => void)[] = [];
      let node: HTMLElement | null = anchorRef.current;
      while (node) {
        const el = node;
        node.addEventListener("scroll", run, opts);
        cleanups.push(() => el.removeEventListener("scroll", run, opts));
        node = node.parentElement;
      }

      return () => {
        window.removeEventListener("scroll", run, opts);
        window.removeEventListener("resize", run);
        cleanups.forEach((fn) => fn());
      };
    }, [open, anchorRef]);

    useEffect(() => {
      if (!open || !closeOnEscape) return;
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onRequestClose();
        }
      };
      window.addEventListener("keydown", onKey, true);
      return () => window.removeEventListener("keydown", onKey, true);
    }, [open, closeOnEscape, onRequestClose]);

    if (!open || !box) return null;

    const style: React.CSSProperties = {
      position: "fixed",
      left: box.left,
      width: box.width,
      maxHeight: box.maxHeight,
      zIndex: PLANNING_DROPDOWN_Z_INDEX,
      ...(box.top !== undefined ? { top: box.top } : {}),
      ...(box.bottom !== undefined ? { bottom: box.bottom } : {}),
    };

    return createPortal(
      <div
        ref={forwardedRef}
        className="planning-dropdown-panel"
        style={style}
        role="presentation"
        data-planning-dropdown-panel=""
      >
        {children}
      </div>,
      document.body,
    );
  },
);

export default PlanningDropdownPanel;
