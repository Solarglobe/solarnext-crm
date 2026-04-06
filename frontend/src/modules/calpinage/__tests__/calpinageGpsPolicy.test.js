import { describe, it, expect } from "vitest";
import {
  computeInitialZoomFromLeadMeta,
  hasSeriousCalpinageGeometry,
  getCenterFromSavedGeometry,
  getGpsPrecisionHintMessage,
  pickConfirmedBuildingGps,
} from "../calpinageGpsPolicy.js";

describe("calpinageGpsPolicy", () => {
  describe("computeInitialZoomFromLeadMeta", () => {
    it("pin validé → zoom très serré", () => {
      expect(
        computeInitialZoomFromLeadMeta({
          is_geo_verified: true,
          geo_precision_level: "MANUAL_PIN_BUILDING",
        })
      ).toBe(21);
    });
    it("ville → zoom moins fort", () => {
      expect(
        computeInitialZoomFromLeadMeta({
          geo_precision_level: "CITY",
          is_geo_verified: false,
        })
      ).toBe(16);
    });
  });

  describe("hasSeriousCalpinageGeometry", () => {
    it("capture toiture = sérieux", () => {
      expect(
        hasSeriousCalpinageGeometry({
          roof: { image: { dataUrl: "x".repeat(40) } },
        })
      ).toBe(true);
    });
    it("vide = pas sérieux", () => {
      expect(hasSeriousCalpinageGeometry({ roof: { map: { centerLatLng: { lat: 48, lng: 2 } } } })).toBe(false);
    });
  });

  describe("getCenterFromSavedGeometry", () => {
    it("lit roof.map.centerLatLng", () => {
      var c = getCenterFromSavedGeometry({
        roof: { map: { centerLatLng: { lat: 48.85, lng: 2.35 } } },
      });
      expect(c).toEqual([48.85, 2.35]);
    });
  });

  describe("getGpsPrecisionHintMessage", () => {
    it("pin validé → pas de message", () => {
      expect(
        getGpsPrecisionHintMessage({
          is_geo_verified: true,
          geo_precision_level: "MANUAL_PIN_BUILDING",
        })
      ).toBe(null);
    });
    it("ville → message", () => {
      expect(
        getGpsPrecisionHintMessage({ geo_precision_level: "CITY", is_geo_verified: false })
      ).toContain("commune");
    });
  });

  describe("pickConfirmedBuildingGps", () => {
    it("priorise la position du marqueur", () => {
      expect(
        pickConfirmedBuildingGps(
          { lat: 48.1, lng: 2.2 },
          { lat: 48, lon: 2 },
          { lat: 47, lng: 1 }
        )
      ).toEqual({ lat: 48.1, lon: 2.2 });
    });
    it("sinon dernier point connu (lon)", () => {
      expect(pickConfirmedBuildingGps(null, { lat: 48.5, lon: 2.5 }, { lat: 47, lng: 1 })).toEqual({
        lat: 48.5,
        lon: 2.5,
      });
    });
    it("sinon centre carte", () => {
      expect(pickConfirmedBuildingGps(null, null, { lat: 46.5, lng: 2.5 })).toEqual({ lat: 46.5, lon: 2.5 });
    });
    it("null si rien de valide", () => {
      expect(pickConfirmedBuildingGps(null, null, null)).toBe(null);
    });
  });
});
