/**
 * Phase3ChecklistBridge — Monte Phase3ChecklistPanel dans le placeholder legacy.
 * Lecture seule via window.getPhase3ChecklistData.
 */

import { createRoot } from "react-dom/client";
import { useEffect, useRef } from "react";
import { Phase3ChecklistPanel } from "./Phase3ChecklistPanel";
import { usePhase3ChecklistData } from "./hooks/usePhase3ChecklistData";

const MOUNT_ID = "phase3-checklist-mount";

export { usePhase3ChecklistData } from "./hooks/usePhase3ChecklistData";

export function Phase3ChecklistBridge({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }) {
  const rootRef = useRef<ReturnType<typeof createRoot> | null>(null);
  const { data, catalogModuleSelected } = usePhase3ChecklistData();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const mount = container.querySelector("#" + MOUNT_ID) as HTMLElement | null;
    if (!mount || !mount.isConnected) return;

    if (!rootRef.current) {
      rootRef.current = createRoot(mount);
    }
    const root = rootRef.current;
    if (data) {
      root.render(
        <Phase3ChecklistPanel
          panelCount={data.panelCount}
          totalDcKw={data.totalDcKw}
          selectedInverter={data.selectedInverter}
          inverterFamily={data.inverterFamily}
          catalogModuleSelected={catalogModuleSelected}
        />
      );
    } else {
      root.render(null);
    }

    return () => {
      root.render(null);
    };
  }, [containerRef, data]);

  return null;
}
