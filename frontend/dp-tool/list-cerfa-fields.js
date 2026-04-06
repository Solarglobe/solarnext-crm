/**
 * Liste tous les champs de formulaire du PDF cerfa_16702-02.pdf
 * avec leurs noms internes et types (aucun remplissage, aucune modification).
 */

import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { PDFDocument } from "pdf-lib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pdfPath = join(__dirname, "photos", "cerfa_16702-02.pdf");

async function main() {
  let bytes;
  try {
    bytes = await readFile(pdfPath);
  } catch (err) {
    console.error("Erreur lecture PDF:", err.message);
    process.exit(1);
  }

  try {
    const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const fields = form.getFields();

    console.log("=== Champs du formulaire cerfa_16702-02.pdf ===\n");
    console.log("Nombre total de champs:", fields.length);
    console.log("");

    fields.forEach((field, index) => {
      console.log(
        `[${index + 1}] name: ${field.getName()} | type: ${field.constructor.name}`
      );
    });

    console.log("\n=== Fin de la liste ===");
  } catch (e) {
    console.error("Erreur chargement PDF (pdf-lib):", e.message);
    process.exit(1);
  }
}

main();
