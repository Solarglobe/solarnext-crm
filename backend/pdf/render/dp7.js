/* ======================================================
   DP7 — SCRIPT PDF (INJECTÉ VIA PLAYWRIGHT)
   - Data-field strict (aligné DP2/DP4)
   - Image finale (base64) déjà prête (photo + flèches rouges)
   - Aucun mapping spécifique client/cadastre : mêmes champs que DP2
====================================================== */

(function () {
  // ======================================================
  // SÉCURITÉ — DATA OBLIGATOIRE
  // ======================================================
  const data = window.__DP7_DATA__;
  if (!data) {
    console.error("[DP7] __DP7_DATA__ manquant");
    return;
  }

  // ======================================================
  // META DOC (DP7 / DP8)
  // - Permet de réutiliser le moteur DP7 pour DP8
  // ======================================================
  const meta = window.__DP_DOC_META__ || null;

  // ======================================================
  // HELPERS SAFE
  // ======================================================
  function setText(field, value) {
    const nodes = document.querySelectorAll(`[data-field="${field}"]`);
    if (!nodes || !nodes.length) return;
    nodes.forEach((el) => {
      el.textContent = value ?? "";
    });
  }

  function setImage(field, src) {
    const el = document.querySelector(`[data-field="${field}"]`);
    if (!el || !src) return;
    el.src = src;
    if (el.decode) el.decode().catch(() => {});
  }

  // ======================================================
  // CLIENT (IDENTIQUE DP2)
  // ======================================================
  setText("client.nom", data.client?.nom);
  setText("client.adresse", data.client?.adresse);
  setText("client.cp", data.client?.cp);
  setText("client.ville", data.client?.ville);

  // ======================================================
  // PARCELLE (IDENTIQUE DP2)
  // ======================================================
  setText("parcelle.numero", data.parcelle?.numero);
  setText("parcelle.surface_m2", data.parcelle?.surface_m2);

  // ======================================================
  // IMAGE DP7 — VISUEL FINAL
  // ======================================================
  setImage("images.final", data.images?.final);

  // ======================================================
  // TITRES (DP7 / DP8)
  // ======================================================
  try {
    if (meta?.docTitle && typeof meta.docTitle === "string") {
      document.title = `${meta.docTitle} | SolarGlobe`;
    }
    if (meta?.h1 && typeof meta.h1 === "string") {
      const h1 = document.querySelector(".h1");
      if (h1) h1.textContent = meta.h1;
      const img = document.querySelector('img[data-field="images.final"]');
      if (img) img.setAttribute("alt", meta.h1);
    }
    if (meta?.code && typeof meta.code === "string") {
      const footerRight = document.querySelector(".footer > div:last-child");
      if (footerRight) {
        const txtNode = Array.from(footerRight.childNodes || []).find(
          (n) => n && n.nodeType === Node.TEXT_NODE && (n.textContent || "").trim().length
        );
        if (txtNode) txtNode.textContent = `${meta.code} · Page 1 / 1`;
      }
    }
  } catch (_) {}

  // ======================================================
  // META
  // ======================================================
  setText("date", new Date().toLocaleDateString("fr-FR"));
  window.__DP7_READY__ = true;
})();

