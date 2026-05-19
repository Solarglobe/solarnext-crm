/**
 * Backfill onboarding company fields into canonical organization columns.
 *
 * Mapping:
 * - onboarding.profile.name -> organizations.name + legal_name
 * - onboarding.profile.siret -> organizations.siret
 * - onboarding.profile.rge_number -> organizations.rge_number
 * - onboarding.profile.address -> organizations.address_line1
 * - onboarding.profile.primary_color -> organizations.pdf_primary_color
 *
 * Idempotent: only fills empty canonical fields.
 */
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS rge_number VARCHAR(100) NULL;

    UPDATE organizations
    SET
      legal_name = COALESCE(NULLIF(TRIM(legal_name), ''), NULLIF(TRIM(settings_json #>> '{onboarding,profile,name}'), '')),
      siret = COALESCE(NULLIF(TRIM(siret), ''), NULLIF(TRIM(settings_json #>> '{onboarding,profile,siret}'), '')),
      rge_number = COALESCE(NULLIF(TRIM(rge_number), ''), NULLIF(TRIM(settings_json #>> '{onboarding,profile,rge_number}'), '')),
      address_line1 = COALESCE(NULLIF(TRIM(address_line1), ''), NULLIF(TRIM(settings_json #>> '{onboarding,profile,address}'), '')),
      pdf_primary_color = COALESCE(
        NULLIF(TRIM(pdf_primary_color), ''),
        CASE
          WHEN NULLIF(TRIM(settings_json #>> '{onboarding,profile,primary_color}'), '') ~ '^#[0-9A-Fa-f]{6}$'
          THEN NULLIF(TRIM(settings_json #>> '{onboarding,profile,primary_color}'), '')
          ELSE NULL
        END
      )
    WHERE settings_json ? 'onboarding';
  `);
};

export const down = () => {
  // No-op: backfilled official organization data should not be erased.
};
