/**
 * PV-CATALOG-2026 - Seed global sans prix.
 *
 * Donnees techniques de demarrage issues de sources publiques/fabricants.
 * Les prix restent volontairement vides: ils viennent des imports fournisseur.
 */

export const shorthands = undefined;

const esc = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const num = (v) => (v == null ? "NULL" : Number(v));
const bool = (v) => (v ? "true" : "false");
const arr = (values = []) => `ARRAY[${values.map(esc).join(",")}]::text[]`;

const VERIFIED = "2026-05-01";
const CEC = "California Energy Commission Solar Equipment Lists";
const CEC_URL = "https://www.energy.ca.gov/programs-and-topics/programs/solar-equipment-lists";
const ENF = "ENF Solar product directory";
const ENF_URL = "https://www.enfsolar.com/";

const panels = [
  {
    brand: "LONGi",
    model_ref: "Hi-MO X10 LR7-54HVB-500M",
    name: "LONGi Hi-MO X10 500W",
    technology: "TOPCon",
    power_wc: 500,
    efficiency_pct: 24.5,
    width_mm: 1990,
    height_mm: 1134,
    thickness_mm: 30,
    weight_kg: 23.5,
    warranty_product_years: 15,
    warranty_performance_years: 30,
    certificate_iec: "IEC 61215 / IEC 61730",
    source_name: CEC,
    source_url: CEC_URL,
    datasheet_url: "https://www.longi.com/en/products/modules/hi-mo-x10/",
    data_confidence: 0.9,
    is_favorite: true,
  },
  {
    brand: "DualSun",
    model_ref: "FLASH-500-Half-Cut-Glass-Glass",
    name: "DualSun FLASH 500 Half-Cut Glass-Glass",
    technology: "TOPCon",
    power_wc: 500,
    efficiency_pct: 22.6,
    width_mm: 2094,
    height_mm: 1134,
    thickness_mm: 30,
    weight_kg: 27.0,
    warranty_product_years: 30,
    warranty_performance_years: 30,
    certificate_iec: "IEC 61215 / IEC 61730",
    source_name: ENF,
    source_url: ENF_URL,
    datasheet_url: "https://dualsun.com/en/product/flash-half-cut-glass-glass/",
    data_confidence: 0.82,
    is_favorite: true,
  },
  {
    brand: "Trina Solar",
    model_ref: "TSM-NEG18R.28-500W",
    name: "Trina Vertex S+ 500W",
    technology: "TOPCon",
    power_wc: 500,
    efficiency_pct: 22.5,
    width_mm: 1961,
    height_mm: 1134,
    thickness_mm: 30,
    weight_kg: 23.5,
    warranty_product_years: 25,
    warranty_performance_years: 30,
    certificate_iec: "IEC 61215 / IEC 61730",
    source_name: CEC,
    source_url: CEC_URL,
    datasheet_url: "https://www.trinasolar.com/en-glb/product/VERTEX-S-NEG18R.28",
    data_confidence: 0.86,
  },
  {
    brand: "JA Solar",
    model_ref: "JAM54D41-455/LB",
    name: "JA Solar DeepBlue 4.0 Pro 455W",
    technology: "TOPCon",
    bifacial: true,
    power_wc: 455,
    efficiency_pct: 22.8,
    width_mm: 1762,
    height_mm: 1134,
    thickness_mm: 30,
    weight_kg: 21.5,
    warranty_product_years: 25,
    warranty_performance_years: 30,
    certificate_iec: "IEC 61215 / IEC 61730",
    source_name: CEC,
    source_url: CEC_URL,
    datasheet_url: "https://www.jasolar.com/",
    data_confidence: 0.82,
  },
  {
    brand: "DMEGC",
    model_ref: "DM500M10RT-B60HBB",
    name: "DMEGC 500W TOPCon",
    technology: "TOPCon",
    power_wc: 500,
    efficiency_pct: 22.6,
    width_mm: 2279,
    height_mm: 1134,
    thickness_mm: 30,
    weight_kg: 28.0,
    warranty_product_years: 25,
    warranty_performance_years: 30,
    certificate_iec: "IEC 61215 / IEC 61730",
    source_name: ENF,
    source_url: ENF_URL,
    datasheet_url: "https://www.dmegcsolar.com/",
    data_confidence: 0.76,
  },
];

