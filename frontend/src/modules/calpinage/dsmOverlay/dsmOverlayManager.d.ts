export function createDsmOverlayManager(container: HTMLElement): DsmOverlayManager;
export function getDsmOverlayManager(): DsmOverlayManager | null;
export function resolveAnnualProductionKwhForShadingOverlay(totalPowerKwc: number): number | null;

interface DsmOverlayManager {
  enable(): void;
  disable(): void;
  toggle(): boolean;
  isEnabled(): boolean;
  destroy(): void;
}
