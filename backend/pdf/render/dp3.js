/* ======================================================
   DP3 — SCRIPT PDF (INJECTÉ VIA PLAYWRIGHT)
   - Data-field strict
   - Image base64
   - Zones texte DP3 (x,y,w,h en % ou 0..1)
====================================================== */

(function () {
  // ======================================================
  // SÉCURITÉ — DATA OBLIGATOIRE
  // ======================================================
  const data = window.__DP3_DATA__;
  if (!data) {
    console.error("[DP3] __DP3_DATA__ manquant");
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

  function asOrientationLabel(v) {
    return v === "paysage" ? "Paysage" : "Portrait";
  }

  function fmtModule(module) {
    const m = module || null;
    if (!m) {
      return {
        manufacturer: "—",
        reference: "—",
        power_w: "—",
        dimensions: "—",
      };
    }

    const power =
      typeof m.power_w === "number"
        ? `${m.power_w} Wc`
        : (m.power_w != null ? String(m.power_w) : "—");

    const w = typeof m.width_m === "number" ? m.width_m.toFixed(3) : null;
    const h = typeof m.height_m === "number" ? m.height_m.toFixed(3) : null;
    const dims = w && h ? `${w} m × ${h} m` : "—";

    return {
      manufacturer: m.manufacturer || "—",
      reference: m.reference || "—",
      power_w: power,
      dimensions: dims,
    };
  }

  function toPct(v) {
    if (typeof v !== "number" || Number.isNaN(v)) return 0;
    // Compat : si 0..1 => convertir en %
    if (v >= 0 && v <= 1) return v * 100;
    return v;
  }

  // ======================================================
  // CLIENT (IDENTIQUE DP2)
  // ======================================================
  setText("client.nom", data.client?.nom);
  setText("client.adresse", data.client?.adresse);
  setText("client.cp", data.client?.cp);
  setText("client.ville", data.client?.ville);

  // ======================================================
  // DP3 — PARAMÈTRES (LEFT)
  // ======================================================
  setText("dp3.installationOrientation", asOrientationLabel(data.installationOrientation));

  const moduleFmt = fmtModule(data.module);
  setText("dp3.module.manufacturer", moduleFmt.manufacturer);
  setText("dp3.module.reference", moduleFmt.reference);
  setText("dp3.module.power_w", moduleFmt.power_w);
  setText("dp3.module.dimensions", moduleFmt.dimensions);

  // ======================================================
  // IMAGE DP3 (PLAN DE COUPE)
  // ======================================================
  setImage("images.baseImage", data.baseImage);

  // ======================================================
  // ZONES TEXTE — SUPERPOSITION
  // ======================================================
  (function fillTextBoxes() {
    const layer = document.querySelector(`[data-field="dp3.textBoxesLayer"]`);
    if (!layer) return;

    layer.innerHTML = "";
    const boxes = Array.isArray(data.textBoxes) ? data.textBoxes : [];
    for (const b of boxes) {
      if (!b) continue;

      const x = toPct(b.x);
      const y = toPct(b.y);
      const w = toPct(b.w);
      const h = toPct(b.h);

      const el = document.createElement("div");
      el.className = "text-box";
      el.style.left = `${x}%`;
      el.style.top = `${y}%`;
      el.style.width = `${w}%`;
      el.style.height = `${h}%`;

      const fs = typeof b.fontSize === "number" && b.fontSize > 0 ? b.fontSize : 12;
      el.style.fontSize = `${fs}px`;
      el.textContent = b.text != null ? String(b.text) : "";

      layer.appendChild(el);
    }
  })();

  // ======================================================
  // META
  // ======================================================
  setText("date", new Date().toLocaleDateString("fr-FR"));

  // ======================================================
  // FLAG DE FIN — UTILISÉ PAR PLAYWRIGHT (SI BESOIN)
  // ======================================================
  window.__DP3_READY__ = true;
})();

