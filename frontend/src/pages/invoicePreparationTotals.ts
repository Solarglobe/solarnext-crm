/**
 * Totaux « préparation facture » : priorité aux montants snapshot backend (ligne),
 * recalcul uniquement après édition ou si snapshot incomplet.
 */

export type PreparedInvoiceTotalsSource = "snapshot" | "computed";

function debugInvoicePrep(message: string, payload: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return;
  if (import.meta.env.VITEST) return;
  console.log(`[invoicePrep] ${message}`, payload);
}

export type PreparedInvoiceLine = {
  id: string;
  label: string;
  description: string;
  quantity: number;
  unit_price_ht: number;
  discount_percent: number;
  vat_rate: number;
  discount_ht: number;
  line_kind: string | null;
  /** Montants figés issus du view-model / snapshot devis */
  total_line_ht?: number;
  total_line_vat?: number;
  total_line_ttc?: number;
  totalsSource: PreparedInvoiceTotalsSource;
};

export function roundMoney2(n: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function snapshotTotalsComplete(line: PreparedInvoiceLine): boolean {
  const ht = Number(line.total_line_ht);
  const vat = Number(line.total_line_vat);
  const ttc = Number(line.total_line_ttc);
  return Number.isFinite(ht) && Number.isFinite(vat) && Number.isFinite(ttc);
}

/** Recalcul métier (qty, PU, remise % ou discount_ht) — source de vérité si le snapshot HT est incohérent. */
function computeArithmeticMoneyTotals(line: PreparedInvoiceLine): {
  baseHt: number;
  discountHt: number;
  totalHt: number;
  totalVat: number;
  totalTtc: number;
} {
  const rawBase = roundMoney2(Number(line.quantity) * Number(line.unit_price_ht));
  const dhStored = roundMoney2(Number(line.discount_ht ?? 0));
  const pct = Math.min(100, Math.max(0, Number(line.discount_percent) || 0));
  let totalHt: number;
  let discountHtOut: number;
  if (pct > 0.0001) {
    const sign = rawBase >= 0 ? 1 : -1;
    discountHtOut = roundMoney2(Math.abs(rawBase) * (pct / 100));
    totalHt = roundMoney2(rawBase - sign * discountHtOut);
  } else {
    discountHtOut = dhStored;
    totalHt = roundMoney2(rawBase - dhStored);
  }
  const vr = Number(line.vat_rate) || 0;
  const totalVat = roundMoney2(totalHt * (vr / 100));
  const totalTtc = roundMoney2(totalHt + totalVat);
  return {
    baseHt: rawBase,
    discountHt: discountHtOut,
    totalHt,
    totalVat,
    totalTtc,
  };
}

const SNAPSHOT_HT_TOLERANCE = 0.02;

/**
 * Montants affichés pour une ligne (snapshot ou recalcul après édition).
 * Ne clamp pas qty × PU : les PU négatifs (ex. DOCUMENT_DISCOUNT) restent effectifs.
 */
export function getPreparedLineMoneyTotals(line: PreparedInvoiceLine): {
  baseHt: number;
  discountHt: number;
  totalHt: number;
  totalVat: number;
  totalTtc: number;
} {
  const arith = computeArithmeticMoneyTotals(line);

  if (line.totalsSource === "snapshot" && snapshotTotalsComplete(line)) {
    const ht = Number(line.total_line_ht);
    const vat = Number(line.total_line_vat);
    const ttc = Number(line.total_line_ttc);
    const htOk = Math.abs(ht - arith.totalHt) <= SNAPSHOT_HT_TOLERANCE;

    debugInvoicePrep("getPreparedLineMoneyTotals", {
      label: line.label,
      totalsSource: line.totalsSource,
      qty: line.quantity,
      PU: line.unit_price_ht,
      discount_ht: line.discount_ht,
      discount_pct: line.discount_percent,
      rawBase: arith.baseHt,
      snapHt: ht,
      arithHt: arith.totalHt,
      htOk,
    });

    if (htOk) {
      return {
        baseHt: arith.baseHt,
        discountHt: arith.discountHt,
        totalHt: ht,
        totalVat: vat,
        totalTtc: ttc,
      };
    }
    return arith;
  }

  debugInvoicePrep("getPreparedLineMoneyTotals (computed path)", {
    label: line.label,
    qty: line.quantity,
    PU: line.unit_price_ht,
    discount_ht: line.discount_ht,
    discount_pct: line.discount_percent,
    rawBase: arith.baseHt,
    totalHt: arith.totalHt,
  });
  return arith;
}

export function aggregatePreparedTotals(lines: PreparedInvoiceLine[]): {
  total_ht: number;
  total_vat: number;
  total_ttc: number;
} {
  return lines.reduce(
    (acc, line) => {
      const t = getPreparedLineMoneyTotals(line);
      acc.total_ht = roundMoney2(acc.total_ht + t.totalHt);
      acc.total_vat = roundMoney2(acc.total_vat + t.totalVat);
      acc.total_ttc = roundMoney2(acc.total_ttc + t.totalTtc);
      return acc;
    },
    { total_ht: 0, total_vat: 0, total_ttc: 0 }
  );
}

function keepNormalizedLine(line: PreparedInvoiceLine): boolean {
  const kind = String(line.line_kind || "").toUpperCase();
  const ttc = Number(line.total_line_ttc);
  const th = Number(line.total_line_ht);
  const hasSnapMag =
    (Number.isFinite(ttc) && Math.abs(ttc) > 1e-9) ||
    (Number.isFinite(th) && Math.abs(th) > 1e-9);
  return (
    hasSnapMag ||
    line.quantity !== 0 ||
    line.unit_price_ht !== 0 ||
    line.discount_percent > 0 ||
    kind === "DOCUMENT_DISCOUNT"
  );
}

export function normalizePreparedLines(rawLines: unknown[]): PreparedInvoiceLine[] {
  return rawLines
    .map((raw, idx) => {
      const row = raw as Record<string, unknown>;
      const label = String(row.label ?? row.description ?? "").trim();
      const quantity = Number(row.quantity ?? 0);
      const unitPrice = Number(row.unit_price_ht ?? 0);
      const discountHtRaw = Number(row.discount_ht ?? 0);
      const discountPercentRaw = Number(
        row.discount_percent ?? row.discountPercent ?? row.line_discount_percent ?? 0
      );
      const vatRate = Number(row.vat_rate ?? row.tva_percent ?? 0);
      const rawBase = roundMoney2(
        (Number.isFinite(quantity) ? quantity : 0) * (Number.isFinite(unitPrice) ? unitPrice : 0)
      );

      const lkRaw = row.line_kind;
      const line_kind =
        typeof lkRaw === "string" && lkRaw.trim() ? lkRaw.trim() : null;
      const lineKindUpper = String(line_kind || "").toUpperCase();

      const th = Number(row.total_line_ht);
      const tv = Number(row.total_line_vat);
      const tt = Number(row.total_line_ttc);

      const absBase = Math.abs(rawBase);
      const implicitDiscHt =
        lineKindUpper !== "DOCUMENT_DISCOUNT" &&
        rawBase > 1e-9 &&
        Number.isFinite(th) &&
        th < rawBase - 1e-9
          ? Math.max(0, roundMoney2(rawBase - th))
          : 0;
      const storedDisc = Number.isFinite(discountHtRaw) ? Math.max(0, discountHtRaw) : 0;
      const effectiveDiscountHt = Math.max(storedDisc, implicitDiscHt);
      const derivedPctFromHt =
        absBase > 1e-12 && effectiveDiscountHt > 0
          ? roundMoney2((effectiveDiscountHt / absBase) * 100)
          : 0;
      const finalDiscountPercent =
        Number.isFinite(discountPercentRaw) && discountPercentRaw > 0 ? discountPercentRaw : derivedPctFromHt;

      debugInvoicePrep("normalizePreparedLines", {
        idx,
        label,
        qty: quantity,
        PU: unitPrice,
        discount_ht_raw: discountHtRaw,
        implicitDiscHt,
        effectiveDiscountHt,
        discount_pct_raw: discountPercentRaw,
        derivedPctFromHt,
        finalDiscountPercent,
        rawBase,
        total_line_ht: Number.isFinite(th) ? th : null,
      });

      return {
        id: `line-${idx + 1}`,
        label: label || `Ligne ${idx + 1}`,
        description: String(row.description ?? "").trim(),
        quantity: Number.isFinite(quantity) ? quantity : 0,
        unit_price_ht: Number.isFinite(unitPrice) ? unitPrice : 0,
        discount_percent: Number.isFinite(finalDiscountPercent) ? Math.max(0, finalDiscountPercent) : 0,
        vat_rate: Number.isFinite(vatRate) ? vatRate : 0,
        discount_ht: roundMoney2(effectiveDiscountHt),
        line_kind,
        ...(Number.isFinite(th) ? { total_line_ht: th } : {}),
        ...(Number.isFinite(tv) ? { total_line_vat: tv } : {}),
        ...(Number.isFinite(tt) ? { total_line_ttc: tt } : {}),
        totalsSource: "snapshot",
      } as PreparedInvoiceLine;
    })
    .filter(keepNormalizedLine);
}

export function getDiscountPercent(line: PreparedInvoiceLine): number {
  return Math.min(100, Math.max(0, Number(line.discount_percent) || 0));
}

const COMPUTED_TRIGGER_KEYS = ["quantity", "unit_price_ht", "discount_percent", "vat_rate"] as const;

export function patchTriggersComputedTotals(patch: Partial<PreparedInvoiceLine>): boolean {
  return COMPUTED_TRIGGER_KEYS.some((k) => k in patch);
}
