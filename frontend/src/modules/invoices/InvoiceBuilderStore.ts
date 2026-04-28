import type { InvoiceHeaderSnapshot, InvoiceLine, InvoiceBuilderMeta } from "./invoice.types";
import { discountPercentFromHt, grossHtFromLine } from "../quotes/quoteCalc";

export interface InvoiceBuilderState {
  header: InvoiceHeaderSnapshot | null;
  lines: InvoiceLine[];
  meta: InvoiceBuilderMeta;
  dirty: boolean;
}

export type InvoiceBuilderAction =
  | { type: "HYDRATE"; payload: InvoiceBuilderState }
  | { type: "CLEAR" }
  | { type: "SET_META"; payload: Partial<InvoiceBuilderMeta> }
  | { type: "SET_HEADER"; payload: Partial<InvoiceHeaderSnapshot> }
  | { type: "ADD_LINE"; line: InvoiceLine }
  | { type: "UPDATE_LINE"; id: string; patch: Partial<InvoiceLine> }
  | { type: "REMOVE_LINE"; id: string }
  | { type: "REORDER"; activeId: string; overId: string }
  | { type: "MARK_CLEAN" };

function reorderArray<T extends { id: string }>(items: T[], activeId: string, overId: string): T[] {
  const oldIndex = items.findIndex((x) => x.id === activeId);
  const newIndex = items.findIndex((x) => x.id === overId);
  if (oldIndex < 0 || newIndex < 0) return items;
  const next = [...items];
  const [removed] = next.splice(oldIndex, 1);
  next.splice(newIndex, 0, removed);
  return next.map((row, i) => ({ ...row, position: i + 1 }));
}

export function invoiceBuilderReducer(state: InvoiceBuilderState, action: InvoiceBuilderAction): InvoiceBuilderState {
  switch (action.type) {
    case "HYDRATE":
      return { ...action.payload, dirty: false };
    case "CLEAR":
      return {
        header: null,
        lines: [],
        meta: createEmptyMeta(),
        dirty: false,
      };
    case "SET_META":
      return { ...state, meta: { ...state.meta, ...action.payload }, dirty: true };
    case "SET_HEADER":
      return state.header
        ? { ...state, header: { ...state.header, ...action.payload }, dirty: true }
        : state;
    case "ADD_LINE":
      return { ...state, lines: [...state.lines, action.line], dirty: true };
    case "UPDATE_LINE":
      return {
        ...state,
        lines: state.lines.map((l) => (l.id === action.id ? { ...l, ...action.patch } : l)),
        dirty: true,
      };
    case "REMOVE_LINE":
      return {
        ...state,
        lines: state.lines
          .filter((l) => l.id !== action.id)
          .map((l, i) => ({ ...l, position: i + 1 })),
        dirty: true,
      };
    case "REORDER":
      return {
        ...state,
        lines: reorderArray(state.lines, action.activeId, action.overId).map((l, i) => ({ ...l, position: i + 1 })),
        dirty: true,
      };
    case "MARK_CLEAN":
      return { ...state, dirty: false };
    default:
      return state;
  }
}

export function createEmptyMeta(): InvoiceBuilderMeta {
  return {
    notes: "",
    payment_terms: "",
  };
}

export function mapApiLinesToInvoiceLines(rows: Record<string, unknown>[]): InvoiceLine[] {
  return rows.map((row, i) => {
    const gross = grossHtFromLine({
      quantity: Number(row.quantity) || 0,
      unit_price_ht: Number(row.unit_price_ht) || 0,
    });
    const discHt = Number(row.discount_ht) || 0;
    const id = String(row.id ?? `tmp-${i}`);
    const rawSnap = row.snapshot_json;
    let snap: Record<string, unknown> | undefined;
    if (typeof rawSnap === "string") {
      try {
        snap = JSON.parse(rawSnap) as Record<string, unknown>;
      } catch {
        snap = undefined;
      }
    } else if (rawSnap && typeof rawSnap === "object") {
      snap = rawSnap as Record<string, unknown>;
    }
    const catalogId = snap?.catalog_item_id != null ? String(snap.catalog_item_id) : null;
    return {
      id,
      type: catalogId ? "catalog" : "custom",
      catalog_item_id: catalogId,
      label: String(row.label ?? row.description ?? "Ligne"),
      quantity: Number(row.quantity) || 0,
      unit_price_ht: Number(row.unit_price_ht) || 0,
      tva_percent: Number(row.vat_rate) || 0,
      line_discount_percent: discountPercentFromHt(gross, discHt),
      position: Number(row.position) || i + 1,
    };
  });
}

export function invoiceLinesToSavePayload(lines: InvoiceLine[]) {
  return lines
    .sort((a, b) => a.position - b.position)
    .map((l) => {
      const gross = grossHtFromLine(l);
      const pct = Math.max(0, Math.min(100, l.line_discount_percent));
      const discount_ht = Math.min(roundMoney(gross * (pct / 100)), gross);
      const snap: Record<string, unknown> = {};
      if (l.type === "catalog" && l.catalog_item_id) snap.catalog_item_id = l.catalog_item_id;
      return {
        label: l.label,
        description: l.label,
        quantity: l.quantity,
        unit_price_ht: l.unit_price_ht,
        vat_rate: l.tva_percent,
        discount_ht,
        snapshot_json: Object.keys(snap).length ? snap : undefined,
      };
    });
}

function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}