const inverters = [
  {
    brand: "Enphase",
    model_ref: "IQ8P-3P",
    name: "Enphase IQ8P 3P",
    inverter_type: "micro",
    inverter_family: "MICRO",
    nominal_va: 480,
    phases: "3P",
    modules_per_inverter: 1,
    max_input_current_a: 14,
    max_dc_power_kw: 0.67,
    euro_efficiency_pct: 97.2,
    monitoring_integrated: true,
    compatible_battery: true,
    source_name: CEC,
    source_url: CEC_URL,
    datasheet_url: "https://enphase.com/",
    data_confidence: 0.86,
    is_favorite: true,
  },
  {
    brand: "Enphase",
    model_ref: "IQ8HC",
    name: "Enphase IQ8HC",
    inverter_type: "micro",
    inverter_family: "MICRO",
    nominal_va: 384,
    phases: "1P",
    modules_per_inverter: 1,
    max_input_current_a: 14,
    max_dc_power_kw: 0.56,
    euro_efficiency_pct: 97.0,
    monitoring_integrated: true,
    compatible_battery: true,
    source_name: CEC,
    source_url: CEC_URL,
    datasheet_url: "https://enphase.com/",
    data_confidence: 0.86,
    is_favorite: true,
  },
  {
    brand: "APsystems",
    model_ref: "DS3-H",
    name: "APsystems DS3-H",
    inverter_type: "micro",
    inverter_family: "MICRO",
    nominal_va: 960,
    phases: "1P",
    modules_per_inverter: 2,
    max_input_current_a: 20,
    max_dc_power_kw: 1.36,
    euro_efficiency_pct: 97.0,
    monitoring_integrated: true,
    compatible_battery: false,
    source_name: ENF,
    source_url: ENF_URL,
    datasheet_url: "https://emea.apsystems.com/",
    data_confidence: 0.78,
  },
  {
    brand: "Huawei",
    model_ref: "SUN2000-6KTL-M1",
    name: "Huawei SUN2000-6KTL-M1",
    inverter_type: "string",
    inverter_family: "CENTRAL",
    nominal_power_kw: 6,
    phases: "3P",
    mppt_count: 2,
    inputs_per_mppt: 1,
    mppt_min_v: 140,
    mppt_max_v: 980,
    max_input_current_a: 13.5,
    max_dc_power_kw: 9,
    euro_efficiency_pct: 97.7,
    monitoring_integrated: true,
    compatible_battery: true,
    source_name: CEC,
    source_url: CEC_URL,
    datasheet_url: "https://solar.huawei.com/",
    data_confidence: 0.86,
    is_favorite: true,
  },
  {
    brand: "SolarEdge",
    model_ref: "SE5000H",
    name: "SolarEdge SE5000H",
    inverter_type: "string",
    inverter_family: "CENTRAL",
    nominal_power_kw: 5,
    phases: "1P",
    mppt_count: 1,
    inputs_per_mppt: 1,
    mppt_min_v: 380,
    mppt_max_v: 480,
    max_input_current_a: 13.5,
    max_dc_power_kw: 7.75,
    euro_efficiency_pct: 98.8,
    monitoring_integrated: true,
    compatible_battery: false,
    source_name: CEC,
    source_url: CEC_URL,
    datasheet_url: "https://knowledge-center.solaredge.com/sites/kc/files/se-single-phase-inverter-datasheet.pdf",
    data_confidence: 0.88,
  },
];

