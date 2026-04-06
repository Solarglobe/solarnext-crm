/**
 * Test pipeline complet : Calpinage → Analyse Ombres → Validation calpinage → Devis → Qualité des snapshots.
 * Vérifie que technical_snapshot (calpinage_snapshots) et economic_snapshot (quote + lignes) sont complets,
 * cohérents et figés (immuables après modification du calpinage).
 *
 * Usage: node backend/scripts/test-pipeline-study-to-quote.js
 * Prérequis: DATABASE_URL, migrations à jour.
 */

import "dotenv/config";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, "../../.env.dev"), override: false });
config({ path: resolve(__dirname, "../.env"), override: false });

import { pool } from "../config/db.js";
import { createCalpinageSnapshot } from "../services/calpinage/calpinageSnapshot.service.js";
import { validateCalpinage } from "../controllers/calpinageValidate.controller.js";
import * as quoteService from "../routes/quotes/service.js";
import { withTx } from "../db/tx.js";

const TEST_PREFIX = "PIPELINE-Q2Q";
let assertionsPassed = 0;
let assertionsFailed = 0;

function ok(msg, detail = "") {
  assertionsPassed++;
  console.log(`  ✔ ${msg}${detail ? ` — ${detail}` : ""}`);
}

function fail(msg, detail = "") {
  assertionsFailed++;
  const err = detail ? new Error(`${msg}: ${detail}`) : new Error(msg);
  console.log(`  ✖ ${msg}`);
  if (detail) console.log(`    ${detail}`);
  throw err;
}

function assert(cond, fieldOrMsg) {
  if (!cond) {
    assertionsFailed++;
    throw new Error(typeof fieldOrMsg === "string" ? `Champ critique manquant ou invalide: ${fieldOrMsg}` : fieldOrMsg);
  }
  assertionsPassed++;
}

/** Organisation de test (ou première existante) */
async function getOrCreateOrg() {
  const r = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
  if (r.rows.length > 0) return r.rows[0].id;
  const ins = await pool.query(
    "INSERT INTO organizations (name) VALUES ($1) RETURNING id",
    [`${TEST_PREFIX}-Org-${Date.now()}`]
  );
  return ins.rows[0].id;
}

