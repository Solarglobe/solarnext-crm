/**
 * Signature mail SolarGlobe robuste : aucune image distante indispensable.
 *
 * Les anciennes signatures utilisaient des images https (logo, trait vertical, icones sociales).
 * Selon le client mail, elles pouvaient etre bloquees apres envoi. Cette migration ne touche que
 * les signatures qui portent ces URLs fragiles.
 */

export const shorthands = undefined;

const SOLARGLOBE_SIGNATURE_HTML = `
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

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(
    `
    UPDATE mail_signatures
       SET signature_html = $sig$${SOLARGLOBE_SIGNATURE_HTML}$sig$,
           updated_at = now()
     WHERE is_active = true
       AND (
         signature_html ILIKE '%placehold.co%'
         OR signature_html ILIKE '%icons8.com%'
         OR signature_html ILIKE '%logo-solarglobe-rect.png%'
       );
  `
  );
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = () => {
  /* no-op: on ne restaure pas une signature dependante d'images distantes. */
};
