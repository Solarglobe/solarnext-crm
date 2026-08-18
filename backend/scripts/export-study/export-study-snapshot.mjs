#!/usr/bin/env node

import "../../config/register-local-env.js";
import { getConnectionString } from "../../config/database-url.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, "../..");
const RESULTS_DIR = path.join(__dirname, "results");
const STUDY_REF = process.argv[2] || "SGS-2026-0137";
const SNAPSHOT_PATH = path.join(RESULTS_DIR, `${STUDY_REF}-snapshot.json`);
const REPORT_PATH = path.join(RESULTS_DIR, `${STUDY_REF}-export-report.md`);

const TABLES_READ = new Set();
const SERVICES_CALLED = [];
const missingFields = [];
const checks = [];

function nowIso() {
  return new Date().toISOString();
}

function environmentLabel() {
  const raw = process.env.DATABASE_URL || "";
  if (/railway\.internal|rlwy\.net|railway/i.test(raw)) return "railway";
  if (/localhost|127\.0\.0\.1|@db:/i.test(raw)) return "local";
  return raw ? "configured" : "missing";
}

function addMissing(field, importance, searched, reconstructable) {
  missingFields.push({
    field,
    importance,
    searched,
    reconstructable_without_recalculation: reconstructable,
  });
}

function source(table, column, service = null, mode = "persisted", present = null) {
  return {
    source_table: table,
    source_column: column,
    source_service: service,
    mode,
    present,
  };
}

function redactPersonalLead(lead) {
  if (!lead) return null;
  return {
    id: lead.id ?? null,
    customer_type: lead.customer_type ?? null,
    status: lead.status ?? null,
    created_at: lead.created_at ?? null,
    updated_at: lead.updated_at ?? null,
    site_address_id: lead.site_address_id ?? null,
    consumption_mode: lead.consumption_mode ?? null,
    consumption_annual_kwh: lead.consumption_annual_kwh ?? null,
    consumption_annual_calculated_kwh: lead.consumption_annual_calculated_kwh ?? null,
    consumption_profile: lead.consumption_profile ?? null,
    grid_type: lead.grid_type ?? null,
    meter_power_kva: lead.meter_power_kva ?? null,
    energy_profile: lead.energy_profile ?? null,
    hp_hc: lead.hp_hc ?? null,
    tariff_type: lead.tariff_type ?? null,
    elec_price_base_eur_kwh: lead.elec_price_base_eur_kwh ?? null,
    elec_price_hp_eur_kwh: lead.elec_price_hp_eur_kwh ?? null,
    elec_price_hc_eur_kwh: lead.elec_price_hc_eur_kwh ?? null,
    equipement_actuel: lead.equipement_actuel ?? null,
    equipement_actuel_params: lead.equipement_actuel_params ?? null,
    equipements_a_venir: lead.equipements_a_venir ?? null,
  };
}

function compactAddress(address) {
  if (!address) return null;
  return {
    id: address.id ?? null,
    postal_code: address.postal_code ?? null,
    city: address.city ?? null,
    lat: numericOrNull(address.lat),
    lon: numericOrNull(address.lon),
    geo_source: address.geo_source ?? null,
    geo_precision_level: address.geo_precision_level ?? null,
    is_geo_verified: address.is_geo_verified ?? null,
  };
}

function numericOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickLatest(rows, dateKey = "created_at") {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return [...rows].sort((a, b) => new Date(b[dateKey] || 0) - new Date(a[dateKey] || 0))[0];
}

function getPath(obj, keys) {
  let cur = obj;
  for (const key of keys) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[key];
  }
  return cur;
}

function findFirstArrayByNames(obj, names, maxDepth = 8) {
  const seen = new Set();
  function visit(node, depth) {
    if (!node || typeof node !== "object" || depth > maxDepth || seen.has(node)) return null;
    seen.add(node);
    for (const name of names) {
      if (Array.isArray(node[name])) return node[name];
    }
    for (const value of Object.values(node)) {
      const found = visit(value, depth + 1);
      if (found) return found;
    }
    return null;
  }
  return visit(obj, 0);
}

