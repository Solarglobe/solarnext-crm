/**
 * Résolution capacité kWh pour simulation BATTERY_VIRTUAL (fournisseurs P2),
 * avant toute décision « unbounded » en étude commerciale.
 */

import { resolveVirtualBatteryCapacityKwh } from "./virtualBattery8760.service.js";
import {
  vbHasExploitableProviderGrid,
  vbSelectMySmartTierFromGrid,
} from "./pv/virtualBatteryGridResolve.service.js";

/**
 * @typedef {"contractual_input"|"physical_battery_fallback"|"provider_grid_tier"|"provider_grid_tier_capped_at_max"} VbP2CapacitySource
 */

/**
 * @param {{
 *   vbInput: object,
 *   ctx: object,
 *   providerCodeUpper: string,
 *   requiredCapacityKwhFromUnbounded: number,
 *   allowPhysicalBatteryFallback?: boolean,
 * }} p
 * @returns {{ capacity_kwh: number|null, source: VbP2CapacitySource|null }}
 */
export function resolveP2VirtualBatterySimulationCapacityKwh({
  vbInput,
  ctx,
  providerCodeUpper,
  requiredCapacityKwhFromUnbounded,
  allowPhysicalBatteryFallback = true,
}) {
  const capInput = resolveVirtualBatteryCapacityKwh(vbInput);
  if (capInput != null) {
    return { capacity_kwh: capInput, source: "contractual_input" };
  }

  if (allowPhysicalBatteryFallback) {
    const phys =
      ctx?.battery_input?.enabled === true && ctx.battery_input?.capacity_kwh != null
        ? Number(ctx.battery_input.capacity_kwh)
        : null;
    if (phys != null && phys > 0) {
      return { capacity_kwh: phys, source: "physical_battery_fallback" };
    }
  }

  const pc = String(providerCodeUpper || "").toUpperCase();
  if (pc === "MYLIGHT_MYSMARTBATTERY") {
    const grids = ctx?.settings?.pv?.virtual_battery;
    if (vbHasExploitableProviderGrid(grids)) {
      const pcGrid = grids.providers?.[pc];
      if (pcGrid && Array.isArray(pcGrid.capacityTiers) && pcGrid.capacityTiers.length > 0) {
        const req = Number(requiredCapacityKwhFromUnbounded);
        const tg = vbSelectMySmartTierFromGrid(pcGrid, req);
        if (tg.ok && tg.selected_capacity_kwh != null) {
          return { capacity_kwh: tg.selected_capacity_kwh, source: "provider_grid_tier" };
        }
        if (
          tg?.reason === "MISSING_PROVIDER_TIER_FOR_REQUIRED_CAPACITY" &&
          tg.max_tier_kwh != null &&
          Number(tg.max_tier_kwh) > 0
        ) {
          return {
            capacity_kwh: Number(tg.max_tier_kwh),
            source: "provider_grid_tier_capped_at_max",
          };
        }
      }
    }
  }

  return { capacity_kwh: null, source: null };
}
