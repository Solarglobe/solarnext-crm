import { describe, it, expect } from "vitest";
import {
  getStudyWorkflowBadge,
  workflowBadgeLabel,
  formatStudyPowerKw,
  formatStudyUpdatedAt,
  studyCustomTitleSubtitle,
} from "../studyCardUtils";

describe("studyCardUtils", () => {
  describe("getStudyWorkflowBadge", () => {
    it("NON CALCULÉ sans scénarios v2", () => {
      expect(
        getStudyWorkflowBadge({
          has_scenarios_v2: false,
          quote_has_signed: true,
          quote_exists: true,
        })
      ).toBe("non_calc");
    });
    it("SIGNÉ si devis signé", () => {
      expect(
        getStudyWorkflowBadge({
          has_scenarios_v2: true,
          quote_has_signed: true,
          quote_exists: true,
        })
      ).toBe("signe");
    });
    it("DEVIS GÉNÉRÉ si quote sans signature", () => {
      expect(
        getStudyWorkflowBadge({
          has_scenarios_v2: true,
          quote_has_signed: false,
          quote_exists: true,
        })
      ).toBe("devis");
    });
    it("CALCULÉ si scénarios sans devis", () => {
      expect(
        getStudyWorkflowBadge({
          has_scenarios_v2: true,
          quote_has_signed: false,
          quote_exists: false,
        })
      ).toBe("calcule");
    });
  });

  describe("workflowBadgeLabel", () => {
    it("libellés FR attendus", () => {
      expect(workflowBadgeLabel("non_calc")).toBe("NON CALCULÉ");
      expect(workflowBadgeLabel("calcule")).toBe("CALCULÉ");
      expect(workflowBadgeLabel("devis")).toBe("DEVIS GÉNÉRÉ");
      expect(workflowBadgeLabel("signe")).toBe("SIGNÉ");
    });
  });

  describe("formatStudyPowerKw", () => {
    it("priorité calpinage_power_kwc", () => {
      expect(formatStudyPowerKw({ calpinage_power_kwc: 6, scenario_hardware_kwc: 9 })).toBe("6.0 kWc");
    });
    it("fallback scenario_hardware_kwc", () => {
      expect(formatStudyPowerKw({ calpinage_power_kwc: null, scenario_hardware_kwc: 4.5 })).toBe("4.5 kWc");
    });
    it("— si absent ou invalide", () => {
      expect(formatStudyPowerKw({ calpinage_power_kwc: null, scenario_hardware_kwc: null })).toBe("—");
      expect(formatStudyPowerKw({ calpinage_power_kwc: 0, scenario_hardware_kwc: null })).toBe("—");
    });
  });

  describe("formatStudyUpdatedAt", () => {
    it("— si vide", () => {
      expect(formatStudyUpdatedAt(undefined)).toBe("—");
    });
    it("formate une date ISO", () => {
      const s = formatStudyUpdatedAt("2024-06-15T14:30:00.000Z");
      expect(s).not.toBe("—");
      expect(s.length).toBeGreaterThan(4);
    });
  });

  describe("studyCustomTitleSubtitle", () => {
    it("null si titre vide ou identique au numéro", () => {
      expect(studyCustomTitleSubtitle({ title: "", study_number: "SGS-1" })).toBeNull();
      expect(studyCustomTitleSubtitle({ title: "SGS-1", study_number: "SGS-1" })).toBeNull();
    });
    it("retourne le titre métier si différent", () => {
      expect(studyCustomTitleSubtitle({ title: "Toit sud", study_number: "SGS-12" })).toBe("Toit sud");
    });
  });
});
