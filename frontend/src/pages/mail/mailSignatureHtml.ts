import type { ComposerMode } from "./mailComposerLogic";

export const SOLARGLOBE_ROBUST_SIGNATURE_HTML = `
<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;color:#1f2933;font-size:13px;line-height:1.45;max-width:620px;">
  <tbody>
    <tr>
      <td style="vertical-align:middle;padding:0 18px 0 0;width:150px;">
        <div style="font-size:24px;line-height:1;font-weight:700;letter-spacing:.2px;white-space:nowrap;">
          <span style="color:#111827;">Solar</span><span style="color:#C39847;">Globe</span>
        </div>
        <div style="margin-top:6px;font-size:10px;line-height:1.35;color:#667085;text-transform:uppercase;letter-spacing:.7px;">
          Energie solaire
        </div>
      </td>
      <td style="vertical-align:middle;border-left:3px solid #C39847;padding:0 0 0 18px;">
        <div style="font-size:12px;color:#667085;line-height:1.4;">Bureau d'etude &amp; coordination photovoltaique</div>
        <div style="margin-top:6px;font-size:14px;line-height:1.45;color:#111827;">
          <strong>Benoit LETREN</strong> <span style="color:#C39847;">- President</span><br>
          <strong>Nicolas BRUNET</strong> <span style="color:#C39847;">- Directeur General</span>
        </div>
        <div style="margin-top:8px;font-size:12px;line-height:1.55;color:#2b2b2b;">
          <span style="color:#C39847;">Tel.</span> <a href="tel:+33172994753" style="color:#2b2b2b;text-decoration:none;">01 72 99 47 53</a>
          &nbsp;&nbsp;<span style="color:#C39847;">Email</span> <a href="mailto:contact@solarglobe.fr" style="color:#2b2b2b;text-decoration:none;">contact@solarglobe.fr</a><br>
          <span style="color:#C39847;">Web</span> <a href="https://www.solarglobe.fr" style="color:#2b2b2b;text-decoration:none;">www.solarglobe.fr</a>
          &nbsp;&nbsp;<span style="color:#C39847;">Social</span>
          <a href="https://www.facebook.com/people/Solarglobe/61578264284164/" style="color:#2b2b2b;text-decoration:none;">Facebook</a>
          <span style="color:#c8a35a;"> | </span>
          <a href="https://www.instagram.com/solarglobe.fr/" style="color:#2b2b2b;text-decoration:none;">Instagram</a>
          <span style="color:#c8a35a;"> | </span>
          <a href="https://www.linkedin.com/company/108327439/" style="color:#2b2b2b;text-decoration:none;">LinkedIn</a>
        </div>
        <div style="margin-top:8px;font-size:11px;line-height:1.4;color:#667085;">Solutions photovoltaiques haut rendement - Ile-de-France</div>
      </td>
    </tr>
  </tbody>
</table>
`.trim();

export function hardenMailSignatureHtml(innerHtml: string): string {
  const html = String(innerHtml || "");
  if (!html.trim()) return "";
  const hasFragileRemoteAsset = /placehold\.co|icons8\.com|logo-solarglobe-rect\.png/i.test(html);
  const looksLikeSolarGlobeSignature = /solarglobe|contact@solarglobe\.fr|01\s*72\s*99\s*47\s*53/i.test(html);
  if (hasFragileRemoteAsset && looksLikeSolarGlobeSignature) return SOLARGLOBE_ROBUST_SIGNATURE_HTML;
  return html;
}

/** Bloc signature dans le composer (évite mélange avec le corps). */
export function wrapMailSignatureHtml(innerHtml: string): string {
  const inner = hardenMailSignatureHtml(innerHtml).trim();
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
