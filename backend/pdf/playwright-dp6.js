import { chromium } from "playwright";

export async function generateDP6PDF(dp6Data) {
  if (!dp6Data) {
    throw new Error("generateDP6PDF : dp6Data manquant");
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // ======================================================
  // INJECTION DES DONNÉES AVANT CHARGEMENT (ALIGNÉ DP2/DP4)
  // DP6 lit directement window.DP6_STATE via backend/pdf/render/dp6.js
  // ======================================================
  await page.addInitScript((data) => {
    window.DP6_STATE = data;
  }, dp6Data);

  // ======================================================
  // CHARGEMENT DE LA PAGE HTML DP6
  // ⚠️ networkidle ≠ images décodées
  // ======================================================
  // NOTE : utiliser 127.0.0.1 (évite certains soucis IPv6 avec "localhost").
  // Le port est celui du serveur Express (PORT), fallback 3000.
  const port = process.env.PORT || 3000;
  await page.goto(`http://127.0.0.1:${port}/pdf/render/dp6.html`, {
    waitUntil: "domcontentloaded",
  });

  // ======================================================
  // ⏳ ATTENTE RÉELLE DES IMAGES (logo + visuel)
  // ======================================================
  await page.waitForFunction(() => {
    const imgs = Array.from(document.images || []).filter((img) => {
      const src = img.getAttribute("src");
      return typeof src === "string" && src.length > 0;
    });
    if (!imgs.length) return false;
    return imgs.every((img) => img.complete && img.naturalWidth > 0);
  }, { timeout: 15000 });

  // ======================================================
  // 🔒 FRAME SUPPLÉMENTAIRE POUR STABILISATION RENDER
  // ======================================================
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => new Promise(requestAnimationFrame));

  // ======================================================
  // GÉNÉRATION DU PDF
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

