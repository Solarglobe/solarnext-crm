/**
 * Import multi-fichiers Solteo/Switchgrid — tests du service de parsing + priorité métier.
 * Structures calquées sur les fichiers réels (c68.json SGE, r65.json Wh, r65.csv date,value).
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  parseC68,
  detectPhase,
  parseR65Json,
  parseDailyCsv,
  parseMonthlyCsv,
  computeAnnualFromDaily,
  computeAnnualFromMonthly,
  resolveAnnualPriority,
  scaleHourlyToAnnual,
} from "../services/energy/solteoImportService.js";

function c68Fixture() {
  return {
    point: {
      attributes: { id: "22493921713260" },
      donneesGenerales: {
        etatContractuel: { libelle: "En service" },
        adresseInstallation: {
          numeroEtNomVoie: "50 av DU CLOS",
          lieuDit: "LA VARENNE ST HILAIRE",
          codePostal: "94210",
          commune: { libelle: "ST MAUR DES FOSSES" },
        },
        segment: { libelle: "C5" },
      },
      situationAlimentation: {
        alimentationPrincipale: {
          domaineTension: { libelle: "BT<=36kVA" },
          tensionLivraison: { attributes: { code: "230/400 V" }, libelle: "230/400 V" },
          puissanceRaccordementSoutirage: { valeur: "36", unite: "kVA" },
        },
      },
      situationComptage: {
        dispositifComptage: {
          typeComptage: { attributes: { code: "LINKY" }, libelle: "Compteur Linky" },
          compteurs: { compteur: [{ ticActivee: "true" }] },
          disjoncteur: { calibre: { libelle: "30-60 A" } },
          relais: { plageHeuresCreuses: "HC (22H30-6H30)" }, // structure réelle SGE
        },
        futuresPlagesHeuresCreuses: { libelle: "HC (1H28-6H58;13H58-16H28)" },
      },
      situationContractuelle: {
        structureTarifaire: {
          formuleTarifaireAcheminement: {
            attributes: { code: "BTINFCU4" },
            libelle: "Tarif BT<=36kVA Courte Utilisation heures pleines heures creuses associées à deux saisons",
          },
          puissanceSouscriteMax: { valeur: "18", unite: "kVA" },
          calendrierFrn: { libelle: "Heures Pleines/Creuses" },
        },
      },
    },
  };
}

test("parseC68 : extraction complète + phase triphasé sûr (18 kVA + 230/400 V)", () => {
  const c = parseC68(c68Fixture());
  assert.ok(c);
  assert.equal(c.pdl, "22493921713260");
  assert.equal(c.etat_contractuel, "En service");
  assert.equal(c.segment, "C5");
  assert.equal(c.code_postal, "94210");
  assert.equal(c.commune, "ST MAUR DES FOSSES");
  assert.equal(c.compteur_linky, true);
  assert.equal(c.tension_livraison, "230/400 V");
  assert.equal(c.puissance_raccordement_kva, 36);
  assert.equal(c.puissance_souscrite_kva, 18);
  assert.equal(c.tariff_type, "hp_hc");
  assert.equal(c.plage_hc, "HC (22H30-6H30)");
  assert.ok(String(c.futures_plages_hc || "").includes("1H28"));
  assert.equal(c.phase_detection, "triphasé");
  assert.equal(c.grid_type_auto, "tri");
});

test("detectPhase : prudence sur les cas ambigus", () => {
  assert.deepEqual(detectPhase({ tension: "230/400 V", souscriteKva: 18 }), {
    detection: "triphasé", grid_type_auto: "tri",
  });
  assert.deepEqual(detectPhase({ tension: "230/400 V", souscriteKva: 9 }), {
    detection: "triphasé probable", grid_type_auto: null,
  });
  assert.deepEqual(detectPhase({ tension: "230 V", souscriteKva: 9 }), {
    detection: "monophasé", grid_type_auto: "mono",
  });
  assert.deepEqual(detectPhase({ tension: null, souscriteKva: null }), {
    detection: "inconnu", grid_type_auto: null,
  });
});

/** Série quotidienne synthétique en Wh (structure r65.json) — nDays jours finissant le 2026-06-30. */
function r65JsonFixture(nDays, whPerDay = 33518) {
  const points = [];
  const end = Date.UTC(2026, 5, 30);
  for (let i = nDays - 1; i >= 0; i--) {
    const d = new Date(end - i * 86400000).toISOString().slice(0, 10);
    points.push({ v: String(whPerDay), d });
  }
  return {
    pointId: "22493921713260",
    grandeur: [{ grandeurMetier: "CONS", grandeurPhysique: "EA", unite: "Wh", points }],
  };
}

