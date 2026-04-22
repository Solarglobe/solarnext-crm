/**
 * CP-036 — Étendre types lead_activities (DEVIS_SIGNE, PROJECT_STATUS_CHANGE, INSTALLATION_TERMINEE)
 */

import { addConstraintIdempotent } from "./lib/addConstraintIdempotent.js";

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`ALTER TABLE lead_activities DROP CONSTRAINT IF EXISTS lead_activities_type_check`);
  addConstraintIdempotent(
    pgm,
    "lead_activities",
    "lead_activities_type_check",
    `CHECK (type IN (
      'NOTE', 'CALL', 'MEETING', 'EMAIL',
      'STATUS_CHANGE', 'STAGE_CHANGE', 'ADDRESS_VERIFIED',
      'PROJECT_STATUS_CHANGE', 'DEVIS_SIGNE', 'INSTALLATION_TERMINEE'
    ))`
  );
};

export const down = (pgm) => {
  pgm.sql(`ALTER TABLE lead_activities DROP CONSTRAINT IF EXISTS lead_activities_type_check`);
  addConstraintIdempotent(
    pgm,
    "lead_activities",
    "lead_activities_type_check",
    `CHECK (type IN (
      'NOTE', 'CALL', 'MEETING', 'EMAIL',
      'STATUS_CHANGE', 'STAGE_CHANGE', 'ADDRESS_VERIFIED'
    ))`
  );
};