function findFirstValueByNames(obj, names, maxDepth = 8) {
  const seen = new Set();
  function visit(node, depth) {
    if (!node || typeof node !== "object" || depth > maxDepth || seen.has(node)) return undefined;
    seen.add(node);
    for (const name of names) {
      if (Object.prototype.hasOwnProperty.call(node, name)) return node[name];
    }
    for (const value of Object.values(node)) {
      const found = visit(value, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  return visit(obj, 0);
}

function stripSecrets(value) {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (/password|secret|token|database_url|authorization|cookie|apikey|api_key/i.test(key)) {
      out[key] = "[REDACTED]";
    } else {
      out[key] = stripSecrets(val);
    }
  }
  return out;
}

function containsForbiddenSecretText(text) {
  return /DATABASE_URL|postgres(?:ql)?:\/\/|password_hash|refresh_token|token_secret/i.test(text);
}

function containsPersonalDataText(text) {
  return /"email"\s*:|"phone"\s*:|"mobile"\s*:|"first_name"\s*:|"last_name"\s*:|"full_name"\s*:|"address_line1"\s*:|"formatted_address"\s*:/i.test(text);
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function writeReport(file, report) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, report, "utf8");
}

function assertSelect(sql) {
  const normalized = String(sql).replace(/--.*$/gm, "").trim().toLowerCase();
  if (!normalized.startsWith("select")) {
    throw new Error(`READ_ONLY_VIOLATION: non-SELECT query refused: ${normalized.slice(0, 40)}`);
  }
  if (/\b(insert|update|delete|upsert|merge|alter|drop|create|truncate|grant|revoke|copy\s+.*\s+from)\b/i.test(normalized)) {
    throw new Error("READ_ONLY_VIOLATION: write-like keyword refused");
  }
}

async function q(pool, table, sql, params = []) {
  assertSelect(sql);
  TABLES_READ.add(table);
  const res = await pool.query(sql, params);
  return res.rows;
}

async function readConsumptionCsv(csvPath) {
  if (!csvPath || typeof csvPath !== "string") return null;
  const candidates = [];
  if (path.isAbsolute(csvPath)) candidates.push(csvPath);
  candidates.push(path.resolve(BACKEND_ROOT, csvPath));
  candidates.push(path.resolve(BACKEND_ROOT, "..", csvPath));

  let found = null;
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        found = candidate;
        break;
      }
    } catch {}
  }
  if (!found) return { found: false, csv_path: csvPath, hourly_kwh: null };

  const raw = await fs.readFile(found, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== "");
  const values = [];
  for (const line of lines) {
    const cells = line.includes(";") ? line.split(";") : line.split(",");
    let numeric = null;
    for (let i = cells.length - 1; i >= 0; i--) {
      const cleaned = String(cells[i]).trim().replace(",", ".");
      if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
        numeric = Number(cleaned);
        break;
      }
    }
    if (Number.isFinite(numeric)) values.push(numeric);
  }
  const likelyWatts = values.some((v) => Math.abs(v) > 50);
  const hourly_kwh = values.map((v) => likelyWatts ? v / 1000 : v);
  return {
    found: true,
    csv_path: csvPath,
    local_path: path.relative(BACKEND_ROOT, found),
    raw_rows: values.length,
    unit_interpreted_as: likelyWatts ? "W_to_kWh_per_hour" : "kWh",
    hourly_kwh,
  };
}

function monthlySums8760(hourly) {
  if (!Array.isArray(hourly) || hourly.length !== 8760) return null;
  const days = [31,28,31,30,31,30,31,31,30,31,30,31];
  const out = [];
  let h = 0;
  for (const d of days) {
    let sum = 0;
    for (let i = 0; i < d * 24; i++) sum += Number(hourly[h++]) || 0;
    out.push(Math.round(sum * 1000) / 1000);
  }
  return out;
}

function sum(arr) {
  return Array.isArray(arr) ? arr.reduce((a, b) => a + (Number(b) || 0), 0) : null;
}

function addCheck(name, ok, details = null) {
  checks.push({ name, ok: ok === true, details });
}

