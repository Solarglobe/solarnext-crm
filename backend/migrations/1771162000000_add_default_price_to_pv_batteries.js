/**
 * Ajoute la colonne default_price_ht (prix catalogue HT) à pv_batteries.
 * Pas de valeur par défaut, pas de NOT NULL.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.addColumns("pv_batteries", {
    default_price_ht: { type: "numeric(12,2)", notNull: false },
  });
};

export const down = (pgm) => {
  pgm.dropColumns("pv_batteries", ["default_price_ht"]);
};
