import type { QuoteHeaderSnapshot, QuoteLine, QuoteBuilderMeta, QuoteLineSource } from "./quote.types";
import { discountPercentFromHt, grossHtFromLine } from "./quoteCalc";
import { parseDepositFromMeta } from "./quoteDeposit";

function formatClientDisplayFromQuote(q: Record<string, unknown>): string | null {
  const cn = q.company_name;
  if (cn != null && String(cn).trim()) return String(cn).trim();
  const fn = [q.first_name, q.last_name].filter(Boolean).join(" ").trim();
  if (fn) return fn;
  return null;
}

export interface QuoteBuilderState {
  header: QuoteHeaderSnapshot | null;
  lines: QuoteLine[];
  meta: QuoteBuilderMeta;
  dirty: boolean;
}

export type QuoteBuilderAction =
  | { type: "HYDRATE"; payload: QuoteBuilderState }
  | { type: "SET_META"; payload: Partial<QuoteBuilderMeta> }
  | { type: "SET_HEADER"; payload: Partial<QuoteHeaderSnapshot> }
  | { type: "ADD_LINE"; line: QuoteLine }
  | { type: "UPDATE_LINE"; id: string; patch: Partial<QuoteLine> }
  | { type: "REMOVE_LINE"; id: string }
  | { type: "REORDER"; activeId: string; overId: string }
  | { type: "SET_LINES"; lines: QuoteLine[] }
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

export function quoteBuilderReducer(state: QuoteBuilderState, action: QuoteBuilderAction): QuoteBuilderState {
  switch (action.type) {
    case "HYDRATE":
      return { ...action.payload, dirty: false };
    case "SET_META": {
      const p = action.payload;
      const nextMeta = { ...state.meta, ...p };
      if (p.deposit && typeof p.deposit === "object") {
        nextMeta.deposit = { ...state.meta.deposit, ...p.deposit };
      }
      if (p.legal_documents && typeof p.legal_documents === "object") {
        nextMeta.legal_documents = {
          ...state.meta.legal_documents,
          ...p.legal_documents,
        };
      }
      return { ...state, meta: nextMeta, dirty: true };
    }
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
    case "SET_LINES":
      return {
        ...state,
        lines: action.lines.map((l, i) => ({ ...l, position: i + 1 })),
        dirty: true,
      };
    case "MARK_CLEAN":
      return { ...state, dirty: false };
    default:
      return state;
  }
}

export function createEmptyMeta(): QuoteBuilderMeta {
  return {
    validity_days: 30,
    deposit: { type: "PERCENT", value: 0 },
    notes: "",
    commercial_notes: "",
    technical_notes: "",
    payment_terms: "",
    study_import: null,
    pdf_show_line_pricing: true,
    legal_documents: { include_rge: false, include_decennale: false },
  };
}

function lineSourceFromSnapshot(row: Record<string, unknown>): QuoteLineSource | undefined {
  const raw = row.snapshot_json;
  if (raw == null) return undefined;
  try {
    const snap = typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : (raw as Record<string, unknown>);
    const ls = snap?.line_source;
    if (ls === "study_prep") return "study_prep";
    if (ls === "manual") return "manual";
  } catch {
    /* ignore */
  }
  return undefined;
}

function lineReferenceFromSnapshot(row: Record<string, unknown>): string {
  const raw = row.snapshot_json;
  if (raw == null) return "";
  try {
    const snap = typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : (raw as Record<string, unknown>);
    const r = snap?.reference ?? snap?.product_reference;
    const s = r != null ? String(r).trim() : "";
    return s.slice(0, 120);
  } catch {
    return "";
  }
}

function lineKindFromSnapshot(row: Record<string, unknown>): string | null {
  const raw = row.snapshot_json;
  if (raw == null) return null;
  try {
    const snap = typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : (raw as Record<string, unknown>);
    const kind = snap?.line_kind;
    if (kind == null) return null;
    const normalized = String(kind).trim();
    return normalized ? normalized : null;
  } catch {
    return null;
  }
}