function buildReport({ studyFound, version, selectedScenarioId, exportData, error }) {
  const errorLabel = error
    ? String(error.message || error.code || error.name || error)
    : "aucune";
  const attempts = Array.isArray(exportData?.export_metadata?.execution_attempts)
    ? exportData.export_metadata.execution_attempts
    : [];
  const attemptLines = attempts.length
    ? attempts.map((a) => `- ${a.method}: ${a.status}${a.error ? ` (${a.error})` : ""}`).join("\n")
    : "- local script execution";
  const missingLines = missingFields.length
    ? missingFields.map((m) => `- ${m.field} | importance: ${m.importance} | recherché: ${m.searched} | reconstructible sans recalcul: ${m.reconstructable_without_recalculation}`).join("\n")
    : "- Aucune absence bloquante détectée dans les champs recherchés.";
  const checkLines = checks.length
    ? checks.map((c) => `- ${c.ok ? "OK" : "FAIL"} ${c.name}${c.details ? ` — ${JSON.stringify(c.details)}` : ""}`).join("\n")
    : "- Aucun contrôle exécuté.";
  return `# Export ${STUDY_REF}

## Statut

- Etude trouvee: ${studyFound ? "oui" : "non"}
- Version retenue: ${version?.id ?? "n/a"} / numero ${version?.version_number ?? "n/a"}
- Scenario retenu: ${selectedScenarioId ?? "n/a"}
- Erreur: ${errorLabel}
- Fichier JSON: ${path.relative(BACKEND_ROOT, SNAPSHOT_PATH)}

## Tentatives d'acces

${attemptLines}

## Donnees recuperees

- Tables lues: ${Array.from(TABLES_READ).sort().join(", ") || "aucune"}
- Services appeles: ${SERVICES_CALLED.join(", ") || "aucun service metier; SQL SELECT direct"}
- Sections exportees: ${exportData ? Object.keys(exportData).join(", ") : "n/a"}

## Donnees manquantes

${missingLines}

## Controles

${checkLines}

## Suffisance benchmark PVcalc vs seriescalc

${studyFound && exportData?.study?.current_version_id && !error
  ? "A confirmer selon les controles ci-dessus : le benchmark peut demarrer uniquement si les donnees PV, site et consommation necessaires sont presentes."
  : "Non suffisant a ce stade : etude introuvable ou export incomplet."}

## Garantie lecture seule

Le script refuse toute requete non SELECT et n'appelle pas runStudy, runStudyCalc, ni les services de persistance.
`;
}

