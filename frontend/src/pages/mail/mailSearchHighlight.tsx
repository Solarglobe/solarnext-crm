import React from "react";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Surligne les occurrences des termes (insensible à la casse). */
export function highlightTermsInText(text: string, terms: string[]): React.ReactNode {
  const t = terms.map((x) => x.trim()).filter((x) => x.length >= 2);
  if (!t.length || !text) return text;
  try {
    const re = new RegExp(`(${t.map(escapeRegExp).join("|")})`, "gi");
    const parts: React.ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    const r = new RegExp(re.source, re.flags);
    let k = 0;
    while ((m = r.exec(text))) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      parts.push(
        <mark className="mail-search-hit" key={`h-${k++}`}>
          {m[0]}
        </mark>
      );
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts.length ? parts : text;
  } catch {
    return text;
  }
}

/** Extrait centré autour du premier terme trouvé (aperçu type Gmail). */
export function excerptAroundTerms(full: string, terms: string[], maxLen = 140): string {
  const raw = full.trim();
  if (!raw) return "";
  const t = terms.map((x) => x.trim().toLowerCase()).filter((x) => x.length >= 2);
  if (!t.length) {
    return raw.length > maxLen ? `${raw.slice(0, Math.max(0, maxLen - 1)).trim()}…` : raw;
  }
  const low = raw.toLowerCase();
  for (const term of t) {
    const idx = low.indexOf(term);
    if (idx >= 0) {
      const padBefore = 48;
      const padAfter = maxLen - Math.min(term.length + padBefore, maxLen);
      const start = Math.max(0, idx - padBefore);
      const end = Math.min(raw.length, idx + term.length + padAfter);
      const prefix = start > 0 ? "… " : "";
      const suffix = end < raw.length ? " …" : "";
      return `${prefix}${raw.slice(start, end).trim()}${suffix}`;
    }
  }
  return raw.length > maxLen ? `${raw.slice(0, maxLen - 1).trim()}…` : raw;
}
