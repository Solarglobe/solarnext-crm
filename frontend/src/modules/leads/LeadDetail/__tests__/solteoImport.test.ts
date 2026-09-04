/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";

import {
  buildManualHpHcImportOptions,
  collectSolteoFiles,
  isMultiFileImport,
} from "../solteoImport";

describe("collectSolteoFiles", () => {
  it("reconnait un export annuel Enedis HP/HC comme un CSV quotidien importable seul", async () => {
    const csv = [
      ";;H PLEINE-CREUSE Heures Creuses;H PLEINE-CREUSE Heures Creuses;H PLEINE-CREUSE Heures Pleines;H PLEINE-CREUSE Heures Pleines",
      "Date;Nature releve;Consommation (kWh);Index;Consommation (kWh);Index",
      "01-09-2025;evt reelle;15;25924;10;29543",
    ].join("\n");
    const file = {
      name: "conso energie annuelle.csv",
      text: async () => csv,
    } as File;

    const { files, names } = await collectSolteoFiles([file]);

    expect(files.dailyCsv).toBe(csv);
    expect(isMultiFileImport(files)).toBe(true);
    expect(names).toEqual(["conso energie annuelle.csv"]);
  });
});

describe("buildManualHpHcImportOptions", () => {
  it("construit les tarifs et plages manuels pour un CSV HP/HC seul", () => {
    const payload = buildManualHpHcImportOptions({
      priceHp: "0,2081",
      priceHc: "0.1635",
      hpStart: "08:00",
      hpEnd: "20:00",
      hcStart: "20:00",
      hcEnd: "08:00",
    });

    expect(payload).toEqual({
      elec_price_hp_eur_kwh: 0.2081,
      elec_price_hc_eur_kwh: 0.1635,
      hp_periods: [{ start: "08:00", end: "20:00" }],
      off_peak_periods: [{ start: "20:00", end: "08:00" }],
      plage_hc: "HC (20H-8H)",
    });
  });

  it("refuse un prix HP/HC absent avant import", () => {
    expect(() =>
      buildManualHpHcImportOptions({
        priceHp: "",
        priceHc: "0.1635",
        hpStart: "08:00",
        hpEnd: "20:00",
        hcStart: "20:00",
        hcEnd: "08:00",
      })
    ).toThrow(/Prix HP invalide/);
  });
});
