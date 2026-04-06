/**
 * Nommage PDF Client-Etude-Scenario (slugify + mapping scénarios).
 * node backend/tests/studyPdfFileName.util.test.js
 */
import { slugify, mapScenarioName, buildStudyPdfFileName } from "../services/studyPdfFileName.util.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function run() {
  assert(slugify("Jean Dupont") === "JeanDupont", "Jean Dupont → JeanDupont");
  assert(slugify("Étude 1") === "Etude1", "Étude 1 → Etude1");

  assert(mapScenarioName("BASE") === "SansBatterie", "BASE");
  assert(mapScenarioName("BATTERY_PHYSICAL") === "BatteriePhysique", "BATTERY_PHYSICAL");
  assert(mapScenarioName("BATTERY_VIRTUAL") === "BatterieVirtuelle", "BATTERY_VIRTUAL");
  assert(mapScenarioName(undefined) === "Scenario", "fallback scenario");
  assert(mapScenarioName("OTHER") === "Scenario", "unknown id");

  assert(
    buildStudyPdfFileName("Dupont", "Étude 1", "BASE") === "Dupont-Etude1-SansBatterie.pdf",
    "exemple Dupont-Etude1-SansBatterie"
  );
  assert(
    buildStudyPdfFileName("Martin", "Étude 2", "BATTERY_VIRTUAL") === "Martin-Etude2-BatterieVirtuelle.pdf",
    "Martin + virtuel"
  );
  assert(
    buildStudyPdfFileName("", "", null) === "Client-Etude-Scenario.pdf",
    "fallback Client-Etude-Scenario"
  );

  console.log("studyPdfFileName.util.test.js OK");
}

run();
