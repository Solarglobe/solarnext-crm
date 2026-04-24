import { chromium } from "playwright";

export async function generateDP3PDF(dp3Data) {
  if (!dp3Data) {
    throw new Error("generateDP3PDF : dp3Data manquant");
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const port = process.env.PORT || 3000;

  // ======================================================
  // INJECTION DES DONNÉES AVANT CHARGEMENT (COMME DP2)
  // ======================================================
  await page.addInitScript((data) => {
    window.__DP3_DATA__ = data;
  }, dp3Data);

  // ======================================================
  // CHARGEMENT DE LA PAGE HTML DP3
  // ⚠️ networkidle ≠ images base64 décodées
  // ======================================================
  await page.goto(`http://127.0.0.1:${port}/pdf/render/dp3.html`, { waitUntil: "domcontentloaded" });

  // ======================================================
  // ⏳ ATTENTE RÉELLE DES IMAGES BASE64 (POINT CLÉ)
  // ======================================================
  await page.waitForFunction(() => {
    const imgs = Array.from(document.images || []);
    if (!imgs.length) return false;

    return imgs.every(img => {
      // image bien chargée + décodée
      return img.complete && img.naturalWidth > 0;
    });
  }, { timeout: 15000 });

  // ======================================================
  // 🔒 FRAME SUPPLÉMENTAIRE POUR STABILISATION RENDER
  // (GPU / paint / layout final)
  // ======================================================
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => new Promise(requestAnimationFrame));

  // ======================================================
  // GÉNÉRATION DU PDF
  // ======================================================
  const pdfBuffer = await page.pdf({
    format: "A4",
    landscape: true,        // IDENTIQUE DP2
    printBackground: true,
    margin: {
      top: "12mm",
      bottom: "12mm",
      left: "12mm",
      right: "12mm"
    }
  });

  await browser.close();
  return pdfBuffer;
}

