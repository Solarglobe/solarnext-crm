// ======================================================
// DEV LOCAL — MOCK SMARTPITCH_CTX
// ⚠️ À SUPPRIMER EN PROD
// ======================================================
if (!window.SMARTPITCH_CTX) {
  console.warn("DEV MODE : injection SMARTPITCH_CTX mock");
  window.SMARTPITCH_CTX = {
    client: {
      nom: "DUPONT Jean",
      date_naissance: "1980-01-01",
      adresse: "57 rue de chelles",
      ville: "Vaires-sur-marne"
    },
    maison: { toiture: "Tuiles", orientation: "S", inclinaison: 30 }
  };
}
// ======================================================
// DEV LOCAL — MOCK DP1_CONTEXT (à partir de SMARTPITCH_CTX)
// ======================================================
if (!window.DP1_CONTEXT && window.SMARTPITCH_CTX?.client) {
  console.warn("DEV MODE : injection DP1_CONTEXT mock");

  window.DP1_CONTEXT = {
    nom: window.SMARTPITCH_CTX.client.nom,
    adresse: window.SMARTPITCH_CTX.client.adresse,
    cp: "75000",      // ← tu peux changer pour tester
    ville: window.SMARTPITCH_CTX.client.ville
  };
}

// ======================================================
// NAVIGATION / CHARGEMENT DES PAGES (UNIQUE)
// ======================================================
document.addEventListener("DOMContentLoaded", () => {
  const content = document.getElementById("page-content");
  const links = document.querySelectorAll(".dp-menu a[data-page]");
  if (!content) return;

  function setActive(page) {
    links.forEach(a => a.classList.toggle("active", a.dataset.page === page));
  }

  function wireAccordions() {
    content.querySelectorAll(".dp-item-header").forEach(header => {
      header.addEventListener("click", () => {
        const item = header.closest(".dp-item");
        if (!item) return;
        item.classList.toggle("open");
        const toggle = header.querySelector(".dp-toggle");
        if (toggle) toggle.textContent = item.classList.contains("open") ? "Masquer" : "Voir";
      });
    });
  }

function initInjectedPage(page) {
  if (page.endsWith("dp1.html")) {
    if (typeof initDP1_MapModal === "function") {
      initDP1_MapModal();
    } else {
      console.warn("[DP1] initDP1_MapModal introuvable");
    }
  }
}


  async function loadPage(page) {
    try {
      const res = await fetch(page, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      content.innerHTML = await res.text();
      setActive(page);
      wireAccordions();
      initInjectedPage(page);
    } catch (e) {
      console.error(e);
      content.innerHTML = `
        <p style="color:#b91c1c;font-weight:600">Erreur de chargement</p>
        <p style="color:#6b7280">${e.message}</p>
      `;
    }
  }

  document.addEventListener("click", e => {
    const link = e.target.closest(".dp-menu a[data-page]");
    if (!link) return;
    e.preventDefault();
    loadPage(link.dataset.page);
  });

  loadPage("pages/general.html");
});



// ======================================================
// GÉNÉRATION PDF MANDAT — FRONT (inchangé)
// ======================================================
async function generateMandatPDF() {
  if (!window.SMARTPITCH_CTX) {
    alert("Les données du projet ne sont pas disponibles.");
    return;
  }

  try {
    const res = await fetch("http://localhost:3000/pdf/render/mandat/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mandatData: window.SMARTPITCH_CTX })
    });

    if (!res.ok) throw new Error("Erreur génération PDF");

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    window.open(url, "_blank");

    const a = document.createElement("a");
    a.href = url;
    a.download = "mandat-solarglobe.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 3000);
  } catch (err) {
    console.error(err);
    alert("Erreur lors de la génération du PDF.");
  }
}

// ======================================================
// DP1 — INIT GLOBAL (appelé APRÈS injection dp1.html)
// ======================================================
function initDP1() {
  initDP1_UIOnly();
  initDP1_UIStates();
  initDP1_MapModal();
  loadDP1LeadContext(); // silencieux
}

// ======================================================
// DP1 — ÉTAPE 1 : UI ONLY
// ======================================================
function initDP1_UIOnly() {
  const dp1Page = document.getElementById("dp1-page");
  if (!dp1Page) return;

  const uploadBox = document.querySelector("#dp1-upload-card .dp-upload-box");
  const uploadInput = document.getElementById("dp1-upload-input");

  if (uploadBox && uploadInput) {
    uploadBox.addEventListener("click", () => uploadInput.click());
    uploadBox.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        uploadInput.click();
      }
    });
  }
}

