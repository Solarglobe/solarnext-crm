/**
 * Nommage PDF Etude-Scenario[-XkWc][-NBatterie(s)] (mapping scénarios + faits snapshot).
 * node backend/tests/studyPdfFileName.util.test.js
 */
import {
  slugify,
  mapScenarioName,
  buildStudyPdfFileName,
  extractPdfNameFactsFromSnapshot,
} from "../services/studyPdfFileName.util.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function run() {
  assert(slugify("Jean Dupont") === "JeanDupont", "Jean Dupont → JeanDupont");
  assert(slugify("Étude 1") === "Etude1", "Étude 1 → Etude1");

  assert(mapScenarioName("BASE") === "SansBatterie", "BASE");
  assert(mapScenarioName("BATTERY_PHYSICAL") === "BatteriePhysique", "BATTERY_PHYSICAL");
  assert(mapScenarioName("BATTERY_VIRTUAL") === "BatterieVirtuelle", "BATTERY_VIRTUAL");
  assert(mapScenarioName("BATTERY_HYBRID") === "Hybride", "BATTERY_HYBRID");
  assert(mapScenarioName(undefined) === "Scenario", "fallback scenario");
  assert(mapScenarioName("OTHER") === "Scenario", "unknown id");

  // Nommage complet — sans nom client
  assert(
    buildStudyPdfFileName("BASE", { kwc: 9 }) === "Etude-SansBatterie-9kWc.pdf",
    "BASE 9 kWc"
  );
  assert(
    buildStudyPdfFileName("BATTERY_VIRTUAL", { kwc: 12 }) === "Etude-BatterieVirtuelle-12kWc.pdf",
    "virtuelle : pas de segment batterie"
  );
  assert(
    buildStudyPdfFileName("BATTERY_HYBRID", { kwc: 12, batteryUnits: 1 }) ===
      "Etude-Hybride-12kWc-1Batterie.pdf",
    "hybride 12 kWc 1 batterie"
  );
  assert(
    buildStudyPdfFileName("BATTERY_HYBRID", { kwc: 12, batteryUnits: 2 }) ===
      "Etude-Hybride-12kWc-2Batteries.pdf",
    "hybride 12 kWc 2 batteries (pluriel)"
  );
  assert(
    buildStudyPdfFileName("BATTERY_PHYSICAL", {}) === "Etude-BatteriePhysique-1Batterie.pdf",
    "physique sans faits : fallback 1 batterie, pas de segment kWc"
  );
  assert(
    buildStudyPdfFileName("BATTERY_PHYSICAL", { kwc: 3.88, batteryUnits: 1 }) ===
      "Etude-BatteriePhysique-3-88kWc-1Batterie.pdf",
    "kWc décimal filename-safe"
  );
  assert(buildStudyPdfFileName(null) === "Etude-Scenario.pdf", "fallback Etude-Scenario");

  // Extraction des faits depuis un snapshot
  const facts = extractPdfNameFactsFromSnapshot({
    installation: { puissance_kwc: 12 },
    equipment: { batterie: { unites: 2, type: "hybride" } },
  });
  assert(facts.kwc === 12 && facts.batteryUnits === 2, "extraction snapshot kwc+unites");
  const factsLegacy = extractPdfNameFactsFromSnapshot({ installation: { puissance_kwc: 9 } });
  assert(
    factsLegacy.kwc === 9 && factsLegacy.batteryUnits === null,
    "snapshot legacy sans unites → null (fallback 1 géré par le builder)"
  );
  const factsEmpty = extractPdfNameFactsFromSnapshot(null);
  assert(factsEmpty.kwc === null && factsEmpty.batteryUnits === null, "snapshot absent");

  console.log("studyPdfFileName.util.test.js OK");
}

run();
