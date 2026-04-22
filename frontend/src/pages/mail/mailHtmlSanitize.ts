import DOMPurify from "dompurify";

let _linkHooks = false;

function ensureLinkHooks(): void {
  if (_linkHooks || typeof window === "undefined") return;
  _linkHooks = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName !== "A" || !(node instanceof HTMLAnchorElement)) return;
    const href = node.getAttribute("href");
    if (href && /^https?:/i.test(href)) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
}

/** Profil lecture / aperçu (HTML riche affiché dans le CRM). */
export function sanitizeMailHtmlDisplay(html: string): string {
  ensureLinkHooks();
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "rel", "class"],
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
}

/**
 * Corps éditeur mail (composer) — liste blanche stricte + data-signature pour le bloc signature.
 */
export function sanitizeMailHtmlComposer(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "ul",
      "ol",
      "li",
      "a",
      "span",
      "div",
      "blockquote",
      "hr",
      "img",
      "table",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "th",
      "td",
      "colgroup",
      "col",
    ],
    ALLOWED_ATTR: [
      "href",
      "target",
      "rel",
      "style",
      "class",
      "src",
      "alt",
      "width",
      "height",
      "colspan",
      "rowspan",
      "align",
      "valign",
      "border",
      "cellpadding",
      "cellspacing",
    ],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ["data-signature"],
  });
}

/** Alias historique — aperçu / lecture. */
export function sanitizeMailHtml(html: string): string {
  return sanitizeMailHtmlDisplay(html);
}

/** Alias historique — sortie composer / envoi. */
export function sanitizeComposerHtml(html: string): string {
  return sanitizeMailHtmlComposer(html);
}
