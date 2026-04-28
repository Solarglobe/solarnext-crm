/* ======================================================
   DP2 — SCRIPT PDF (INJECTÉ VIA PLAYWRIGHT)
   - Aucun accès DOM fragile
   - Data-field strict
   - Compatible images base64 lourdes
   - Aucun effet de bord
====================================================== */

(function () {
  // ======================================================
  // SÉCURITÉ — DATA OBLIGATOIRE
  // ======================================================
  const data = window.__DP2_DATA__;
  if (!data) {
    console.error("[DP2] __DP2_DATA__ manquant");
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
  // DP2 — PARAMÈTRES
  // ======================================================
  setText("dp2.category", data.dp2?.category);
  setText("dp2.scale", data.dp2?.scale);

  // ======================================================
  // DP2 — MODULE PV
  // ======================================================
  setText("dp2.modulePv.manufacturer", data.dp2?.modulePv?.manufacturer);
  setText("dp2.modulePv.reference", data.dp2?.modulePv?.reference);
  setText("dp2.modulePv.power_w", data.dp2?.modulePv?.power_w);
  setText("dp2.modulePv.dimensions", data.dp2?.modulePv?.dimensions);

  // ======================================================
  // DP2 — LÉGENDE
  // Format validé : [{ legendKey, count }, ...]
  // Affichage PDF : liste avec icônes (formes/couleurs) + "Label ×N"
  // ======================================================
  (function fillLegend() {
    const container = document.querySelector(`[data-field="dp2.legend"]`);
    const legend = data.dp2?.legend;
    if (!container) return;

    // Reset
    container.innerHTML = "";

    if (!Array.isArray(legend) || !legend.length) {
      const empty = document.createElement("div");
      empty.className = "legend-item";
      const txt = document.createElement("span");
      txt.className = "legend-text";
      txt.textContent = "—";
      empty.appendChild(txt);
      container.appendChild(empty);
      return;
    }

    const LEGEND_META = {
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
        svg: `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.5" y="4.5" width="7" height="7" rx="0.8" fill="#dc2626" stroke="#dc2626" stroke-width="1.4"/></svg>`
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
        // Pas de "N" textuel : uniquement un pictogramme
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
      }
    };

    for (const it of legend) {
      const key = it?.legendKey ? String(it.legendKey) : "";
      const count = typeof it?.count === "number" ? it.count : 0;
      if (!key) continue;

      const meta = LEGEND_META[key] || null;
      const label = meta?.label || key;
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
  })();

  // ======================================================
  // IMAGE DP2
  // ======================================================
  setImage("images.plan", data.images?.plan);

  // ======================================================
  // META
  // ======================================================
  setText("date", new Date().toLocaleDateString("fr-FR"));

  // ======================================================
  // FLAG DE FIN — UTILISÉ PAR PLAYWRIGHT
  // ======================================================
  window.__DP2_READY__ = true;
})();

