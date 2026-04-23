/**
 * Multer (et certains clients HTTP) passent parfois le nom de fichier comme une chaîne
 * dont les code units sont les octets UTF-8 lus en Latin-1 → mojibake (« Ã© » pour « é »).
 * @param {string | null | undefined} name
 * @returns {string} Chaîne normalisée, ou "" si entrée vide / non-string
 */
export function normalizeMultipartFilename(name) {
  if (name == null || typeof name !== "string") return "";
  const t = name.trim();
  if (!t) return "";
  try {
    const decoded = Buffer.from(t, "latin1").toString("utf8");
    if (decoded === t) return t;
    if (decoded.includes("\uFFFD")) return t;
    const d = decoded.trim();
    return d || t;
  } catch {
    return t;
  }
}
