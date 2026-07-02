/**
 * LOT2-PRIX-COMPTEUR — prix de l'électricité du client (facture fournisseur),
 * saisis dans la fiche compteur. PAS présents dans les flux Enedis (C68/R65 = acheminement
 * seulement) → saisie manuelle, défaut = réglages org.
 * BASE : elec_price_base_eur_kwh ; HP/HC : elec_price_hp_eur_kwh + elec_price_hc_eur_kwh (TTC, €/kWh).
 * Portés par lead_meters (vérité compteur) + colonnes à plat leads (compat moteur/API).
 */

export const shorthands = undefined;

const COLS = {
  elec_price_base_eur_kwh: { type: "numeric(8,5)", notNull: false },
  elec_price_hp_eur_kwh: { type: "numeric(8,5)", notNull: false },
  elec_price_hc_eur_kwh: { type: "numeric(8,5)", notNull: false },
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.addColumns("leads", COLS);
  pgm.addColumns("lead_meters", COLS);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropColumns("lead_meters", Object.keys(COLS));
  pgm.dropColumns("leads", Object.keys(COLS));
};
