/**
 * Acompte devis — structure metadata_json.deposit (+ compat deposit_percent legacy).
 */

import type { QuoteDeposit } from "./quote.types";

export function parseDepositFromMeta(meta: Record<string, unknown> | null | undefined): QuoteDeposit {
  const m = meta || {};
  const raw = m.deposit as { type?: string; value?: unknown; note?: unknown } | undefined;
  if (raw && typeof raw === "object") {
    const t = String(raw.type || "").toUpperCase();
    if (t === "PERCENT" || t === "AMOUNT") {
      const v = Number(raw.value);
      if (Number.isFinite(v) && v >= 0) {
        const note = typeof raw.note === "string" ? raw.note.slice(0, 500) : undefined;
        const value = t === "PERCENT" ? Math.min(100, v) : v;
        return { type: t, value, ...(note ? { note } : {}) };
      }
    }
  }
  const legacy = Number(m.deposit_percent);
  if (Number.isFinite(legacy) && legacy > 0) {
    return { type: "PERCENT", value: Math.min(100, legacy) };
  }
  return { type: "PERCENT", value: 0 };
}
