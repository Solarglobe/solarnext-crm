import type { DocumentCategory, DocumentSourceType, EntityDocument } from "./entityDocumentTypes";

function asBool(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

function asCategory(v: unknown): DocumentCategory | null {
  if (v == null || v === "") return null;
  const s = String(v).trim().toUpperCase();
  const allowed: DocumentCategory[] = [
    "QUOTE",
    "INVOICE",
    "COMMERCIAL_PROPOSAL",
    "DP_MAIRIE",
    "ADMINISTRATIVE",
    "OTHER",
  ];
  return (allowed as string[]).includes(s) ? (s as DocumentCategory) : null;
}

function asSource(v: unknown): DocumentSourceType | null {
  if (v == null || v === "") return null;
  const s = String(v).trim().toUpperCase();
  if (s === "SYSTEM_GENERATED" || s === "MANUAL_UPLOAD") return s as DocumentSourceType;
  return null;
}

export function normalizeEntityDocument(raw: Record<string, unknown>): EntityDocument {
  const displayName =
    (raw.displayName as string) ?? (raw.display_name as string) ?? null;
  return {
    id: String(raw.id ?? ""),
    file_name: String(raw.file_name ?? ""),
    file_size: Number(raw.file_size ?? 0) || 0,
    mime_type: String(raw.mime_type ?? ""),
    created_at: String(raw.created_at ?? ""),
    document_type: raw.document_type != null ? String(raw.document_type) : null,
    documentCategory: asCategory(raw.documentCategory ?? raw.document_category),
    sourceType: asSource(raw.sourceType ?? raw.source_type),
    isClientVisible: asBool(raw.isClientVisible ?? raw.is_client_visible),
    displayName: displayName && displayName.trim() ? displayName.trim() : null,
    description:
      raw.description != null && String(raw.description).trim()
        ? String(raw.description).trim()
        : null,
  };
}
