import { chromium } from "playwright";

export async function generateDP4PDF(dp4Data) {
  if (!dp4Data) {
    throw new Error("generateDP4PDF : dp4Data manquant");
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const port = process.env.PORT || 3000;

  // ======================================================
  // INJECTION DES DONNÉES AVANT CHARGEMENT (COMME DP2/DP3)
  // ======================================================
  await page.addInitScript((data) => {
    window.__DP4_DATA__ = data;
  }, dp4Data);

  // ======================================================
  // CHARGEMENT DE LA PAGE HTML DP4
  // ⚠️ networkidle ≠ images base64 décodées
  // ======================================================
  await page.goto(`http://127.0.0.1:${port}/pdf/render/dp4.html`, {
    waitUntil: "domcontentloaded",
  });

  // ======================================================
  // ⏳ ATTENTE RÉELLE DES IMAGES BASE64 (POINT CLÉ)
  // ======================================================
  await page.waitForFunction(() => {
    const imgs = Array.from(document.images || []);
    if (!imgs.length) return false;
    return imgs.every((img) => img.complete && img.naturalWidth > 0);
  }, { timeout: 15000 });

  // ======================================================
  // 🔒 FRAME SUPPLÉMENTAIRE POUR STABILISATION RENDER
  // ======================================================
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => new Promise(requestAnimationFrame));

  // ======================================================
  // GÉNÉRATION DU PDF (MULTI-PAGES VIA CSS page-break)
  // ======================================================
  const pdfBuffer = await page.pdf({
    format: "A4",
    landscape: true,
    printBackground: true,
    margin: {
      top: "12mm",
      bottom: "12mm",
      left: "12mm",
      right: "12mm",
    },
  });

  await browser.close();
  return pdfBuffer;
}

