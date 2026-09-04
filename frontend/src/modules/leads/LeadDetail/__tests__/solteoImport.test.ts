/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";

import { collectSolteoFiles, isMultiFileImport } from "../solteoImport";

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
