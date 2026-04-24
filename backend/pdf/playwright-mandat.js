import { chromium } from "playwright";

/** Unifie les alias CRM → champ attendu par mandat.html (data-field="client.date_naissance"). */
function normalizeMandatPayloadForRender(mandatData) {
  if (!mandatData || typeof mandatData !== "object") return mandatData;
  const out = { ...mandatData };
  const c = out.client && typeof out.client === "object" ? { ...out.client } : null;
  if (c) {
    const raw =
      (c.date_naissance != null && String(c.date_naissance).trim()) ||
      (c.birthDate != null && String(c.birthDate).trim()) ||
      (c.birth_date != null && String(c.birth_date).trim()) ||
      "";
    const iso = raw ? raw.slice(0, 10) : "";
    if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      c.date_naissance = iso;
    }
    out.client = c;
  }
  return out;
}

export async function generateMandatPDF(mandatData) {
  if (!mandatData) {
    throw new Error("generateMandatPDF : mandatData manquant");
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const port = process.env.PORT || 3000;

  const payload = normalizeMandatPayloadForRender(mandatData);

  // 👉 on injecte les données AVANT le chargement
  await page.addInitScript((data) => {
    window.__MANDAT_DATA__ = data;
  }, payload);

  await page.goto(`http://127.0.0.1:${port}/pdf/render/mandat.html`, { waitUntil: "networkidle" });

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
