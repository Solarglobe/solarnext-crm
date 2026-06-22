/**
 * CP-QUOTE-BILLING-PARTY — Notion "facturé par qui" pour les lignes de devis/facture.
 *
 * SOLARGLOBE     : prestation facturée et encaissée par SolarGlobe (matériel, coffret, étude,
 *                  démarches, raccordement si facturé, accompagnement, logiciel offert...).
 * INSTALLER_RGE  : pose réalisée et facturée DIRECTEMENT par un installateur RGE indépendant.
 *                  Affichée pour information, JAMAIS incluse dans le total facturable SolarGlobe,
 *                  JAMAIS copiée dans une facture SolarGlobe.
 *
 * Module pur (sans I/O) : testable unitairement sans base de données.
 */

export const BILLING_PARTY_SOLARGLOBE = "SOLARGLOBE";
export const BILLING_PARTY_INSTALLER_RGE = "INSTALLER_RGE";
export const VALID_BILLING_PARTIES = Object.freeze([
  BILLING_PARTY_SOLARGLOBE,
  BILLING_PARTY_INSTALLER_RGE,
]);

/** Toute valeur inconnue/absente retombe sur SOLARGLOBE (non rétroactif / sûr). */
export function normalizeBillingParty(value) {
  const s = String(value ?? "").trim().toUpperCase();
  return s === BILLING_PARTY_INSTALLER_RGE ? BILLING_PARTY_INSTALLER_RGE : BILLING_PARTY_SOLARGLOBE;
}

/** @param {{ billing_party?: unknown }} line */
export function isInstallerRgeLine(line) {
  return normalizeBillingParty(line?.billing_party) === BILLING_PARTY_INSTALLER_RGE;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Répartit des lignes (avec total_line_ht/vat/ttc + billing_party) en 3 blocs :
 *  - solarglobe         : seules lignes SolarGlobe (= total facturable, base facture/acompte)
 *  - installer          : seules lignes INSTALLER_RGE (estimation pose indicative)
 *  - project_indicative : somme des deux (coût global indicatif, jamais facturé tel quel)
 *
 * Les lignes avec is_active === false sont ignorées (cohérent avec le moteur SQL).
 *
 * @param {Array<{ billing_party?: unknown, is_active?: unknown,
 *                 total_line_ht?: number, total_line_vat?: number, total_line_ttc?: number }>} lines
 */
export function splitQuoteTotalsByBillingParty(lines) {
  let sgHt = 0, sgVat = 0, sgTtc = 0;
  let inHt = 0, inVat = 0, inTtc = 0;

  for (const l of lines || []) {
    if (l && l.is_active === false) continue;
    const ht = Number(l?.total_line_ht) || 0;
    const vat = Number(l?.total_line_vat) || 0;
    const ttc = Number(l?.total_line_ttc) || 0;
    if (isInstallerRgeLine(l)) {
      inHt += ht; inVat += vat; inTtc += ttc;
    } else {
      sgHt += ht; sgVat += vat; sgTtc += ttc;
    }
  }

  const solarglobe = { total_ht: round2(sgHt), total_vat: round2(sgVat), total_ttc: round2(sgTtc) };
  const installer = { total_ht: round2(inHt), total_vat: round2(inVat), total_ttc: round2(inTtc) };
  const project_indicative = {
    total_ht: round2(solarglobe.total_ht + installer.total_ht),
    total_vat: round2(solarglobe.total_vat + installer.total_vat),
    total_ttc: round2(solarglobe.total_ttc + installer.total_ttc),
  };

  return { solarglobe, installer, project_indicative };
}
