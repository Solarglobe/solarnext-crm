import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMultipartFilename } from "../utils/multipartFilenameUtf8.js";

test("latin1 mojibake → UTF-8 (cas Multer)", () => {
  const mojibake = Buffer.from("Devis été.pdf", "utf8").toString("latin1");
  assert.equal(mojibake, "Devis Ã©tÃ©.pdf");
  assert.equal(normalizeMultipartFilename(mojibake), "Devis été.pdf");
});

test("déjà UTF-8 correct", () => {
  assert.equal(normalizeMultipartFilename("Facture été rénovation électricité.pdf"), "Facture été rénovation électricité.pdf");
});

test("ASCII inchangé", () => {
  assert.equal(normalizeMultipartFilename("report-2024.pdf"), "report-2024.pdf");
});

test("vide", () => {
  assert.equal(normalizeMultipartFilename(""), "");
  assert.equal(normalizeMultipartFilename("   "), "");
});