async function main() {
  await fs.mkdir(RESULTS_DIR, { recursive: true });
  const connectionString = getConnectionString();
  const exportBase = {
    export_metadata: {
      study_reference: STUDY_REF,
      exported_at: nowIso(),
      environment_used: environmentLabel(),
      study_version_id: null,
      selected_scenario_id: null,
      retrieval_method: "direct_sql_select_readonly",
      tables_read: [],
      read_services_called: SERVICES_CALLED,
      no_database_writes_performed: true,
      execution_attempts: [
        {
          method: "local_db_config",
          status: "started",
          error: null,
        },
      ],
    },
    missing_fields: missingFields,
  };

  if (!connectionString) {
    addMissing("database.connection", "bloquant", "configuration DB projet", false);
    const data = { ...exportBase, error: "DATABASE_URL_MISSING" };
    await writeJson(SNAPSHOT_PATH, data);
    await writeReport(REPORT_PATH, buildReport({ studyFound: false, version: null, selectedScenarioId: null, exportData: data, error: new Error("DATABASE_URL_MISSING") }));
    process.exitCode = 2;
    return;
  }

  const railwayLike = /railway|rlwy\.net|railway\.internal/i.test(connectionString);
  const pool = new Pool({
    connectionString,
    ...(railwayLike ? { ssl: { rejectUnauthorized: false } } : {}),
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 8_000,
    statement_timeout: 15_000,
    query_timeout: 15_000,
    application_name: "solarnext-export-study-readonly",
  });

  let exportData = null;
  let selectedVersion = null;
  let selectedScenarioId = null;
  let studyFound = false;
  let fatalError = null;

  try {
    const studies = await q(pool, "studies",
      `SELECT id, organization_id, client_id, lead_id, study_number, status, created_at, updated_at, title, current_version, archived_at, deleted_at
       FROM studies
       WHERE study_number = $1
       ORDER BY updated_at DESC`,
      [STUDY_REF]
    );
    studyFound = studies.length > 0;
    if (!studyFound) {
      addMissing("study", "bloquant", "studies.study_number", false);
      exportData = { ...exportBase, study_found: false };
      return;
    }
    if (studies.length > 1) {
      addMissing("study.unique_reference", "bloquant", "studies.study_number", false);
    }

    const study = studies[0];
    const orgId = study.organization_id;
    const studyId = study.id;

    const versions = await q(pool, "study_versions",
      `SELECT id, organization_id, study_id, version_number, title, summary, data_json, created_by, created_at,
              final_study_json, status, updated_at, selected_scenario_id, selected_scenario_snapshot,
              is_locked, locked_at
       FROM study_versions
       WHERE study_id = $1 AND organization_id = $2
       ORDER BY version_number ASC`,
      [studyId, orgId]
    );
    selectedVersion = versions.find((v) => Number(v.version_number) === Number(study.current_version)) || versions.at(-1) || null;
    if (!selectedVersion) addMissing("study.current_version", "bloquant", "study_versions", false);
    selectedScenarioId = selectedVersion?.selected_scenario_id ?? null;

    const leadRows = study.lead_id
      ? await q(pool, "leads",
          `SELECT id, organization_id, customer_type, status, site_address_id,
                  consumption_mode, consumption_annual_kwh, consumption_annual_calculated_kwh,
                  consumption_profile, grid_type, meter_power_kva, energy_profile, hp_hc, tariff_type,
                  elec_price_base_eur_kwh, elec_price_hp_eur_kwh, elec_price_hc_eur_kwh,
                  equipement_actuel, equipement_actuel_params, equipements_a_venir,
                  created_at, updated_at
           FROM leads
           WHERE id = $1 AND organization_id = $2`,
          [study.lead_id, orgId]
        )
      : [];
    const lead = leadRows[0] || null;

    const addressRows = lead?.site_address_id
      ? await q(pool, "addresses",
          `SELECT id, organization_id, postal_code, city, lat, lon, geo_source, geo_precision_level, is_geo_verified
           FROM addresses
           WHERE id = $1 AND organization_id = $2`,
          [lead.site_address_id, orgId]
        )
      : [];
    const address = addressRows[0] || null;

    const meters = study.lead_id
      ? await q(pool, "lead_meters",
          `SELECT *
           FROM lead_meters
           WHERE lead_id = $1 AND organization_id = $2
           ORDER BY is_default DESC, sort_order ASC, created_at ASC`,
          [study.lead_id, orgId]
        )
      : [];
    const selectedMeterId = selectedVersion?.data_json?.selected_meter_id ?? null;
    const selectedMeter = meters.find((m) => m.id === selectedMeterId) || meters.find((m) => m.is_default === true) || meters[0] || null;

    const monthlyConsumption = study.lead_id
      ? await q(pool, "lead_consumption_monthly",
          `SELECT id, lead_id, meter_id, year, month, kwh, created_at, updated_at
           FROM lead_consumption_monthly
           WHERE lead_id = $1 AND organization_id = $2
              OR (meter_id IS NOT NULL AND meter_id = ANY($3::uuid[]))
           ORDER BY year, month`,
          [study.lead_id, orgId, meters.map((m) => m.id)]
        )
      : [];

    const calpinageDataRows = selectedVersion
      ? await q(pool, "calpinage_data",
          `SELECT id, organization_id, study_version_id, geometry_json, total_panels, total_power_kwc,
                  annual_production_kwh, total_loss_pct, created_at
           FROM calpinage_data
           WHERE study_version_id = $1 AND organization_id = $2`,
          [selectedVersion.id, orgId]
        )
      : [];
    const calpinageData = calpinageDataRows[0] || null;

    const calpinageSnapshots = selectedVersion
      ? await q(pool, "calpinage_snapshots",
          `SELECT id, study_id, study_version_id, organization_id, version_number, snapshot_json, created_at, is_active
           FROM calpinage_snapshots
           WHERE study_version_id = $1 AND organization_id = $2
           ORDER BY version_number DESC, created_at DESC`,
          [selectedVersion.id, orgId]
        )
      : [];
    const calpinageSnapshot = calpinageSnapshots[0] || null;
    const calpinagePayload = calpinageSnapshot?.snapshot_json?.payload || calpinageData?.geometry_json || null;

    const economicSnapshots = selectedVersion
      ? await q(pool, "economic_snapshots",
          `SELECT id, study_id, study_version_id, organization_id, version_number, status, config_json,
                  created_at, updated_at, is_active
           FROM economic_snapshots
           WHERE study_version_id = $1 AND organization_id = $2
           ORDER BY is_active DESC, version_number DESC, updated_at DESC, created_at DESC`,
          [selectedVersion.id, orgId]
        )
      : [];
    const economicSnapshot = economicSnapshots[0] || null;

    const quotes = await q(pool, "quotes",
      `SELECT id, organization_id, client_id, lead_id, study_id, study_version_id, quote_number, status,
              total_ht, total_vat, total_ttc, discount_ht, currency, created_at, updated_at, metadata_json
       FROM quotes
       WHERE study_id = $1 AND organization_id = $2
       ORDER BY updated_at DESC, created_at DESC`,
      [studyId, orgId]
    );

    const documents = await q(pool, "entity_documents",
      `SELECT id, organization_id, entity_type, entity_id, file_name, mime_type, document_type,
              document_category, source_type, created_at
       FROM entity_documents
       WHERE organization_id = $1
         AND ((entity_type = 'study' AND entity_id = $2)
              OR (entity_type = 'lead' AND entity_id = $3))
       ORDER BY created_at DESC`,
      [orgId, studyId, study.lead_id]
    );

    const orgRows = await q(pool, "organizations",
      `SELECT id, settings_json
       FROM organizations
       WHERE id = $1`,
      [orgId]
    );
    const organizationSettings = orgRows[0]?.settings_json || null;

    const dataJson = selectedVersion?.data_json || {};
    const selectedSnapshot = selectedVersion?.selected_scenario_snapshot || null;
    const finalStudyJson = selectedVersion?.final_study_json || null;
    const calcResult = dataJson?.calc_result || null;
    const scenariosV2 = Array.isArray(dataJson?.scenarios_v2) ? dataJson.scenarios_v2 : [];
    const selectedScenario =
      selectedScenarioId != null
        ? scenariosV2.find((s) => (s?.id || s?.name) === selectedScenarioId) || null
        : null;

    if (!selectedScenarioId) addMissing("study_versions.selected_scenario_id", "important", "study_versions.selected_scenario_id", false);
    if (!selectedSnapshot) addMissing("study_versions.selected_scenario_snapshot", "important", "study_versions.selected_scenario_snapshot", false);
    if (!calcResult) addMissing("study_versions.data_json.calc_result", "important", "study_versions.data_json", false);
    if (!Array.isArray(scenariosV2) || scenariosV2.length === 0) addMissing("study_versions.data_json.scenarios_v2", "bloquant benchmark financier", "study_versions.data_json", false);

    const csvPath =
      dataJson?.consommation?.csv_path ||
      dataJson?.solarnext_payload?.consommation?.csv_path ||
      findFirstValueByNames(dataJson, ["csv_path", "loadcurve_path"], 6) ||
      findFirstValueByNames(calpinagePayload, ["csv_path", "loadcurve_path"], 6);
    const csvData = await readConsumptionCsv(csvPath);
    let persistedConsoHourly =
      findFirstArrayByNames(dataJson, ["conso_hourly", "consumption_hourly", "hourly_kwh", "hourly"], 7);
    if (!Array.isArray(persistedConsoHourly) || persistedConsoHourly.length !== 8760) {
      persistedConsoHourly = csvData?.hourly_kwh?.length === 8760 ? csvData.hourly_kwh : null;
    }
    if (!persistedConsoHourly) addMissing("consumption.hourly_8760", "bloquant benchmark horaire", "study_versions.data_json, CSV path, calpinage payload", "possible seulement si CSV accessible ou recalcul consommation autorisé");

    const pvHourly =
      findFirstArrayByNames(dataJson?.calc_result, ["pv_hourly", "hourly"], 5) ||
      findFirstArrayByNames(dataJson?.scenarios_v2, ["pv_hourly"], 5) ||
      findFirstArrayByNames(selectedSnapshot, ["pv_hourly"], 5);
    if (!Array.isArray(pvHourly) || pvHourly.length !== 8760) {
      addMissing("production.pv_hourly_8760", "important benchmark horaire", "calc_result, scenarios_v2, selected_scenario_snapshot", "possible par recalcul non destructif si payload complet");
    }

    const monthlyRawPerKwc =
      getPath(calcResult, ["pv", "monthly_raw"]) ||
      findFirstValueByNames(selectedSnapshot, ["monthly_raw_kwh", "monthly_raw"], 7) ||
      findFirstValueByNames(scenariosV2, ["monthly_raw_kwh", "monthly_raw"], 7);

    const productionMonthly =
      getPath(calcResult, ["pv", "monthly"]) ||
      findFirstValueByNames(selectedSnapshot, ["monthly_kwh"], 7) ||
      findFirstValueByNames(selectedScenario, ["monthly_kwh"], 7);

    const panels = calpinagePayload?.validatedRoofData?.pans || calpinagePayload?.pans || null;
    const totalPowerKwc = numericOrNull(calpinageData?.total_power_kwc ?? calpinagePayload?.totals?.total_power_kwc);
    const totalPanels = numericOrNull(calpinageData?.total_panels ?? calpinagePayload?.totals?.panels_count);

    const annualConsumption =
      numericOrNull(selectedMeter?.consumption_annual_kwh) ??
      numericOrNull(selectedMeter?.consumption_annual_calculated_kwh) ??
      numericOrNull(lead?.consumption_annual_kwh) ??
      numericOrNull(lead?.consumption_annual_calculated_kwh) ??
      sum(persistedConsoHourly);

    const economicsConfig = economicSnapshot?.config_json || {};
    const vehicleV2h =
      economicsConfig.vehicleV2h ||
      dataJson.vehicle_v2h_input ||
      selectedScenario?.vehicle_v2h ||
      selectedSnapshot?.equipment?.vehicle_v2h ||
      null;
    if (!vehicleV2h) addMissing("v2h.parameters", "important scénario V2H", "economic_snapshots.config_json.vehicleV2h, data_json, selected snapshot", false);

    const virtualBattery =
      economicsConfig.batteries?.virtual ||
      dataJson.virtual_battery_input ||
      selectedScenario?.virtual_battery_finance ||
      selectedSnapshot?.economic_snapshot?.virtual_battery ||
      null;

    exportData = stripSecrets({
      export_metadata: {
        study_reference: STUDY_REF,
        exported_at: nowIso(),
        environment_used: environmentLabel(),
        study_version_id: selectedVersion?.id ?? null,
        selected_scenario_id: selectedScenarioId,
        retrieval_method: "direct_sql_select_readonly",
        tables_read: [],
        read_services_called: SERVICES_CALLED,
        no_database_writes_performed: true,
      },
      study: {
        _trace: source("studies", "id, study_number, status, current_version", null, "persisted", true),
        uuid: study.id,
        study_number: study.study_number,
        status: study.status,
        current_version_number: study.current_version,
        current_version_id: selectedVersion?.id ?? null,
        selected_scenario_id: selectedScenarioId,
        version_status: selectedVersion?.status ?? null,
        version_updated_at: selectedVersion?.updated_at ?? null,
        scenario_snapshot_created_at: selectedSnapshot?.created_at ?? null,
        calc_result_computed_at: calcResult?.computed_at ?? null,
      },
      site: {
        _trace: source("addresses", "lat, lon, postal_code, city", null, "persisted", !!address),
        latitude: numericOrNull(address?.lat),
        longitude: numericOrNull(address?.lon),
        postal_code: address?.postal_code ?? null,
        city: address?.city ?? null,
        altitude: findFirstValueByNames(calpinagePayload, ["altitude", "altitude_m"], 6) ?? null,
        geo_source: address?.geo_source ?? null,
        geo_precision_level: address?.geo_precision_level ?? null,
      },
      pv_system: {
        _trace: source("calpinage_data/calpinage_snapshots", "geometry_json, snapshot_json, total_power_kwc", null, "persisted", !!calpinagePayload),
        total_power_kwc: totalPowerKwc,
        total_panels: totalPanels,
        pans: panels,
        panel: calpinagePayload?.panel || calpinagePayload?.panelSpec || selectedSnapshot?.equipment?.panneau || null,
        inverter: calpinagePayload?.inverter || selectedSnapshot?.equipment?.onduleur || null,
        losses: calcResult?.pv?.loss_breakdown || selectedScenario?.production_assumptions?.loss_breakdown || selectedSnapshot?.production_assumptions?.loss_breakdown || null,
        shading: calpinagePayload?.shading || dataJson?.shading_official || selectedSnapshot?.shading || null,
        horizon: calpinagePayload?.horizonMask || dataJson?.horizonMask || selectedSnapshot?.horizon || null,
        bifacial: calpinagePayload?.bifacial || dataJson?.bifacial || null,
        clipping: {
          clipped_kwh: calcResult?.pv?.clipped_kwh ?? null,
          clipping_loss_pct: calcResult?.pv?.clipping_loss_pct ?? null,
        },
      },
      consumption: {
        _trace: source("lead_meters/lead_consumption_monthly/storage", "consumption_*, kwh, csv", null, "persisted", !!annualConsumption),
        selected_meter: selectedMeter ? {
          id: selectedMeter.id,
          name: selectedMeter.name,
          is_default: selectedMeter.is_default,
          meter_power_kva: selectedMeter.meter_power_kva,
          grid_type: selectedMeter.grid_type,
          consumption_mode: selectedMeter.consumption_mode,
          consumption_profile: selectedMeter.consumption_profile,
          hp_hc: selectedMeter.hp_hc,
          tariff_type: selectedMeter.tariff_type,
        } : null,
        annual_kwh: annualConsumption,
        monthly_kwh: monthlyConsumption.map((m) => ({
          year: m.year,
          month: m.month,
          kwh: numericOrNull(m.kwh),
          meter_id: m.meter_id,
        })),
        hourly_8760_kwh: persistedConsoHourly,
        hourly_source: persistedConsoHourly ? (csvData?.found ? "csv_file" : "persisted_json") : null,
        csv: csvData ? {
          found: csvData.found,
          csv_path: csvData.csv_path,
          local_path: csvData.local_path,
          raw_rows: csvData.raw_rows,
          unit_interpreted_as: csvData.unit_interpreted_as,
        } : null,
        timezone: findFirstValueByNames(dataJson, ["timezone", "time_zone"], 6) ?? null,
        reference_year: findFirstValueByNames(dataJson, ["reference_year", "simulation_year"], 6) ?? null,
        corrections_applied: findFirstValueByNames(dataJson, ["corrections_applied", "meter_calc_change_lines_fr"], 6) ?? null,
      },
      production: {
        _trace: source("study_versions.data_json", "calc_result.pv", null, "persisted", !!calcResult?.pv),
        pvgis_monthly_raw_kwh_per_kwc: monthlyRawPerKwc ?? null,
        monthly_scaled_kwh: productionMonthly ?? null,
        pv_hourly_8760_kwh: Array.isArray(pvHourly) && pvHourly.length === 8760 ? pvHourly : null,
        annual_kwh: calcResult?.pv?.total_kwh ?? selectedScenario?.production?.annual_kwh ?? selectedSnapshot?.production?.annual_kwh ?? null,
        factor_ac: calcResult?.pv?.factorAC ?? selectedScenario?.production_assumptions?.factorAC ?? null,
        source: calcResult?.pv?.source ?? null,
        losses_and_factors: calcResult?.pv?.loss_breakdown ?? null,
      },
      v2h: {
        _trace: source("economic_snapshots/data_json/selected_scenario_snapshot", "vehicleV2h", null, "persisted", !!vehicleV2h),
        parameters: vehicleV2h,
        availability: findFirstValueByNames(vehicleV2h, ["availability_hourly", "availability", "presence_grid"], 6) ?? null,
        selected_scenario_energy: selectedScenario?.id?.startsWith?.("VEHICLE_V2H") ? selectedScenario.energy ?? null : null,
      },
      virtual_battery: {
        _trace: source("economic_snapshots/data_json/scenarios_v2", "virtual battery fields", null, "persisted", !!virtualBattery),
        parameters: virtualBattery,
        selected_scenario_finance: selectedScenario?.virtual_battery_finance ?? null,
      },
      economics: {
        _trace: source("economic_snapshots", "config_json", null, "persisted", !!economicSnapshot),
        economic_snapshot: economicsConfig,
        organization_economics: organizationSettings?.economics ?? null,
        capex_ttc: selectedScenario?.finance?.capex_ttc ?? selectedSnapshot?.finance?.capex_ttc ?? economicsConfig?.totals?.ttc ?? null,
        quotes,
      },
      results: {
        _trace: source("study_versions", "selected_scenario_snapshot, final_study_json, data_json", null, "persisted", !!selectedVersion),
        selected_scenario_snapshot: selectedSnapshot,
        final_study_json: finalStudyJson,
        calc_result: calcResult,
        scenarios_v2: scenariosV2,
        selected_scenario: selectedScenario,
        hourly_tables_persisted: {
          consumption_hourly_8760_present: Array.isArray(persistedConsoHourly) && persistedConsoHourly.length === 8760,
          pv_hourly_8760_present: Array.isArray(pvHourly) && pvHourly.length === 8760,
        },
      },
      raw_technical_snapshots: {
        study_versions: versions.map((v) => ({
          id: v.id,
          version_number: v.version_number,
          status: v.status,
          created_at: v.created_at,
          updated_at: v.updated_at,
          selected_scenario_id: v.selected_scenario_id,
          has_selected_scenario_snapshot: !!v.selected_scenario_snapshot,
          has_final_study_json: !!v.final_study_json,
          has_calc_result: !!v.data_json?.calc_result,
          scenarios_v2_count: Array.isArray(v.data_json?.scenarios_v2) ? v.data_json.scenarios_v2.length : 0,
        })),
        lead: redactPersonalLead(lead),
        site_address: compactAddress(address),
        calpinage_data: calpinageData,
        calpinage_snapshots: calpinageSnapshots,
        economic_snapshots: economicSnapshots,
        documents: documents.map((d) => ({
          id: d.id,
          entity_type: d.entity_type,
          entity_id: d.entity_id,
          file_name: d.file_name,
          mime_type: d.mime_type,
          document_type: d.document_type,
          document_category: d.document_category,
          source_type: d.source_type,
          created_at: d.created_at,
        })),
      },
      missing_fields: missingFields,
      validation_checks: checks,
    });

    exportData.export_metadata.tables_read = Array.from(TABLES_READ).sort();

    addCheck("study_number exact", exportData.study.study_number === STUDY_REF, { value: exportData.study.study_number });
    addCheck("consumption hourly length 8760", Array.isArray(exportData.consumption.hourly_8760_kwh) && exportData.consumption.hourly_8760_kwh.length === 8760, { length: exportData.consumption.hourly_8760_kwh?.length ?? 0 });
    if (Array.isArray(exportData.consumption.hourly_8760_kwh) && Number.isFinite(Number(exportData.consumption.annual_kwh))) {
      const s = sum(exportData.consumption.hourly_8760_kwh);
      addCheck("consumption hourly sum close to annual", Math.abs(s - Number(exportData.consumption.annual_kwh)) <= Math.max(1, Number(exportData.consumption.annual_kwh) * 0.01), { sum_hourly: Math.round(s * 1000) / 1000, annual_kwh: exportData.consumption.annual_kwh });
    }
    addCheck("production hourly length 8760 if present", exportData.production.pv_hourly_8760_kwh == null || exportData.production.pv_hourly_8760_kwh.length === 8760, { length: exportData.production.pv_hourly_8760_kwh?.length ?? null });
    if (Array.isArray(exportData.production.monthly_scaled_kwh) && Number.isFinite(Number(exportData.production.annual_kwh))) {
      const m = sum(exportData.production.monthly_scaled_kwh);
      addCheck("production monthly sum coherent with annual", Math.abs(m - Number(exportData.production.annual_kwh)) <= Math.max(1, Number(exportData.production.annual_kwh) * 0.01), { monthly_sum: Math.round(m * 1000) / 1000, annual_kwh: exportData.production.annual_kwh });
    }
    if (Array.isArray(exportData.pv_system.pans) && Number.isFinite(Number(exportData.pv_system.total_power_kwc))) {
      const panSum = exportData.pv_system.pans.reduce((acc, p) => acc + (Number(p.total_power_kwc ?? p.power_kwc ?? p.kwc ?? p.panelCount * ((exportData.pv_system.panel?.power_wc || 0) / 1000)) || 0), 0);
      addCheck("total power coherent with pans", Math.abs(panSum - Number(exportData.pv_system.total_power_kwc)) <= Math.max(0.05, Number(exportData.pv_system.total_power_kwc) * 0.05), { pan_sum_kwc: Math.round(panSum * 1000) / 1000, total_power_kwc: exportData.pv_system.total_power_kwc });
    }
    addCheck("selected scenario coherent with snapshot", !selectedScenarioId || !selectedSnapshot || selectedSnapshot.scenario_type === selectedScenarioId, { selected_scenario_id: selectedScenarioId, snapshot_scenario_type: selectedSnapshot?.scenario_type ?? null });

    exportData.validation_checks = checks;
    const jsonTextProbe = JSON.stringify(exportData);
    addCheck("no secret or database url in file", !containsForbiddenSecretText(jsonTextProbe), null);
    addCheck("no unnecessary personal data keys in file", !containsPersonalDataText(jsonTextProbe), null);
    exportData.validation_checks = checks;

  } catch (err) {
    fatalError = err;
    if (exportBase.export_metadata.execution_attempts?.[0]) {
      exportBase.export_metadata.execution_attempts[0].status = "failed";
      exportBase.export_metadata.execution_attempts[0].error =
        err.message || err.code || err.name || "Database connection failed";
    }
    addMissing("export.execution", "bloquant", "script execution", false);
    exportData = {
      ...exportBase,
      export_metadata: {
        ...exportBase.export_metadata,
        tables_read: Array.from(TABLES_READ).sort(),
      },
      error: {
        message: err.message || err.code || err.name || "Database connection failed",
        code: err.code ?? null,
        name: err.name ?? null,
      },
    };
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
    if (exportData) {
      exportData.export_metadata.tables_read = Array.from(TABLES_READ).sort();
      exportData.missing_fields = missingFields;
      exportData.validation_checks = checks;
      await writeJson(SNAPSHOT_PATH, exportData);
      await writeReport(REPORT_PATH, buildReport({
        studyFound,
        version: selectedVersion,
        selectedScenarioId,
        exportData,
        error: fatalError,
      }));
    }
  }
}

main().catch(async (err) => {
  const data = {
    export_metadata: {
      study_reference: STUDY_REF,
      exported_at: nowIso(),
      environment_used: environmentLabel(),
      retrieval_method: "direct_sql_select_readonly",
      tables_read: Array.from(TABLES_READ).sort(),
      read_services_called: SERVICES_CALLED,
      no_database_writes_performed: true,
    },
    error: { message: err.message, code: err.code ?? null },
    missing_fields: missingFields,
    validation_checks: checks,
  };
  await writeJson(SNAPSHOT_PATH, data);
  await writeReport(REPORT_PATH, buildReport({ studyFound: false, version: null, selectedScenarioId: null, exportData: data, error: err }));
  process.exitCode = 1;
});
