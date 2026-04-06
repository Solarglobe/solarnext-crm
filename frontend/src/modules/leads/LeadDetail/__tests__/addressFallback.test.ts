import { describe, it, expect } from "vitest";
import {
  filterExploitableSuggestions,
  parseFrenchAddressParts,
  qualityUiFromSite,
  isLowConfidencePrecision,
} from "../addressFallback";

describe("addressFallback", () => {
  describe("parseFrenchAddressParts", () => {
    it("extrait CP, rue et ville (ex. Chelles)", () => {
      const p = parseFrenchAddressParts("12 impasse des lilas 77500 chelles");
      expect(p.postalCode).toBe("77500");
      expect(p.cityGuess?.toLowerCase()).toBe("chelles");
      expect(p.queryStreetCity?.toLowerCase()).toContain("impasse");
      expect(p.queryStreetCity?.toLowerCase()).toContain("chelles");
      expect(p.queryCityOnly?.toLowerCase()).toBe("chelles");
    });

    it("ville après code postal", () => {
      const p = parseFrenchAddressParts("foo 69000 Lyon");
      expect(p.postalCode).toBe("69000");
      expect(p.cityGuess?.toLowerCase()).toBe("lyon");
      expect(p.queryCityOnly?.toLowerCase()).toBe("lyon");
    });
  });

  describe("filterExploitableSuggestions", () => {
    it("retire les entrées sans lat/lon", () => {
      expect(
        filterExploitableSuggestions([
          { lat: 48, lon: 2, place_id: "a" },
          { lat: null, lon: null, place_id: "b" },
        ] as { lat: number | null; lon: number | null; place_id: string }[])
      ).toHaveLength(1);
    });
  });

  describe("isLowConfidencePrecision", () => {
    it("STREET est faible confiance", () => {
      expect(isLowConfidencePrecision("STREET")).toBe(true);
    });
    it("HOUSE_NUMBER_INTERPOLATED non", () => {
      expect(isLowConfidencePrecision("HOUSE_NUMBER_INTERPOLATED")).toBe(false);
    });
  });

  describe("qualityUiFromSite", () => {
    it("fallback ville → approx_city", () => {
      expect(
        qualityUiFromSite({
          isGeoVerified: false,
          hasLatLon: true,
          geoPrecisionLevel: "CITY",
          geoSource: "autocomplete_fallback_city",
        })
      ).toBe("approx_city");
    });

    it("manuel sans GPS → pending_manual", () => {
      expect(
        qualityUiFromSite({
          isGeoVerified: false,
          hasLatLon: false,
          geoSource: "manual_map_pending",
        })
      ).toBe("pending_manual");
    });

    it("validé", () => {
      expect(
        qualityUiFromSite({
          isGeoVerified: true,
          hasLatLon: true,
          geoPrecisionLevel: "MANUAL_PIN_BUILDING",
        })
      ).toBe("validated");
    });
  });
});
