/**
 * V21 fresh-database prerequisite. The historical multi-meter migrations are
 * placeholders, so a newly migrated database lacks the monthly meter link.
 * Preserve existing kWh and links; attach only legacy unassigned months to the
 * lead's principal meter. No Enedis schema or business integration is involved.
 */
export const shorthands = undefined;

export const up = (pgm) => pgm.sql(`
  ALTER TABLE lead_consumption_monthly ADD COLUMN IF NOT EXISTS meter_id uuid;

  INSERT INTO lead_meters (
    organization_id, lead_id, name, is_default, sort_order,
    consumption_pdl, meter_power_kva, grid_type, consumption_mode,
    consumption_annual_kwh, consumption_annual_calculated_kwh,
    consumption_profile, hp_hc, supplier_name, tariff_type,
    elec_price_base_eur_kwh, elec_price_hp_eur_kwh, elec_price_hc_eur_kwh,
    electricity_subscription_ttc_month, electricity_annual_bill_ttc,
    energy_profile, equipement_actuel, equipement_actuel_params, equipements_a_venir
  )
  SELECT l.organization_id, l.id, 'Compteur principal', true, 0,
    l.consumption_pdl, l.meter_power_kva, l.grid_type, l.consumption_mode,
    l.consumption_annual_kwh, l.consumption_annual_calculated_kwh,
    l.consumption_profile, COALESCE(l.hp_hc, false), l.supplier_name, l.tariff_type,
    l.elec_price_base_eur_kwh, l.elec_price_hp_eur_kwh, l.elec_price_hc_eur_kwh,
    l.electricity_subscription_ttc_month, l.electricity_annual_bill_ttc,
    l.energy_profile, l.equipement_actuel, l.equipement_actuel_params, l.equipements_a_venir
  FROM leads l
  WHERE EXISTS (
    SELECT 1 FROM lead_consumption_monthly cm
    WHERE cm.lead_id = l.id AND cm.organization_id = l.organization_id AND cm.meter_id IS NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM lead_meters m
    WHERE m.lead_id = l.id AND m.organization_id = l.organization_id AND m.is_default
  );

  UPDATE lead_consumption_monthly cm
  SET meter_id = m.id
  FROM lead_meters m
  WHERE cm.meter_id IS NULL AND m.is_default
    AND m.lead_id = cm.lead_id AND m.organization_id = cm.organization_id;

  -- A malformed historical ownership row fails migration instead of guessing.
  ALTER TABLE lead_consumption_monthly ALTER COLUMN meter_id SET NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_meters_v21_ownership
    ON lead_meters (id, lead_id, organization_id);

  DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'lead_consumption_monthly'::regclass
        AND conname = 'lcm_v21_meter_ownership_fk'
    ) THEN
      ALTER TABLE lead_consumption_monthly
        ADD CONSTRAINT lcm_v21_meter_ownership_fk
        FOREIGN KEY (meter_id, lead_id, organization_id)
        REFERENCES lead_meters (id, lead_id, organization_id) ON DELETE CASCADE;
    END IF;
  END $$;

  -- The historical per-lead uniqueness prevents two meters using the same month.
  ALTER TABLE lead_consumption_monthly DROP CONSTRAINT IF EXISTS lcm_lead_year_month_unique;
  DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'lead_consumption_monthly'::regclass
        AND conname = 'lcm_meter_year_month_unique'
    ) THEN
      ALTER TABLE lead_consumption_monthly
        ADD CONSTRAINT lcm_meter_year_month_unique UNIQUE (meter_id, year, month);
    END IF;
  END $$;
`);

// Application rollback keeps compatible additive schema and customer readings.
// Dropping meter_id would irreversibly merge distinct meters' monthly histories.
export const down = (pgm) => pgm.sql('SELECT 1');
