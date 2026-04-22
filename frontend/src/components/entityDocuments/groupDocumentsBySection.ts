import type { DocumentSectionKey, EntityDocument } from "./entityDocumentTypes";

export const SECTION_ORDER: DocumentSectionKey[] = [
  "QUOTE",
  "INVOICE",
  "COMMERCIAL_PROPOSAL",
  "DP",
  "DP_MAIRIE",
  "ADMINISTRATIVE",
  "OTHER",
];

export function resolveSectionKey(doc: EntityDocument): DocumentSectionKey {
  const c = doc.documentCategory;
  if (
    c === "QUOTE" ||
    c === "INVOICE" ||
    c === "COMMERCIAL_PROPOSAL" ||
    c === "DP" ||
    c === "DP_MAIRIE" ||
    c === "ADMINISTRATIVE" ||
    c === "OTHER"
  ) {
    return c;
  }
  return "OTHER";
}

export function groupDocumentsBySection(docs: EntityDocument[]): Record<DocumentSectionKey, EntityDocument[]> {
  const buckets = SECTION_ORDER.reduce(
    (acc, k) => {
      acc[k] = [];
      return acc;
    },
    {} as Record<DocumentSectionKey, EntityDocument[]>
  );

  const sorted = [...docs].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  for (const d of sorted) {
    buckets[resolveSectionKey(d)].push(d);
  }

  return buckets;
}
