import { chromium } from "playwright";

export async function generateDP1PDF(dp1Data) {
  if (!dp1Data) {
    throw new Error("generateDP1PDF : dp1Data manquant");
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // NOTE : 127.0.0.1 + PORT du processus Express (aligné playwright-dp6.js / dp7.js) — évite localhost:3000 figé en prod.
  const port = process.env.PORT || 3000;

  // ======================================================
  // INJECTION DES DONNÉES AVANT CHARGEMENT (COMME MANDAT)
  // ======================================================
  await page.addInitScript((data) => {
    window.__DP1_DATA__ = data;
  }, dp1Data);

  // ======================================================
  // CHARGEMENT DE LA PAGE HTML DP1
  // ⚠️ networkidle ≠ images base64 décodées
  // ======================================================
  await page.goto(`http://127.0.0.1:${port}/pdf/render/dp1.html`, { waitUntil: "domcontentloaded" });

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
    landscape: true,        // DP1 = paysage
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