// ======================================================
// DP1 — ÉTAPE 2 : ÉTATS UI (EMPTY / GENERATED)
// ======================================================
function initDP1_UIStates() {
  const dp1Page = document.getElementById("dp1-page");
  if (!dp1Page) return;

  const actions = document.querySelector(".dp-page-actions");
  const grid = document.getElementById("dp1-cards");
  if (!actions || !grid) return;

  window.DP1_UI = window.DP1_UI || {};
  window.DP1_UI.state = "EMPTY";

  window.DP1_UI.setState = function(nextState) {
    window.DP1_UI.state = nextState;

    if (nextState === "EMPTY") {
      actions.innerHTML = `
        <button class="dp-btn dp-btn-outline" type="button" disabled>
          Télécharger toutes les annexes
        </button>
        <button class="dp-btn dp-btn-primary" type="button" id="dp1-generate-auto">
          Générer automatiquement
        </button>
      `;
      return;
    }

    if (nextState === "GENERATED") {
      actions.innerHTML = `
        <button class="dp-btn dp-btn-primary" type="button" id="dp1-download">
          Télécharger DP1
        </button>
      `;

  if (nextState === "GENERATED") {
  actions.innerHTML = `
    <button class="dp-btn dp-btn-primary" type="button" id="dp1-download">
      Télécharger DP1
    </button>
  `;

  const dl = document.getElementById("dp1-download");
  if (dl) dl.addEventListener("click", () => console.log("[DP1] Télécharger DP1 — backend à venir"));

  return;
}

      const dl = document.getElementById("dp1-download");
      if (dl) dl.addEventListener("click", () => console.log("[DP1] Télécharger DP1 — backend à venir"));
    }
  };

  window.DP1_UI.setState("EMPTY");
}

