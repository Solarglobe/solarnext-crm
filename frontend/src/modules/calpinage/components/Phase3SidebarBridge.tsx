/**
 * Phase3SidebarBridge — Monte Phase3Sidebar dans #p3-sidebar-react-mount.
 * Le mount point est dans zone-a-phase3 (affiché uniquement en Phase 3).
 */
import { createRoot } from "react-dom/client";
import { useEffect, useRef } from "react";
import { Phase3Sidebar } from "./Phase3Sidebar";

const MOUNT_ID = "p3-sidebar-react-mount";

export function Phase3SidebarBridge({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const rootRef = useRef<ReturnType<typeof createRoot> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const mount = container.querySelector("#" + MOUNT_ID) as HTMLElement | null;
    if (!mount || !mount.isConnected) return;

    if (!rootRef.current) {
      rootRef.current = createRoot(mount);
    }
    rootRef.current.render(<Phase3Sidebar containerRef={containerRef} />);

    return () => {
      rootRef.current?.render(null);
    };
  }, [containerRef]);

  return null;
}
