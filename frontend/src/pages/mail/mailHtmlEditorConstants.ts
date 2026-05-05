/** Inséré par « Signature professionnelle » — logo en URL https (à remplacer). */
export const MAIL_SIG_PRO_TEMPLATE_HTML = `
<table style="border-collapse:collapse;width:100%;max-width:600px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1e293b;">
  <tbody>
    <tr>
      <td style="vertical-align:top;padding:0 14px 0 0;width:110px;">
        <img src="https://placehold.co/100x40/f1f5f9/64748b/png?text=Logo" alt="Logo" width="100" style="display:block;border:0;height:auto;max-width:100px;" />
      </td>
      <td style="vertical-align:top;line-height:1.45;">
        <p style="margin:0;font-size:16px;font-weight:bold;">Nom Prénom</p>
        <p style="margin:4px 0 0;font-size:13px;color:#64748b;">Poste / fonction</p>
        <p style="margin:10px 0 0;font-size:12px;line-height:1.55;">
          Tél. <a href="tel:+33000000000" style="color:#2563eb;">+33 0 00 00 00 00</a><br />
          <a href="mailto:contact@entreprise.fr" style="color:#2563eb;">contact@entreprise.fr</a><br />
          Entreprise — Adresse
        </p>
      </td>
    </tr>
  </tbody>
</table>
<p style="margin:8px 0 0;font-size:11px;color:#94a3b8;">— Remplacez le logo et les textes ci-dessus —</p>
`.trim();

/** Plage de tailles affichée dans la liste (px entiers). */
export const FONT_SIZE_MIN_PX = 8;
export const FONT_SIZE_MAX_PX = 30;

export function clampFontSizePxInt(n: number): number {
  return Math.min(FONT_SIZE_MAX_PX, Math.max(FONT_SIZE_MIN_PX, Math.round(n)));
}

/** Extrait une taille en px depuis une valeur style (ex. "14px", " 14PX "). */
export function parseFontSizePx(s: string | null | undefined): number | null {
  if (s == null || !String(s).trim()) return null;
  const m = String(s).trim().match(/^([\d.]+)\s*px$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Vrai si la taille correspond exactement à un entier 8–30 px (liste déroulante). */
export function isPresetFontSizeValue(s: string | null | undefined): boolean {
  const n = parseFontSizePx(s);
  return n !== null && Number.isInteger(n) && n >= FONT_SIZE_MIN_PX && n <= FONT_SIZE_MAX_PX;
}

export const FONT_SIZE_PRESETS: { label: string; value: string }[] = Array.from(
  { length: FONT_SIZE_MAX_PX - FONT_SIZE_MIN_PX + 1 },
  (_, i) => {
    const n = FONT_SIZE_MIN_PX + i;
    return { label: `${n} px`, value: `${n}px` };
  }
);

/** Convertit une couleur CSS (hex, rgb) vers #rrggbb pour `<input type="color">`. */
export function colorToHexForInput(c: string | null | undefined): string {
  if (c == null || !String(c).trim()) return "#000000";
  const s = String(c).trim();
  if (s.startsWith("#")) {
    const raw = s.slice(1);
    if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toLowerCase()}`;
    if (/^[0-9a-fA-F]{3}$/.test(raw)) {
      const [a, b, d] = raw.split("");
      return `#${a}${a}${b}${b}${d}${d}`.toLowerCase();
    }
  }
  const rgb = s.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) {
    const r = Math.max(0, Math.min(255, parseInt(rgb[1], 10)));
    const g = Math.max(0, Math.min(255, parseInt(rgb[2], 10)));
    const b = Math.max(0, Math.min(255, parseInt(rgb[3], 10)));
    const h = (n: number) => n.toString(16).padStart(2, "0");
    return `#${h(r)}${h(g)}${h(b)}`;
  }
  return "#000000";
}

/** Largeur image (attribut HTML width — px ou %) */
export const IMAGE_WIDTH_PRESETS: { label: string; value: string }[] = [
  { label: "100%", value: "100%" },
  { label: "75%", value: "75%" },
  { label: "50%", value: "50%" },
  { label: "320px", value: "320" },
  { label: "200px", value: "200" },
];

export const LINE_HEIGHT_PRESETS: { label: string; value: string }[] = [
  { label: "Compact", value: "1.15" },
  { label: "Standard", value: "1.45" },
  { label: "Aéré", value: "1.65" },
];

/** Pastilles rapides (toolbar couleur) — toujours exporté pour éviter les références orphelines. */
export const COLOR_SWATCHES = ["#000000", "#FFFFFF", "#6366F1", "#1F2937", "#6B7280"];
