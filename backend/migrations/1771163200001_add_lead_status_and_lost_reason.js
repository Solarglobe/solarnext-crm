/**
 * CP-REFAC — Statuts commerciaux leads + lost_reason + contrainte LOST
 * - lost_reason TEXT (obligatoire si status = LOST)
 * - archived_at : déjà présent (CP-032A timestamptz) — ADD IF NOT EXISTS pour idempotence
 * - Extension leads_status_check : conserve LEAD, CLIENT + nouveaux codes métier
 * - status est VARCHAR (pas ENUM) — pas d’ALTER TYPE
 * - Index perf (IF NOT EXISTS)
 */

import { addConstraintIdempotent } from "./lib/addConstraintIdempotent.js";

export const shorthands = undefined;

/** Statuts autorisés après migration (LEAD/CLIENT conservés pour l’existant) */
const LEAD_STATUS_VALUES = [
  "LEAD",
  "CLIENT",
  "NEW",
  "QUALIFIED",
  "APPOINTMENT",
  "OFFER_SENT",
  "IN_REFLECTION",
  "FOLLOW_UP",
  "LOST",
  "ARCHIVED",
  "SIGNED",
];

export const up = (pgm) => {
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS lost_reason TEXT`);

  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE`);

  pgm.sql(`ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check`);
  const statusList = LEAD_STATUS_VALUES.map((s) => `'${s}'`).join(", ");
  addConstraintIdempotent(
    pgm,
    "leads",
    "leads_status_check",
    `CHECK (status IN (${statusList}))`
  );

  addConstraintIdempotent(
    pgm,
    "leads",
    "check_lost_reason",
    `CHECK (
          status <> 'LOST'
          OR (lost_reason IS NOT NULL AND length(trim(lost_reason)) > 0)
        )`
  );

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_leads_archived_at ON leads(archived_at)`);
};

export const down = (pgm) => {
  /* Ne pas DROP idx_leads_* : peuvent exister depuis CP-032A / CP-035 */

  pgm.sql(`ALTER TABLE leads DROP CONSTRAINT IF EXISTS check_lost_reason`);

  pgm.sql(`
    UPDATE leads SET status = 'LEAD', lost_reason = NULL
    WHERE status IS NOT NULL AND status NOT IN ('LEAD', 'CLIENT');
  `);

  pgm.sql(`ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check`);
  addConstraintIdempotent(
    pgm,
    "leads",
    "leads_status_check",
    "CHECK (status IN ('LEAD','CLIENT'))"
  );

  pgm.sql(`ALTER TABLE leads DROP COLUMN IF EXISTS lost_reason`);
};
