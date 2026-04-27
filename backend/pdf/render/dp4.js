/* ======================================================
   DP4 — SCRIPT PDF (INJECTÉ VIA PLAYWRIGHT)
   - Multi-pages (before/after)
   - Data-field strict
   - Images base64
====================================================== */

(function () {
  const data = window.__DP4_DATA__;
  if (!data) {
    console.error("[DP4] __DP4_DATA__ manquant");
    return;
  }

  const pages = Array.isArray(data.pages) ? data.pages : [];
  const pagesHost = document.getElementById("dp4-pages");
  const tpl = document.getElementById("dp4-page-template");
  if (!pagesHost || !tpl) return;

  function setText(root, field, value) {
    const nodes = root.querySelectorAll(`[data-field="${field}"]`);
    if (!nodes || !nodes.length) return;
    nodes.forEach((el) => {
      el.textContent = value ?? "";
    });
  }

  function setImage(root, field, src) {
    const el = root.querySelector(`[data-field="${field}"]`);
    if (!el || !src) return;
    el.src = src;
    if (el.decode) el.decode().catch(() => {});
  }

  function getSize(el) {
    if (!el) return { w: 0, h: 0 };
    const w = el.clientWidth || 0;
    const h = el.clientHeight || 0;
    return { w, h };
  }

  function fitPlanInViewport(viewport, img) {
    if (!viewport || !img) return;
    const vw = viewport.clientWidth || 0;
    const vh = viewport.clientHeight || 0;
    const iw = img.naturalWidth || 0;
    const ih = img.naturalHeight || 0;
    if (!(vw > 0 && vh > 0 && iw > 0 && ih > 0)) return;

    // scale unique, déterministe (sans déformation, sans crop)
    const scale = Math.min(vw / iw, vh / ih);

    // centrer après scale (top/left en px)
    const left = (vw - iw * scale) / 2;
    const top = (vh - ih * scale) / 2;

    img.style.transformOrigin = "top left";
    img.style.transform = `scale(${scale})`;
    img.style.left = `${left}px`;
    img.style.top = `${top}px`;
  }

  function roofTypeLabel(v) {
    const s = typeof v === "string" ? v : "";
    if (s === "tuile") return "Tuile";
    if (s === "ardoise") return "Ardoise";
    if (s === "bac_acier") return "Bac acier";
    if (s === "membrane") return "Membrane";
    if (s === "autre") return "Autre";
    return "—";
  }

  function formatPanelModel(m) {
    if (!m) return "—";
    if (typeof m === "string") return m;
    const manufacturer = m.manufacturer || "";
    const reference = m.reference || "";
    if (manufacturer && reference) return `${manufacturer} — ${reference}`;
    if (reference) return reference;
    if (manufacturer) return manufacturer;
    return "—";
  }

  const LEGEND_META_DP4 = {
    PANNEAUX_PV: {
      label: "Panneaux photovoltaïques",
      svg: `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.2" fill="#2563eb" fill-opacity="0.18" stroke="#2563eb" stroke-width="1.6"/><path d="M6 3v10M10 3v10M2 7h12" stroke="#2563eb" stroke-width="1"/></svg>`
    },
    COMPTEUR_ELECTRIQUE: {
      label: "Compteur électrique",
      svg: `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="2" fill="#10b981" fill-opacity="0.18" stroke="#10b981" stroke-width="1.6"/><path d="M5 9h6" stroke="#10b981" stroke-width="1.6" stroke-linecap="round"/></svg>`
    },
    DISJONCTEUR: {
      label: "Disjoncteur",
      svg: `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="2" fill="#ef4444" fill-opacity="0.18" stroke="#ef4444" stroke-width="1.6"/><path d="M5 5l6 6M11 5L5 11" stroke="#ef4444" stroke-width="1.6" stroke-linecap="round"/></svg>`
    },
    BATTERIE_STOCKAGE: {
      label: "Batterie de stockage",
      svg: `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="5" width="10" height="8" rx="1.6" fill="#a855f7" fill-opacity="0.18" stroke="#a855f7" stroke-width="1.6"/><rect x="6.5" y="3" width="3" height="2" rx="0.6" fill="#a855f7"/></svg>`
    },
    SENS_PENTE: {
      label: "Sens de la pente",
      svg: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5h6.5" stroke="#f59e0b" stroke-width="1.8" stroke-linecap="round"/><path d="M9 5l4 4" stroke="#f59e0b" stroke-width="1.8" stroke-linecap="round"/><path d="M13 9v-4h-4" stroke="#f59e0b" stroke-width="1.8" stroke-linecap="round"/></svg>`
    },
    VOIE_ACCES: {
      label: "Voie d’accès",
      svg: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 12C5 6 11 6 14 12" fill="none" stroke="#6b7280" stroke-width="1.8" stroke-linecap="round"/><path d="M3.5 12C6 8 10 8 12.5 12" fill="none" stroke="#6b7280" stroke-width="1" stroke-dasharray="2 2"/></svg>`
    },
    ANGLE_PRISE_VUE: {
      label: "Angle de prise de vue",
      svg: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 12l4-8 4 8" fill="#0ea5e9" fill-opacity="0.12" stroke="#0ea5e9" stroke-width="1.6"/><circle cx="8" cy="9" r="1.6" fill="#0ea5e9"/></svg>`
    },
    NORD: {
      label: "Flèche Nord",
      svg: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8l4.4 6.6H9.6v5.8H6.4V8.4H3.6z" fill="#111827"/></svg>`
    },
    ANNOTATION_RECTANGLE: {
      label: "Rectangle libre",
      svg: `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="4" width="10" height="8" rx="1.2" fill="transparent" stroke="#111827" stroke-width="1.6"/></svg>`
    },
    ANNOTATION_CERCLE: {
      label: "Cercle libre",
      svg: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="transparent" stroke="#111827" stroke-width="1.6"/></svg>`
    },
    ANNOTATION_TRIANGLE: {
      label: "Triangle libre",
      svg: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3l5 10H3z" fill="transparent" stroke="#111827" stroke-width="1.6" /></svg>`
    },
    ANNOTATION_FLECHE: {
      label: "Flèche libre",
      svg: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h8" stroke="#111827" stroke-width="1.8" stroke-linecap="round"/><path d="M9 5l3 3-3 3" fill="none" stroke="#111827" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    },
    COTES: {
      label: "Cotes",
      svg: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" stroke="#111827" stroke-width="1.6" stroke-linecap="round"/><path d="M3 5v6M13 5v6" stroke="#111827" stroke-width="1.2" stroke-linecap="round"/></svg>`
    },
    FAITAGE: {
      label: "Faîtage",
      svg: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 11l5-6 5 6" fill="none" stroke="#111827" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    },
    /** Symbole ↕ aligné rendu canvas / DP2 (légende plan). */
    HAUTEUR_GOUTTIERE: {
      label: "Hauteur gouttière",
      svg: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v11" stroke="#0f766e" stroke-width="1.35" stroke-linecap="round"/><path d="M5.2 4.5L8 2l2.8 2.5" fill="none" stroke="#0f766e" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.2 11.5L8 14l2.8-2.5" fill="none" stroke="#0f766e" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    }
  };

  function fillLegend(root, items) {
    const container = root.querySelector(`[data-field="page.legend"]`);
    if (!container) return;
    container.innerHTML = "";

    if (!Array.isArray(items) || !items.length) {
      const empty = document.createElement("div");
      empty.className = "legend-item";
      const txt = document.createElement("span");
      txt.className = "legend-text";
      txt.textContent = "—";
      empty.appendChild(txt);
      container.appendChild(empty);
      return;
    }

    for (const it of items) {
      const key = it?.key || it?.legendKey;
      const count = typeof it?.count === "number" ? it.count : 0;
      if (!key) continue;

      const meta = LEGEND_META_DP4[key] || null;
      const label = meta?.label || String(key);
      const showCount = count > 1;

      const row = document.createElement("div");
      row.className = "legend-item";

      const icon = document.createElement("span");
      icon.className = "legend-icon";
      const iconUrl = it?.iconDataUrl;
      if (typeof iconUrl === "string" && iconUrl.startsWith("data:image")) {
        const img = document.createElement("img");
        img.className = "legend-icon-img";
        img.src = iconUrl;
        img.alt = "";
        img.decoding = "async";
        icon.appendChild(img);
      } else if (meta?.svg) {
        icon.innerHTML = meta.svg;
      }

      const text = document.createElement("span");
      text.className = "legend-text";
      text.textContent = label;

      if (showCount) {
        const qty = document.createElement("span");
        qty.className = "legend-count";
        qty.textContent = `x${count}`;
        text.appendChild(qty);
      }

      row.appendChild(icon);
      row.appendChild(text);
      container.appendChild(row);
    }
  }

  // Reset host
  pagesHost.innerHTML = "";

  const total = pages.length;
  const dateLabel = new Date().toLocaleDateString("fr-FR");

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i] || {};
    const frag = tpl.content.cloneNode(true);
    const pageEl = frag.querySelector(".page");
    if (!pageEl) continue;

    // IDs uniques par page (évite collisions si multi-pages)
    const viewport = pageEl.querySelector("#dp4-plan-viewport");
    const planImg = pageEl.querySelector("#dp4-plan-image");
    if (viewport) viewport.id = `dp4-plan-viewport-${i + 1}`;
    if (planImg) planImg.id = `dp4-plan-image-${i + 1}`;

    // Client (identique DP2)
    setText(pageEl, "client.nom", data.client?.nom);
    setText(pageEl, "client.adresse", data.client?.adresse);
    setText(pageEl, "client.cp", data.client?.cp);
    setText(pageEl, "client.ville", data.client?.ville);

    // Parcelle (align DP2)
    setText(pageEl, "parcel.numero", data.parcel?.numero ?? "—");
    setText(pageEl, "parcel.surface_m2", data.parcel?.surface_m2 ?? "");

    // DP4 (page)
    const label = p.label || (p.category === "before" ? "Avant travaux" : p.category === "after" ? "Après travaux" : "—");
    setText(pageEl, "page.title", `DP4 – Plan de toiture — ${label}`);
    setText(pageEl, "page.roofType", roofTypeLabel(p.roofType));
    setText(pageEl, "page.panelModel", formatPanelModel(p.panelModel));
    setText(pageEl, "page.viewHeightMeters", (typeof p.viewHeightMeters === "number" && Number.isFinite(p.viewHeightMeters)) ? p.viewHeightMeters.toFixed(1) : "—");

    // Legend
    fillLegend(pageEl, p.legend);

    // Image (plan final)
    setImage(pageEl, "page.planImage", p.planImageBase64);

    // Meta
    setText(pageEl, "date", dateLabel);
    setText(pageEl, "page.index", String(i + 1));
    setText(pageEl, "page.total", String(total));

    pagesHost.appendChild(frag);

    // Ajuster le scale du plan une fois l'image chargée (et après layout)
    const viewportMounted = document.getElementById(`dp4-plan-viewport-${i + 1}`);
    const imgMounted = document.getElementById(`dp4-plan-image-${i + 1}`);
    if (viewportMounted && imgMounted) {
      const doFit = () => {
        fitPlanInViewport(viewportMounted, imgMounted);
      };

      // déjà chargé ?
      if (imgMounted.complete && imgMounted.naturalWidth > 0) {
        requestAnimationFrame(() => requestAnimationFrame(doFit));
      } else {
        imgMounted.addEventListener("load", () => {
          requestAnimationFrame(() => requestAnimationFrame(doFit));
        }, { once: true });
      }
    }
  }

  window.__DP4_READY__ = true;
})();

