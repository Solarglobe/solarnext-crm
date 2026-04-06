import { chromium } from "playwright";

export async function generateMandatPDF(mandatData) {
  if (!mandatData) {
    throw new Error("generateMandatPDF : mandatData manquant");
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // 👉 on injecte les données AVANT le chargement
  await page.addInitScript((data) => {
    window.__MANDAT_DATA__ = data;
  }, mandatData);

 await page.goto("http://localhost:3000/pdf/render/mandat.html", { waitUntil: "networkidle" });

  const pdfBuffer = await page.pdf({
    format: "A4",
    printBackground: true,
    margin: {
      top: "14mm",
      bottom: "14mm",
      left: "15mm",
      right: "15mm"
    }
  });

  await browser.close();
  return pdfBuffer;
}
