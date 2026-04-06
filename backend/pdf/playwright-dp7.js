import { chromium } from "playwright";

export async function generateDP7PDF(dp7Data, docMeta = null) {
  if (!dp7Data) {
    throw new Error("generateDP7PDF : dp7Data manquant");
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // ======================================================
  // META DOC (DP7 / DP8) — pour ajuster le titre sans dupliquer le moteur
  // ======================================================
  if (docMeta) {
    await page.addInitScript((meta) => {
      window.__DP_DOC_META__ = meta;
    }, docMeta);
  }

  // ======================================================
  // INJECTION DES DONNÉES AVANT CHARGEMENT (ALIGNÉ DP2/DP4)
  // ======================================================
  await page.addInitScript((data) => {
    window.__DP7_DATA__ = data;
  }, dp7Data);

  // ======================================================
  // CHARGEMENT DE LA PAGE HTML DP7
  // ⚠️ networkidle ≠ images base64 décodées
  // ======================================================
  const port = process.env.PORT || 3000;
  await page.goto(`http://127.0.0.1:${port}/pdf/render/dp7.html`, {
    waitUntil: "domcontentloaded",
  });

  // ======================================================
  // ⏳ ATTENTE RÉELLE DES IMAGES (logo + visuel final)
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

