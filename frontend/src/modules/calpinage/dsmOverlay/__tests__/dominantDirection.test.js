/**
 * Test synthétique obligatoire — Direction dominante basée sur perte énergétique.
 * Obstacle artificiel à 60° en secteur Nord-Est → dominantDirection NE, energyLossSharePct > 50%.
 */

import { describe, it, expect } from "vitest";
import { getDominantDirection, getHorizonTemporalUiProfile } from "../dominantDirection.js";
import { computeSolarScore } from "../solarScore.js";

describe("getDominantDirection — perte énergétique annuelle", () => {
  it("obstacle 60° secteur NE → direction Nord-Est, energyLossSharePct > 50%", () => {
    const mask = Array.from({ length: 180 }, (_, i) => {
      const az = i * 2;
      const elev = az >= 40 && az <= 70 ? 60 : 0;
      return { az, elev };
    });

    const result = getDominantDirection({ mask }, 48.85, 2.35);

    expect(result, "Résultat non null").not.toBeNull();
    expect(result.dominantDirection, "Direction dominante = Nord-Est").toBe("Nord-Est");
    expect(result.energyLossSharePct, "Part perte secteur NE > 50%").toBeGreaterThan(50);
    expect(result.dominantSeasonLossPct, "dominantSeasonLossPct défini").toBeDefined();
    expect(Number.isNaN(result.dominantSeasonLossPct), "dominantSeasonLossPct non NaN").toBe(false);
    expect(result.dominantSeasonLossPct, "dominantSeasonLossPct > 0").toBeGreaterThan(0);
    expect(result.winterLossPct, "winterLossPct défini").toBeDefined();
    expect(result.summerLossPct, "summerLossPct défini").toBeDefined();
    expect(Number.isNaN(result.winterLossPct), "winterLossPct non NaN").toBe(false);
    expect(Number.isNaN(result.summerLossPct), "summerLossPct non NaN").toBe(false);
  });
});

describe("getHorizonTemporalUiProfile — barres jour / saison (UI)", () => {
  it("retourne 3 tranches jour + 4 saisons avec signal si masque + GPS", () => {
    const mask = Array.from({ length: 180 }, (_, i) => {
      const az = i * 2;
      const elev = az >= 40 && az <= 70 ? 60 : 0;
      return { az, elev };
    });
    const profile = getHorizonTemporalUiProfile({ mask }, 48.85, 2.35);
    expect(profile.hasSignal).toBe(true);
    expect(profile.dayParts).toHaveLength(3);
    expect(profile.seasons).toHaveLength(4);
    expect(profile.dominantDayKey).toBeTruthy();
    expect(profile.dominantSeasonKey).toBeTruthy();
  });
});

describe("computeSolarScore — score solaire premium", () => {
  it("cas synthétique: loss 5%, orient 180°, tilt 30° → Bon ou Excellent", () => {
    const score = computeSolarScore({ totalLossPct: 5, orientation_deg: 180, tilt_deg: 30 });
    expect(score.label).toBeDefined();
    expect(["Excellent", "Bon", "Moyen", "À optimiser"]).toContain(score.label);
    expect(score.hasOrientationTilt).toBe(true);
  });

  it("sans orient/tilt → label défini, hasOrientationTilt false", () => {
    const score = computeSolarScore({ totalLossPct: 3, orientation_deg: null, tilt_deg: null });
    expect(score.label).toBeDefined();
    expect(score.hasOrientationTilt).toBe(false);
  });
});
