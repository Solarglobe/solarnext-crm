/** Inséré par « Signature professionnelle » — compatible clients mail, table + styles inline. */
export const MAIL_SIG_PRO_TEMPLATE_HTML = `
<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;color:#1f2933;font-size:13px;line-height:1.45;max-width:620px;">
  <tbody>
    <tr>
      <td style="vertical-align:middle;padding:0 16px 0 0;width:130px;">
        <img src="https://www.entreprise.fr/logo-email.png" width="120" height="40" alt="Entreprise" style="display:block;border:0;outline:none;text-decoration:none;width:120px;height:auto;max-width:120px;">
      </td>
      <td style="vertical-align:middle;border-left:3px solid #C39847;padding:0 0 0 16px;">
        <div style="font-size:14px;line-height:1.45;color:#111827;"><strong>Nom Prenom</strong> <span style="color:#C39847;">- Fonction</span></div>
        <div style="margin-top:8px;font-size:12px;line-height:1.55;color:#2b2b2b;">
          <span style="color:#C39847;">Tel.</span> <a href="tel:+33000000000" style="color:#2b2b2b;text-decoration:none;">+33 0 00 00 00 00</a><br>
          <span style="color:#C39847;">Email</span> <a href="mailto:contact@entreprise.fr" style="color:#2b2b2b;text-decoration:none;">contact@entreprise.fr</a><br>
          <span style="color:#C39847;">Web</span> <a href="https://www.entreprise.fr" style="color:#2b2b2b;text-decoration:none;">www.entreprise.fr</a>
        </div>
      </td>
    </tr>
  </tbody>
</table>
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
