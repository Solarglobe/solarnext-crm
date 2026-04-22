/**
 * Colonne reply_to sur mail_outbox (déplacée hors de 1775920000000 pour respecter l’immuabilité
 * des migrations déjà exécutées — checksum migration_checksums).
 */

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.addColumns("mail_outbox", {
    reply_to: { type: "text" },
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropColumns("mail_outbox", ["reply_to"]);
};
