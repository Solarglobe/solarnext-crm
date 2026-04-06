/**
 * Règles métier : Phase 2 (ROOF_EDIT) = toujours roofSurveyLocked false après load.
 * Reflète l’ordre dans loadCalpinageState (calpinage.module.js).
 */
import { describe, it, expect } from "vitest";

function simulateLoadCalpinageRoofLock(data) {
  var state = {
    phase: 2,
    currentPhase: "ROOF_EDIT",
    roofSurveyLocked: false,
  };
  if (data.phase === 2 || data.phase === 3) {
    state.phase = data.phase;
    state.currentPhase = data.phase === 3 ? "PV_LAYOUT" : "ROOF_EDIT";
  }
  if (data.roofSurveyLocked === true) state.roofSurveyLocked = true;
  if (state.currentPhase === "ROOF_EDIT") {
    state.roofSurveyLocked = false;
  }
  return state;
}

describe("calpinage roofSurveyLocked / Phase 2", () => {
  it("phase 2 + roofSurveyLocked true dans le JSON → déverrouillé (édition relevé)", () => {
    var s = simulateLoadCalpinageRoofLock({ phase: 2, roofSurveyLocked: true });
    expect(s.currentPhase).toBe("ROOF_EDIT");
    expect(s.roofSurveyLocked).toBe(false);
  });

  it("phase 3 + roofSurveyLocked true → reste verrouillé côté relevé (implantation)", () => {
    var s = simulateLoadCalpinageRoofLock({ phase: 3, roofSurveyLocked: true });
    expect(s.currentPhase).toBe("PV_LAYOUT");
    expect(s.roofSurveyLocked).toBe(true);
  });

  it("phase 2 sans flag locked → false", () => {
    var s = simulateLoadCalpinageRoofLock({ phase: 2 });
    expect(s.roofSurveyLocked).toBe(false);
  });
});
