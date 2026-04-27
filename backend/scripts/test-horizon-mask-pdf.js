/**
 * CP-DSM-PDF-006 — Tests export PDF "Masque d'ombrage" (1 page)
 * Usage: cd backend && node scripts/test-horizon-mask-pdf.js
 *
 * Scénarios :
 * 1) Données mockées lat/lon → génération PDF OK
 * 2) Study inexistante → 400 BUSINESS
 * 3) Pas de lat/lon (et pas de calpinage gps) → 400 BUSINESS
 *
 * Sortie : PASS/FAIL + taille PDF
 */

import "../config/register-local-env.js";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { buildHorizonMaskSinglePageHtml } from "../pdf/horizonMaskHtmlBuilder.js";
import { generatePdfFromHtml } from "../pdf/playwright-dsm-analysis.js";
import { getHorizonMaskPdfData } from "../services/horizonMaskPdf.service.js";
import { pool } from "../config/db.js";

const MIN_SIZE_KB = 10;
let passed = 0;
let failed = 0;

function ok(name, detail = "") {
  passed++;
  console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, err) {
  failed++;
  console.log(`  ❌ ${name}`);
  console.log(`     ${err?.message || err}`);
}

const mockHorizonMask = [];
for (let i = 0; i <= 360; i += 10) {
  const elev = 5 + 15 * Math.sin((i * Math.PI) / 180) * Math.cos(((i - 180) * Math.PI) / 180);
  mockHorizonMask.push({ az: i, elev: Math.max(0, Math.min(50, elev)) });
}

const mockData = {
  address: "12 rue Example, 75001 Paris",
  date: new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }),
  lat: 48.8566,
  lon: 2.3522,
  orientationDeg: 180,
  tiltDeg: 30,
  horizonMask: { mask: mockHorizonMask, source: "RELIEF_ONLY" },
  horizonMeta: { source: "RELIEF_ONLY", confidence: 0.85 },
};

async function scenario1() {
  console.log("\n1. Données mockées lat/lon → génération PDF OK");
  try {
    const html = buildHorizonMaskSinglePageHtml(mockData);
    if (!html || html.length === 0) {
      fail("Scenario 1", new Error("HTML vide"));
      return;
    }
    if (html.includes("undefined") || html.includes("NaN")) {
      fail("Scenario 1", new Error("HTML contient undefined/NaN"));
      return;
    }
    if (!html.includes("Masque d'horizon")) {
      fail("Scenario 1", new Error("Titre Masque d'horizon absent"));
      return;
    }

    const pdfBuffer = await generatePdfFromHtml(html);
    if (!Buffer.isBuffer(pdfBuffer)) {
      fail("Scenario 1", new Error("PDF n'est pas un Buffer"));
      return;
    }
    if (pdfBuffer[0] !== 0x25 || pdfBuffer[1] !== 0x50) {
      fail("Scenario 1", new Error("Magic PDF invalide"));
      return;
    }
    const sizeKb = Math.round(pdfBuffer.length / 1024);
    if (pdfBuffer.length < MIN_SIZE_KB * 1024) {
      fail("Scenario 1", new Error(`PDF trop petit: ${sizeKb} KB (min ${MIN_SIZE_KB} KB)`));
      return;
    }

    ok("HTML généré");
    ok("PDF valide (magic %P)");
    ok(`Taille ${sizeKb} KB`);
  } catch (e) {
    fail("Scenario 1", e);
  }
}

async function scenario2() {
  console.log("\n2. Study inexistante → 400 BUSINESS");
  try {
    const fakeStudyId = "00000000-0000-0000-0000-000000000001";
    let orgId;
    const orgRes = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
    if (orgRes.rows.length === 0) {
      console.log("  ⏭ Skip (aucune org en DB)");
      return;
    }
    orgId = orgRes.rows[0].id;

    let errMsg = "";
    try {
      await getHorizonMaskPdfData({
        studyId: fakeStudyId,
        versionId: 1,
        orgId,
      });
    } catch (e) {
      errMsg = e.message || "";
    }

    if (errMsg.includes("Étude non trouvée")) {
      ok("Erreur BUSINESS: Étude non trouvée");
    } else {
      fail("Scenario 2", new Error(`Attendu "Étude non trouvée", obtenu: ${errMsg || "aucune erreur"}`));
    }
  } catch (e) {
    if (e.code === "ECONNREFUSED" || e.message?.includes("connect")) {
      console.log("  ⏭ Skip (DB non disponible)");
    } else {
      fail("Scenario 2", e);
    }
  }
}

