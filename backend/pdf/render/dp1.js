/* ======================================================
   DP1 — SCRIPT PDF (INJECTÉ VIA PLAYWRIGHT)
   - Aucun accès DOM fragile
   - Data-field strict
   - Compatible images base64 lourdes
   - Aucun effet de bord
====================================================== */

(function () {
  // ======================================================
  // SÉCURITÉ — DATA OBLIGATOIRE
  // ======================================================
  const data = window.__DP1_DATA__;
  if (!data) {
    console.error("[DP1] __DP1_DATA__ manquant");
    return;
  }

  // ======================================================
  // HELPERS SAFE
  // ======================================================
  function setText(field, value) {
    const nodes = document.querySelectorAll(`[data-field="${field}"]`);
    if (!nodes || !nodes.length) return;
    nodes.forEach(el => {
      el.textContent = value ?? "";
    });
  }

  function setImage(field, src) {
    const el = document.querySelector(`[data-field="${field}"]`);
    if (!el || !src) return;

    // ⚠️ IMPORTANT : attendre le décodage réel de l’image
    el.src = src;

    if (el.decode) {
      el.decode().catch(() => {});
    }
  }

  // ======================================================
  // CLIENT
  // ======================================================
  setText("client.nom", data.client?.nom);
  setText("client.adresse", data.client?.adresse);
  setText("client.cp", data.client?.cp);
  setText("client.ville", data.client?.ville);

  // ======================================================
  // PARCELLE
  // ======================================================
  setText("parcelle.numero", data.parcelle?.numero);
  setText("parcelle.surface_m2", data.parcelle?.surface_m2);

  // ======================================================
  // IMAGES DP1
  // ======================================================
  setImage("img.20000", data.images?.["20000"]);
  setImage("img.5000",  data.images?.["5000"]);
  setImage("img.650",   data.images?.["650"]);

  // ======================================================
  // META
  // ======================================================
  setText("note", data.note || "Document généré automatiquement");
  setText("date", new Date().toLocaleDateString("fr-FR"));

  // ======================================================
  // FLAG DE FIN — UTILISÉ PAR PLAYWRIGHT
  // 👉 permet d’attendre que tout soit prêt AVANT pdf()
  // ======================================================
  window.__DP1_READY__ = true;
})();
