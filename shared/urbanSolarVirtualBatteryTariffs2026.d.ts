export interface UrbanSolarVirtualBatteryTariffs20260801 {
  id: string;
  provider: "URBAN_SOLAR";
  effectiveDate: string;
  verifiedAt: string;
  sourceUrls: {hphc:string;base:string};
  restitutionHttPerKwh: {base:number;hp:number;hc:number};
  restitutionTaxTreatment: {invoicePriceBasis:string;ceeHtPerKwh:number;ceeEffectiveDate:string;includesCee:boolean;includesTicfe:boolean;includesVat:boolean;extraCeeChargeTtcPerKwh:number;sourceNote:string};
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
export const URBAN_SOLAR_TARIFF_EDITIONS: readonly UrbanSolarVirtualBatteryTariffs20260801[];
export function urbanSolarTariffReferenceDate(value?: string | null, now?: Date): string;
export function resolveUrbanSolarTariffsForDate(referenceDate?: string | null, editions?: readonly UrbanSolarVirtualBatteryTariffs20260801[]): UrbanSolarVirtualBatteryTariffs20260801 | null;
