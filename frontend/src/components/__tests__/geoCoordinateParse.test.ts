import { describe, expect, it } from "vitest";
import { FR_MAP_DEFAULT } from "../../modules/leads/LeadDetail/addressFallback";
import {
  parseGeoLatitude,
  parseGeoLongitude,
  resolveCoordOrFrance,
} from "../geoCoordinateParse";

describe("parseGeoLatitude", () => {
  it("accepte un nombre valide", () => {
    expect(parseGeoLatitude(48.8566)).toBe(48.8566);
    expect(parseGeoLatitude(0)).toBe(0);
    expect(parseGeoLatitude(-90)).toBe(-90);
    expect(parseGeoLatitude(90)).toBe(90);
  });

  it("accepte une chaîne numérique valide", () => {
    expect(parseGeoLatitude("48.8566")).toBe(48.8566);
    expect(parseGeoLatitude("  48.8566  ")).toBe(48.8566);
  });

  it("rejette null, undefined, chaîne vide, non numérique, NaN, hors bornes", () => {
    expect(parseGeoLatitude(null)).toBeNull();
    expect(parseGeoLatitude(undefined)).toBeNull();
    expect(parseGeoLatitude("")).toBeNull();
    expect(parseGeoLatitude("   ")).toBeNull();
    expect(parseGeoLatitude("abc")).toBeNull();
    expect(parseGeoLatitude("NaN")).toBeNull();
    expect(parseGeoLatitude(Number.NaN)).toBeNull();
    expect(parseGeoLatitude(Infinity)).toBeNull();
    expect(parseGeoLatitude(90.0001)).toBeNull();
    expect(parseGeoLatitude(-90.0001)).toBeNull();
  });
});

describe("parseGeoLongitude", () => {
  it("accepte un nombre valide", () => {
    expect(parseGeoLongitude(2.3522)).toBe(2.3522);
    expect(parseGeoLongitude(-180)).toBe(-180);
    expect(parseGeoLongitude(180)).toBe(180);
  });

  it("accepte une chaîne numérique valide", () => {
    expect(parseGeoLongitude("2.3522")).toBe(2.3522);
  });

  it("couple Paris — chaînes API typiques", () => {
    expect(parseGeoLatitude("48.8566")).toBe(48.8566);
    expect(parseGeoLongitude("2.3522")).toBe(2.3522);
  });

  it("rejette valeurs invalides ou hors bornes", () => {
    expect(parseGeoLongitude(null)).toBeNull();
    expect(parseGeoLongitude("")).toBeNull();
    expect(parseGeoLongitude(180.0001)).toBeNull();
    expect(parseGeoLongitude(-180.0001)).toBeNull();
  });
});

describe("resolveCoordOrFrance", () => {
  it("utilise Paris pour des chaînes valides (API PG)", () => {
    expect(resolveCoordOrFrance("48.8566", "2.3522")).toEqual({ lat: 48.8566, lon: 2.3522 });
  });

  it("utilise Paris pour des nombres valides", () => {
    expect(resolveCoordOrFrance(48.8566, 2.3522)).toEqual({ lat: 48.8566, lon: 2.3522 });
  });

  it("utilise FR_MAP_DEFAULT si coords absentes ou invalide", () => {
    expect(resolveCoordOrFrance(null, null)).toEqual(FR_MAP_DEFAULT);
    expect(resolveCoordOrFrance("abc", "xyz")).toEqual(FR_MAP_DEFAULT);
    expect(resolveCoordOrFrance(null, "2.35")).toEqual({
      lat: FR_MAP_DEFAULT.lat,
      lon: 2.35,
    });
  });
});