// ======================================================
// DP1 — ÉTAPE 3 : CHARGEMENT LEAD (ERPNext) (inchangé)
// ======================================================
async function loadDP1LeadContext() {
  const params = new URLSearchParams(window.location.search);
  const leadId = params.get("lead_id");

  if (!leadId) {
    console.warn("[DP1] lead_id manquant dans l’URL");
    return null;
  }

  try {
    const res = await fetch(
      `https://solarnext-crm.fr/api/method/solarnext.api.get_lead_data?lead_id=${encodeURIComponent(leadId)}`,
      {
        headers: {
          "Authorization": "token 03a306b161bb4f4:f313b736c475c00",
          "Accept": "application/json"
        }
      }
    );

    if (!res.ok) throw new Error("Erreur ERPNext");

    const json = await res.json();
    const client = json?.message?.client;
    if (!client) return null;

    const context = {
      lead_id: leadId,
      nom: client.nom || "",
      adresse: client.adresse || "",
      cp: client.cp || "",
      ville: client.ville || ""
    };

    window.DP1_CONTEXT = context;
    localStorage.setItem("dp1_context", JSON.stringify(context));
    console.log("[DP1] Contexte chargé", context);
    return context;
  } catch (err) {
    console.error("[DP1] Erreur chargement Lead", err);
    return null;
  }
}
// ======================================================
// DP1 — MODAL CARTE (SOLTEO STRICT + LIBRE) — FULL FIXED (STABLE ALL BROWSERS)
// - Centre sur adresse (BAN)
// - Marker SVG
// - Flèche Nord dans capture
// - 3 vues -> slots dp1-view-1/2/3
// - Anti double bind / anti double génération
// - FIX Edge/Firefox gris/zoom: attente réelle des tuiles WMTS (waitTilesIdle)
// ======================================================
function initDP1_MapModal() {
  const modal = document.getElementById("dp1-map-modal");
  if (!modal) return;

  // Anti double-binding (lié au modal DOM)
  if (modal.dataset.bound === "1") return;
  modal.dataset.bound = "1";

  // --------------------------
  // State
  // --------------------------
  let map = null;

  let ignLayer = null;
  let cadastreLayer = null;

  let viewStrict = null;
  let viewLibre = null;

  let currentMode = "strict";

  // Marker layer
  let parcelleMarkerLayer = null;

  // --------------------------
  // WMTS GRID PM
  // --------------------------
  const WMTS_ORIGIN = [-20037508, 20037508];
  const WMTS_RESOLUTIONS = [
    156543.03392804103, 78271.51696402051, 39135.75848201024,
    19567.87924100512, 9783.93962050256, 4891.96981025128,
    2445.98490512564, 1222.99245256282, 611.49622628141,
    305.748113140705, 152.8740565703525, 76.43702828517625,
    38.21851414258813, 19.109257071294063, 9.554628535647032,
    4.777314267823516, (2.3 + 0.088657133911758), 1.194328566955879,
    0.5971642834779395, 0.29858214173896974, 0.14929107086948487
  ];
  const WMTS_MATRIX_IDS = WMTS_RESOLUTIONS.map((_, i) => String(i));

  const wmtsGridPM = new ol.tilegrid.WMTS({
    origin: WMTS_ORIGIN,
    resolutions: WMTS_RESOLUTIONS,
    matrixIds: WMTS_MATRIX_IDS
  });

  // --------------------------
  // Helpers
  // --------------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // attend un render "utile" même si OL ne déclenche pas toujours rendercomplete
  async function waitRenderComplete(timeoutMs = 1200) {
    if (!map) return;

    let done = false;

    const p = new Promise((resolve) => {
      const t = setTimeout(() => {
        if (done) return;
        done = true;
        resolve();
      }, timeoutMs);

      map.once("rendercomplete", () => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve();
      });
    });

    map.renderSync();
    await p;
  }

  // ✅ FIX ALL BROWSERS : attendre que les tuiles WMTS soient réellement chargées/dessinées
  // (rendercomplete n’est pas suffisant sur Firefox/Edge -> écran gris jusqu’à interaction)
  async function waitTilesIdle(timeoutMs = 2500) {
    if (!map || !ignLayer || !cadastreLayer) return;

    const sources = [
      ignLayer.getSource && ignLayer.getSource(),
      cadastreLayer.getSource && cadastreLayer.getSource()
    ].filter(Boolean);

    if (!sources.length) return;

    let pending = 0;
    let resolved = false;

    const cleanupFns = [];

    function done(resolve) {
      if (resolved) return;
      resolved = true;
      cleanupFns.forEach(fn => {
        try { fn(); } catch(e) {}
      });
      resolve();
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => done(resolve), timeoutMs);

      sources.forEach((src) => {
        const onStart = () => { pending++; };
        const onEnd = () => {
          pending = Math.max(0, pending - 1);
          // si plus aucune tuile en vol, on laisse 1 frame pour que le canvas se peigne
          if (pending === 0) {
            requestAnimationFrame(() => requestAnimationFrame(() => {
              clearTimeout(timer);
              done(resolve);
            }));
          }
        };
        const onErr = () => {
          pending = Math.max(0, pending - 1);
          if (pending === 0) {
            requestAnimationFrame(() => requestAnimationFrame(() => {
              clearTimeout(timer);
              done(resolve);
            }));
          }
        };

        src.on("tileloadstart", onStart);
        src.on("tileloadend", onEnd);
        src.on("tileloaderror", onErr);

        cleanupFns.push(() => src.un("tileloadstart", onStart));
        cleanupFns.push(() => src.un("tileloadend", onEnd));
        cleanupFns.push(() => src.un("tileloaderror", onErr));
      });

      // kickoff + cas où il n’y a pas d’events qui partent (cache)
      map.renderSync();
      requestAnimationFrame(() => {
        if (pending === 0) {
          clearTimeout(timer);
          done(resolve);
        }
      });
    });
  }

  // force updateSize quand le modal vient d’être affiché
  async function safeUpdateSize() {
    if (!map) return;
    // 2 frames + petit délai = évite "size = 0" si modal vient d’apparaître
    await new Promise((r) => requestAnimationFrame(() => r()));
    await new Promise((r) => requestAnimationFrame(() => r()));
    map.updateSize();
    map.renderSync();
    await waitRenderComplete(800);
  }

  // --------------------------
  // Build layers
  // --------------------------
  function buildLayers() {
    ignLayer = new ol.layer.Tile({
      opacity: 1,
      source: new ol.source.WMTS({
        url: "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile",
        layer: "GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2",
        matrixSet: "PM",
        format: "image/png",
        style: "normal",
        tileGrid: wmtsGridPM,
        wrapX: false,
        crossOrigin: "anonymous"
      })
    });

    cadastreLayer = new ol.layer.Tile({
      opacity: 1,
      source: new ol.source.WMTS({
        url: "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile",
        layer: "CADASTRALPARCELS.PARCELLAIRE_EXPRESS",
        matrixSet: "PM",
        format: "image/png",
        style: "normal",
        tileGrid: wmtsGridPM,
        wrapX: false,
        crossOrigin: "anonymous"
      })
    });
  }

  // --------------------------
  // Build views
  // --------------------------
  function buildViews() {
    const centerParis = ol.proj.fromLonLat([2.3488, 48.8534]);

   viewStrict = new ol.View({
  center: centerParis,

  // 🔴 ON TRAVAILLE EN RÉSOLUTION, PAS EN ZOOM
  resolutions: WMTS_RESOLUTIONS,
  constrainResolution: true,

  enableRotation: false
});


    viewLibre = new ol.View({
      center: centerParis,
      zoom: 17,
      minZoom: 12,
      maxZoom: 23,
      constrainResolution: false,
      enableRotation: false
    });
  }

  // --------------------------
  // CADASTRE AUTO — OFF quand trop dézoomé
  // --------------------------
  function updateCadastreVisibility() {
    if (!map || !cadastreLayer) return;
    const resolution = map.getView().getResolution();

    // ✅ ton seuil d’origine conservé (tu dis qu’il est bon)
    const CADASTRE_MAX_RESOLUTION = 1.4; // ~1:5000 (approx)
    cadastreLayer.setVisible(resolution < CADASTRE_MAX_RESOLUTION);
  }

  function bindResolutionListenerToCurrentView() {
    if (!map) return;
    const v = map.getView();
    v.un("change:resolution", updateCadastreVisibility);
    v.on("change:resolution", updateCadastreVisibility);
    updateCadastreVisibility();
  }

  // --------------------------
  // Marker layer + marker
  // --------------------------
  function initParcelleMarkerLayer() {
    if (!map || parcelleMarkerLayer) return;

    parcelleMarkerLayer = new ol.layer.Vector({
      source: new ol.source.Vector(),
      zIndex: 9999
    });

    map.addLayer(parcelleMarkerLayer);
  }

  function setParcelleMarker(lon, lat) {
    if (!map || !parcelleMarkerLayer) return;

    const source = parcelleMarkerLayer.getSource();
    source.clear();

    const feature = new ol.Feature({
      geometry: new ol.geom.Point(ol.proj.fromLonLat([lon, lat]))
    });

    feature.setStyle(
      new ol.style.Style({
        image: new ol.style.Icon({
          src: "./assets/marker-pin-plan.svg",
          crossOrigin: "anonymous",
          anchor: [0.5, 1],
          anchorXUnits: "fraction",
          anchorYUnits: "fraction",
          scale: 0.85
        })
      })
    );

    source.addFeature(feature);
  }

  // --------------------------
  // BAN centering (adresse -> coords)
  // ⚠️ NE TOUCHE PAS à la vue
  // --------------------------
  async function centerMapFromLead() {
    if (!window.DP1_CONTEXT) return null;

    const { adresse, cp, ville } = window.DP1_CONTEXT || {};
    if (!adresse || !ville) return null;

    try {
      const q = encodeURIComponent(`${adresse} ${cp || ""} ${ville}`);
      const res = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${q}&limit=1`);
      if (!res.ok) return null;

      const json = await res.json();
      if (!json.features?.length) return null;

      const [lon, lat] = json.features[0].geometry.coordinates;

      setParcelleMarker(lon, lat);

      return ol.proj.fromLonLat([lon, lat]);
    } catch (e) {
      console.warn("[DP1] BAN impossible", e);
      return null;
    }
  }

  // --------------------------
  // Ensure map
  // --------------------------
  function ensureMap() {
    if (map) return;

    const target = document.getElementById("dp1-ign-map");
    if (!target) return;

    buildLayers();
    buildViews();

   map = new ol.Map({
  target,
  layers: [ignLayer, cadastreLayer],
  view: viewStrict,
  pixelRatio: window.devicePixelRatio || 1,
  controls: [
    new ol.control.Zoom(),
    new ol.control.Rotate({ autoHide: true })
  ]
});


    initParcelleMarkerLayer();
    currentMode = "strict";

    // ✅ bind sur la view active
    bindResolutionListenerToCurrentView();

    // API exposée
    window.DP1_MAP = {
      get map() { return map; },
      get mode() { return currentMode; },
      setMode,
      setDP1Scale,
      waitRenderComplete,
      centerMapFromLead,
      setParcelleMarker
    };
  }

  // --------------------------
  // Mode switch SAFE (corrigé)
  // --------------------------
  function setMode(mode) {
    if (!map) return;
    if (mode !== "strict" && mode !== "libre") return;
    if (mode === currentMode) return;

    const oldView = map.getView();
    const c = oldView.getCenter();
    const z = oldView.getZoom();

    currentMode = mode;

    if (mode === "strict") {
      map.setView(viewStrict);
      bindResolutionListenerToCurrentView();

      if (c) viewStrict.setCenter(c);
      if (typeof z === "number") viewStrict.setZoom(Math.min(20, Math.max(12, z)));

      map.renderSync();
      return;
    }

    map.setView(viewLibre);
    bindResolutionListenerToCurrentView();

    if (c) viewLibre.setCenter(c);
    if (typeof z === "number") viewLibre.setZoom(Math.min(23, Math.max(12, z)));

    map.renderSync();
  }

 // --------------------------
// Scale DP1 (Solteo-like) — VERSION STABLE WMTS
// Objectif : recréer EXACTEMENT la vue propre obtenue
// après zoom/dézoom utilisateur
// --------------------------
function setDP1Scale(scale) {
  if (!map) return;

  const view = map.getView();

  const SCALES = {
    20000: WMTS_RESOLUTIONS[15],
    5000:  WMTS_RESOLUTIONS[17],
    650:   WMTS_RESOLUTIONS[20]
  };

  const targetResolution = SCALES[scale];
  if (!targetResolution) return;

  setMode("strict");

  const idx = WMTS_RESOLUTIONS.indexOf(targetResolution);
  if (idx < 0) return;

  // 🔁 Phase 1 — passage volontaire par une autre résolution
  if (idx > 0) {
    view.setResolution(WMTS_RESOLUTIONS[idx - 1]);
    map.renderSync();
  }

  // 🔁 Phase 2 — retour sur la cible (comme l’utilisateur)
  view.setResolution(targetResolution);
  map.renderSync();

  updateCadastreVisibility();
}

// --------------------------
// STABILISATION WMTS AVANT CAPTURE
// (équivalent visuel à un zoom manuel terminé)
// --------------------------
async function stabilizeWMTSView() {
  // attendre que TOUTES les tuiles soient vraiment posées
  await waitTilesIdle(3000);

  // attendre la fin réelle du rendu
  await waitRenderComplete(1500);

  // 🔴 FRAME SUPPLÉMENTAIRE (clé)
  await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => requestAnimationFrame(r));

  // 🔴 MICRO PAUSE — comme un humain qui lâche la souris
  await new Promise(r => setTimeout(r, 120));
}

// --------------------------
// CAPTURE WMTS STRICTE — VERSION DÉFINITIVE
// Capture la vue OL RÉELLE (pas DOM, pas zoom fake)
// --------------------------
async function captureMapAsPngDataUrl() {
  if (!map) return null;

  // 🔒 on attend le rendu WMTS FINAL (post snap)
  await waitTilesIdle(3000);
  await waitRenderComplete(1500);

  const mapEl = document.getElementById("dp1-ign-map");
  if (!mapEl) return null;

  const size = map.getSize();
  const canvas = document.createElement("canvas");
  canvas.width = size[0];
  canvas.height = size[1];
  const ctx = canvas.getContext("2d");

  // fond blanc DP
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // ✅ COMPOSITION EXACTE DES CANVAS OPENLAYERS (WMTS NATIF)
  const layers = mapEl.querySelectorAll(".ol-layer canvas");
  layers.forEach((c) => {
    if (!c.width || !c.height) return;

    ctx.save();

    const opacity = c.parentNode?.style?.opacity;
    ctx.globalAlpha = opacity ? Number(opacity) : 1;

    const transform = window.getComputedStyle(c).transform;
    if (transform && transform !== "none") {
      const m = transform.match(/^matrix\((.+)\)$/);
      if (m) {
        const v = m[1].split(",").map(Number);
        ctx.setTransform(v[0], v[1], v[2], v[3], v[4], v[5]);
      }
    }

    ctx.drawImage(c, 0, 0);
    ctx.restore();
  });

  // flèche nord (overlay réel)
  const arrow = document.querySelector(".dp1-north-arrow");
  if (arrow) {
    const r = arrow.getBoundingClientRect();
    const mr = mapEl.getBoundingClientRect();
    ctx.drawImage(
      arrow,
      r.left - mr.left,
      r.top - mr.top,
      r.width,
      r.height
    );
  }

  return canvas.toDataURL("image/png");
}

// --------------------------
// Injection dans le slot
// --------------------------

async function captureIntoSlot(selector) {
  const dataUrl = await captureMapAsPngDataUrl();
  if (!dataUrl) return;

  const slot = document.querySelector(selector);
  if (!slot) return;

  slot.innerHTML = `
    <div class="dp-generated">
      <img src="${dataUrl}" alt="DP1 vue" />
    </div>
  `;
}

// --------------------------
// Modal open / close (VERSION CORRECTE)
// --------------------------

function closeModal() {
  modal.setAttribute("aria-hidden", "true");
  modal.dataset.generating = "0";

  if (document.activeElement) {
    document.activeElement.blur();
  }
}

async function openModal() {
  // 1) Ouvrir le modal
  modal.setAttribute("aria-hidden", "false");

  // 2) Laisser le navigateur poser le layout
  await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => requestAnimationFrame(r));

  // 3) Créer la map
  ensureMap();
  if (!map) return;

  // 4) Forcer la taille réelle
  map.updateSize();
  map.renderSync();

  // 5) Recentrer depuis BAN
  const center = await centerMapFromLead();
  if (center) {
    const view = map.getView();
    view.setCenter(center);
    view.setZoom(view.getZoom() ?? 17);
  }

  // 6) Rendu stable
  map.renderSync();
  await waitRenderComplete(1200);

  // 7) Cadastre auto
  updateCadastreVisibility();
}

 // --------------------------
// Bind UI events
// --------------------------
document.addEventListener("click", (e) => {
  if (e.target.closest("#dp1-generate-auto")) {
    e.preventDefault();
    openModal();
  }
});

modal.addEventListener("click", async (e) => {
  // fermeture
  if (
    e.target.closest(".dp-modal-close") ||
    e.target.closest("#dp1-map-cancel")
  ) {
    e.preventDefault();
    closeModal();
    return;
  }

  // génération
  if (!e.target.closest("#dp1-map-generate")) return;
  e.preventDefault();

  if (modal.dataset.generating === "1") return;
  modal.dataset.generating = "1";

  try {
    ensureMap();
    if (!map) return;

// ===============================
// 🔁 RECONSTRUCTION WMTS COMPLÈTE
// (exactement comme un humain)
// ===============================

// 1️⃣ Vue large — 1:20000
setDP1Scale(20000);
await waitTilesIdle(3000);
await waitRenderComplete(1500);

// 2️⃣ Vue intermédiaire — 1:5000
setDP1Scale(5000);
await waitTilesIdle(3000);
await waitRenderComplete(1500);

// 3️⃣ Vue proche — 1:650 (VUE PROPRE)
setDP1Scale(650);

// ===============================
// 🧠 STABILISATION HUMAINE WMTS
// (LE MOMENT EXACT À CAPTURER)
// ===============================

// attendre que toutes les tuiles WMTS soient posées
await waitTilesIdle(3000);
await waitRenderComplete(1500);

// forcer 2 frames GPU complètes (paint réel)
await new Promise(r => requestAnimationFrame(r));
await new Promise(r => requestAnimationFrame(r));

// micro-pause humaine (équivalent lâcher souris)
await new Promise(r => setTimeout(r, 180));


    // ===============================
    // 📸 CAPTURES (APRÈS reconstruction)
    // ===============================

    // Slot 3 — 1:650 (PROPRE)
    await captureIntoSlot('[data-slot="dp1-view-3"]');

    // Slot 2 — 1:5000
    setDP1Scale(5000);
    await waitTilesIdle(2000);
    await waitRenderComplete(1200);
    await captureIntoSlot('[data-slot="dp1-view-2"]');

    // Slot 1 — 1:20000
    setDP1Scale(20000);
    await waitTilesIdle(2000);
    await waitRenderComplete(1200);
    await captureIntoSlot('[data-slot="dp1-view-1"]');

    // retour UX
    setDP1Scale(650);
    await waitTilesIdle(1200);

    window.DP1_UI?.setState?.("GENERATED");
    setTimeout(() => closeModal(), 400);

  } catch (err) {
    console.error("[DP1] Erreur génération", err);
  } finally {
    modal.dataset.generating = "0";
  }
});



  // --------------------------
  // Clavier dev (bind 1 seule fois)
  // --------------------------
  if (!window.__DP1_KEY_BOUND) {
    window.__DP1_KEY_BOUND = true;

    window.addEventListener("keydown", (e) => {
      if (!window.DP1_MAP?.map) return;
      if (e.key === "s" || e.key === "S") window.DP1_MAP.setMode("strict");
      if (e.key === "l" || e.key === "L") window.DP1_MAP.setMode("libre");
    });
  }
}
