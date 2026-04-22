/**
 * CP-002 — Migration data : compléter le catalogue PV avec données techniques connues
 * Aucune suppression de table. Mise à jour uniquement.
 */

export const shorthands = undefined;

const esc = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = async (pgm) => {
  // A) PANNEAUX — données électriques (voc, vmp, isc, imp)
  const panelUpdates = [
    { brand: "LONGi", model_ref: "Hi-MO6-485", voc_v: 40.4, vmp_v: 33.4, isc_a: 15.23, imp_a: 14.53 },
    { brand: "LONGi", model_ref: "Hi-MO6-500", voc_v: 40.75, vmp_v: 33.73, isc_a: 15.53, imp_a: 14.83 },
    { brand: "DualSun", model_ref: "FLASH-500", voc_v: 44.22, vmp_v: 36.87, isc_a: 14.04, imp_a: 13.56 },
    { brand: "DMEGC", model_ref: "DM500M10RT-B60HBB", voc_v: 45.74, vmp_v: 37.47, isc_a: 13.35, imp_a: 13.75 },
  ];

  for (const p of panelUpdates) {
    pgm.sql(`
      UPDATE pv_panels SET
        voc_v = COALESCE(voc_v, ${p.voc_v}),
        vmp_v = COALESCE(vmp_v, ${p.vmp_v}),
        isc_a = COALESCE(isc_a, ${p.isc_a}),
        imp_a = COALESCE(imp_a, ${p.imp_a}),
        updated_at = now()
      WHERE brand = ${esc(p.brand)} AND model_ref = ${esc(p.model_ref)}
    `);
  }

  // B) MICRO-ONDULEURS — modules_per_inverter, max_input_current_a, max_dc_power_kw
  const microUpdates = [
    { brand: "ATMOCE", model_ref: "MI-450", modules: 1, max_current: 22, max_dc_kw: 0.45 },
    { brand: "ATMOCE", model_ref: "MI-500", modules: 1, max_current: 22, max_dc_kw: 0.5 },
    { brand: "ATMOCE", model_ref: "MI-600", modules: 1, max_current: 22, max_dc_kw: 0.6 },
    { brand: "ATMOCE", model_ref: "MI-1000", modules: 2, max_current: 22, max_dc_kw: 1.0 },
    { brand: "Enphase", model_ref: "IQ8MC", modules: 1, max_current: 14, max_dc_kw: 0.29 },
    { brand: "Enphase", model_ref: "IQ8AC", modules: 1, max_current: 14, max_dc_kw: 0.366 },
    { brand: "Enphase", model_ref: "IQ8HC", modules: 1, max_current: 14, max_dc_kw: 0.46 },
  ];

  for (const m of microUpdates) {
    pgm.sql(`
      UPDATE pv_inverters SET
        modules_per_inverter = COALESCE(modules_per_inverter, ${m.modules}),
        max_input_current_a = COALESCE(max_input_current_a, ${m.max_current}),
        max_dc_power_kw = COALESCE(max_dc_power_kw, ${m.max_dc_kw}),
        updated_at = now()
      WHERE inverter_type = 'micro' AND brand = ${esc(m.brand)} AND model_ref = ${esc(m.model_ref)}
    `);
  }

  // C) ONDULEURS STRING — mppt_count, mppt_min_v, mppt_max_v, max_input_current_a, max_dc_power_kw
  // Huawei 2-6KTL (L1) : 2 MPPT, 90-530V ; Huawei 3-10KTL-M1 : 2 MPPT, 140-980V ; Huawei 12-20KTL-M2 : 2 MPPT, 160-950V
  const stringUpdates = [
    { model: "2KTL", mppt: 2, min_v: 90, max_v: 530, max_current: 22, max_dc_kw: 3 },
    { model: "3KTL", mppt: 2, min_v: 90, max_v: 530, max_current: 22, max_dc_kw: 3.68 },
    { model: "4KTL", mppt: 2, min_v: 90, max_v: 530, max_current: 22, max_dc_kw: 5 },
    { model: "5KTL", mppt: 2, min_v: 90, max_v: 530, max_current: 22, max_dc_kw: 6 },
    { model: "6KTL", mppt: 2, min_v: 90, max_v: 530, max_current: 22, max_dc_kw: 6 },
    { model: "3KTL-M1", mppt: 2, min_v: 140, max_v: 980, max_current: 22, max_dc_kw: 4 },
    { model: "4KTL-M1", mppt: 2, min_v: 140, max_v: 980, max_current: 22, max_dc_kw: 5 },
    { model: "5KTL-M1", mppt: 2, min_v: 140, max_v: 980, max_current: 22, max_dc_kw: 6 },
    { model: "6KTL-M1", mppt: 2, min_v: 140, max_v: 980, max_current: 22, max_dc_kw: 7 },
    { model: "8KTL-M1", mppt: 2, min_v: 140, max_v: 980, max_current: 22, max_dc_kw: 10 },
    { model: "10KTL-M1", mppt: 2, min_v: 140, max_v: 980, max_current: 22, max_dc_kw: 12 },
    { model: "12KTL-M2", mppt: 2, min_v: 160, max_v: 950, max_current: 22, max_dc_kw: 15 },
    { model: "15KTL-M2", mppt: 2, min_v: 160, max_v: 950, max_current: 22, max_dc_kw: 18 },
    { model: "17KTL-M2", mppt: 2, min_v: 160, max_v: 950, max_current: 22, max_dc_kw: 21 },
    { model: "20KTL-M2", mppt: 2, min_v: 160, max_v: 950, max_current: 22, max_dc_kw: 24 },
  ];

  for (const s of stringUpdates) {
    pgm.sql(`
      UPDATE pv_inverters SET
        mppt_count = COALESCE(mppt_count, ${s.mppt}),
        mppt_min_v = COALESCE(mppt_min_v, ${s.min_v}),
        mppt_max_v = COALESCE(mppt_max_v, ${s.max_v}),
        max_input_current_a = COALESCE(max_input_current_a, ${s.max_current}),
        max_dc_power_kw = COALESCE(max_dc_power_kw, ${s.max_dc_kw}),
        updated_at = now()
      WHERE inverter_type = 'string' AND brand = 'Huawei' AND model_ref = ${esc(s.model)}
    `);
  }

  // D) BATTERIES — nominal_voltage_v, max_charge_kw, max_discharge_kw, roundtrip_efficiency_pct, depth_of_discharge_pct
  const batteryUpdates = [
    { brand: "ATMOCE", model_ref: "BAT-7", voltage: 51.2, charge: 3.5, discharge: 3.5, eff: 90, dod: 95 },
    { brand: "Enphase", model_ref: "IQ-Battery-5P", voltage: 76.8, charge: 3.84, discharge: 3.84, eff: 90, dod: 95 },
    { brand: "Enphase", model_ref: "IQ-Battery-10T", voltage: 67.2, charge: 3.84, discharge: 3.84, eff: 89, dod: 95 },
    { brand: "Huawei", model_ref: "LUNA2000-5", voltage: 450, charge: 2.5, discharge: 2.5, eff: 90, dod: 100 },
    { brand: "Huawei", model_ref: "LUNA2000-10", voltage: 450, charge: 5, discharge: 5, eff: 90, dod: 100 },
    { brand: "Huawei", model_ref: "LUNA2000-15", voltage: 450, charge: 7.5, discharge: 7.5, eff: 90, dod: 100 },
  ];

  for (const b of batteryUpdates) {
    pgm.sql(`
      UPDATE pv_batteries SET
        nominal_voltage_v = COALESCE(nominal_voltage_v, ${b.voltage}),
        max_charge_kw = COALESCE(max_charge_kw, ${b.charge}),
        max_discharge_kw = COALESCE(max_discharge_kw, ${b.discharge}),
        roundtrip_efficiency_pct = COALESCE(roundtrip_efficiency_pct, ${b.eff}),
        depth_of_discharge_pct = COALESCE(depth_of_discharge_pct, ${b.dod}),
        updated_at = now()
      WHERE brand = ${esc(b.brand)} AND model_ref = ${esc(b.model_ref)}
    `);
  }
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = async (pgm) => {
  // Pas de rollback des données — on ne supprime rien
  // Les valeurs restent en base
};
