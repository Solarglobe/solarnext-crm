const SOLARGLOBE_SIGNATURE_HTML = `
<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;color:#1f2933;font-size:12px;line-height:1.4;max-width:640px;">
  <tbody>
    <tr>
      <td width="148" style="vertical-align:middle;padding:0 16px 0 0;width:148px;">
        <img src="https://solarnext-crm.fr/assets/branding/logo-solarglobe-rect-pdf.png" width="142" height="46" alt="SolarGlobe" style="display:block;border:0;outline:none;text-decoration:none;width:142px;height:auto;max-width:142px;">
      </td>
      <td width="2" bgcolor="#C39847" style="width:2px;min-width:2px;background:#C39847;font-size:0;line-height:0;">&nbsp;</td>
      <td width="16" style="width:16px;font-size:0;line-height:0;">&nbsp;</td>
      <td style="vertical-align:middle;padding:0;">
        <div style="font-size:12px;color:#3f4652;line-height:1.35;margin:0 0 8px 0;">Bureau d'etude &amp; coordination photovoltaique</div>
        <div style="font-size:15px;line-height:1.35;color:#111827;margin:0 0 8px 0;">
          <strong>Benoit LETREN</strong> <span style="color:#C39847;">- President</span>
        </div>
        <div style="font-size:12px;line-height:1.65;color:#1f2933;margin:0;">
          <span style="color:#C39847;">Tel.</span> <a href="tel:+33669188403" style="color:#1f2933 !important;text-decoration:none !important;"><span style="color:#1f2933;text-decoration:none;">06 69 18 84 03</span></a>
          &nbsp;&nbsp;<span style="color:#C39847;">Email</span> <a href="mailto:contact@solarglobe.fr" style="color:#1f2933 !important;text-decoration:none !important;"><span style="color:#1f2933;text-decoration:none;">contact@solarglobe.fr</span></a><br>
          <span style="color:#C39847;">Web</span> <a href="https://www.solarglobe.fr" style="color:#1f2933 !important;text-decoration:none !important;"><span style="color:#1f2933;text-decoration:none;">www.solarglobe.fr</span></a>
          &nbsp;&nbsp;<span style="color:#C39847;">Social</span>&nbsp;
          <a href="https://www.facebook.com/people/Solarglobe/61578264284164/" style="color:#1f2933 !important;text-decoration:none !important;white-space:nowrap;"><img src="https://solarnext-crm.fr/assets/branding/facebook-signature.png" width="14" height="14" alt="Facebook" style="display:inline-block;border:0;vertical-align:-2px;width:14px;height:14px;"></a>
          <span style="color:#c8a35a;">&nbsp;|&nbsp;</span>
          <a href="https://www.instagram.com/solarglobe.fr/" style="color:#1f2933 !important;text-decoration:none !important;white-space:nowrap;"><img src="https://solarnext-crm.fr/assets/branding/instagram-signature.png" width="14" height="14" alt="Instagram" style="display:inline-block;border:0;vertical-align:-2px;width:14px;height:14px;"></a>
        </div>
        <div style="margin-top:8px;font-size:11px;line-height:1.35;color:#667085;">Solutions photovoltaiques haut rendement - Ile-de-France</div>
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
       AND signature_html ILIKE '%06 69 18 84 03%';
  `);
};

export const down = () => {};
