/** Types de sortie bundle roofModel v1 (synthèse énergie / BOM / PDF). */
export type RoofOutputsBundleV1 = Readonly<{
  energy: {
    totalPowerKwc: number;
    panelCount: number;
    annualProductionKwhAc: number | null;
    specificYieldKwhPerKwc: number | null;
    totalLossPct: number | null;
    source: string;
  };
  bom: {
    totalRailLinearM: number;
    railStockPiecesOf5m8: number;
    items: ReadonlyArray<{ code: string; label: string; quantity: number; unit: string }>;
    assumptions: string[];
  };
  pdf: {
    title: string;
    subtitle?: string | null;
    view3dImageDataUrl?: string | null;
  };
  updatedAtIso: string;
}>;

export type Any = any;
