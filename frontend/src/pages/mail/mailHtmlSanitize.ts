import DOMPurify from "dompurify";

let _linkHooks = false;
let _allowRemoteImages = false;

function ensureLinkHooks(): void {
  if (_linkHooks || typeof window === "undefined") return;
  _linkHooks = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node instanceof HTMLElement) {
      for (const attr of Array.from(node.attributes)) {
        const n = attr.name.toLowerCase();
        if (n.startsWith("on") || n === "srcdoc") node.removeAttribute(attr.name);
      }
    }
    if (node.nodeName === "IMG" && node instanceof HTMLImageElement) {
      const src = node.getAttribute("src") || "";
      if (/^https?:\/\//i.test(src) && !_allowRemoteImages) {
        node.removeAttribute("src");
        node.setAttribute("data-remote-src-blocked", "1");
        node.setAttribute("alt", node.getAttribute("alt") || "Image distante bloquee");
      }
      if (/^(javascript|data:text\/html|file|vbscript):/i.test(src)) node.removeAttribute("src");
      return;
    }
    if (node.nodeName !== "A" || !(node instanceof HTMLAnchorElement)) return;
    const href = node.getAttribute("href");
    if (href && /[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/.test(href)) node.removeAttribute("href");
    if (href && /^(javascript|data|file|vbscript):/i.test(href)) node.removeAttribute("href");
    if (href && /^https?:/i.test(href)) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
}

/** Profil lecture / aperçu (HTML riche affiché dans le CRM). */
export function sanitizeMailHtmlDisplay(html: string, options: { allowRemoteImages?: boolean } = {}): string {
  ensureLinkHooks();
  _allowRemoteImages = options.allowRemoteImages === true;
  try {
    return DOMPurify.sanitize(String(html || "").slice(0, 1_000_000), {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["script", "style", "form", "input", "button", "textarea", "select", "option", "iframe", "object", "embed", "svg", "math", "meta", "link"],
      FORBID_ATTR: ["srcset", "formaction", "ping"],
      ADD_ATTR: ["target", "rel", "class", "data-signature", "data-remote-src-blocked"],
      ALLOW_UNKNOWN_PROTOCOLS: false,
    });
  } finally {
    _allowRemoteImages = false;
  }
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
    FORBID_TAGS: ["script", "iframe", "object", "embed", "svg", "math", "meta", "link", "form", "input", "button"],
    FORBID_ATTR: ["srcdoc", "srcset", "formaction", "ping"],
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
export function sanitizeMailHtml(html: string, options: { allowRemoteImages?: boolean } = {}): string {
  return sanitizeMailHtmlDisplay(html, options);
}

/** Alias historique — sortie composer / envoi. */
export function sanitizeComposerHtml(html: string): string {
  return sanitizeMailHtmlComposer(html);
}