const batteries = [
  {
    brand: "Enphase",
    model_ref: "IQ-Battery-5P",
    name: "Enphase IQ Battery 5P",
    usable_kwh: 5,
    nominal_voltage_v: 67.2,
    max_charge_kw: 3.84,
    max_discharge_kw: 3.84,
    roundtrip_efficiency_pct: 90,
    depth_of_discharge_pct: 100,
    cycle_life: 6000,
    chemistry: "LFP",
    scalable: true,
    max_modules: 16,
    warranty_years: 15,
    source_name: CEC,
    source_url: CEC_URL,
    datasheet_url: "https://enphase.com/",
    data_confidence: 0.86,
    is_favorite: true,
  },
  {
    brand: "Huawei",
    model_ref: "LUNA2000-7-S1",
    name: "Huawei LUNA2000-7-S1",
    usable_kwh: 6.9,
    nominal_voltage_v: 350,
    max_charge_kw: 3.5,
    max_discharge_kw: 3.5,
    roundtrip_efficiency_pct: 95,
    depth_of_discharge_pct: 100,
    cycle_life: 6000,
    chemistry: "LFP",
    scalable: true,
    max_modules: 3,
    max_system_charge_kw: 10.5,
    max_system_discharge_kw: 10.5,
    warranty_years: 15,
    source_name: ENF,
    source_url: ENF_URL,
    datasheet_url: "https://solar.huawei.com/",
    data_confidence: 0.78,
    is_favorite: true,
  },
  {
    brand: "BYD",
    model_ref: "Battery-Box-Premium-HVS-7.7",
    name: "BYD Battery-Box Premium HVS 7.7",
    usable_kwh: 7.68,
    nominal_voltage_v: 307,
    max_charge_kw: 7.68,
    max_discharge_kw: 7.68,
    roundtrip_efficiency_pct: 96,
    depth_of_discharge_pct: 100,
    cycle_life: 6000,
    chemistry: "LFP",
    scalable: true,
    max_modules: 5,
    warranty_years: 10,
    source_name: CEC,
    source_url: CEC_URL,
    datasheet_url: "https://www.bydbatterybox.com/",
    data_confidence: 0.82,
  },
];

const mountings = [
  {
    brand: "K2 Systems",
    model_ref: "SingleRail",
    name: "K2 SingleRail",
    mounting_type: "surimposition",
    roof_compatibility: ["tuile", "ardoise", "bac acier"],
    material: "Aluminium / inox",
    certificate_iec: "ETN selon configuration",
    source_name: "K2 Systems catalogue",
    source_url: "https://catalogue.k2-systems.com/en-uk/",
    datasheet_url: "https://catalogue.k2-systems.com/en-uk/",
    data_confidence: 0.74,
    is_favorite: true,
  },
  {
    brand: "Esdec",
    model_ref: "ClickFit EVO",
    name: "Esdec ClickFit EVO",
    mounting_type: "surimposition",
    roof_compatibility: ["tuile", "ardoise", "bac acier"],
    material: "Aluminium / acier",
    certificate_iec: "ETN selon configuration",
    source_name: "Esdec product catalogue",
    source_url: "https://www.esdec.com/",
    datasheet_url: "https://www.esdec.com/",
    data_confidence: 0.72,
  },
  {
    brand: "Renusol",
    model_ref: "VarioSole+",
    name: "Renusol VarioSole+",
    mounting_type: "surimposition",
    roof_compatibility: ["tuile", "ardoise", "bac acier", "fibrociment"],
    material: "Aluminium / inox",
    certificate_iec: "ETN selon configuration",
    source_name: "Renusol catalogue",
    source_url: "https://www.renusol.com/",
    datasheet_url: "https://www.renusol.com/",
    data_confidence: 0.7,
  },
];

