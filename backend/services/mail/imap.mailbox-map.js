/**
 * CP-070 — Mapping dossiers IMAP → types métier (sans dépendance fournisseur).
 * S’appuie sur specialUse (RFC 6154) + heuristiques sur le chemin.
 */

/**
 * @param {{ path?: string, specialUse?: string, delimiter?: string }} entry
 * @returns {'INBOX' | 'SENT' | 'DRAFT' | 'TRASH' | 'CUSTOM'}
 */
export function classifyMailboxType(entry) {
  const su = entry.specialUse || "";
  const path = String(entry.path || "");
  const lower = path.toLowerCase();

  if (su === "\\Inbox" || lower === "inbox") {
    return "INBOX";
  }
  if (su === "\\Sent") {
    return "SENT";
  }
  if (su === "\\Drafts") {
    return "DRAFT";
  }
  if (su === "\\Trash") {
    return "TRASH";
  }

  if (
    lower.endsWith("sent") ||
    lower.includes("[gmail]/sent") ||
    lower.includes("éléments envoyés") ||
    lower.includes("elements envoyes") ||
    lower.includes("sent items")
  ) {
    return "SENT";
  }
  if (
    lower.includes("draft") ||
    lower.includes("brouillon") ||
    lower.includes("[gmail]/draft")
  ) {
    return "DRAFT";
  }
  if (
    lower.includes("trash") ||
    lower.includes("corbeille") ||
    lower.includes("deleted") ||
    lower.includes("[gmail]/trash")
  ) {
    return "TRASH";
  }

  return "CUSTOM";
}

/**
 * @param {string} path
 * @param {string} delimiter
 */
function displayNameFromPath(path, delimiter) {
  if (!path) return "MAILBOX";
  const d = delimiter || "/";
  const parts = path.split(d).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

/**
 * @param {Iterable<{ path?: string, delimiter?: string, specialUse?: string }>} rawList
 * @returns {Array<{ name: string, type: string, path: string, external_id: string }>}
 */
export function collectMailboxesFromList(rawList) {
  const seen = new Set();
  const out = [];
  for (const m of rawList) {
    const path = m.path || "";
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const type = classifyMailboxType(m);
    const name = displayNameFromPath(path, m.delimiter);
    out.push({
      name,
      type,
      path,
      external_id: path,
    });
  }
  return out;
}
