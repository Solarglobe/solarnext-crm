/** Display-only rounding: never feed these amounts back into the simulation. */
export function electricityBillDisplay(billing, digits = 2) {
  if (!billing) return null;
  const factor = 10 ** digits;
  const round = value => value == null || !Number.isFinite(Number(value)) ? null : Math.round((Number(value) + Number.EPSILON) * factor) / factor;
  const before = round(billing.bill_before_eur);
  const after = round(billing.bill_after_eur);
  return { ...billing, bill_before_eur: before, bill_after_eur: after,
    bill_savings_eur: before == null || after == null ? null : round(before - after) };
}
