const SOLARGLOBE_SIGNATURE_HTML = `
<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;color:#1f2933;font-size:13px;line-height:1.45;max-width:620px;">
  <tbody>
    <tr>
      <td style="vertical-align:middle;padding:0 18px 0 0;width:170px;">
        <img src="https://solarnext-crm.fr/assets/branding/logo-solarglobe-rect-pdf.png" width="160" height="52" alt="SolarGlobe" style="display:block;border:0;outline:none;text-decoration:none;width:160px;height:auto;max-width:160px;">
      </td>
      <td style="vertical-align:middle;border-left:3px solid #C39847;padding:0 0 0 18px;">
        <div style="font-size:12px;color:#667085;line-height:1.4;">Bureau d'etude &amp; coordination photovoltaique</div>
        <div style="margin-top:6px;font-size:14px;line-height:1.45;color:#111827;">
          <strong>Benoit LETREN</strong> <span style="color:#C39847;">- President</span>
        </div>
        <div style="margin-top:8px;font-size:12px;line-height:1.55;color:#2b2b2b;">
          <span style="color:#C39847;">Tel.</span> <a href="tel:+33669188403" style="color:#2b2b2b;text-decoration:none;">06 69 18 84 03</a>
          &nbsp;&nbsp;<span style="color:#C39847;">Email</span> <a href="mailto:contact@solarglobe.fr" style="color:#2b2b2b;text-decoration:none;">contact@solarglobe.fr</a><br>
          <span style="color:#C39847;">Web</span> <a href="https://www.solarglobe.fr" style="color:#2b2b2b;text-decoration:none;">www.solarglobe.fr</a>
          &nbsp;&nbsp;<span style="color:#C39847;">Social</span>&nbsp;
          <a href="https://www.facebook.com/people/Solarglobe/61578264284164/" style="color:#2b2b2b;text-decoration:none;white-space:nowrap;"><img src="https://solarnext-crm.fr/assets/branding/facebook-signature.png" width="16" height="16" alt="Facebook" style="display:inline-block;border:0;vertical-align:-3px;width:16px;height:16px;"> <span style="color:#2b2b2b;">Facebook</span></a>
          <span style="color:#c8a35a;"> | </span>
          <a href="https://www.instagram.com/solarglobe.fr/" style="color:#2b2b2b;text-decoration:none;white-space:nowrap;"><img src="https://solarnext-crm.fr/assets/branding/instagram-signature.png" width="16" height="16" alt="Instagram" style="display:inline-block;border:0;vertical-align:-3px;width:16px;height:16px;"> <span style="color:#2b2b2b;">Instagram</span></a>
        </div>
        <div style="margin-top:8px;font-size:11px;line-height:1.4;color:#667085;">Solutions photovoltaiques haut rendement - Ile-de-France</div>
      </td>
    </tr>
  </tbody>
</table>
`.trim();

export const up = (pgm) => {
  pgm.sql(`
    UPDATE mail_signatures
       SET signature_html = $sig$${SOLARGLOBE_SIGNATURE_HTML}$sig$,
           updated_at = now()
     WHERE is_active = true
       AND signature_html ILIKE '%solarglobe%'
       AND (
         signature_html ILIKE '%Nicolas BRUNET%'
         OR signature_html ILIKE '%01 72 99 47 53%'
         OR signature_html ILIKE '%LinkedIn%'
         OR signature_html ILIKE '%logo-solarglobe-rect%'
       );
  `);
};

export const down = () => {};
