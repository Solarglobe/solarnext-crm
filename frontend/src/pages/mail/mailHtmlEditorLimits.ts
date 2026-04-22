/** Taille max du HTML mail (signature / composer) — évite payloads énormes. */
export const MAIL_HTML_MAX_UTF8_BYTES = 50 * 1024;

/** Fichier image embarqué en data-URL — plafond raisonnable avant base64. */
export const MAIL_IMAGE_FILE_MAX_BYTES = 400 * 1024;

export function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function mailHtmlExceedsLimit(html: string, maxBytes = MAIL_HTML_MAX_UTF8_BYTES): boolean {
  return utf8ByteLength(html) > maxBytes;
}
