/**
 * Coût d'achat HT optionnel par batterie catalogue (marge interne devis technique).
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.addColumns("pv_batteries", {
    purchase_price_ht: { type: "numeric(12,2)", notNull: false },
  });
};

export const down = (pgm) => {
  pgm.dropColumns("pv_batteries", ["purchase_price_ht"]);
};
