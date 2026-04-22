import type { ComposerMode } from "./mailComposerLogic";

/** Bloc signature dans le composer (évite mélange avec le corps). */
export function wrapMailSignatureHtml(innerHtml: string): string {
  const inner = innerHtml.trim();
  if (!inner) return "";
  return `<div data-signature="1">${inner}</div>`;
}

export function stripMailSignatureFromHtml(html: string): string {
  if (typeof document === "undefined") {
    return html.replace(/<div\b[^>]*\bdata-signature=(?:["'][^"']*["']|[^\s>]+)[^>]*>[\s\S]*?<\/div>/gi, "");
  }
  const d = document.createElement("div");
  d.innerHTML = html;
  const sig = d.querySelector("div[data-signature]");
  if (sig) sig.remove();
  return d.innerHTML;
}

/**
 * @param baseHtml Corps sans bloc signature
 */
export function injectMailSignatureHtml(baseHtml: string, innerSignature: string, mode: ComposerMode): string {
  const wrapped = wrapMailSignatureHtml(innerSignature);
  if (!wrapped) return stripMailSignatureFromHtml(baseHtml);
  const cleaned = stripMailSignatureFromHtml(baseHtml);

  if (mode === "forward") {
    const re = /<hr\b[^>]*>/i;
    const m = cleaned.match(re);
    if (m && m.index != null) {
      return cleaned.slice(0, m.index) + wrapped + cleaned.slice(m.index);
    }
    return wrapped + cleaned;
  }

  if (mode === "reply" || mode === "replyAll") {
    const re = /<(blockquote|hr)\b/i;
    const m = cleaned.match(re);
    if (m && m.index != null) {
      return cleaned.slice(0, m.index) + wrapped + cleaned.slice(m.index);
    }
    return cleaned + wrapped;
  }

  return cleaned + wrapped;
}

/** Conserve le bloc « message transféré » (à partir du premier &lt;hr&gt;) lors de l’application d’un template. */
export function extractForwardQuotedAppendix(htmlWithoutSignature: string): string {
  const hr = /<hr\b[^>]*>/i;
  const m = htmlWithoutSignature.match(hr);
  if (!m || m.index == null) return "";
  return htmlWithoutSignature.slice(m.index);
}

export function shortSignaturePreview(innerHtml: string, maxLen = 72): string {
  if (typeof document === "undefined") {
    const t = innerHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
  }
  const d = document.createElement("div");
  d.innerHTML = innerHtml;
  const t = (d.textContent || "").replace(/\s+/g, " ").trim();
  return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
}
