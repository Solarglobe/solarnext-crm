import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { getDpPdfFileName } from "../constants/dpPdfFileNames.js";
import {
  DP_COMPLETE_REQUIRED_PIECES,
  getMissingDpCompletePieces,
} from "../services/dpCompletePackage.service.js";
import {
  assertLeadDpAccessEligible,
  buildDpContextFromLeadRow,
  DP_ACCESS_FORBIDDEN_BODY,
  isDpAccessEligible,
} from "../services/leadDp.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

function readRepoFile(...parts) {
  return readFileSync(path.join(repoRoot, ...parts), "utf8");
}

test("DP access: route /leads/:id/dp is reserved to clients or signed/DP projects", () => {
  assert.equal(isDpAccessEligible({ status: "CLIENT", project_status: null }), true);
  assert.equal(isDpAccessEligible({ status: "LEAD", project_status: "SIGNE" }), true);
  assert.equal(isDpAccessEligible({ status: "LEAD", project_status: "DP_A_DEPOSER" }), true);
  assert.equal(isDpAccessEligible({ status: "LEAD", project_status: "DEVIS" }), false);
  assert.equal(isDpAccessEligible({ status: "PROSPECT", project_status: null }), false);
});

test("DP PDF persistence applies the same eligibility rule as /leads/:id/dp", async () => {
  const eligibleDb = {
    query: async () => ({ rows: [{ id: "lead-1", status: "LEAD", project_status: "SIGNE" }] }),
  };
  const row = await assertLeadDpAccessEligible(eligibleDb, "lead-1", "org-1");
  assert.equal(row.id, "lead-1");

  const blockedDb = {
    query: async () => ({ rows: [{ id: "lead-2", status: "LEAD", project_status: "DEVIS" }] }),
  };
  await assert.rejects(
    () => assertLeadDpAccessEligible(blockedDb, "lead-2", "org-1"),
    (err) => err?.statusCode === 403 && err?.code === DP_ACCESS_FORBIDDEN_BODY.code
  );

  const missingDb = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    () => assertLeadDpAccessEligible(missingDb, "lead-3", "org-1"),
    (err) => err?.statusCode === 403 && err?.code === "LEAD_NOT_FOUND"
  );
});

test("DP PDF naming covers every generated piece independently", () => {
  const leadId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const expected = {
    mandat: `mandat-representation-${leadId}.pdf`,
    dp1: `dp1-plan-de-situation-${leadId}.pdf`,
    dp2: `dp2-plan-de-masse-${leadId}.pdf`,
    dp3: `dp3-plan-de-coupe-${leadId}.pdf`,
    dp4: `dp4-plan-facades-toitures-${leadId}.pdf`,
    dp5: `dp5-representation-graphique-${leadId}.pdf`,
    dp6: `dp6-insertion-paysagere-${leadId}.pdf`,
    dp7: `dp7-photo-proche-${leadId}.pdf`,
    dp8: `dp8-photo-lointaine-${leadId}.pdf`,
    cerfa: `cerfa-${leadId}.pdf`,
    dp_complet: `dossier-declaration-prealable-${leadId}.pdf`,
  };

  for (const [piece, fileName] of Object.entries(expected)) {
    assert.equal(getDpPdfFileName(piece, leadId), fileName, piece);
  }
});

