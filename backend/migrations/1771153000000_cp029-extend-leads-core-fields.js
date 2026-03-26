/**
 * CP-029 LEAD/CLIENT RECORD — Migration A : extend_leads_core_fields
 * Ajoute/normalise les champs de la fiche unique (Lead/Client)
 * Si certains champs existent déjà, alter only (ADD COLUMN IF NOT EXISTS)
 */

export const shorthands = undefined;

export const up = (pgm) => {
  // 1. Normaliser status existant avant contrainte : converted/signed/client -> CLIENT, sinon LEAD
  pgm.sql(`
    UPDATE leads SET status = CASE
      WHEN status IN ('converted','signed','client','CLIENT') THEN 'CLIENT'
      ELSE 'LEAD'
    END
    WHERE status IS NULL OR status NOT IN ('LEAD','CLIENT');
  `);

  // 2. Colonnes identité / contact
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS civility varchar(20) NULL`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS full_name varchar(180) NULL`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS phone_mobile varchar(30) NULL`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS phone_landline varchar(30) NULL`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_salesperson_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS customer_type varchar(20) NOT NULL DEFAULT 'PERSON'`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_source varchar(80) NULL`);

  // 3. Status visibilité (status existe déjà, ajouter default et contrainte)
  pgm.sql(`ALTER TABLE leads ALTER COLUMN status SET DEFAULT 'LEAD'`);
  pgm.sql(`ALTER TABLE leads ALTER COLUMN status SET NOT NULL`);
  pgm.sql(`ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check`);
  pgm.sql(`ALTER TABLE leads ADD CONSTRAINT leads_status_check CHECK (status IN ('LEAD','CLIENT'))`);

  // 4. Remplir full_name depuis first_name + last_name
  pgm.sql(`
    UPDATE leads SET full_name = COALESCE(NULLIF(TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')), ''), 'Sans nom')
    WHERE full_name IS NULL OR full_name = '';
  `);
  pgm.sql(`ALTER TABLE leads ALTER COLUMN full_name SET DEFAULT 'Sans nom'`);
  pgm.sql(`UPDATE leads SET full_name = 'Sans nom' WHERE full_name IS NULL`);

  // 5. Copier assigned_to -> assigned_salesperson_user_id
  pgm.sql(`UPDATE leads SET assigned_salesperson_user_id = assigned_to WHERE assigned_salesperson_user_id IS NULL AND assigned_to IS NOT NULL`);

  // 6. Copier phone -> phone_mobile
  pgm.sql(`UPDATE leads SET phone_mobile = phone WHERE phone_mobile IS NULL AND phone IS NOT NULL`);

  // 7. Bien / foyer
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS property_type varchar(30) NULL`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS household_size int NULL`);
  pgm.sql(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_household_size_check') THEN ALTER TABLE leads ADD CONSTRAINT leads_household_size_check CHECK (household_size IS NULL OR household_size >= 0); END IF; END $$`);

  // 8. Conso électrique
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS consumption_mode varchar(20) NULL`);
  pgm.sql(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_consumption_mode_check') THEN ALTER TABLE leads ADD CONSTRAINT leads_consumption_mode_check CHECK (consumption_mode IS NULL OR consumption_mode IN ('ANNUAL','MONTHLY','PDL')); END IF; END $$`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS consumption_annual_kwh int NULL`);
  pgm.sql(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_consumption_annual_kwh_check') THEN ALTER TABLE leads ADD CONSTRAINT leads_consumption_annual_kwh_check CHECK (consumption_annual_kwh IS NULL OR consumption_annual_kwh >= 0); END IF; END $$`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS consumption_pdl varchar(50) NULL`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS hp_hc boolean NOT NULL DEFAULT false`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS supplier_name varchar(80) NULL`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS consumption_profile varchar(20) NULL`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS tariff_type varchar(20) NULL`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS grid_type varchar(20) NULL`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS meter_power_kva int NULL`);
  pgm.sql(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_meter_power_kva_check') THEN ALTER TABLE leads ADD CONSTRAINT leads_meter_power_kva_check CHECK (meter_power_kva IS NULL OR meter_power_kva >= 0); END IF; END $$`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS consumption_annual_calculated_kwh int NULL`);
  pgm.sql(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_consumption_annual_calculated_check') THEN ALTER TABLE leads ADD CONSTRAINT leads_consumption_annual_calculated_check CHECK (consumption_annual_calculated_kwh IS NULL OR consumption_annual_calculated_kwh >= 0); END IF; END $$`);

  // 9. Maison / toiture
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS construction_year int NULL`);
  pgm.sql(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_construction_year_check') THEN ALTER TABLE leads ADD CONSTRAINT leads_construction_year_check CHECK (construction_year IS NULL OR (construction_year >= 1800 AND construction_year <= 2100)); END IF; END $$`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS insulation_level varchar(20) NULL`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS roof_type varchar(20) NULL`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS frame_type varchar(20) NULL`);

  // 10. Business
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS estimated_budget_eur int NULL`);
  pgm.sql(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_estimated_budget_check') THEN ALTER TABLE leads ADD CONSTRAINT leads_estimated_budget_check CHECK (estimated_budget_eur IS NULL OR estimated_budget_eur >= 0); END IF; END $$`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS financing_mode varchar(20) NULL`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS project_timing varchar(20) NULL`);

  // 11. Éligibilité
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_primary_residence boolean NULL`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS house_over_2_years boolean NULL`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_abf_zone boolean NULL`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_asbestos_roof boolean NULL`);

  // 12. RGPD
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS rgpd_consent boolean NOT NULL DEFAULT false`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS rgpd_consent_at timestamptz NULL`);

  // 13. Notes internes
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS internal_note text NULL`);

  // Index
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_leads_status_cp029 ON leads(status)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_leads_full_name ON leads(full_name)`);
};

export const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_leads_full_name`);
  pgm.sql(`DROP INDEX IF EXISTS idx_leads_status_cp029`);

  pgm.sql(`ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check`);
  pgm.sql(`ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_household_size_check`);
  pgm.sql(`ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_consumption_mode_check`);
  pgm.sql(`ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_consumption_annual_kwh_check`);
  pgm.sql(`ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_meter_power_kva_check`);
  pgm.sql(`ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_consumption_annual_calculated_check`);
  pgm.sql(`ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_construction_year_check`);
  pgm.sql(`ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_estimated_budget_check`);

  const cols = [
    "civility", "full_name", "phone_mobile", "phone_landline", "assigned_salesperson_user_id",
    "customer_type", "lead_source", "property_type", "household_size",
    "consumption_mode", "consumption_annual_kwh", "consumption_pdl", "hp_hc", "supplier_name",
    "consumption_profile", "tariff_type", "grid_type", "meter_power_kva", "consumption_annual_calculated_kwh",
    "construction_year", "insulation_level", "roof_type", "frame_type",
    "estimated_budget_eur", "financing_mode", "project_timing",
    "is_primary_residence", "house_over_2_years", "is_abf_zone", "has_asbestos_roof",
    "rgpd_consent", "rgpd_consent_at", "internal_note"
  ];
  cols.forEach((c) => pgm.sql(`ALTER TABLE leads DROP COLUMN IF EXISTS "${c}"`));
};
