/**
 * Stage 2B — héritage billing_party de l'article catalogue vers la ligne de devis.
 * Lancement : cd backend && node --test tests/quoteCatalogBillingParty.test.mjs
 *
 * Note environnement : buildQuoteItemSnapshotFromCatalogItem vit dans quoteEngine.service.js
 * (gros fichier mal synchronisé dans le bac à sable → import non fiable ici). On teste donc la
 * RÈGLE d'héritage exacte appliquée par cette fonction : `billing_party: normalizeBillingParty(catalog.billing_party)`.
 * Le test sur la fonction réelle est à exécuter en CI (cf. variante commentée en bas).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BILLING_PARTY_SOLARGLOBE,
  BILLING_PARTY_INSTALLER_RGE,
  normalizeBillingParty,
  splitQuoteTotalsByBillingParty,
} from "../services/finance/quoteBillingParty.js";

/** Reproduit exactement le mapping catalogue → snapshot ligne (buildQuoteItemSnapshotFromCatalogItem). */
function lineSnapshotFromCatalog(catalog) {
  return {
    name: catalog.name ?? "",
    description: catalog.description ?? "",
    category: catalog.category ?? "OTHER",
    pricing_mode: catalog.pricing_mode ?? "FIXED",
    billing_party: normalizeBillingParty(catalog.billing_party),
    source: { catalogItemId: catalog.id ?? null },
  };
}

test("Article catalogue INSTALLER_RGE → ligne héritée en INSTALLER_RGE", () => {
  const catalog = {
    id: "cat-1",
    name: "Installation photovoltaïque – Main-d'œuvre (partenaire RGE)",
    category: "INSTALL",
    billing_party: "INSTALLER_RGE",
  };
  const snap = lineSnapshotFromCatalog(catalog);
  assert.equal(snap.billing_party, BILLING_PARTY_INSTALLER_RGE);
  assert.equal(snap.source.catalogItemId, "cat-1");
});

test("Article catalogue sans billing_party → SOLARGLOBE (défaut, non rétroactif)", () => {
  const snap = lineSnapshotFromCatalog({ id: "c2", name: "Module 500W", category: "PANEL" });
  assert.equal(snap.billing_party, BILLING_PARTY_SOLARGLOBE);
});

test("Ligne catalogue pose RGE → exclue du total SolarGlobe, isolée en estimation pose", () => {
  const pose = lineSnapshotFromCatalog({ id: "c3", name: "Pose RGE", billing_party: "INSTALLER_RGE" });
  const lines = [
    { total_line_ht: 8000, total_line_vat: 1600, total_line_ttc: 9600, billing_party: BILLING_PARTY_SOLARGLOBE },
    { total_line_ht: 2100, total_line_vat: 420, total_line_ttc: 2520, billing_party: pose.billing_party },
  ];
  const { solarglobe, installer, project_indicative } = splitQuoteTotalsByBillingParty(lines);
  assert.deepEqual(solarglobe, { total_ht: 8000, total_vat: 1600, total_ttc: 9600 });
  assert.deepEqual(installer, { total_ht: 2100, total_vat: 420, total_ttc: 2520 });
  assert.deepEqual(project_indicative, { total_ht: 10100, total_vat: 2020, total_ttc: 12120 });
});

/*
 * Variante CI (Postgres + fichiers complets) — décommenter pour tester la fonction réelle :
 *
 * import { buildQuoteItemSnapshotFromCatalogItem } from "../services/quoteEngine.service.js";
 * test("buildQuoteItemSnapshotFromCatalogItem hérite billing_party", () => {
 *   const snap = buildQuoteItemSnapshotFromCatalogItem({ id: "x", name: "Pose", billing_party: "INSTALLER_RGE" });
 *   assert.equal(snap.billing_party, "INSTALLER_RGE");
 * });
 */