test("DP context exposes linked mairie portal data and expected documents", () => {
  const context = buildDpContextFromLeadRow({
    id: "lead-1",
    status: "CLIENT",
    project_status: "SIGNE",
    full_name: "Alice Martin",
    first_name: "Alice",
    last_name: "Martin",
    site_address_line1: "12 rue du Soleil",
    site_postal_code: "31000",
    site_city: "Toulouse",
    site_lat: "43.6045",
    site_lon: "1.444",
    mairie_id: "mairie-1",
    mairie_name: "Mairie de Toulouse",
    mairie_postal_code: "31000",
    mairie_city: "Toulouse",
    mairie_portal_url: "https://urbanisme.example.test",
    mairie_portal_type: "online",
    mairie_account_status: "created",
    mairie_account_email: "urbanisme@example.test",
    mairie_bitwarden_ref: "bw://mairie/toulouse",
    mairie_notes: "Depot numerique obligatoire.",
  });

  assert.deepEqual(
    {
      id: context.mairie.id,
      name: context.mairie.name,
      portalUrl: context.mairie.portalUrl,
      portalType: context.mairie.portalType,
      accountStatus: context.mairie.accountStatus,
      accountEmail: context.mairie.accountEmail,
      notes: context.mairie.notes,
    },
    {
      id: "mairie-1",
      name: "Mairie de Toulouse",
      portalUrl: "https://urbanisme.example.test",
      portalType: "online",
      accountStatus: "created",
      accountEmail: "urbanisme@example.test",
      notes: "Depot numerique obligatoire.",
    }
  );
  assert.ok(context.mairie.expectedDocuments.some((doc) => doc.id === "dp1" && doc.required));
  assert.ok(context.mairie.expectedDocuments.some((doc) => doc.id === "mairie_extra" && doc.required === false));
});

test("DP2 draft persistence ignores the temporary DP4 roof editor state", () => {
  const draftStore = readRepoFile("frontend", "dp-tool", "dp-draft-store.js");

  assert.match(draftStore, /function getPersistableDp2RuntimeState\(\)/);
  assert.match(draftStore, /global\.__SN_DP4_EDITOR_ACTIVE === true/);
  assert.match(draftStore, /global\.__dp2RealPlanBackup/);
  assert.match(draftStore, /global\.DP2_STATE\.editorProfile !== "DP4_ROOF"/);
  assert.match(draftStore, /global\.__SN_DP4_EDITOR_ACTIVE !== true && typeof global\.dp2SyncActiveVersionBeforeDraft === "function"/);
});

test("DP4 editor session swaps DP2_STATE only temporarily and restores the real DP2 plan", () => {
  const dp2 = readRepoFile("frontend", "dp-tool", "dp2.js");

  assert.match(dp2, /function dp4BeginEditorSession\(cat\)/);
  assert.match(dp2, /window\.DP4_EDITOR_STATE\.editorProfile = "DP4_ROOF"/);
  assert.match(dp2, /window\.__SN_DP4_EDITOR_ACTIVE = true/);
  assert.match(dp2, /window\.DP2_STATE = editorState/);
  assert.match(dp2, /function dp4RestoreRealDp2StateAfterEditorSession\(\)/);
  assert.match(dp2, /window\.DP2_STATE = dp4ClonePlain\(real, real\)/);
  assert.match(dp2, /window\.DP4_EDITOR_STATE = null/);
  assert.match(dp2, /window\.__dp2RealPlanBackup = null/);
});

test("DP2 to DP4 import freezes the DP2 overlay transform and detects stale map movement", () => {
  const dp4 = readRepoFile("frontend", "dp-tool", "dp4.js");

  assert.match(dp4, /function dp4DrawFrozenDp2BeforeOverlay\(\)/);
  assert.match(dp4, /const v = dp4ValidateDP2CaptureForImport\(cap\)/);
  assert.match(dp4, /const drawing = dp4BuildTransparentDp2DrawingCanvas\(source\.state, cap\)/);
  assert.match(dp4, /const tr = dp4MakeAffineFromDp2ToMapPixels\(cap, map\)/);
  assert.match(dp4, /window\.DP4_IMPORT_DP2_ACTIVE = true/);
  assert.match(dp4, /window\.DP4_IMPORT_VIEW_SNAPSHOT = view/);
  assert.match(dp4, /window\.DP4_IMPORT_DP2_FROZEN_TRANSFORM = dp4ClonePlain\(tr, tr\)/);
  assert.match(dp4, /function dp4ImportViewSnapshotDiffersFromMap\(snap, map\)/);
  assert.match(dp4, /window\.DP4_IMPORT_DP2_FROZEN_TRANSFORM/);
});