/** Lead + Study + StudyVersion (sans Client : devis lead-only) */
async function createLeadStudyVersion(orgId) {
  let stageId;
  const stageRes = await pool.query(
    "SELECT id FROM pipeline_stages WHERE organization_id = $1 ORDER BY position ASC LIMIT 1",
    [orgId]
  );
  if (stageRes.rows[0]?.id) {
    stageId = stageRes.rows[0].id;
  } else {
    const insStage = await pool.query(
      `INSERT INTO pipeline_stages (organization_id, name, position, is_closed) VALUES ($1, 'Qualification', 0, false) RETURNING id`,
      [orgId]
    );
    stageId = insStage.rows[0].id;
  }

  const addrRes = await pool.query(
    `INSERT INTO addresses (organization_id, city, lat, lon, country_code) VALUES ($1, 'Paris', 48.8566, 2.3522, 'FR') RETURNING id`,
    [orgId]
  );
  const addressId = addrRes.rows[0].id;

  const leadRes = await pool.query(
    `INSERT INTO leads (organization_id, stage_id, first_name, last_name, full_name, email, site_address_id)
     VALUES ($1, $2, 'Test', 'Pipeline', 'Test Pipeline', 'pipeline-q2q@test.local', $3) RETURNING id`,
    [orgId, stageId, addressId]
  );
  const leadId = leadRes.rows[0].id;

  const studyRes = await pool.query(
    `INSERT INTO studies (organization_id, lead_id, study_number, status)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [orgId, leadId, `${TEST_PREFIX}-${Date.now()}`, "draft"]
  );
  const studyId = studyRes.rows[0].id;

  const versionRes = await pool.query(
    `INSERT INTO study_versions (organization_id, study_id, version_number, data_json)
     VALUES ($1, $2, 1, '{}'::jsonb) RETURNING id`,
    [orgId, studyId]
  );
  const versionId = versionRes.rows[0].id;

  return { orgId, leadId, studyId, versionId, addressId };
}

/** geometry_json minimal pour sous-test "validate endpoint equivalence" (shading null accepté) */
function minimalGeometryForEndpointTest() {
  return {
    roofState: { gps: { lat: 48.8566, lon: 2.3522 } },
    gps: { lat: 48.8566, lon: 2.3522 },
    validatedRoofData: {
      pans: [{ id: "PAN_1", orientationDeg: 180, tiltDeg: 30, surfaceM2: 50 }],
      scale: 1,
      north: 0,
    },
    pvParams: { panelSpec: { powerWc: 500 } },
    frozenBlocks: [],
    shading: null,
    _testMeta: { number_of_panels: 1, total_power_w: 500 },
  };
}

/** geometry_json minimal mais réaliste : 12 panneaux, shading 4.2 %, GPS, orientation 180, tilt 30, onduleur */
function buildCalpinageGeometryJson() {
  const lat = 48.8566;
  const lon = 2.3522;
  const modulePowerW = 500;
  const numPanels = 12;
  const totalPowerW = numPanels * modulePowerW;
  const orientationDeg = 180;
  const tiltDeg = 30;
  const totalLossPct = 4.2;

  const panels = Array.from({ length: numPanels }, (_, i) => ({
    id: `panel-${i + 1}`,
    center: { x: 100 + i * 50, y: 100 },
    orientation: orientationDeg,
    state: "placed",
  }));

  return {
    roofState: { gps: { lat, lon } },
    gps: { lat, lon },
    validatedRoofData: {
      pans: [
        {
          id: "PAN_1",
          orientationDeg,
          tiltDeg,
          surfaceM2: 50,
          panelCount: numPanels,
          polygonPx: [
            { x: 100, y: 100 },
            { x: 600, y: 100 },
            { x: 600, y: 400 },
            { x: 100, y: 400 },
          ],
        },
      ],
      scale: 1,
      north: 0,
    },
    pvParams: {
      panelSpec: { powerWc: modulePowerW, powerWp: modulePowerW },
      orientationPanneaux: "portrait",
    },
    frozenBlocks: [
      {
        id: "block-1",
        panId: "PAN_1",
        panels,
        rotation: 0,
        orientation: "PORTRAIT",
      },
    ],
    shading: {
      normalized: {
        totalLossPct,
        panelCount: numPanels,
        perPanel: panels.map(() => ({ lossPct: totalLossPct / numPanels })),
        combined: { totalLossPct },
      },
      totalLossPct,
    },
    inverter: {
      id: "inv-1",
      brand: "Test",
      model: "Inverter 6kW",
      nominal_power_kw: 6,
      inverter_type: "STRING",
    },
    _testMeta: {
      number_of_panels: numPanels,
      total_power_w: totalPowerW,
      orientation_deg: orientationDeg,
      tilt_deg: tiltDeg,
    },
  };
}

/** Injecte calpinage via INSERT (équivalent POST /api/studies/:id/versions/1/calpinage) */
async function injectCalpinage(orgId, versionId, geometryJson) {
  const totalPanels = geometryJson._testMeta?.number_of_panels ?? 12;
  const totalPowerW = geometryJson._testMeta?.total_power_w ?? 6000;
  const totalPowerKwc = totalPowerW / 1000;
  const totalLossPct = geometryJson.shading?.totalLossPct ?? 4.2;

  await pool.query(
    `INSERT INTO calpinage_data (organization_id, study_version_id, geometry_json, total_panels, total_power_kwc, annual_production_kwh, total_loss_pct)
     VALUES ($1, $2, $3::jsonb, $4, $5, NULL, $6)
     ON CONFLICT (study_version_id)
     DO UPDATE SET
       geometry_json = EXCLUDED.geometry_json,
       total_panels = EXCLUDED.total_panels,
       total_power_kwc = EXCLUDED.total_power_kwc,
       total_loss_pct = EXCLUDED.total_loss_pct`,
    [orgId, versionId, JSON.stringify(geometryJson), totalPanels, totalPowerKwc, totalLossPct]
  );
}

/** Crée un devis avec lignes (snapshot_json minimal pour satisfaire NOT NULL + chk). clientId optionnel (devis lead-only si null). */
async function createQuoteWithLines(orgId, clientId, leadId, studyId, items) {
  const quoteNumber = `DRAFT-PL-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return withTx(pool, async (client) => {
    const insQuote = await client.query(
      `INSERT INTO quotes (organization_id, client_id, lead_id, study_id, quote_number, status, total_ht, total_vat, total_ttc)
       VALUES ($1, $2, $3, $4, $5, 'draft', 0, 0, 0) RETURNING id`,
      [orgId, clientId ?? null, leadId || null, studyId || null, quoteNumber]
    );
    const quoteId = insQuote.rows[0].id;
    let totalHt = 0;
    let totalVat = 0;
    let totalTtc = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const qty = Number(it.quantity) || 0;
      const up = Number(it.unit_price_ht) || 0;
      const rate = Number(it.tva_rate) || 0;
      const totalLineHt = Math.round(qty * up * 100) / 100;
      const totalLineVat = Math.round(totalLineHt * (rate / 100) * 100) / 100;
      const totalLineTtc = Math.round((totalLineHt + totalLineVat) * 100) / 100;
      totalHt += totalLineHt;
      totalVat += totalLineVat;
      totalTtc += totalLineTtc;
      const snapshotJson = JSON.stringify({
        name: it.label || "",
        description: it.description || "",
        category: "OTHER",
        source: {},
      });
      await client.query(
        `INSERT INTO quote_lines (organization_id, quote_id, label, description, quantity, unit_price_ht, vat_rate, total_line_ht, total_line_vat, total_line_ttc, position, snapshot_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
        [
          orgId,
          quoteId,
          it.label || null,
          it.description || "",
          qty,
          up,
          rate,
          totalLineHt,
          totalLineVat,
          totalLineTtc,
          i + 1,
          snapshotJson,
        ]
      );
    }
    totalHt = Math.round(totalHt * 100) / 100;
    totalVat = Math.round(totalVat * 100) / 100;
    totalTtc = Math.round(totalTtc * 100) / 100;
    await client.query(
      "UPDATE quotes SET total_ht = $1, total_vat = $2, total_ttc = $3 WHERE id = $4",
      [totalHt, totalVat, totalTtc, quoteId]
    );
    return quoteId;
  });
}

/** Récupère le snapshot technique actif (calpinage_snapshots) pour l'étude */
async function getActiveTechnicalSnapshot(studyId) {
  const r = await pool.query(
    `SELECT id, version_number, snapshot_json FROM calpinage_snapshots
     WHERE study_id = $1 AND is_active = true ORDER BY version_number DESC LIMIT 1`,
    [studyId]
  );
  if (r.rows.length === 0) return null;
  return r.rows[0].snapshot_json;
}

/** Valide technical_snapshot (payload = copie du geometry_json) */
function validateTechnicalSnapshot(snapshotJson, expectedPanels = 12) {
  if (!snapshotJson || typeof snapshotJson !== "object") {
    fail("technical_snapshot", "snapshot_json manquant ou invalide");
  }
  const payload = snapshotJson.payload || snapshotJson;
  const gps = payload.roofState?.gps || payload.gps;
  assert(gps && typeof gps.lat === "number" && typeof gps.lon === "number", "gps");

  const vrd = payload.validatedRoofData;
  assert(vrd && Array.isArray(vrd.pans), "validatedRoofData.pans");
  const pan = vrd.pans[0];
  assert(pan, "validatedRoofData.pans[0]");
  const orientationDeg = pan.orientationDeg ?? pan.orientation_deg ?? payload._testMeta?.orientation_deg;
  const tiltDeg = pan.tiltDeg ?? pan.tilt_deg ?? payload._testMeta?.tilt_deg;
  assert(typeof orientationDeg === "number", "orientation_deg");
  assert(typeof tiltDeg === "number", "tilt_deg");

  const numPanels = payload._testMeta?.number_of_panels ?? (payload.frozenBlocks?.[0]?.panels?.length ?? 0) ?? (vrd.pans?.reduce((s, p) => s + (p.panelCount ?? 0), 0));
  assert(numPanels === expectedPanels, `number_of_panels (attendu ${expectedPanels}, obtenu ${numPanels})`);

  const totalPowerW = payload._testMeta?.total_power_w ?? (numPanels * (payload.pvParams?.panelSpec?.powerWc ?? 500));
  assert(Number.isFinite(totalPowerW) && totalPowerW > 0, "total_power_w");

  const shading = payload.shading;
  const totalLossPct = shading?.totalLossPct ?? shading?.normalized?.totalLossPct ?? shading?.combined?.totalLossPct;
  assert(totalLossPct !== undefined && totalLossPct !== null && Number.isFinite(Number(totalLossPct)), "shading.totalLossPct");

  const inverter = payload.inverter;
  assert(!inverter || typeof inverter === "object", "inverter (présent et objet si défini)");

  if (inverter && typeof inverter.nominal_power_kw === "number" && totalPowerW > 0) {
    const ratioDcAc = totalPowerW / (inverter.nominal_power_kw * 1000);
    assert(ratioDcAc >= 0.5 && ratioDcAc <= 2.5, `ratio DC/AC cohérent (${ratioDcAc.toFixed(2)})`);
    ok("technical_snapshot: ratio DC/AC cohérent", ratioDcAc.toFixed(2));
  }

  ok("technical_snapshot: number_of_panels", String(numPanels));
  ok("technical_snapshot: total_power_w", String(totalPowerW));
  ok("technical_snapshot: orientation_deg", String(orientationDeg));
  ok("technical_snapshot: tilt_deg", String(tiltDeg));
  ok("technical_snapshot: shading.totalLossPct", String(totalLossPct));
  ok("technical_snapshot: gps présent", "");
  ok("technical_snapshot: inverter présent ou null", "");
  return { number_of_panels: numPanels, total_power_w: totalPowerW, orientation_deg: orientationDeg, tilt_deg: tiltDeg, totalLossPct, gps };
}

/** Valide economic_snapshot (quote + items) : lignes, TVA, totaux, pas d'undefined/NaN */
function validateEconomicSnapshot(quoteData) {
  const { quote, items } = quoteData;
  if (!quote) fail("economic_snapshot", "quote manquant");
  assert(Array.isArray(items), "items (array)");

  const totalHt = Number(quote.total_ht);
  const totalVat = Number(quote.total_vat);
  const totalTtc = Number(quote.total_ttc);
  assert(!Number.isNaN(totalHt), "total_ht (NaN)");
  assert(!Number.isNaN(totalVat), "total_vat (NaN)");
  assert(!Number.isNaN(totalTtc), "total_ttc (NaN)");

  let sumHt = 0;
  let sumVat = 0;
  for (const line of items) {
    assert(line.quantity !== undefined && line.unit_price_ht !== undefined, `ligne ${line.id || line.label}: quantity ou unit_price_ht manquant`);
    const qty = Number(line.quantity);
    const up = Number(line.unit_price_ht);
    const rate = Number(line.vat_rate ?? 0);
    assert(!Number.isNaN(qty), `ligne quantity NaN`);
    assert(!Number.isNaN(up), `ligne unit_price_ht NaN`);
    sumHt += qty * up;
    sumVat += (qty * up * rate) / 100;
  }
  sumHt = Math.round(sumHt * 100) / 100;
  sumVat = Math.round(sumVat * 100) / 100;
  const expectedTtc = Math.round((sumHt + sumVat) * 100) / 100;
  assert(Math.abs(totalHt - sumHt) < 0.02, `total_ht cohérent (attendu ~${sumHt}, obtenu ${totalHt})`);
  assert(Math.abs(totalTtc - expectedTtc) < 0.02, `total_ttc cohérent (attendu ~${expectedTtc}, obtenu ${totalTtc})`);

  ok("economic_snapshot: lignes présentes", String(items.length));
  ok("economic_snapshot: total_ht cohérent", String(totalHt));
  ok("economic_snapshot: total_ttc cohérent", String(totalTtc));
  ok("economic_snapshot: aucun undefined/NaN sur totaux", "");
  return { total_ht: totalHt, total_ttc: totalTtc, linesCount: items.length };
}

/** Mock res pour appel controller (équivalence endpoint) */
function mockRes() {
  const out = { statusCode: null, body: null };
  return {
    status(code) {
      out.statusCode = code;
      return this;
    },
    json(data) {
      out.body = data;
      return this;
    },
    getResult: () => out,
  };
}

/** Nettoyage (ordre FK) */
async function cleanup(ids) {
  if (!ids) return;
  try {
    if (ids.quoteId) {
      await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [ids.quoteId]);
      await pool.query("DELETE FROM quotes WHERE id = $1", [ids.quoteId]);
    }
    if (ids.studyId) {
      await pool.query("DELETE FROM calpinage_snapshots WHERE study_id = $1", [ids.studyId]);
      await pool.query("DELETE FROM calpinage_data WHERE study_version_id = $1", [ids.versionId]);
      await pool.query("DELETE FROM study_versions WHERE study_id = $1", [ids.studyId]);
      await pool.query("DELETE FROM studies WHERE id = $1", [ids.studyId]);
    }
    if (ids.leadId) await pool.query("DELETE FROM leads WHERE id = $1", [ids.leadId]);
    if (ids.addressId) await pool.query("DELETE FROM addresses WHERE id = $1", [ids.addressId]);
  } catch (e) {
    console.warn("  ⚠ Cleanup:", e.message);
  }
}

async function run() {
  console.log("\n=== Pipeline Calpinage → Validation → Devis (qualité snapshots) ===\n");

  let ids = null;
  let quoteId = null;

  try {
    const orgId = await getOrCreateOrg();

    // --- Sous-test : équivalence endpoint == service (POST /calpinage/validate → createCalpinageSnapshot)
    console.log("0) [Équivalence endpoint] Étude de test dédiée, appel controller validateCalpinage (shading null)\n");
    let idsEp = null;
    try {
      idsEp = await createLeadStudyVersion(orgId);
      await injectCalpinage(orgId, idsEp.versionId, minimalGeometryForEndpointTest());
      const req = {
        params: { studyId: idsEp.studyId },
        body: { studyVersionId: idsEp.versionId },
        query: {},
        user: { organizationId: orgId, organization_id: orgId, id: null, userId: null },
      };
      const res = mockRes();
      await validateCalpinage(req, res);
      const { statusCode, body } = res.getResult();
      assert(statusCode === 200, "endpoint équivalence: status 200");
      assert(body?.snapshotId && typeof body?.version_number === "number", "endpoint équivalence: snapshotId et version_number");
      const snapCheck = await pool.query(
        "SELECT id FROM calpinage_snapshots WHERE study_id = $1 AND is_active = true",
        [idsEp.studyId]
      );
      assert(snapCheck.rows.length === 1, "endpoint équivalence: 1 snapshot créé en base");
      ok("Validate endpoint == createCalpinageSnapshot (source de vérité unique)", "");
    } finally {
      if (idsEp) await cleanup(idsEp);
    }

    ids = await createLeadStudyVersion(orgId);
    const { studyId, versionId, leadId, addressId } = ids;

    console.log("1) Données créées : org, lead, study, version (sans Client — devis lead-only)\n");

    const geometryJson = buildCalpinageGeometryJson();
    await injectCalpinage(orgId, versionId, geometryJson);
    console.log("2) Calpinage injecté (12 panneaux, 6000 W, shading 4.2 %, orientation 180°, tilt 30°)\n");

    const validateResult = await createCalpinageSnapshot(studyId, versionId, orgId, null);
    console.log("3) Validation calpinage : snapshot créé, version_number =", validateResult.version_number, "\n");

    const items = [
      { label: "Panneaux 500 Wc", description: "12 × 500 Wc", quantity: 12, unit_price_ht: 500, tva_rate: 10 },
      { label: "Pose", description: "Pose et raccordement", quantity: 1, unit_price_ht: 2000, tva_rate: 10 },
      { label: "Remise", description: "Remise commerciale", quantity: 1, unit_price_ht: -500, tva_rate: 0 },
    ];
    quoteId = await createQuoteWithLines(orgId, null, leadId, studyId, items);
    assert(quoteId, "quote.id après createQuote");
    ids.quoteId = quoteId;
    console.log("4) Devis créé sans client (lead_id + study_id), quote_id =", quoteId, "\n");

    const getQuote = await quoteService.getQuoteById(quoteId, orgId);
    console.log("5) Devis récupéré (GET quote)\n");
    assert(getQuote.quote.client_id == null, "Devis lead-only : client_id doit être null");
    assert(getQuote.quote.lead_id === leadId, "Devis lead-only : lead_id doit être renseigné");
    ok("Devis créé sans client (lead-only)", "");

    const technicalSnapshot = await getActiveTechnicalSnapshot(studyId);
    assert(technicalSnapshot, "technical_snapshot (calpinage_snapshots actif)");

    console.log("——— PHASE 2 : Validations ———\n");
    const techResult = validateTechnicalSnapshot(technicalSnapshot, 12);
    const econResult = validateEconomicSnapshot(getQuote);

    console.log("\n——— Snapshot technique (JSON) ———\n");
    console.log(JSON.stringify(technicalSnapshot, null, 2));

    console.log("\n——— Snapshot économique (quote + items) ———\n");
    console.log(JSON.stringify({ quote: getQuote.quote, items: getQuote.items }, null, 2));

    console.log("\n——— PHASE 3 : Immutabilité ———\n");
    const geometryModified = buildCalpinageGeometryJson();
    geometryModified._testMeta = { number_of_panels: 14, total_power_w: 7000, orientation_deg: 180, tilt_deg: 30 };
    geometryModified.frozenBlocks[0].panels = Array.from({ length: 14 }, (_, i) => ({
      id: `panel-${i + 1}`,
      center: { x: 100 + i * 40, y: 100 },
      orientation: 180,
      state: "placed",
    }));
    await injectCalpinage(orgId, versionId, geometryModified);
    console.log("6) Calpinage modifié (14 panneaux) — rechargement devis et snapshot\n");

    const technicalAfter = await getActiveTechnicalSnapshot(studyId);
    const quoteAfter = await quoteService.getQuoteById(quoteId, orgId);

    assert(technicalAfter, "technical_snapshot après modification (toujours présent)");
    const techAfterResult = validateTechnicalSnapshot(technicalAfter, 12);
    if (techAfterResult.number_of_panels !== 12) {
      fail("Immutabilité technical_snapshot", `number_of_panels doit rester 12, obtenu ${techAfterResult.number_of_panels}`);
    }
    ok("technical_snapshot.number_of_panels reste 12 après modification calpinage", "");

    const econAfter = validateEconomicSnapshot(quoteAfter);
    if (econAfter.total_ttc !== econResult.total_ttc || econAfter.linesCount !== econResult.linesCount) {
      fail("Immutabilité economic_snapshot", "total_ttc ou nombre de lignes a changé");
    }
    ok("economic_snapshot identique après modification calpinage", "");

    console.log("\n——— Résultat des assertions ———");
    console.log(`  Passed: ${assertionsPassed}`);
    console.log(`  Failed: ${assertionsFailed}`);

    if (assertionsFailed > 0) {
      console.log("\n❌ FAIL\n");
      process.exit(1);
    }
    console.log("\n✔ PASS — Pipeline étude → devis fiable, snapshots complets et figés.\n");
  } catch (e) {
    console.error("\n❌ FAIL:", e.message);
    if (e.stack) console.error(e.stack);
    process.exit(1);
  } finally {
    await cleanup(ids);
  }
}

run();