test("parseR65Json + computeAnnualFromDaily : 608 jours Wh → fenêtre 365 j complète", () => {
  const r = parseR65Json(r65JsonFixture(608));
  assert.ok(r);
  assert.equal(r.points.length, 608);
  const daily = computeAnnualFromDaily(r.points);
  assert.equal(daily.days_covered, 365);
  assert.equal(daily.complete_365, true);
  assert.equal(daily.window_end, "2026-06-30");
  assert.equal(daily.window_start, "2025-07-01");
  // 365 × 33 518 Wh = 12 234,07 kWh (ordre de grandeur du dossier réel)
  assert.ok(Math.abs(daily.sum_kwh - 12234.07) < 0.1, `sum=${daily.sum_kwh}`);
});

test("parseDailyCsv : unité par médiane globale — un jour d'absence à 1 800 Wh reste 1,8 kWh", () => {
  const lines = ["date,value"];
  for (let i = 1; i <= 30; i++) {
    lines.push(`2026-06-${String(i).padStart(2, "0")},${i === 15 ? 1800 : 35000}`);
  }
  const r = parseDailyCsv(lines.join("\n"));
  assert.ok(r);
  const low = r.points.find((p) => p.date === "2026-06-15");
  assert.ok(Math.abs(low.kwh - 1.8) < 0.001, `kwh=${low.kwh}`);
});

test("resolveAnnualPriority : R65 complet PRIME sur la courbe horaire partielle", () => {
  const daily = computeAnnualFromDaily(parseR65Json(r65JsonFixture(365)).points);
  const out = resolveAnnualPriority({
    daily,
    monthly: null,
    engine: { annual_kwh: 13206, engine_consumption_source: "CSV_HOURLY_PARTIAL_REBUILT" },
    manualAnnualKwh: 9999,
  });
  assert.equal(out.source, "R65_DAILY_365");
  assert.ok(Math.abs(out.annual_kwh - 12234.07) < 0.1);
});

test("resolveAnnualPriority : cascade P3 (>330 j) → P5 (courbe partielle) → P6 (manuel)", () => {
  const d340 = computeAnnualFromDaily(parseR65Json(r65JsonFixture(340)).points);
  const p3 = resolveAnnualPriority({ daily: d340, monthly: null, engine: null, manualAnnualKwh: null });
  assert.equal(p3.source, "R65_DAILY_PARTIAL_ANNUALIZED");
  assert.ok(Math.abs(p3.annual_kwh - (d340.sum_kwh / 340) * 365) < 0.01);
  assert.ok(p3.warnings.length > 0);

  const d200 = computeAnnualFromDaily(parseR65Json(r65JsonFixture(200)).points);
  const p5 = resolveAnnualPriority({
    daily: d200,
    monthly: null,
    engine: { annual_kwh: 13206, engine_consumption_source: "CSV_HOURLY_PARTIAL_REBUILT" },
    manualAnnualKwh: null,
  });
  assert.equal(p5.source, "CSV_HOURLY_PARTIAL_REBUILT");
  assert.equal(p5.annual_kwh, 13206);

  const p6 = resolveAnnualPriority({ daily: null, monthly: null, engine: null, manualAnnualKwh: 11000 });
  assert.equal(p6.source, "MANUAL");
  assert.equal(p6.annual_kwh, 11000);
});

test("parseMonthlyCsv + computeAnnualFromMonthly : 12 mois complets → MONTHLY_12", () => {
  const lines = ["date,value"];
  const months = ["2025-07","2025-08","2025-09","2025-10","2025-11","2025-12","2026-01","2026-02","2026-03","2026-04","2026-05","2026-06"];
  for (const m of months) lines.push(`${m},1000`);
  const parsed = parseMonthlyCsv(lines.join("\n"));
  assert.ok(parsed);
  const monthly = computeAnnualFromMonthly(parsed.months);
  assert.equal(monthly.complete_12, true);
  assert.equal(Math.round(monthly.sum_kwh), 12000);
  const out = resolveAnnualPriority({ daily: null, monthly, engine: null, manualAnnualKwh: null });
  assert.equal(out.source, "MONTHLY_12");
});

test("scaleHourlyToAnnual : normalisation exacte du profil sur l'annuel R65", () => {
  const hourly = new Array(8760).fill(13206 / 8760); // profil reconstruit ~13 206 kWh
  const { hourly: scaled, factor } = scaleHourlyToAnnual(hourly, 12234);
  const sum = scaled.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 12234) < 0.001, `sum=${sum}`);
  assert.ok(Math.abs(factor - 12234 / 13206) < 0.0001);
});