export function mapApiItemsToLines(rows: Record<string, unknown>[]): QuoteLine[] {
  return rows.map((row, i) => {
    const gross = grossHtFromLine({
      quantity: Number(row.quantity) || 0,
      unit_price_ht: Number(row.unit_price_ht) || 0,
    });
    const discHt = Number(row.discount_ht) || 0;
    const id = String(row.id ?? `tmp-${i}`);
    const catalogId = row.catalog_item_id != null ? String(row.catalog_item_id) : null;
    const lineSource = lineSourceFromSnapshot(row);
    const puCents = row.purchase_unit_price_ht_cents;
    const purchase_unit_price_ht_cents =
      puCents != null && Number.isFinite(Number(puCents)) ? Math.floor(Number(puCents)) : undefined;
    const line = {
      id,
      type: catalogId ? "catalog" : "custom",
      catalog_item_id: catalogId,
      line_source: lineSource,
      label: String(row.label ?? row.description ?? "Ligne"),
      description: String(row.description ?? ""),
      reference: lineReferenceFromSnapshot(row),
      quantity: Number(row.quantity) || 0,
      unit_price_ht:
        row.unit_price_ht != null && row.unit_price_ht !== "" ? Number(row.unit_price_ht) : 0,
      tva_percent: Number(row.vat_rate) || 0,
      line_discount_percent: discountPercentFromHt(gross, discHt),
      position: Number(row.position) || i + 1,
      ...(purchase_unit_price_ht_cents !== undefined ? { purchase_unit_price_ht_cents } : {}),
    };
    (line as QuoteLine & { line_kind?: string | null }).line_kind = lineKindFromSnapshot(row);
    return line;
  });
}

export function linesToSaveItems(lines: QuoteLine[]) {
  return lines
    .sort((a, b) => a.position - b.position)
    .map((l) => {
      const gross = grossHtFromLine(l);
      const pct = Math.max(0, Math.min(100, l.line_discount_percent));
      const discount_ht =
        gross > 0 ? Math.min(roundMoney(gross * (pct / 100)), gross) : 0;
      const line_source = l.line_source === "study_prep" ? "study_prep" : "manual";
      const ref = (l.reference ?? "").trim().slice(0, 120);
      const lineKind = (l as QuoteLine & { line_kind?: string | null }).line_kind;
      return {
        label: l.label,
        description: (l.description ?? "").trim(),
        quantity: l.quantity,
        unit_price_ht: l.unit_price_ht,
        tva_rate: l.tva_percent,
        discount_ht,
        line_source,
        catalog_item_id: l.type === "catalog" ? l.catalog_item_id ?? undefined : undefined,
        ...(ref ? { reference: ref } : {}),
        ...(lineKind ? { line_kind: lineKind } : {}),
      };
    });
}

function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

/** Hydratation état builder depuis GET /api/quotes/:id (quote + items). */
export function buildStateFromApi(data: { quote: Record<string, unknown>; items: Record<string, unknown>[] }): QuoteBuilderState {
  const q = data.quote;
  const metaRaw = (q.metadata_json as Record<string, unknown>) || {};
  const siRaw = metaRaw.study_import;
  const studyImport =
    siRaw && typeof siRaw === "object"
      ? {
          last_at: (siRaw as { last_at?: unknown }).last_at != null ? String((siRaw as { last_at?: unknown }).last_at) : null,
          study_version_id:
            (siRaw as { study_version_id?: unknown }).study_version_id != null
              ? String((siRaw as { study_version_id?: unknown }).study_version_id)
              : null,
        }
      : null;
  const ldRaw = metaRaw.legal_documents;
  const legal_documents =
    ldRaw && typeof ldRaw === "object"
      ? {
          include_rge: Boolean((ldRaw as { include_rge?: unknown }).include_rge),
          include_decennale: Boolean((ldRaw as { include_decennale?: unknown }).include_decennale),
        }
      : { include_rge: false, include_decennale: false };
  return {
    header: {
      id: String(q.id),
      quote_number: String(q.quote_number ?? ""),
      status: String(q.status ?? "DRAFT"),
      lead_id: (q.lead_id as string) ?? null,
      client_id: (q.client_id as string) ?? null,
      study_id: (q.study_id as string) ?? null,
      study_version_id: (q.study_version_id as string) ?? null,
      valid_until: (q.valid_until as string) ?? null,
      client_display: formatClientDisplayFromQuote(q),
    },
    lines: mapApiItemsToLines(data.items || []),
    meta: {
      validity_days: Number(metaRaw.validity_days) || 30,
      deposit: parseDepositFromMeta(metaRaw),
      notes: String(metaRaw.notes ?? ""),
      commercial_notes: String(metaRaw.commercial_notes ?? ""),
      technical_notes: String(metaRaw.technical_notes ?? ""),
      payment_terms: String(metaRaw.payment_terms ?? ""),
      study_import: studyImport,
      pdf_show_line_pricing: metaRaw.pdf_show_line_pricing !== false,
      legal_documents,
    },
    dirty: false,
  };
}