export const up = (pgm) => {
  for (const p of panels) {
    pgm.sql(`
      INSERT INTO pv_panels (
        name, brand, model_ref, technology, bifacial, power_wc, efficiency_pct,
        width_mm, height_mm, thickness_mm, weight_kg, warranty_product_years,
        warranty_performance_years, certificate_iec, shading_compatible,
        source_name, source_url, datasheet_url, last_verified_at, data_confidence,
        status, is_favorite, active
      )
      VALUES (
        ${esc(p.name)}, ${esc(p.brand)}, ${esc(p.model_ref)}, ${esc(p.technology)}, ${bool(p.bifacial)},
        ${num(p.power_wc)}, ${num(p.efficiency_pct)}, ${num(p.width_mm)}, ${num(p.height_mm)},
        ${num(p.thickness_mm)}, ${num(p.weight_kg)}, ${num(p.warranty_product_years)},
        ${num(p.warranty_performance_years)}, ${esc(p.certificate_iec)}, true,
        ${esc(p.source_name)}, ${esc(p.source_url)}, ${esc(p.datasheet_url)}, ${esc(VERIFIED)},
        ${num(p.data_confidence)}, 'active', ${bool(p.is_favorite)}, true
      )
      ON CONFLICT (brand, model_ref) DO UPDATE SET
        name = EXCLUDED.name,
        technology = EXCLUDED.technology,
        power_wc = EXCLUDED.power_wc,
        efficiency_pct = EXCLUDED.efficiency_pct,
        width_mm = EXCLUDED.width_mm,
        height_mm = EXCLUDED.height_mm,
        thickness_mm = EXCLUDED.thickness_mm,
        weight_kg = EXCLUDED.weight_kg,
        warranty_product_years = EXCLUDED.warranty_product_years,
        warranty_performance_years = EXCLUDED.warranty_performance_years,
        certificate_iec = EXCLUDED.certificate_iec,
        source_name = EXCLUDED.source_name,
        source_url = EXCLUDED.source_url,
        datasheet_url = EXCLUDED.datasheet_url,
        last_verified_at = EXCLUDED.last_verified_at,
        data_confidence = EXCLUDED.data_confidence,
        is_favorite = pv_panels.is_favorite OR EXCLUDED.is_favorite,
        updated_at = now();
    `);
  }

  for (const i of inverters) {
    pgm.sql(`
      INSERT INTO pv_inverters (
        name, brand, model_ref, inverter_type, inverter_family, nominal_power_kw, nominal_va,
        phases, mppt_count, inputs_per_mppt, modules_per_inverter, mppt_min_v, mppt_max_v,
        max_input_current_a, max_dc_power_kw, euro_efficiency_pct, compatible_battery,
        monitoring_integrated, source_name, source_url, datasheet_url, last_verified_at,
        data_confidence, status, is_favorite, active
      )
      VALUES (
        ${esc(i.name)}, ${esc(i.brand)}, ${esc(i.model_ref)}, ${esc(i.inverter_type)}, ${esc(i.inverter_family)},
        ${num(i.nominal_power_kw)}, ${num(i.nominal_va)}, ${esc(i.phases)}, ${num(i.mppt_count)},
        ${num(i.inputs_per_mppt)}, ${num(i.modules_per_inverter)}, ${num(i.mppt_min_v)}, ${num(i.mppt_max_v)},
        ${num(i.max_input_current_a)}, ${num(i.max_dc_power_kw)}, ${num(i.euro_efficiency_pct)},
        ${bool(i.compatible_battery)}, ${bool(i.monitoring_integrated)}, ${esc(i.source_name)},
        ${esc(i.source_url)}, ${esc(i.datasheet_url)}, ${esc(VERIFIED)}, ${num(i.data_confidence)},
        'active', ${bool(i.is_favorite)}, true
      )
      ON CONFLICT (brand, model_ref) DO UPDATE SET
        name = EXCLUDED.name,
        inverter_type = EXCLUDED.inverter_type,
        inverter_family = EXCLUDED.inverter_family,
        nominal_power_kw = EXCLUDED.nominal_power_kw,
        nominal_va = EXCLUDED.nominal_va,
        phases = EXCLUDED.phases,
        mppt_count = EXCLUDED.mppt_count,
        inputs_per_mppt = EXCLUDED.inputs_per_mppt,
        modules_per_inverter = EXCLUDED.modules_per_inverter,
        max_input_current_a = EXCLUDED.max_input_current_a,
        max_dc_power_kw = EXCLUDED.max_dc_power_kw,
        euro_efficiency_pct = EXCLUDED.euro_efficiency_pct,
        monitoring_integrated = EXCLUDED.monitoring_integrated,
        source_name = EXCLUDED.source_name,
        source_url = EXCLUDED.source_url,
        datasheet_url = EXCLUDED.datasheet_url,
        last_verified_at = EXCLUDED.last_verified_at,
        data_confidence = EXCLUDED.data_confidence,
        is_favorite = pv_inverters.is_favorite OR EXCLUDED.is_favorite,
        updated_at = now();
    `);
  }

  for (const b of batteries) {
    pgm.sql(`
      INSERT INTO pv_batteries (
        name, brand, model_ref, usable_kwh, nominal_voltage_v, max_charge_kw,
        max_discharge_kw, roundtrip_efficiency_pct, depth_of_discharge_pct, cycle_life,
        chemistry, scalable, max_modules, max_system_charge_kw, max_system_discharge_kw,
        warranty_years, source_name, source_url, datasheet_url, last_verified_at,
        data_confidence, status, is_favorite, active
      )
      VALUES (
        ${esc(b.name)}, ${esc(b.brand)}, ${esc(b.model_ref)}, ${num(b.usable_kwh)},
        ${num(b.nominal_voltage_v)}, ${num(b.max_charge_kw)}, ${num(b.max_discharge_kw)},
        ${num(b.roundtrip_efficiency_pct)}, ${num(b.depth_of_discharge_pct)}, ${num(b.cycle_life)},
        ${esc(b.chemistry)}, ${bool(b.scalable)}, ${num(b.max_modules)}, ${num(b.max_system_charge_kw)},
        ${num(b.max_system_discharge_kw)}, ${num(b.warranty_years)}, ${esc(b.source_name)},
        ${esc(b.source_url)}, ${esc(b.datasheet_url)}, ${esc(VERIFIED)}, ${num(b.data_confidence)},
        'active', ${bool(b.is_favorite)}, true
      )
      ON CONFLICT (brand, model_ref) DO UPDATE SET
        name = EXCLUDED.name,
        usable_kwh = EXCLUDED.usable_kwh,
        chemistry = EXCLUDED.chemistry,
        scalable = EXCLUDED.scalable,
        max_modules = EXCLUDED.max_modules,
        warranty_years = EXCLUDED.warranty_years,
        source_name = EXCLUDED.source_name,
        source_url = EXCLUDED.source_url,
        datasheet_url = EXCLUDED.datasheet_url,
        last_verified_at = EXCLUDED.last_verified_at,
        data_confidence = EXCLUDED.data_confidence,
        is_favorite = pv_batteries.is_favorite OR EXCLUDED.is_favorite,
        updated_at = now();
    `);
  }

  for (const m of mountings) {
    pgm.sql(`
      INSERT INTO pv_mounting_systems (
        name, brand, model_ref, mounting_type, roof_compatibility, material,
        certificate_iec, source_name, source_url, datasheet_url, last_verified_at,
        data_confidence, status, is_favorite, active
      )
      VALUES (
        ${esc(m.name)}, ${esc(m.brand)}, ${esc(m.model_ref)}, ${esc(m.mounting_type)},
        ${arr(m.roof_compatibility)}, ${esc(m.material)}, ${esc(m.certificate_iec)},
        ${esc(m.source_name)}, ${esc(m.source_url)}, ${esc(m.datasheet_url)}, ${esc(VERIFIED)},
        ${num(m.data_confidence)}, 'active', ${bool(m.is_favorite)}, true
      )
      ON CONFLICT (brand, model_ref) DO UPDATE SET
        name = EXCLUDED.name,
        mounting_type = EXCLUDED.mounting_type,
        roof_compatibility = EXCLUDED.roof_compatibility,
        material = EXCLUDED.material,
        source_name = EXCLUDED.source_name,
        source_url = EXCLUDED.source_url,
        datasheet_url = EXCLUDED.datasheet_url,
        last_verified_at = EXCLUDED.last_verified_at,
        data_confidence = EXCLUDED.data_confidence,
        is_favorite = pv_mounting_systems.is_favorite OR EXCLUDED.is_favorite,
        updated_at = now();
    `);
  }
};

export const down = (pgm) => {
  pgm.sql("DELETE FROM pv_mounting_systems WHERE brand IN ('K2 Systems', 'Esdec', 'Renusol')");
  pgm.sql("DELETE FROM pv_batteries WHERE brand IN ('Enphase', 'Huawei', 'BYD') AND last_verified_at = DATE '2026-05-01'");
  pgm.sql("DELETE FROM pv_inverters WHERE brand IN ('Enphase', 'APsystems', 'Huawei', 'SolarEdge') AND last_verified_at = DATE '2026-05-01'");
  pgm.sql("DELETE FROM pv_panels WHERE brand IN ('LONGi', 'DualSun', 'Trina Solar', 'JA Solar', 'DMEGC') AND last_verified_at = DATE '2026-05-01'");
};
