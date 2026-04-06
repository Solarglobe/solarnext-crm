/**
 * Phase2SidebarBridge — Monte Phase2Sidebar dans #p2-sidebar-react-mount.
 * Le mount point est dans zone-a-phase2 (affiché uniquement en Phase 2).
 */
import { createRoot } from "react-dom/client";
import { useEffect, useRef } from "react";
import Phase2Sidebar from "./Phase2Sidebar";

const MOUNT_ID = "p2-sidebar-react-mount";

export function Phase2SidebarBridge({
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
    rootRef.current.render(<Phase2Sidebar />);

    return () => {
      rootRef.current?.render(null);
    };
  }, [containerRef]);

  return null;
}