async function scenario3() {
  console.log("\n3. Pas de lat/lon (et pas de calpinage gps) → 400 BUSINESS");
  let addressId = null;
  let leadId = null;
  let studyId = null;
  try {
    let orgId;
    let stageId;
    const orgRes = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
    if (orgRes.rows.length === 0) {
      console.log("  ⏭ Skip (aucune org en DB)");
      return;
    }
    orgId = orgRes.rows[0].id;

    const stageRes = await pool.query(
      "SELECT id FROM pipeline_stages WHERE organization_id = $1 ORDER BY position ASC LIMIT 1",
      [orgId]
    );
    if (stageRes.rows.length === 0) {
      const ins = await pool.query(
        `INSERT INTO pipeline_stages (organization_id, name, position, is_closed)
         VALUES ($1, 'Qualification', 0, false) RETURNING id`,
        [orgId]
      );
      stageId = ins.rows[0].id;
    } else {
      stageId = stageRes.rows[0].id;
    }

    const addrRes = await pool.query(
      `INSERT INTO addresses (organization_id, city, country_code)
       VALUES ($1, 'Paris', 'FR')
       RETURNING id`,
      [orgId]
    );
    addressId = addrRes.rows[0].id;

    const leadRes = await pool.query(
      `INSERT INTO leads (organization_id, stage_id, first_name, last_name, full_name, email, site_address_id)
       VALUES ($1, $2, 'Test', 'HM', 'Test HM', 'hm-test@test.local', $3)
       RETURNING id`,
      [orgId, stageId, addressId]
    );
    leadId = leadRes.rows[0].id;

    const studyRes = await pool.query(
      `INSERT INTO studies (organization_id, lead_id, study_number, status)
       VALUES ($1, $2, $3, 'draft')
       RETURNING id`,
      [orgId, leadId, `HM-NOLAT-${Date.now()}`]
    );
    studyId = studyRes.rows[0].id;

    await pool.query(
      `INSERT INTO study_versions (organization_id, study_id, version_number, data_json)
       VALUES ($1, $2, 1, '{}'::jsonb)`,
      [orgId, studyId]
    );

    let errMsg = "";
    try {
      await getHorizonMaskPdfData({
        studyId,
        versionId: 1,
        orgId,
      });
    } catch (e) {
      errMsg = e.message || "";
    }

    if (errMsg.includes("Adresse non géolocalisée")) {
      ok("Erreur BUSINESS: Adresse non géolocalisée (lat/lon requis)");
    } else {
      fail("Scenario 3", new Error(`Attendu "Adresse non géolocalisée", obtenu: ${errMsg || "aucune erreur"}`));
    }
  } catch (e) {
    if (e.code === "ECONNREFUSED" || e.message?.includes("connect")) {
      console.log("  ⏭ Skip (DB non disponible)");
    } else {
      fail("Scenario 3", e);
    }
  } finally {
    if (studyId) {
      try {
        await pool.query("DELETE FROM study_versions WHERE study_id = $1", [studyId]);
        await pool.query("DELETE FROM studies WHERE id = $1", [studyId]);
      } catch (_) {}
    }
    if (leadId) {
      try {
        await pool.query("DELETE FROM leads WHERE id = $1", [leadId]);
      } catch (_) {}
    }
    if (addressId) {
      try {
        await pool.query("DELETE FROM addresses WHERE id = $1", [addressId]);
      } catch (_) {}
    }
  }
}

async function run() {
  console.log("\n=== CP-DSM-PDF-006 — Tests export PDF Masque d'ombrage (1 page) ===\n");

  try {
    await scenario1();
    await scenario2();
    await scenario3();
  } finally {
    try {
      await pool.end();
    } catch (_) {}
  }

  console.log("\n=== RÉSULTAT ===");
  const total = passed + failed;
  console.log(`  ${passed}/${total} PASS`);
  if (failed > 0) {
    console.log(`  ❌ ${failed} échec(s)`);
    process.exit(1);
  }
  console.log("\n✅ PASS — Export PDF Masque d'ombrage OK\n");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
