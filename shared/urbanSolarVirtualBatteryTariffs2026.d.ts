export interface UrbanSolarVirtualBatteryTariffs20260801 {
  provider: "URBAN_SOLAR";
  effectiveDate: string;
  sourceLabel: string;
  oneTimeSetupFeeTtc: number;
  storageSubscriptionEurPerKwcMonthHt: number;
  autoproducerContributionEurPerYearHt: number;
  supplierSubscriptionIncludesAutoproducerContribution: boolean;
  restitutionTtcPerKwh: {
    base: number;
    hp: number;
    hc: number;
  };
  electricityTtcPerKwh: {
    baseByKva: Record<number, number>;
    hp: number;
    hc: number;
  };
  supplierSubscriptionTtcPerMonth: {
    base: Record<number, number>;
    hphc: Record<number, number>;
  };
}

export const URBAN_SOLAR_VIRTUAL_BATTERY_TARIFFS_2026_08_01: UrbanSolarVirtualBatteryTariffs20260801;
export const URBAN_SOLAR_KVA_STEPS: readonly number[];
export function urbanSolarNearestKva(meterKva: number): number;

