/**
 * ViewModel PDF legacy : clone + enrichissement léger P8 (capacité batterie figée
 * dans selected_scenario_snapshot.equipment.batterie — issue du même scenarios_v2 au moment du snapshot).
 */
export function buildLegacyPdfViewModel(ctx: unknown): Record<string, unknown> {
  const vm = ctx as Record<string, unknown>;
  if (!vm?.fullReport) {
    throw new Error(
      "PDF VIEW MODEL INVALID — fullReport missing. Backend mapper must be used."
    );
  }
  const fullReport = { ...(vm.fullReport as Record<string, unknown>) };
  const origP8 = fullReport.p8 as Record<string, unknown> | undefined;
  if (origP8) {
    const snap = vm.selected_scenario_snapshot as Record<string, unknown> | undefined;
    const batterie = (snap?.equipment as Record<string, unknown> | undefined)?.batterie as
      | Record<string, unknown>
      | undefined;
    const cap = batterie?.capacite_kwh;
    fullReport.p8 = {
      ...origP8,
      snapshotBatteryCapacityKwh: cap != null && Number.isFinite(Number(cap)) ? Number(cap) : null,
    };
  }
  return { ...vm, fullReport };
}
