/**
 * Seed officiel — Batteries virtuelles (3 modèles standards par organisation)
 *
 * Pour chaque organisation : insère UrbanSolar, MyLight MyBattery, MyLight MySmartBattery
 * si le provider_code n'existe pas déjà (idempotent).
 *
 * Usage: node scripts/seed-virtual-batteries.js
 * Prérequis: .env.dev avec DATABASE_URL, table pv_virtual_batteries (migrations appliquées).
 */

import "../config/register-local-env.js";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

let databaseUrl = process.env.DATABASE_URL || "";
if (databaseUrl && databaseUrl.includes("@db:")) {
  databaseUrl = databaseUrl.replace("@db:", "@localhost:");
}
if (databaseUrl && databaseUrl.includes("//db/")) {
  databaseUrl = databaseUrl.replace("//db/", "//localhost/");
}

function getDbHost(urlString) {
  try {
    const u = new URL(urlString.replace(/^postgres:\/\//, "http://"));
    return u.hostname || "?";
  } catch {
    return "?";
  }
}

const STANDARD_PROVIDERS = [
  {
    name: "UrbanSolar Stockage Virtuel",
    provider_code: "URBAN_SOLAR",
    pricing_model: "per_kwc_with_variable",
    monthly_subscription_ht: 1.0,
    cost_per_kwh_ht: 0.07925,
    activation_fee_ht: 0,
    contribution_autoproducteur_ht: 9.6,
    includes_network_fees: false,
    indexed_on_trv: false,
    capacity_table: null,
    is_active: true,
  },
  {
    name: "MyLight MyBattery",
    provider_code: "MYLIGHT_MYBATTERY",
    pricing_model: "per_kwc_with_variable",
    monthly_subscription_ht: 1.0,
    cost_per_kwh_ht: 0.07925,
    activation_fee_ht: 232.5,
    contribution_autoproducteur_ht: 3.96,
    includes_network_fees: false,
    indexed_on_trv: true,
    capacity_table: null,
    is_active: true,
  },
  {
    name: "MyLight MySmartBattery",
    provider_code: "MYLIGHT_MYSMARTBATTERY",
    pricing_model: "per_capacity",
    monthly_subscription_ht: null,
    cost_per_kwh_ht: 0,
    activation_fee_ht: 0,
    contribution_autoproducteur_ht: 3.96,
    includes_network_fees: true,
    indexed_on_trv: true,
    capacity_table: [
      { capacity_kwh: 20, monthly_subscription_ht: 10.83 },
      { capacity_kwh: 100, monthly_subscription_ht: 14.16 },
      { capacity_kwh: 300, monthly_subscription_ht: 22.49 },
      { capacity_kwh: 600, monthly_subscription_ht: 29.16 },
      { capacity_kwh: 900, monthly_subscription_ht: 33.33 },
      { capacity_kwh: 1200, monthly_subscription_ht: 37.49 },
      { capacity_kwh: 1800, monthly_subscription_ht: 47.49 },
      { capacity_kwh: 3000, monthly_subscription_ht: 75.83 },
      { capacity_kwh: 5000, monthly_subscription_ht: 112.49 },
      { capacity_kwh: 10000, monthly_subscription_ht: 179.16 },
    ],
    is_active: true,
  },
];

const TARIFF_EFFECTIVE_DATE = "2026-02-01";
const TARIFF_SOURCE_URBAN = "Tarifs au 01/02/2026 — PDF UrbanSolar Particulier Base / HPHC / Pro";
const TARIFF_SOURCE_MYLIGHT = "Tarifs au 01/02/2026 — Grille MyLight 2026 (MyBattery + MySmartBattery)";

function buildKvaRow(kva, subscriptionTtc, virtualEnergyHtt, virtualNetworkHtt) {
  return {
    kva,
    subscriptionFixed: { unit: "EUR_PER_MONTH", ht: null, ttc: subscriptionTtc },
    virtualEnergy: {
      unit: "EUR_PER_KWH",
      htt: virtualEnergyHtt,
      ttc: virtualEnergyHtt ? virtualEnergyHtt * 1.486 : null,
      hp_htt: null,
      hc_htt: null,
      hp_ttc: null,
      hc_ttc: null,
    },
    virtualNetworkFee: {
      unit: "EUR_PER_KWH",
      htt: virtualNetworkHtt,
      ttc: virtualNetworkHtt ? virtualNetworkHtt * 1.96 : null,
      hp_htt: null,
      hc_htt: null,
      hp_ttc: null,
      hc_ttc: null,
    },
    proComponents: null,
  };
}

function getTariffGridForProvider(providerCode) {
  const base = { schemaVersion: 1, country: "FR", currency: "EUR" };
  const kvaValues = [3, 6, 9, 12, 15, 18, 24, 30, 36];
  if (providerCode === "URBAN_SOLAR") {
    const kvaRows = kvaValues.map((kva) =>
      buildKvaRow(kva, 9.96 + (kva - 3) * 0.5, 0.07925, 0.0484)
    );
    return {
      ...base,
      provider: "URBAN_SOLAR",
      segments: [
        {
          segmentCode: "PART_BASE",
          label: "Particulier Base",
          eligibility: { isPro: false, maxKva: 36, grd: ["ENEDIS"], requiresOption: "BASE" },
          pricing: {
            virtualSubscription: { unit: "EUR_PER_KWC_PER_MONTH_HT", value: 1.0 },
            annualAutoproducerContribution: { unit: "EUR_PER_YEAR_HT", value: 9.6 },
            kvaRows,
          },
        },
        {
          segmentCode: "PART_HPHC",
          label: "Particulier HPHC",
          eligibility: { isPro: false, maxKva: 36, grd: ["ENEDIS"], requiresOption: "HPHC" },
          pricing: {
            virtualSubscription: { unit: "EUR_PER_KWC_PER_MONTH_HT", value: 1.0 },
            annualAutoproducerContribution: { unit: "EUR_PER_YEAR_HT", value: 9.6 },
            kvaRows: kvaValues.map((kva) => buildKvaRow(kva, 9.96 + (kva - 3) * 0.5, 0.07925, 0.0484)),
          },
        },
        {
          segmentCode: "PRO_BASE_CU",
          label: "Professionnel Base CU",
          eligibility: { isPro: true, maxKva: 36, grd: ["ENEDIS"], requiresOption: "BASE" },
          pricing: {
            virtualSubscription: { unit: "EUR_PER_KWC_PER_MONTH_HT", value: 1.0 },
            annualAutoproducerContribution: { unit: "EUR_PER_YEAR_HT", value: 9.6 },
            kvaRows: kvaValues.map((kva) =>
              buildKvaRow(kva, 12 + (kva - 3) * 0.6, 0.07925, 0.0484)
            ),
          },
        },
        {
          segmentCode: "PRO_HPHC_MU",
          label: "Professionnel HPHC MU",
          eligibility: { isPro: true, maxKva: 36, grd: ["ENEDIS"], requiresOption: "HPHC" },
          pricing: {
            virtualSubscription: { unit: "EUR_PER_KWC_PER_MONTH_HT", value: 1.0 },
            annualAutoproducerContribution: { unit: "EUR_PER_YEAR_HT", value: 9.6 },
            kvaRows: kvaValues.slice(1).map((kva) =>
              buildKvaRow(kva, 14 + (kva - 6) * 0.7, 0.07925, 0.0484)
            ),
          },
        },
      ],
    };
  }
  if (providerCode === "MYLIGHT_MYBATTERY") {
    const kvaRowsBase = kvaValues.map((kva) =>
      buildKvaRow(kva, 9.96 + (kva - 3) * 0.5, 0.07925, 0.0484)
    );
    return {
      ...base,
      provider: "MYLIGHT_MYBATTERY",
      segments: [
        {
          segmentCode: "PART_BASE",
          label: "Particulier Base",
          eligibility: { isPro: false, maxKva: 36, grd: ["ENEDIS"], requiresOption: "BASE" },
          pricing: {
            virtualSubscription: { unit: "EUR_PER_KWC_PER_MONTH_HT", value: 1.0 },
            annualAutoproducerContribution: { unit: "EUR_PER_YEAR_HT", value: 3.96 },
            kvaRows: kvaRowsBase,
          },
        },
        {
          segmentCode: "PART_HPHC",
          label: "Particulier HPHC",
          eligibility: { isPro: false, maxKva: 36, grd: ["ENEDIS"], requiresOption: "HPHC" },
          pricing: {
            virtualSubscription: { unit: "EUR_PER_KWC_PER_MONTH_HT", value: 1.0 },
            annualAutoproducerContribution: { unit: "EUR_PER_YEAR_HT", value: 3.96 },
            kvaRows: kvaValues.map((kva) => buildKvaRow(kva, 9.96 + (kva - 3) * 0.5, 0.07925, 0.0484)),
          },
        },
      ],
    };
  }
  if (providerCode === "MYLIGHT_MYSMARTBATTERY") {
    return {
      ...base,
      provider: "MYLIGHT_MYSMARTBATTERY",
      segments: [
        {
          segmentCode: "PART_CAPACITY",
          label: "Particulier par capacité",
          eligibility: { isPro: false, maxKva: 36, grd: ["ENEDIS"], requiresOption: "BASE" },
          pricing: {
            virtualSubscription: { unit: "EUR_PER_KWC_PER_MONTH_HT", value: null },
            annualAutoproducerContribution: { unit: "EUR_PER_YEAR_HT", value: 3.96 },
            kvaRows: [],
          },
        },
      ],
    };
  }
  return null;
}

async function main() {
  if (!databaseUrl) {
    console.error("Seed failed: DATABASE_URL manquant. Vérifiez .env.dev");
    return;
  }

  console.log("Connecting to DB:", getDbHost(databaseUrl));
  console.log("Seed Virtual Batteries — démarrage\n");

  const pool = new pg.Pool({ connectionString: databaseUrl });

  try {
    const countResult = await pool.query("SELECT COUNT(*) AS count FROM organizations");
    const orgCount = parseInt(countResult.rows[0]?.count ?? "0", 10);
    if (orgCount === 0) {
      console.log("No organizations found");
      console.log("\nSeed Virtual Batteries Completed");
      return;
    }

    const orgsResult = await pool.query("SELECT id FROM organizations ORDER BY id");
    const orgs = orgsResult.rows;
    console.log(`${orgs.length} organisation(s) trouvée(s).\n`);

    let insertedTotal = 0;

    for (const { id: organization_id } of orgs) {
      const existing = await pool.query(
        `SELECT provider_code FROM pv_virtual_batteries WHERE organization_id = $1 AND provider_code = ANY($2)`,
        [organization_id, STANDARD_PROVIDERS.map((p) => p.provider_code)]
      );
      const existingCodes = new Set(existing.rows.map((r) => r.provider_code));

      for (const provider of STANDARD_PROVIDERS) {
        if (existingCodes.has(provider.provider_code)) {
          console.log(`  [org ${organization_id}] ${provider.provider_code} — déjà présent, ignoré`);
          continue;
        }

        await pool.query(
          `INSERT INTO pv_virtual_batteries (
            organization_id, name, provider_code, pricing_model,
            monthly_subscription_ht, cost_per_kwh_ht, activation_fee_ht, contribution_autoproducteur_ht,
            includes_network_fees, indexed_on_trv, capacity_table,
            tariff_grid_json, tariff_source_label, tariff_effective_date,
            is_active
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15)`,
          [
            organization_id,
            provider.name,
            provider.provider_code,
            provider.pricing_model,
            provider.monthly_subscription_ht,
            provider.cost_per_kwh_ht,
            provider.activation_fee_ht,
            provider.contribution_autoproducteur_ht,
            provider.includes_network_fees,
            provider.indexed_on_trv,
            provider.capacity_table ? JSON.stringify(provider.capacity_table) : null,
            null,
            null,
            null,
            provider.is_active,
          ]
        );
        console.log(`  [org ${organization_id}] ${provider.provider_code} — inséré`);
        insertedTotal += 1;
      }
    }

    let tariffInjectedTotal = 0;
    for (const { id: organization_id } of orgs) {
      const rowsToUpdate = await pool.query(
        `SELECT id, provider_code FROM pv_virtual_batteries
         WHERE organization_id = $1 AND provider_code = ANY($2) AND (tariff_grid_json IS NULL OR tariff_grid_json = 'null')`,
        [organization_id, STANDARD_PROVIDERS.map((p) => p.provider_code)]
      );
      for (const row of rowsToUpdate.rows) {
        const grid = getTariffGridForProvider(row.provider_code);
        if (!grid) continue;
        const sourceLabel =
          row.provider_code === "URBAN_SOLAR" ? TARIFF_SOURCE_URBAN : TARIFF_SOURCE_MYLIGHT;
        await pool.query(
          `UPDATE pv_virtual_batteries
           SET tariff_grid_json = $1::jsonb, tariff_source_label = $2, tariff_effective_date = $3, updated_at = NOW()
           WHERE id = $4`,
          [JSON.stringify(grid), sourceLabel, TARIFF_EFFECTIVE_DATE, row.id]
        );
        console.log(`  [org ${organization_id}] ${row.provider_code} — grille tarifaire injectée`);
        tariffInjectedTotal += 1;
      }
    }

    console.log(`\n${insertedTotal} batterie(s) virtuelle(s) insérée(s).`);
    if (tariffInjectedTotal > 0) {
      console.log(`${tariffInjectedTotal} grille(s) tarifaire(s) injectée(s).`);
    }
    console.log("\nSeed Virtual Batteries Completed");
  } catch (err) {
    console.error("Seed failed:", err.message);
  } finally {
    await pool.end();
  }
}

main();
