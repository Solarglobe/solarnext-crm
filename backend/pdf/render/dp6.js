/* ======================================================
   DP6 — SCRIPT PDF
   RÈGLES :
   - Sources autorisées (client/adresse/cadastre) : SMARTPITCH_CTX, DP1_CONTEXT
   - Source autorisée (images + module PV) : DP6_STATE
   - 2 pages : AVANT travaux / APRÈS travaux
   - Aucun champ inventé / aucun fallback hors périmètre
====================================================== */

(function () {
  const SMARTPITCH_CTX = window.SMARTPITCH_CTX || null;
  const DP1_CONTEXT = window.DP1_CONTEXT || null;
  const DP6_STATE = window.DP6_STATE || null;
  const PANEL_DIMENSIONS = window.PANEL_DIMENSIONS || null;

  function setText(field, value) {
    const nodes = document.querySelectorAll(`[data-field="${field}"]`);
    if (!nodes || !nodes.length) return;
    nodes.forEach((el) => {
      el.textContent = value ?? "";
    });
  }

  function setImage(field, src) {
    const el = document.querySelector(`[data-field="${field}"]`);
    if (!el) return;
    if (!(typeof src === "string" && src.length)) {
      el.removeAttribute("src");
      return;
    }
    el.src = src;
    if (el.decode) el.decode().catch(() => {});
  }

  function asNonEmptyString(v) {
    if (typeof v === "string") {
      const s = v.trim();
      return s ? s : "";
    }
    return "";
  }

  function firstNonEmptyString(...vals) {
    for (const v of vals) {
      const s = asNonEmptyString(v);
      if (s) return s;
    }
    return "";
  }

  function formatCadastralRefsFromCtx(ctx) {
    if (!ctx || typeof ctx !== "object") return "";

    // 1) Champ direct (string) — si présent
    const direct = firstNonEmptyString(
      ctx.ref_cadastrale,
      ctx.refCadastrale,
      ctx.cadastreRefs,
      ctx.cadastre_ref
    );
    if (direct) return direct;

    // 2) Objet parcelle/cadastre (section + numero) — si présent
    const parcel = (ctx.parcelle && typeof ctx.parcelle === "object") ? ctx.parcelle : null;
    const cad = (ctx.cadastre && typeof ctx.cadastre === "object") ? ctx.cadastre : null;
    const carrier = parcel || cad;
    if (carrier) {
      const ref = firstNonEmptyString(carrier.reference, carrier.ref, carrier.refs);
      if (ref) return ref;
      const section = firstNonEmptyString(carrier.section);
      const numero = firstNonEmptyString(carrier.numero);
      const joined = `${section} ${numero}`.trim();
      if (joined) return joined;
    }

    // 3) Champs à plat (section + numero) — si présents
    const section = firstNonEmptyString(ctx.section);
    const numero = firstNonEmptyString(ctx.numero);
    const joined = `${section} ${numero}`.trim();
    return joined || "";
  }

  function orientationLabel(v) {
    const s = typeof v === "string" ? v.trim().toUpperCase() : "";
    if (s === "PORTRAIT") return "Portrait";
    if (s === "PAYSAGE" || s === "LANDSCAPE") return "Paysage";
    return "—";
  }

  function formatSolarGlobePanelDimensionsMeters() {
    const dims = PANEL_DIMENSIONS;
    const wmm = typeof dims?.width_mm === "number" && Number.isFinite(dims.width_mm) ? dims.width_mm : null;
    const hmm = typeof dims?.height_mm === "number" && Number.isFinite(dims.height_mm) ? dims.height_mm : null;
    if (wmm == null || hmm == null) return "";

    const hm = (hmm / 1000).toFixed(2).replace(".", ",");
    const wm = (wmm / 1000).toFixed(2).replace(".", ",");
    // ✅ strictement identique à l'UI DP6
    return `${hm} m × ${wm} m`;
  }

  function formatModuleDimensions(modulePv) {
    // ✅ Source de vérité unique (SolarGlobe) — priorité absolue
    const fromConst = formatSolarGlobePanelDimensionsMeters();
    if (fromConst) return fromConst;

    if (!modulePv || typeof modulePv !== "object") return "—";
    const direct = asNonEmptyString(modulePv.dimensions);
    if (direct) return direct;

    const wmm = typeof modulePv.width_mm === "number" && Number.isFinite(modulePv.width_mm) ? modulePv.width_mm : null;
    const hmm = typeof modulePv.height_mm === "number" && Number.isFinite(modulePv.height_mm) ? modulePv.height_mm : null;
    if (wmm != null && hmm != null) return `${hmm} × ${wmm} mm`;

    const wm = typeof modulePv.width_m === "number" && Number.isFinite(modulePv.width_m) ? modulePv.width_m : null;
    const hm = typeof modulePv.height_m === "number" && Number.isFinite(modulePv.height_m) ? modulePv.height_m : null;
    if (wm != null && hm != null) return `${hm} × ${wm} m`;

    return "—";
  }

  // ======================================================
  // AVANT/APRÈS — IMAGES (source : DP6_STATE)
  // ======================================================
  setImage("images.before", DP6_STATE?.beforeImage);
  setImage("images.after", DP6_STATE?.afterImage);

  // ======================================================
  // CLIENT / ADRESSE / CADASTRE (sources : DP1_CONTEXT + SMARTPITCH_CTX)
  // ======================================================
  const clientNom = firstNonEmptyString(DP1_CONTEXT?.nom, SMARTPITCH_CTX?.client?.nom);
  const adresse = firstNonEmptyString(DP1_CONTEXT?.adresse, SMARTPITCH_CTX?.client?.adresse);
  const cp = firstNonEmptyString(DP1_CONTEXT?.cp, SMARTPITCH_CTX?.client?.cp);
  const ville = firstNonEmptyString(DP1_CONTEXT?.ville, SMARTPITCH_CTX?.client?.ville);

  setText("client.nom", clientNom || "—");
  setText("client.adresse", adresse || "—");
  setText("client.cp", cp || "—");
  setText("client.ville", ville || "—");

  const cadRefs = firstNonEmptyString(
    formatCadastralRefsFromCtx(DP1_CONTEXT),
    formatCadastralRefsFromCtx(SMARTPITCH_CTX)
  );
  setText("cadastre.refs", cadRefs || "—");

  // ======================================================
  // APRÈS — MODULE PV (source : DP6_STATE)
  // ======================================================
  const mod = DP6_STATE?.module || null;
  setText("dp6.module.fabricant", mod?.fabricant ?? "—");
  setText("dp6.module.reference", mod?.reference ?? "—");
  setText("dp6.module.dimensions", formatModuleDimensions(mod));
  setText("dp6.layout.orientation", orientationLabel(DP6_STATE?.layout?.orientation));

  // ======================================================
  // META
  // ======================================================
  setText("date", new Date().toLocaleDateString("fr-FR"));
  window.__DP6_READY__ = true;
})();

