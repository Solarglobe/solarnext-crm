export function validateInverterSizing(opts: {
  totalPanels?: number;
  totalPowerKwc?: number;
  inverter?: any;
  panelSpec?: { power_wc?: number; isc_a?: number; vmp_v?: number; strings?: number[] } | null;
}): {
  requiredUnits: number;
  isDcPowerOk: boolean;
  isCurrentOk: boolean;
  isMpptOk: boolean;
  isVoltageOk: boolean;
  warnings: string[];
};
