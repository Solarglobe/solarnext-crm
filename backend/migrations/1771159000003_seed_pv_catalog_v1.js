/**
 * CP-002 — Seed catalogue PV v1 (panneaux, onduleurs, batteries)
 * Idempotent : ON CONFLICT DO UPDATE
 */

export const shorthands = undefined;

const esc = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

export const up = (pgm) => {
  // E1) PANNEAUX
  const panels = [
    {
      name: "LONGi 485W",
      brand: "LONGi",
      model_ref: "Hi-MO6-485",
      technology: "TOPCon",
      bifacial: false,
      power_wc: 485,
      efficiency_pct: 22.8,
      temp_coeff_pct_per_deg: -0.29,
      degradation_first_year_pct: 1.0,
      degradation_annual_pct: 0.4,
      width_mm: 2278,
      height_mm: 1134,
      thickness_mm: 30,
      weight_kg: 28.5,
    },
    {
      name: "LONGi 500W",
      brand: "LONGi",
      model_ref: "Hi-MO6-500",
      technology: "TOPCon",
      bifacial: false,
      power_wc: 500,
      efficiency_pct: 22.9,
      temp_coeff_pct_per_deg: -0.29,
      degradation_first_year_pct: 1.0,
      degradation_annual_pct: 0.4,
      width_mm: 2278,
      height_mm: 1134,
      thickness_mm: 30,
      weight_kg: 29.0,
    },
    {
      name: "DualSun FLASH 500",
      brand: "DualSun",
      model_ref: "FLASH-500",
      technology: "PERC",
      bifacial: false,
      power_wc: 500,
      efficiency_pct: 22.6,
      temp_coeff_pct_per_deg: -0.3,
      degradation_first_year_pct: 1.0,
      degradation_annual_pct: 0.4,
      width_mm: 2094,
      height_mm: 1134,
      thickness_mm: 35,
      weight_kg: 27.5,
    },
    {
      name: "DMEGC 500",
      brand: "DMEGC",
      model_ref: "DM500M10RT-B60HBB",
      technology: "PERC",
      bifacial: false,
      power_wc: 500,
      efficiency_pct: 21.2,
      temp_coeff_pct_per_deg: -0.35,
      degradation_first_year_pct: 1.0,
      degradation_annual_pct: 0.4,
      width_mm: 2279,
      height_mm: 1134,
      thickness_mm: 30,
      weight_kg: 28.0,
    },
  ];

  for (const p of panels) {
    pgm.sql(`
      INSERT INTO pv_panels (name, brand, model_ref, technology, bifacial, power_wc, efficiency_pct, temp_coeff_pct_per_deg, degradation_first_year_pct, degradation_annual_pct, width_mm, height_mm, thickness_mm, weight_kg)
      VALUES (${esc(p.name)}, ${esc(p.brand)}, ${esc(p.model_ref)}, ${esc(p.technology)}, ${p.bifacial}, ${p.power_wc}, ${p.efficiency_pct}, ${p.temp_coeff_pct_per_deg}, ${p.degradation_first_year_pct}, ${p.degradation_annual_pct}, ${p.width_mm}, ${p.height_mm}, ${p.thickness_mm ?? "NULL"}, ${p.weight_kg != null ? p.weight_kg : "NULL"})
      ON CONFLICT (brand, model_ref) DO UPDATE SET
        name = EXCLUDED.name,
        technology = EXCLUDED.technology,
        power_wc = EXCLUDED.power_wc,
        efficiency_pct = EXCLUDED.efficiency_pct,
        temp_coeff_pct_per_deg = EXCLUDED.temp_coeff_pct_per_deg,
        width_mm = EXCLUDED.width_mm,
        height_mm = EXCLUDED.height_mm,
        thickness_mm = EXCLUDED.thickness_mm,
        weight_kg = EXCLUDED.weight_kg,
        updated_at = now()
    `);
  }

  // E2) MICRO ATMOCE
  const atmoceMicros = [
    { name: "ATMOCE MI-450", brand: "ATMOCE", model_ref: "MI-450", nominal_va: 450, inverter_type: "micro" },
    { name: "ATMOCE MI-500", brand: "ATMOCE", model_ref: "MI-500", nominal_va: 500, inverter_type: "micro" },
    { name: "ATMOCE MI-600", brand: "ATMOCE", model_ref: "MI-600", nominal_va: 600, inverter_type: "micro" },
    { name: "ATMOCE MI-1000", brand: "ATMOCE", model_ref: "MI-1000", nominal_va: 1000, inverter_type: "micro" },
  ];

  for (const m of atmoceMicros) {
    pgm.sql(`
      INSERT INTO pv_inverters (name, brand, model_ref, inverter_type, nominal_va, phases)
      VALUES (${esc(m.name)}, ${esc(m.brand)}, ${esc(m.model_ref)}, 'micro', ${m.nominal_va}, '1P')
      ON CONFLICT (brand, model_ref) DO UPDATE SET name = EXCLUDED.name, nominal_va = EXCLUDED.nominal_va, updated_at = now()
    `);
  }

  // E3) MICRO ENPHASE
  const enphaseMicros = [
    { name: "Enphase IQ8MC", brand: "Enphase", model_ref: "IQ8MC", nominal_va: 290, inverter_type: "micro" },
    { name: "Enphase IQ8AC", brand: "Enphase", model_ref: "IQ8AC", nominal_va: 366, inverter_type: "micro" },
    { name: "Enphase IQ8HC", brand: "Enphase", model_ref: "IQ8HC", nominal_va: 460, inverter_type: "micro" },
  ];

  for (const m of enphaseMicros) {
    pgm.sql(`
      INSERT INTO pv_inverters (name, brand, model_ref, inverter_type, nominal_va, phases)
      VALUES (${esc(m.name)}, ${esc(m.brand)}, ${esc(m.model_ref)}, 'micro', ${m.nominal_va}, '1P')
      ON CONFLICT (brand, model_ref) DO UPDATE SET name = EXCLUDED.name, nominal_va = EXCLUDED.nominal_va, updated_at = now()
    `);
  }

  // E4) ONDULEURS HUAWEI
  const huaweiString = [
    { model: "2KTL", power: 2, phases: "1P", battery: false },
    { model: "3KTL", power: 3, phases: "1P", battery: false },
    { model: "4KTL", power: 4, phases: "1P", battery: false },
    { model: "5KTL", power: 5, phases: "1P", battery: false },
    { model: "6KTL", power: 6, phases: "1P", battery: false },
    { model: "3KTL-M1", power: 3, phases: "3P", battery: true },
    { model: "4KTL-M1", power: 4, phases: "3P", battery: true },
    { model: "5KTL-M1", power: 5, phases: "3P", battery: true },
    { model: "6KTL-M1", power: 6, phases: "3P", battery: true },
    { model: "8KTL-M1", power: 8, phases: "3P", battery: true },
    { model: "10KTL-M1", power: 10, phases: "3P", battery: true },
    { model: "12KTL-M2", power: 12, phases: "3P", battery: true },
    { model: "15KTL-M2", power: 15, phases: "3P", battery: true },
    { model: "17KTL-M2", power: 17, phases: "3P", battery: true },
    { model: "20KTL-M2", power: 20, phases: "3P", battery: true },
  ];

  for (const h of huaweiString) {
    pgm.sql(`
      INSERT INTO pv_inverters (name, brand, model_ref, inverter_type, nominal_power_kw, phases, compatible_battery)
      VALUES (${esc("Huawei " + h.model)}, 'Huawei', ${esc(h.model)}, 'string', ${h.power}, ${esc(h.phases)}, ${h.battery})
      ON CONFLICT (brand, model_ref) DO UPDATE SET name = EXCLUDED.name, nominal_power_kw = EXCLUDED.nominal_power_kw, compatible_battery = EXCLUDED.compatible_battery, updated_at = now()
    `);
  }

  // E5) BATTERIES
  const batteries = [
    { name: "ATMOCE 7kWh", brand: "ATMOCE", model_ref: "BAT-7", usable_kwh: 7, chemistry: "LFP" },
    { name: "Enphase IQ Battery 5P", brand: "Enphase", model_ref: "IQ-Battery-5P", usable_kwh: 5.1, chemistry: "LFP" },
    { name: "Enphase IQ Battery 10T", brand: "Enphase", model_ref: "IQ-Battery-10T", usable_kwh: 10.1, chemistry: "LFP" },
    { name: "Huawei LUNA2000 5kWh", brand: "Huawei", model_ref: "LUNA2000-5", usable_kwh: 5, chemistry: "LFP", scalable: true, max_modules: 3 },
    { name: "Huawei LUNA2000 10kWh", brand: "Huawei", model_ref: "LUNA2000-10", usable_kwh: 10, chemistry: "LFP", scalable: true, max_modules: 3 },
    { name: "Huawei LUNA2000 15kWh", brand: "Huawei", model_ref: "LUNA2000-15", usable_kwh: 15, chemistry: "LFP", scalable: true, max_modules: 3 },
  ];

  for (const b of batteries) {
    pgm.sql(`
      INSERT INTO pv_batteries (name, brand, model_ref, usable_kwh, chemistry, scalable, max_modules)
      VALUES (${esc(b.name)}, ${esc(b.brand)}, ${esc(b.model_ref)}, ${b.usable_kwh}, ${esc(b.chemistry)}, ${b.scalable ?? false}, ${b.max_modules ?? "NULL"})
      ON CONFLICT (brand, model_ref) DO UPDATE SET name = EXCLUDED.name, usable_kwh = EXCLUDED.usable_kwh, chemistry = EXCLUDED.chemistry, scalable = EXCLUDED.scalable, max_modules = EXCLUDED.max_modules, updated_at = now()
    `);
  }
};

export const down = (pgm) => {
  pgm.sql("DELETE FROM pv_panels WHERE brand IN ('LONGi', 'DualSun', 'DMEGC')");
  pgm.sql("DELETE FROM pv_inverters WHERE brand IN ('ATMOCE', 'Enphase', 'Huawei')");
  pgm.sql("DELETE FROM pv_batteries WHERE brand IN ('ATMOCE', 'Enphase', 'Huawei')");
};