test("DP generated PDF persistence blocks duplicates unless forceReplace deletes first", () => {
  const persist = readRepoFile("backend", "services", "dpPdfPersistResponse.service.js");

  assert.match(persist, /await assertLeadDpAccessEligible\(pool, leadId, user\.organizationId\)/);
  assert.match(persist, /const existing = await findExistingLeadDpDocumentByPiece/);
  assert.match(persist, /if \(existing && !forceReplace\)/);
  assert.match(persist, /alreadyExists: true/);
  assert.match(persist, /if \(existing && forceReplace\)/);
  assert.match(persist, /await deleteDocument\(existing\.id, user\.organizationId\)/);
  assert.match(persist, /await saveLeadDpGeneratedPdfDocument/);
});

test("DP complete package requires every mairie dossier PDF in the expected order", () => {
  assert.deepEqual(
    DP_COMPLETE_REQUIRED_PIECES.map((piece) => piece.key),
    ["mandat", "cerfa", "dp1", "dp2", "dp3", "dp4", "dp6", "dp7", "dp8"]
  );

  const missing = getMissingDpCompletePieces([
    { pieceKey: "mandat" },
    { pieceKey: "cerfa" },
    { pieceKey: "dp1" },
    { pieceKey: "dp2" },
    { pieceKey: "dp3" },
    { pieceKey: "dp4" },
    { pieceKey: "dp6" },
    { pieceKey: "dp7" },
  ]);
  assert.deepEqual(missing, [{ key: "dp8", label: "DP8 - Photo lointaine" }]);
});

test("DP complete package route and front button use the persisted PDF assembly flow", () => {
  const routes = readRepoFile("backend", "routes", "pdfRender.js");
  const front = readRepoFile("frontend", "dp-tool", "dp-app.js");
  const page = readRepoFile("frontend", "dp-tool", "pages", "general.html");

  assert.match(routes, /\/pdf\/render\/dp-complet\/pdf/);
  assert.match(routes, /piece: "dp_complet"/);
  assert.match(routes, /assembleLeadDpCompletePdf/);
  assert.match(front, /function bindDPCompleteAssemblyButton\(\)/);
  assert.match(front, /\/pdf\/render\/dp-complet\/pdf/);
  assert.match(page, /dp-complete-assemble/);
  assert.match(page, /Assembler dossier DP complet/);
});

test("DP6 panel zones expose grid controls and PDF panel count", () => {
  const dp6 = readRepoFile("frontend", "dp-tool", "dp6.js");
  const page = readRepoFile("frontend", "dp-tool", "pages", "dp6.html");
  const pdfScript = readRepoFile("backend", "pdf", "render", "dp6.js");
  const pdfTemplate = readRepoFile("backend", "pdf", "render", "dp6.html");

  assert.match(page, /dp6-add-panel-zone/);
  assert.match(page, /dp6-zone-rows/);
  assert.match(page, /dp6-zone-cols/);
  assert.match(page, /dp6-zone-gap/);
  assert.match(page, /dp6-zone-orientation/);
  assert.match(page, /dp6-total-panel-count/);

  assert.match(dp6, /function dp6DrawSolarPanelGrid\(/);
  assert.match(dp6, /function dp6AddPanelZone\(/);
  assert.match(dp6, /function dp6TotalPanelCount\(/);
  assert.match(dp6, /DP6_PANEL_ZONE_DEFAULT_ROWS = 2/);
  assert.match(dp6, /DP6_PANEL_ZONE_DEFAULT_COLS = 2/);

  assert.match(pdfTemplate, /data-field="dp6\.panel\.count"/);
  assert.match(pdfScript, /function countPanelsFromState\(/);
  assert.match(pdfScript, /setText\("dp6\.panel\.count"/);
});
