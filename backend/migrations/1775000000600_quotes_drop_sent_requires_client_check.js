/**
 * Devis SENT / ACCEPTED sans fiche client : destinataire = lead (customer_snapshot).
 * Timestamp 1775000000600 : après 1775000000500_fix_missing_idx_lcm_meter_id (ordre pgmigrations).
 */

import { addConstraintIdempotent } from "./lib/addConstraintIdempotent.js";

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_sent_requires_client_check;`);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  addConstraintIdempotent(
    pgm,
    "quotes",
    "quotes_sent_requires_client_check",
    `CHECK (
      NOT (
        status IN ('READY_TO_SEND','SENT','ACCEPTED','REJECTED','EXPIRED')
        AND client_id IS NULL
      )
    )`
  );
};
