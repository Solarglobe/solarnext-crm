/**
 * CP-070/Phase 2 — Mapping dossiers IMAP → types canoniques.
 * Priorite : specialUse RFC 6154, puis fallback d'alias documente.
 */

export const MAIL_FOLDER_TYPES = {
  INBOX: "INBOX",
  SENT: "SENT",
  DRAFT: "DRAFT",
  ARCHIVE: "ARCHIVE",
  TRASH: "TRASH",
  JUNK: "JUNK",
  CUSTOM: "CUSTOM",
};

const SPECIAL_USE_TO_TYPE = new Map([
  ["\\inbox", MAIL_FOLDER_TYPES.INBOX],
  ["\\sent", MAIL_FOLDER_TYPES.SENT],
  ["\\drafts", MAIL_FOLDER_TYPES.DRAFT],
  ["\\archive", MAIL_FOLDER_TYPES.ARCHIVE],
  ["\\trash", MAIL_FOLDER_TYPES.TRASH],
  ["\\junk", MAIL_FOLDER_TYPES.JUNK],
]);

const FOLDER_PRIORITY = {
  INBOX: 10,
  SENT: 10,
  DRAFT: 15,
  ARCHIVE: 40,
  CUSTOM: 50,
  JUNK: 80,
  TRASH: 90,
};

/**
 * @param {string} s
 */
function stripAccents(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * @param {unknown} attrs
 */
export function normalizeMailboxAttributes(attrs) {
  if (!attrs) return [];
  const arr =
    typeof attrs === "string"
      ? [attrs]
      : typeof attrs?.[Symbol.iterator] === "function"
        ? [...attrs]
        : Array.isArray(attrs)
          ? attrs
          : [];
  return [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))];
}

/**
 * @param {{ path?: string, name?: string, specialUse?: string, delimiter?: string, flags?: unknown, attributes?: unknown }} entry
 * @returns {'INBOX' | 'SENT' | 'DRAFT' | 'ARCHIVE' | 'TRASH' | 'JUNK' | 'CUSTOM'}
 */
export function classifyMailboxType(entry) {
  const specialUse = String(entry.specialUse || "").trim().toLowerCase();
  if (SPECIAL_USE_TO_TYPE.has(specialUse)) return SPECIAL_USE_TO_TYPE.get(specialUse);

  const attrs = normalizeMailboxAttributes(entry.flags || entry.attributes);
  for (const attr of attrs) {
    const mapped = SPECIAL_USE_TO_TYPE.get(attr.toLowerCase());
    if (mapped) return mapped;
  }

  const path = String(entry.path || entry.name || "");
  const delimiter = entry.delimiter || "/";
  const leaf = stripAccents(displayNameFromPath(path, delimiter));
  const full = stripAccents(path);

  if (leaf === "inbox" || full === "inbox") return MAIL_FOLDER_TYPES.INBOX;
  if (["sent", "sent items", "elements envoyes", "courrier envoye", "messages envoyes"].includes(leaf)) {
    return MAIL_FOLDER_TYPES.SENT;
  }
  if (["draft", "drafts", "brouillon", "brouillons"].includes(leaf)) return MAIL_FOLDER_TYPES.DRAFT;
  if (["archive", "archives", "all mail", "tous les messages"].includes(leaf)) return MAIL_FOLDER_TYPES.ARCHIVE;
  if (["trash", "deleted", "deleted items", "corbeille", "elements supprimes"].includes(leaf)) {
    return MAIL_FOLDER_TYPES.TRASH;
  }
  if (["junk", "spam", "courrier indesirable", "indesirables", "courriers indesirables"].includes(leaf)) {
    return MAIL_FOLDER_TYPES.JUNK;
  }

  if (full.includes("[gmail]/sent")) return MAIL_FOLDER_TYPES.SENT;
  if (full.includes("[gmail]/draft")) return MAIL_FOLDER_TYPES.DRAFT;
  if (full.includes("[gmail]/all mail") || full.includes("[gmail]/tous les messages")) return MAIL_FOLDER_TYPES.ARCHIVE;
  if (full.includes("[gmail]/trash")) return MAIL_FOLDER_TYPES.TRASH;
  if (full.includes("[gmail]/spam")) return MAIL_FOLDER_TYPES.JUNK;

  return MAIL_FOLDER_TYPES.CUSTOM;
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
 * @param {string} path
 * @param {string | null | undefined} delimiter
 */
export function parentPathFromPath(path, delimiter) {
  if (!path || !delimiter) return null;
  const idx = String(path).lastIndexOf(String(delimiter));
  if (idx <= 0) return null;
  return String(path).slice(0, idx);
}

/**
 * @param {string} path
 * @param {string | null | undefined} delimiter
 */
export function depthFromPath(path, delimiter) {
  if (!path || !delimiter) return 0;
  return String(path).split(String(delimiter)).filter(Boolean).length - 1;
}

/**
 * @param {unknown} entry
 */
export function isSelectableMailbox(entry) {
  const attrs = normalizeMailboxAttributes(entry?.flags || entry?.attributes);
  return !attrs.some((a) => a.toLowerCase() === "\\noselect");
}

/**
 * @param {unknown} entry
 */
export function isSubscribedMailbox(entry) {
  const attrs = normalizeMailboxAttributes(entry?.flags || entry?.attributes);
  if (typeof entry?.subscribed === "boolean") return entry.subscribed;
  if (typeof entry?.listed === "boolean" && entry.listed === false) return false;
  if (attrs.some((a) => a.toLowerCase() === "\\subscribed")) return true;
  return null;
}

/**
 * @param {unknown} m
 */
export function normalizeMailboxEntry(m) {
  const path = String(m?.path || "").trim();
  if (!path) return null;
  const delimiter = m?.delimiter != null ? String(m.delimiter) : "/";
  const type = classifyMailboxType(m);
  const name = displayNameFromPath(path, delimiter);
  return {
    name,
    display_name: name,
    type,
    path,
    external_id: path,
    parent_path: parentPathFromPath(path, delimiter),
    delimiter,
    depth: depthFromPath(path, delimiter),
    attributes: normalizeMailboxAttributes(m?.flags || m?.attributes),
    special_use: m?.specialUse ? String(m.specialUse) : null,
    selectable: isSelectableMailbox(m),
    subscribed: isSubscribedMailbox(m),
    sync_priority: FOLDER_PRIORITY[type] ?? FOLDER_PRIORITY.CUSTOM,
  };
}

/**
 * @param {Iterable<{ path?: string, delimiter?: string, specialUse?: string, flags?: unknown, attributes?: unknown }>} rawList
 * @returns {Array<{ name: string, display_name: string, type: string, path: string, external_id: string, parent_path: string | null, delimiter: string, depth: number, attributes: string[], special_use: string | null, selectable: boolean, subscribed: boolean | null, sync_priority: number }>}
 */
export function collectMailboxesFromList(rawList) {
  const seen = new Set();
  const out = [];
  for (const m of rawList) {
    const path = m?.path || "";
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const normalized = normalizeMailboxEntry(m);
    if (normalized) out.push(normalized);
  }
  return out;
}
