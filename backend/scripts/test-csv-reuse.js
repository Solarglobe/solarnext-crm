/**
 * Test CSV reuse : vérifier si le CSV est encore utilisé lors d'un second calcul
 * sur la même étude / même lead.
 *
 * 1) Appelle POST validate-devis-technique une première fois
 * 2) Appelle exactement le même endpoint une deuxième fois
 * 3) Affiche les logs DEBUG_CALC_BEFORE_LOAD_CONSUMPTION et TRACE_CONSO_SOURCE pour les deux appels
 *
 * Usage: cd backend && node scripts/test-csv-reuse.js [studyId] [versionId]
 *        (versionId = study_versions.id UUID ; si omis, utilise la dernière study_version de l'org)
 */

import "../config/register-local-env.js";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { pool } = await import("../config/db.js");
const { validateDevisTechnique } = await import("../controllers/validateDevisTechnique.controller.js");

async function getDefaultStudyAndVersion() {
  const orgRes = await pool.query(
    "SELECT id FROM organizations ORDER BY name ASC, created_at ASC LIMIT 1"
  );
  if (orgRes.rows.length === 0) throw new Error("Aucune organisation trouvée");
  const orgId = orgRes.rows[0].id;

  const versionRes = await pool.query(
    `SELECT sv.id AS version_id, sv.study_id, sv.version_number
     FROM study_versions sv
     JOIN studies s ON s.id = sv.study_id AND s.organization_id = $1
     WHERE sv.organization_id = $1
     ORDER BY sv.created_at DESC
     LIMIT 1`,
    [orgId]
  );
  if (versionRes.rows.length === 0) {
    throw new Error(
      "Aucune study_version trouvée. Créez une étude avec calpinage ou passez studyId et versionId en arguments."
    );
  }
  const row = versionRes.rows[0];
  return { studyId: row.study_id, versionId: row.version_id, orgId };
}

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
    get captured() {
      return out;
    },
  };
}

function runTest(studyId, versionId, orgId) {
  const logsFirst = [];
  const logsSecond = [];
  let callIndex = 0;
  const originalLog = console.log;

  console.log = function (...args) {
    const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    if (
      msg.includes("DEBUG_CALC_BEFORE_LOAD_CONSUMPTION") ||
      msg.includes("TRACE_CONSO_SOURCE")
    ) {
      (callIndex === 0 ? logsFirst : logsSecond).push(msg);
    }
    originalLog.apply(console, args);
  };

  const req = {
    params: { studyId, versionId },
    user: { organizationId: orgId },
  };

  const setSecondCall = () => {
    callIndex = 1;
  };

  return { req, logsFirst, logsSecond, originalLog, setSecondCall };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL manquant (.env ou .env.dev)");
    process.exit(1);
  }

  let studyId = process.argv[2];
  let versionId = process.argv[3];
  let orgId;

  if (!studyId || !versionId) {
    console.log("studyId ou versionId absent → recherche dernière study_version de l'org…");
    try {
      const def = await getDefaultStudyAndVersion();
      studyId = studyId || def.studyId;
      versionId = versionId || def.versionId;
      orgId = def.orgId;
    } catch (e) {
      console.error("❌", e.message);
      printExpectedFormat();
      process.exit(1);
    }
  } else {
    const vRes = await pool.query(
      "SELECT study_id, organization_id FROM study_versions WHERE id = $1",
      [versionId]
    );
    if (vRes.rows.length === 0) {
      console.error("❌ versionId inconnu:", versionId);
      process.exit(1);
    }
    if (!studyId) studyId = vRes.rows[0].study_id;
    orgId = vRes.rows[0].organization_id;
  }

  console.log("\n=== TEST CSV REUSE ===\n");
  console.log("studyId:", studyId);
  console.log("versionId (study_versions.id):", versionId);
  console.log("orgId:", orgId);

  const { req, logsFirst, logsSecond, originalLog, setSecondCall } = runTest(
    studyId,
    versionId,
    orgId
  );
  const res1 = mockRes();
  const res2 = mockRes();

  try {
    await validateDevisTechnique(req, res1);
  } catch (e) {
    console.error("❌ Premier appel validate-devis-technique:", e.message);
    console.log = originalLog;
    process.exit(1);
  }

  setSecondCall();

  try {
    await validateDevisTechnique(req, res2);
  } catch (e) {
    console.error("❌ Second appel validate-devis-technique:", e.message);
    console.log = originalLog;
    process.exit(1);
  }

  console.log = originalLog;

  console.log("\n" + "=".repeat(60));
  console.log("TEST CSV REUSE RESULT");
  console.log("=".repeat(60));

  console.log("\nFIRST CALC:");
  if (logsFirst.length === 0) {
    console.log("  (no DEBUG_CALC_BEFORE_LOAD_CONSUMPTION or TRACE_CONSO_SOURCE captured)");
  } else {
    logsFirst.forEach((line) => console.log("  ", line));
  }

  console.log("\nSECOND CALC:");
  if (logsSecond.length === 0) {
    console.log("  (no DEBUG_CALC_BEFORE_LOAD_CONSUMPTION or TRACE_CONSO_SOURCE captured)");
  } else {
    logsSecond.forEach((line) => console.log("  ", line));
  }

  const firstCsv = logsFirst.some((l) => l.includes('"source":"CSV"') || l.includes("source=CSV"));
  const secondCsv = logsSecond.some((l) => l.includes('"source":"CSV"') || l.includes("source=CSV"));
  const secondSynth = logsSecond.some(
    (l) => l.includes('"source":"SYNTHETIC"') || l.includes("source=SYNTHETIC")
  );

  console.log("\n--- INTERPRETATION ---");
  if (secondCsv) {
    console.log("A) Second calcul : csvPath présent, TRACE_CONSO_SOURCE = CSV → OK (réutilisation CSV)");
  } else if (secondSynth || logsSecond.some((l) => l.includes("csvPath") && l.includes("null"))) {
    console.log(
      "C) Second calcul : TRACE_CONSO_SOURCE = SYNTHETIC ou csvPath = null → BUG (CSV non réutilisé)"
    );
  } else {
    console.log("B) Vérifier manuellement les logs ci-dessus (csvPath et source).");
  }

  console.log("\n");
}

function printExpectedFormat() {
  console.log("\n" + "=".repeat(60));
  console.log("FORMAT ATTENDU (quand des study_versions existent) :");
  console.log("=".repeat(60));
  console.log("\nTEST CSV REUSE RESULT\n");
  console.log("FIRST CALC:");
  console.log('  {"tag":"DEBUG_CALC_BEFORE_LOAD_CONSUMPTION","studyId":"...","versionId":...,"leadId":"...","csvPath":"/path/..."}');
  console.log('  {"tag":"TRACE_CONSO_SOURCE","source":"CSV",...}');
  console.log("\nSECOND CALC:");
  console.log('  {"tag":"DEBUG_CALC_BEFORE_LOAD_CONSUMPTION","studyId":"...","versionId":...,"leadId":"...","csvPath":"/path/..."}');
  console.log('  {"tag":"TRACE_CONSO_SOURCE","source":"CSV",...}  ← attendu (A) ; si source=SYNTHETIC ou csvPath=null → (C) bug');
  console.log("\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
