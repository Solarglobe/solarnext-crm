/**
 * Portail client — timeline & mapping project_status (sans DB).
 * node --test backend/tests/clientPortal.service.test.js
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapProjectStatusToTimelineStepIndex,
  buildPortalTimelinePayload,
  PORTAL_TIMELINE_STEPS,
  hashPortalTokenSecret,
  resolvePortalProjectStatusLabel,
  resolvePortalOffer,
  isPortalClientDocument,
  resolvePortalDocumentLabel,
  resolvePortalDocumentLabelFromRow,
  normalizePortalFileName,
  dedupeByFileNameKeepNewest,
  splitPortalFilteredDocuments,
  mergePortalDocumentsForResponse,
} from "../services/clientPortal.service.js";

describe("clientPortal.service", () => {
  it("hashPortalTokenSecret est déterministe", () => {
    const a = hashPortalTokenSecret("abc");
    const b = hashPortalTokenSecret("abc");
    assert.equal(a, b);
    assert.equal(a.length, 64);
  });

  it("mapProjectStatusToTimelineStepIndex — valeurs CRM", () => {
    assert.equal(mapProjectStatusToTimelineStepIndex("SIGNE"), 1);
    assert.equal(mapProjectStatusToTimelineStepIndex("DP_A_DEPOSER"), 2);
    assert.equal(mapProjectStatusToTimelineStepIndex("DP_DEPOSE"), 3);
    assert.equal(mapProjectStatusToTimelineStepIndex("DP_ACCEPTE"), 4);
    assert.equal(mapProjectStatusToTimelineStepIndex("INSTALLATION_PLANIFIEE"), 5);
    assert.equal(mapProjectStatusToTimelineStepIndex("INSTALLATION_REALISEE"), 6);
    assert.equal(mapProjectStatusToTimelineStepIndex("CONSUEL_EN_ATTENTE"), 7);
    assert.equal(mapProjectStatusToTimelineStepIndex("CONSUEL_OBTENU"), 8);
    assert.equal(mapProjectStatusToTimelineStepIndex("MISE_EN_SERVICE"), 9);
    assert.equal(mapProjectStatusToTimelineStepIndex("FACTURATION_TERMINEE"), 10);
    assert.equal(mapProjectStatusToTimelineStepIndex("CLOTURE"), 10);
  });

  it("mapProjectStatusToTimelineStepIndex — inconnu => 1", () => {
    assert.equal(mapProjectStatusToTimelineStepIndex("UNKNOWN"), 1);
    assert.equal(mapProjectStatusToTimelineStepIndex(null), 1);
  });

  it("buildPortalTimelinePayload — CLIENT : étape courante DP_ACCEPTE", () => {
    const p = buildPortalTimelinePayload("CLIENT", "DP_ACCEPTE");
    assert.equal(p.mode, "CLIENT");
    assert.equal(p.current_step, 4);
    assert.equal(p.raw_status, "DP_ACCEPTE");
    assert.equal(p.steps.length, PORTAL_TIMELINE_STEPS.length);
    assert.equal(p.steps[3].status, "current");
    assert.equal(p.steps[2].status, "done");
    assert.equal(p.steps[4].status, "upcoming");
  });

  it("buildPortalTimelinePayload — LEAD : 1re étape active (attente signature), le reste gris", () => {
    const p = buildPortalTimelinePayload("LEAD", null);
    assert.equal(p.mode, "LEAD");
    assert.equal(p.current_step, 1);
    assert.equal(p.steps[0].status, "current");
    assert.ok(p.steps.slice(1).every((s) => s.status === "upcoming"));
    assert.equal(p.lead_first_step_label, "Devis en attente de signature");
    assert.equal(p.steps[0].label, "Devis signé");
  });

  it("resolvePortalProjectStatusLabel — CLIENT + DP_DEPOSE", () => {
    assert.equal(resolvePortalProjectStatusLabel("CLIENT", "DP_DEPOSE"), "Démarches en cours");
  });

  it("resolvePortalProjectStatusLabel — LEAD", () => {
    assert.equal(resolvePortalProjectStatusLabel("LEAD", null), "Étude en cours");
  });

  it("resolvePortalOffer — devis le plus récent = ACCEPTED → projet validé", () => {
    const o = resolvePortalOffer([
      { status: "ACCEPTED", total_ttc: 200, created_at: new Date("2026-03-01") },
      { status: "SENT", total_ttc: 100, created_at: new Date("2026-02-01") },
    ]);
    assert.equal(o.kind, "validated");
    assert.equal(o.headline, "Projet validé — Installation en cours");
  });

  it("resolvePortalOffer — devis ouvert plus récent qu’un ancien signé → offre en cours", () => {
    const o = resolvePortalOffer([
      {
        status: "SENT",
        total_ttc: 100,
        currency: "EUR",
        sent_at: new Date("2026-03-15"),
        created_at: new Date("2026-03-10"),
      },
      { status: "ACCEPTED", total_ttc: 200, created_at: new Date("2026-02-01") },
    ]);
    assert.equal(o.kind, "pending");
    assert.equal(o.amount_ttc, 100);
  });

  it("resolvePortalOffer — dernier devis ouvert (montant + date)", () => {
    const o = resolvePortalOffer([
      {
        status: "SENT",
        total_ttc: 5880,
        currency: "EUR",
        sent_at: new Date("2026-03-31T10:00:00Z"),
        created_at: new Date("2026-03-20"),
      },
    ]);
    assert.equal(o.kind, "pending");
    assert.equal(o.amount_ttc, 5880);
    assert.equal(o.date_kind, "sent");
    assert.ok(o.reference_date);
  });

  it("resolvePortalOffer — aucun devis exploitable", () => {
    assert.equal(resolvePortalOffer([]).kind, "none");
    assert.equal(resolvePortalOffer([{ status: "REJECTED", total_ttc: 1 }]).kind, "none");
  });

  it("resolvePortalDocumentLabel — repli sur document_type", () => {
    assert.equal(resolvePortalDocumentLabel("quote_pdf"), "Devis");
    assert.equal(resolvePortalDocumentLabel("study_pdf"), "Proposition");
    assert.equal(resolvePortalDocumentLabel("study_proposal"), "Proposition");
    assert.equal(resolvePortalDocumentLabel("lead_attachment"), "Document");
  });

  it("resolvePortalDocumentLabelFromRow — source quote / étude / lead", () => {
    assert.equal(
      resolvePortalDocumentLabelFromRow({ entity_type: "quote", document_type: "quote_pdf" }),
      "Devis"
    );
    assert.equal(
      resolvePortalDocumentLabelFromRow({ entity_type: "study_version", document_type: "study_pdf" }),
      "Proposition"
    );
    assert.equal(
      resolvePortalDocumentLabelFromRow({ entity_type: "lead", document_type: "lead_attachment" }),
      "Document"
    );
  });

  it("isPortalClientDocument — devis quote, propositions study*, lead hors copies techniques", () => {
    assert.equal(
      isPortalClientDocument({ entity_type: "quote", document_type: "quote_pdf" }),
      true
    );
    assert.equal(
      isPortalClientDocument({ entity_type: "study_version", document_type: "study_pdf" }),
      true
    );
    assert.equal(
      isPortalClientDocument({ entity_type: "lead", document_type: "lead_attachment" }),
      true
    );
    assert.equal(
      isPortalClientDocument({ entity_type: "lead", document_type: "study_pdf" }),
      false
    );
    assert.equal(
      isPortalClientDocument({ entity_type: "lead", document_type: "study_proposal" }),
      false
    );
    assert.equal(
      isPortalClientDocument({ entity_type: "lead", document_type: "quote_pdf" }),
      false
    );
  });

  it("portail — 2 devis quote + 2 propositions SV + copie lead exclue = 4", () => {
    const rows = [
      { id: "q1", entity_type: "quote", document_type: "quote_pdf" },
      { id: "q2", entity_type: "quote", document_type: "quote_pdf" },
      { id: "sv1", entity_type: "study_version", document_type: "study_pdf" },
      { id: "sv2", entity_type: "study_version", document_type: "study_pdf" },
      { id: "leadCopy", entity_type: "lead", document_type: "study_pdf" },
    ];
    const portal = rows.filter((r) => isPortalClientDocument(r));
    assert.equal(portal.length, 4);
    assert.ok(!portal.some((r) => r.id === "leadCopy"));
  });

  it("normalizePortalFileName — trim + lower", () => {
    assert.equal(normalizePortalFileName("  Foo.PDF "), "foo.pdf");
  });

  it("dedupeByFileNameKeepNewest — cas 1 : 2 propositions même file_name → 1 (plus récent)", () => {
    const docs = [
      {
        id: "old",
        file_name: "PierrickROUXEL-Etude1-SansBatterie.pdf",
        created_at: new Date("2026-01-01"),
        entity_type: "study_version",
        document_type: "study_pdf",
      },
      {
        id: "new",
        file_name: "pierrickrouxel-etude1-sansbatterie.pdf",
        created_at: new Date("2026-02-01"),
        entity_type: "study_version",
        document_type: "study_pdf",
      },
    ];
    const out = dedupeByFileNameKeepNewest(docs);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "new");
  });

  it("dedupeByFileNameKeepNewest — cas 2 : 2 devis noms différents → 2", () => {
    const docs = [
      { id: "a", file_name: "devis-a.pdf", created_at: new Date(), entity_type: "quote", document_type: "quote_pdf" },
      { id: "b", file_name: "devis-b.pdf", created_at: new Date(), entity_type: "quote", document_type: "quote_pdf" },
    ];
    assert.equal(dedupeByFileNameKeepNewest(docs).length, 2);
  });

  it("dedupeByFileNameKeepNewest — cas 3 : 2 devis même file_name → 1 récent", () => {
    const docs = [
      { id: "a", file_name: "x.pdf", created_at: new Date("2026-01-01"), entity_type: "quote", document_type: "quote_pdf" },
      { id: "b", file_name: "x.pdf", created_at: new Date("2026-06-01"), entity_type: "quote", document_type: "quote_pdf" },
    ];
    const out = dedupeByFileNameKeepNewest(docs);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "b");
  });

  it("merge + dédup — cas 4 : 2 lead manuels distincts conservés (pas de dédup lead)", () => {
    const filtered = [
      { id: "l1", entity_type: "lead", document_type: "lead_attachment", file_name: "a.pdf", created_at: new Date("2026-01-01") },
      { id: "l2", entity_type: "lead", document_type: "lead_attachment", file_name: "b.pdf", created_at: new Date("2026-01-02") },
    ].filter((r) => isPortalClientDocument(r));
    const { leadManual, quotes, proposals } = splitPortalFilteredDocuments(filtered);
    const merged = mergePortalDocumentsForResponse({
      proposalsDeduped: dedupeByFileNameKeepNewest(proposals),
      quotesDeduped: dedupeByFileNameKeepNewest(quotes),
      leadManual,
    });
    assert.equal(merged.length, 2);
  });

  it("pipeline complet — cas 5 : 2 propositions (dont 1 doublon nom) + 2 devis = 4 sans doublon Pierrick…SansBatterie", () => {
    const rows = [
      {
        id: "p-dup-old",
        entity_type: "study_version",
        document_type: "study_pdf",
        file_name: "PierrickROUXEL-Etude1-SansBatterie.pdf",
        created_at: new Date("2026-01-01"),
      },
      {
        id: "p-dup-new",
        entity_type: "study_version",
        document_type: "study_pdf",
        file_name: "PierrickROUXEL-Etude1-SansBatterie.pdf",
        created_at: new Date("2026-03-01"),
      },
      {
        id: "p-physique",
        entity_type: "study_version",
        document_type: "study_pdf",
        file_name: "PierrickROUXEL-Etude1-BatteriePhysique.pdf",
        created_at: new Date("2026-02-01"),
      },
      {
        id: "q1",
        entity_type: "quote",
        document_type: "quote_pdf",
        file_name: "devis-0021.pdf",
        created_at: new Date("2026-01-15"),
      },
      {
        id: "q2",
        entity_type: "quote",
        document_type: "quote_pdf",
        file_name: "devis-0022.pdf",
        created_at: new Date("2026-02-01"),
      },
    ];
    const filtered = rows.filter((r) => isPortalClientDocument(r));
    const { leadManual, quotes, proposals } = splitPortalFilteredDocuments(filtered);
    const merged = mergePortalDocumentsForResponse({
      proposalsDeduped: dedupeByFileNameKeepNewest(proposals),
      quotesDeduped: dedupeByFileNameKeepNewest(quotes),
      leadManual,
    });
    assert.equal(merged.length, 4);
    const sansBat = merged.filter(
      (d) =>
        normalizePortalFileName(d.file_name) ===
        normalizePortalFileName("PierrickROUXEL-Etude1-SansBatterie.pdf")
    );
    assert.equal(sansBat.length, 1);
    assert.equal(sansBat[0].id, "p-dup-new");
  });
});
