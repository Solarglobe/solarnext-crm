// ======================================================
// DEV LOCAL — MOCK SMARTPITCH_CTX
// ⚠️ À SUPPRIMER EN PROD
// ======================================================
if (!window.SMARTPITCH_CTX) {
  console.warn("DEV MODE : injection SMARTPITCH_CTX mock");
  window.SMARTPITCH_CTX = {
    client: {
      nom: "GIRARD Kim",
      date_naissance: "1970-06-18",
      adresse: "14 Rue Gabriel Peri",
      ville: "Cachan"
    },
    maison: { toiture: "Bacacier", orientation: "N", inclinaison: 15 }
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
    cp: "77520",      // ← tu peux changer pour tester
    ville: window.SMARTPITCH_CTX.client.ville
  };
}

// ======================================================
// DP VIEW LOCK — Source de vérité vue carto (DP2 → DP4)
// Ne pas remplir automatiquement ; prêt pour lockDPView.
// ======================================================
window.DP_VIEW_LOCK = {
  projection: "EPSG:3857",
  center: null,
  resolution: null,
  size: null
};

// 🔒 HARD RESET runtime-only (jamais persistant)
window.DP4_CAPTURE_IMAGE = null;

// Import DP2 → DP4 (overlay screen-space canvas, PAS layer OpenLayers)
window.DP4_IMPORT_OVERLAY_CANVAS = null;
window.DP4_IMPORT_DP2_ACTIVE = false;

function lockDPView({ map }) {
  const view = map.getView();
  const center = view.getCenter();
  const resolution = view.getResolution();
  const size = map.getSize();
  window.DP_VIEW_LOCK.center = center ? center.slice() : null;
  window.DP_VIEW_LOCK.resolution = resolution != null ? resolution : null;
  window.DP_VIEW_LOCK.size = size ? size.slice() : null;
  console.log("[DP] View locked");
}

function applyDPView({ map }) {
  const lock = window.DP_VIEW_LOCK;
  if (!lock || lock.center == null || lock.resolution == null || lock.size == null) return;
  const view = map.getView();
  view.setCenter(lock.center);
  view.setResolution(lock.resolution);
  map.setSize(lock.size);
  console.log("[DP] View applied");
}

function applySafeInitialResolution(map, targetResolution, wmtsResolutions) {
  if (!map || !map.getView) return;
  const view = map.getView();
  if (!view || !Array.isArray(wmtsResolutions)) return;

  const idx = wmtsResolutions.indexOf(targetResolution);
  if (idx <= 0) return; // pas de cran supérieur possible

  const startResolution = wmtsResolutions[idx - 1];

  // 1) On démarre un cran en dessous
  view.setResolution(startResolution);

  // 2) Une fois le premier rendu fait, on revient à la cible
  map.once("rendercomplete", function () {
    requestAnimationFrame(() => {
      view.setResolution(targetResolution);
      try { map.renderSync(); } catch (_) {}
    });
  });
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
    // ✅ initialise TOUT le DP1 (upload + états + modal + lead)
    if (typeof initDP1 === "function") {
      initDP1();
    } else {
      console.warn("[DP1] initDP1 introuvable");
    }
  } else if (page.endsWith("dp2.html")) {
    initDP2();
  } else if (page.endsWith("dp3.html")) {
    initDP3();
  } else if (page.endsWith("dp4.html")) {
    initDP4();
  } else if (page.endsWith("dp6.html")) {
    initDP6();
  } else if (page.endsWith("dp7.html")) {
    if (typeof initDP7 === "function") {
      initDP7();
      try { if (typeof window.bindDP7ExportPdfButton === "function") window.bindDP7ExportPdfButton(); } catch (_) {}
    } else {
      console.warn("[DP7] initDP7 introuvable");
    }
  } else if (page.endsWith("dp8.html")) {
    if (typeof initDP8 === "function") {
      initDP8();
      try { if (typeof window.bindDP8ExportPdfButton === "function") window.bindDP8ExportPdfButton(); } catch (_) {}
    } else {
      console.warn("[DP8] initDP8 introuvable");
    }
  } else if (page.endsWith("cerfa.html")) {
    if (typeof initCERFA === "function") {
      initCERFA();
    } else {
      console.warn("[CERFA] initCERFA introuvable");
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
// CERFA — INIT (structure + affichage uniquement)
// Texte descriptif réglementaire 100 % déterministe depuis l’état DP / projet.
// ======================================================
window.CERFA_STATE = window.CERFA_STATE || {
  panelCount: "",
  panelPower: "",
  panelHeight: "",
  panelWidth: "",
  panelDepth: "",
  brand: "",
  color: "",
  panelsPerRow: "",
  columnsCount: "",
  rowsCount: "",
  panelOrientation: "",
  roofOrientation: "",
  energyManagement: ""
};

function cerfaLogState() {
  console.log("CERFA_STATE", { ...window.CERFA_STATE });
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function normOrientation(v) {
  const s = String(v || "").toLowerCase().trim();
  if (s.includes("por")) return "portrait";
  if (s.includes("pay")) return "paysage";
  if (s === "p") return "portrait";
  if (s === "l") return "paysage";
  return "";
}

function buildCerfaDescriptionText() {
  const S = window.CERFA_STATE || {};

  const safe = (v) => {
    if (v === undefined || v === null) return "";
    return String(v).trim();
  };

  const panelCount = safe(S.panelCount);
  const panelPower = safe(S.panelPower);
  const panelWidth = safe(S.panelWidth);
  const panelHeight = safe(S.panelHeight);
  const panelThickness = safe(S.panelDepth);
  const rowCount = safe(S.rowsCount);
  const panelsPerRow = safe(S.panelsPerRow);
  const roofOrientation = safe(S.roofOrientation);
  const panelBrand = safe(S.brand);
  const panelColor = safe(S.color);

  const orientation = (S.panelOrientation === "landscape" || S.panelOrientation === "paysage")
    ? "en paysage"
    : "en portrait";

  return (
    "Pose de " + panelCount + " panneaux solaires photovoltaïques d'une puissance unitaire de " +
    panelPower + " Wc et de dimensions " +
    panelWidth + " x " + panelHeight + " x " + panelThickness + " mm,\n" +
    "disposés en " +
    document.getElementById("cerfa-columns")?.value +
    " rangées de " +
    document.getElementById("cerfa-panels-per-row")?.value +
    " panneaux (" + orientation + ") sur toiture d'orientation " +
    roofOrientation + ".\n" +
    "Panneaux de marque " + panelBrand +
    ", traitement anti-reflet, couleur " + panelColor + "."
  );
}

function generateCerfaDescription() {
  const text = buildCerfaDescriptionText();
  const ta = document.getElementById("cerfa-description");
  if (ta) ta.value = text;
  console.log("[CERFA] Texte généré:", text);
}

function initCERFA() {
  const S = window.CERFA_STATE;
  if (S.panelHeight === undefined) S.panelHeight = "";
  if (S.panelWidth === undefined) S.panelWidth = "";
  if (S.panelDepth === undefined) S.panelDepth = "";
  if (S.columnsCount === undefined) S.columnsCount = "";

  function bindInput(id, key, parse) {
    const el = document.getElementById(id);
    if (!el) return;
    const setVal = (v) => { el.value = v === "" || v == null ? "" : String(v); };
    setVal(S[key]);
    el.addEventListener("input", function () {
      S[key] = parse ? parse(this.value) : this.value;
      cerfaLogState();
    });
  }

  function bindSelect(id, key) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = S[key] || "";
    el.addEventListener("change", function () {
      S[key] = this.value;
      cerfaLogState();
    });
  }

  function bindToggleGroup(buttonIds, key, valueTransform) {
    const buttons = buttonIds.map((id) => document.getElementById(id)).filter(Boolean);
    const normalize = valueTransform || ((v) => v);
    buttons.forEach((btn) => {
      const optVal = btn.dataset.value || "";
      if (normalize(optVal) === normalize(S[key] || "")) btn.classList.add("active");
      btn.addEventListener("click", function () {
        buttons.forEach((b) => b.classList.remove("active"));
        this.classList.add("active");
        const raw = this.dataset.value || "";
        S[key] = normalize(raw) || raw;
        cerfaLogState();
      });
    });
  }

  bindInput("cerfa-panel-count", "panelCount", (v) => (v === "" ? "" : Number(v) || v));
  bindInput("cerfa-panel-power", "panelPower", (v) => (v === "" ? "" : Number(v) || v));
  bindInput("cerfa-height", "panelHeight", (v) => (v === "" ? "" : Number(v) || v));
  bindInput("cerfa-width", "panelWidth", (v) => (v === "" ? "" : Number(v) || v));
  bindInput("cerfa-depth", "panelDepth", (v) => (v === "" ? "" : Number(v) || v));
  bindInput("cerfa-brand", "brand");
  bindInput("cerfa-panels-per-row", "panelsPerRow", (v) => (v === "" ? "" : Number(v) || v));
  bindInput("cerfa-columns", "columnsCount", (v) => (v === "" ? "" : Number(v) || v));
  bindInput("cerfa-rows", "rowsCount", (v) => (v === "" ? "" : Number(v) || v));
  bindSelect("cerfa-roof-orientation", "roofOrientation");
  bindToggleGroup(["cerfa-color-noir", "cerfa-color-autre"], "color");
  bindToggleGroup(["cerfa-panel-orientation-portrait", "cerfa-panel-orientation-paysage"], "panelOrientation", normOrientation);
  bindToggleGroup(
    ["cerfa-energy-autoconsommation", "cerfa-energy-vente-surplus", "cerfa-energy-vente-totale"],
    "energyManagement"
  );

  const btnGenerate = document.getElementById("cerfa-btn-generate-description");
  if (btnGenerate) btnGenerate.addEventListener("click", generateCerfaDescription);

  const btnCreatePdf = document.getElementById("cerfa-btn-create-pdf");
  if (btnCreatePdf) btnCreatePdf.addEventListener("click", createCerfaPdf);
}

// ======================================================
// CERFA — Création PDF prérempli (frontend uniquement, pdf-lib)
// ======================================================
async function loadPdf() {
  const res = await fetch("photos/cerfa_16702-02.pdf", { cache: "no-store" });
  if (!res.ok) throw new Error("Impossible de charger le PDF CERFA");
  return res.arrayBuffer();
}

function fillCerfaFields(pdfDoc, state, descriptionText, options) {
  if (!pdfDoc.getForm) return;
  const form = options?.form ?? pdfDoc.getForm();
  const helveticaFont = options?.helveticaFont;
  const rgb = options?.rgb;

  function safeSetText(name, value) {
    if (!value) return;

    try {
      const field = form.getTextField(name);
      field.setText(String(value));
    } catch (err) {
      console.warn("CERFA skip", name);
    }
  }

  function safeCheck(name) {
    try {
      form.getCheckBox(name).check();
    } catch (err) {
      console.warn("[CERFA PDF] check skip", name, err.message);
    }
  }

  // 1) En-tête
  safeSetText("N1FCA_formulaire", "DPC");

  // 2) Déclarant
  safeSetText("D1N_nom", state.nom);
  safeSetText("D1P_prenom", state.prenom);
  safeSetText("D1E_pays", state.pays || "FRANCE");

  // 3) Adresse / contact
  safeSetText("D3N_numero", state.numeroVoie);
  safeSetText("D3V_voie", state.voie);
  safeSetText("D3L_localite", state.ville);
  safeSetText("D3C_code", state.cp);
  safeSetText("D3T_telephone", state.telephone);
  safeSetText("D3K_indicatif", state.indicatif || "33");

  // Email SPLIT
  safeSetText("D5GE1_email", state.emailLocal);
  safeSetText("D5GE2_email", state.emailDomain);
  if (state.emailAccepted === true) safeCheck("D5A_acceptation");

  // 4) Terrain (adresse + cadastre)
  safeSetText("T2Q_numero", state.numeroVoie);
  safeSetText("T2V_voie", state.voie);
  safeSetText("T2L_localite", state.ville);
  safeSetText("T2C_code", state.cp);
  safeSetText("T2S_section", state.parcelleSection);
  safeSetText("T2N_numero", state.parcelleNumero);
  safeSetText("T2T_superficie", state.parcelleSurfaceM2);
  // Superficie totale du terrain (champ réel : D5T_total)
  safeSetText("D5T_total", state.superficieTotale);

  // Cases "NC"
  safeCheck("T3B_CUnc");
  safeCheck("T3S_lotnc");
  safeCheck("T3T_ZACnc");
  safeCheck("T3E_AFUnc");
  safeCheck("T3F_PUPnc");

  // 5) Nature des travaux / PV (section 4.2.1)
  safeCheck("C2ZB1_existante");
  safeSetText("C2ZA7_autres", "Pose de panneaux solaires photovoltaïques");
  try {
    const descField = form.getTextField("C2ZD1_description");
    descField.setText(descriptionText);
    descField.enableMultiline();
  } catch (err) {
    console.warn("[CERFA] skip description", err);
  }
  safeSetText("C2ZP1_crete", state.puissanceKwc);
  if (state.forcePuissanceElecZero === true) {
    safeSetText("C2ZE1_puissance", "0");
  }
  safeSetText("C2ZR1_destination", state.destinationEnergie);

  // 6) Mode d'occupation
  safeCheck("C5ZD1_personnel");
  safeCheck("C2ZF1_principale");

  // 7) Surfaces
  safeSetText("W3ES2_creee", "0");
  safeSetText("W3ES3_supprimee", "0");

  // 8) Signature / date / lieu
  safeSetText("E1L_lieu", state.signatureLieu);
  safeSetText("E1D_date", state.signatureDateDDMMYYYY);
  safeSetText("E1S_signature", state.signatureTexte);

  // 9) PV checkboxes
  safeCheck("P5PA1");
  safeCheck("P5PB1");
  safeCheck("P3GE1");
  safeCheck("P3GD1");
  safeCheck("P3GF1");
  safeCheck("P3GG1");
  safeCheck("P3GH1");
}

function openPdfInNewTab(pdfBytes) {
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
}

function pad2(n) {
  return n < 10 ? "0" + n : String(n);
}

async function createCerfaPdf() {
  const PDFLib = window.PDFLib;
  if (!PDFLib || !PDFLib.PDFDocument) {
    console.warn("[CERFA PDF] pdf-lib non chargé");
    return;
  }
  try {
    const arrayBuffer = await loadPdf();
    const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);

    const { rgb, StandardFonts } = PDFLib;
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const form = pdfDoc.getForm();

    const ctx = window.DP1_CONTEXT || {};
    const client = window.SMARTPITCH_CTX?.client || {};
    const cad = window.DP1_STATE?.selectedParcel || null;
    const cerfaState = window.CERFA_STATE || {};

    // 2) Nom / prénom : nom en MAJ, prénom normal (comme Solteo)
    const nomComplet = String(ctx.nom || client.nom || "").trim();
    const parts = nomComplet.split(/\s+/);
    let nom, prenom;
    if (parts.length > 1) {
      nom = parts[parts.length - 1].toUpperCase();
      prenom = parts.slice(0, -1).join(" ");
    } else {
      nom = nomComplet ? nomComplet.toUpperCase() : "";
      prenom = "";
    }

    // 3) Adresse / cp / ville
    const adresse = String(ctx.adresse || client.adresse || "").trim();
    const cp = String(ctx.cp || client.cp || "").trim();
    const ville = String(ctx.ville || client.ville || "").trim();
    const adresseTokens = adresse ? adresse.split(/\s+/) : [];
    const numeroVoie = adresseTokens.length > 0 && /^\d/.test(adresseTokens[0]) ? adresseTokens[0] : "";
    const voie = numeroVoie ? (adresseTokens.length > 1 ? adresseTokens.slice(1).join(" ") : "") : adresse;

    // 4) Téléphone : format national sans + (ex 0673...), indicatif 33
    let tel = String(client.telephone || "").trim().replace(/[\s.\-]/g, "");
    let indicatif = "33";
    let telNational = tel;
    if (tel.startsWith("+33")) {
      indicatif = "33";
      telNational = tel.slice(3).replace(/[\s.\-]/g, "");
      if (telNational && !telNational.startsWith("0")) telNational = "0" + telNational;
    } else if (tel.startsWith("0033")) {
      indicatif = "33";
      telNational = tel.slice(4).replace(/[\s.\-]/g, "");
      if (telNational && !telNational.startsWith("0")) telNational = "0" + telNational;
    }

    // 5) Email split
    const email = String(client.email || client.mail || "").trim();
    const split = email.split("@");
    const emailLocal = split[0] || "";
    const emailDomain = split[1] || "";
    const emailAccepted = !!(emailLocal && emailDomain);

    // 6) Puissance crête kWc
    const count = cerfaState.panelCount;
    const power = cerfaState.panelPower;
    const puissanceKwc = count != null && power != null && !isNaN(Number(count)) && !isNaN(Number(power))
      ? (Number(count) * Number(power) / 1000).toFixed(2)
      : "";

    // 7) Destination énergie
    let destinationEnergie = "";
    if (cerfaState.energyManagement === "Autoconsommation") destinationEnergie = "Autoconsommation";
    else if (cerfaState.energyManagement === "Autoconsommation + Vente de surplus") destinationEnergie = "Autoconsommation avec vente du surplus";
    else if (cerfaState.energyManagement === "Vente totale") destinationEnergie = "Vente totale";
    else if (cerfaState.energyManagement) destinationEnergie = cerfaState.energyManagement;

    // 8) Cadastre
    const parcelleSection = cad?.section || "";
    const parcelleNumero = cad?.numero || "";
    const parcelleSurfaceM2 = cad?.surface_m2 != null ? String(cad.surface_m2) : "";

    const s1 = Number(parcelleSurfaceM2 || 0);
    const total = s1;
    const superficieTotale = total > 0 ? String(Math.round(total)) : "";

    // 9) Signature
    const signatureLieu = ville || "";
    const d = new Date();
    const signatureDateDDMMYYYY = pad2(d.getDate()) + pad2(d.getMonth() + 1) + String(d.getFullYear());
    const signatureTexte = (prenom + " " + nom).trim();

    const state = {
      nom,
      prenom,
      pays: "FRANCE",
      numeroVoie,
      voie,
      cp,
      ville,
      telephone: telNational,
      indicatif,
      emailLocal,
      emailDomain,
      emailAccepted,
      parcelleSection,
      parcelleNumero,
      parcelleSurfaceM2,
      superficieTotale,
      puissanceKwc,
      destinationEnergie,
      signatureLieu,
      signatureDateDDMMYYYY,
      signatureTexte,
      forcePuissanceElecZero: cerfaState.forcePuissanceElecZero === true
    };

    const descriptionText = buildCerfaDescriptionText();

    fillCerfaFields(pdfDoc, state, descriptionText, { helveticaFont, form, rgb });

    form.updateFieldAppearances(helveticaFont);

    const pdfBytes = await pdfDoc.save();
    openPdfInNewTab(pdfBytes);
  } catch (err) {
    console.error("[CERFA PDF]", err);
  }
}

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
// DP1 — STATE GLOBAL (mode / validation / parcelle / centroid)
// Source unique côté front pour piloter DP1 et stocker ensuite en localStorage
// ======================================================
window.DP1_STATE = window.DP1_STATE || {
  // mode de travail carte
  currentMode: "strict", // "strict" | "libre"

  // validation utilisateur
  isValidated: false,

  // parcelle / résultat cadastre courant (quand on l’ajoutera)
  selectedParcel: null, // ex: { section, numero, surface_m2, ... }

  // dernier centroid utilisé comme vérité (lat/lon WGS84)
  lastCentroid: null, // ex: { lat: 48.85, lon: 2.34 }

  // point courant manipulé (avant validation)
  currentPoint: null, // ex: { lat, lon }

  // utilitaire: reset complet
  reset() {
    this.currentMode = "strict";
    this.isValidated = false;
    this.selectedParcel = null;
    this.lastCentroid = null;
    this.currentPoint = null;
  },

  // utilitaire: marquer “non validé” si l’utilisateur bouge le point
  markDirty() {
    this.isValidated = false;
    this.selectedParcel = null;
    this.lastCentroid = null;
  }
};

// ======================================================
// DP1 — INIT GLOBAL (ANTI DOUBLE BIND GLOBAL)
// ======================================================
function initDP1() {
  // 🔒 Anti double initialisation DP1
  if (window.__DP1_INIT_DONE === true) {
    return;
  }
  window.__DP1_INIT_DONE = true;

  initDP1_UIOnly();
  initDP1_UIStates();
  initDP1_MapModal();
  loadDP1LeadContext(); // silencieux
  initDP1_ImagePreview();
}


// ======================================================
// DP1 — ÉTAPE 1 : UI ONLY
// ======================================================
function initDP1_UIOnly() {
  const dp1Page = document.getElementById("dp1-page");
  if (!dp1Page) return;

  const uploadBox = document.querySelector("#dp1-upload-card .dp-upload-box");
  const uploadInput = document.getElementById("dp1-upload-input");

  if (!uploadBox || !uploadInput) return;

  // clic sur la carte → ouvre le file picker
  uploadBox.addEventListener("click", () => uploadInput.click());

  uploadBox.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      uploadInput.click();
    }
  });

  // 🔴 CE QUI MANQUAIT : traitement du fichier
  uploadInput.addEventListener("change", () => {
    const file = uploadInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const card = document.getElementById("dp1-upload-card");
      card.innerHTML = `
        <div class="dp-generated">
          <img src="${reader.result}" alt="DP1 upload manuel" />
        </div>
      `;

      // optionnel : passer l’état en GENERATED
      if (window.DP1_UI?.setState) {
        window.DP1_UI.setState("GENERATED");
      }
    };

    reader.readAsDataURL(file);
  });
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

  window.DP1_UI.setState = function (nextState) {
    window.DP1_UI.state = nextState;

    // ===============================
    // ÉTAT EMPTY
    // ===============================
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

    // ===============================
    // ÉTAT GENERATED
    // ===============================
    if (nextState === "GENERATED") {
      actions.innerHTML = `
        <button class="dp-btn dp-btn-primary" type="button" id="dp1-download">
          Télécharger DP1
        </button>
      `;

      const dl = document.getElementById("dp1-download");
      if (dl) {
        dl.addEventListener("click", () => {
          generateDP1PDF();
        });
      }

      return;
    }
  };

  // état initial
  window.DP1_UI.setState("EMPTY");
}


// ======================================================
// DP1 — ÉTAPE 3 : CHARGEMENT LEAD (ERPNext)
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
    const message = json?.message;
    const client = message?.client;
    const site = message?.site || {};

    if (!client) return null;

    // ======================================================
    // DP1 — CONTEXTE GLOBAL (client + lat / lon ERPNext)
    // ======================================================
    window.DP1_CONTEXT = {
      lead_id: leadId,
      nom: client.nom || "",
      adresse: client.adresse || "",
      cp: client.cp || "",
      ville: client.ville || "",

      // coordonnées PRIORITAIRES
      lat: site.latitude ? Number(site.latitude) : null,
      lon: site.longitude ? Number(site.longitude) : null
    };

    // initialiser le point courant UNE SEULE FOIS
    if (
      window.DP1_CONTEXT.lat &&
      window.DP1_CONTEXT.lon &&
      !window.DP1_STATE.currentPoint
    ) {
      window.DP1_STATE.currentPoint = {
        lat: window.DP1_CONTEXT.lat,
        lon: window.DP1_CONTEXT.lon
      };
    }

    // persistance locale (ok pour DP suivants)
    localStorage.setItem(
      "dp1_context",
      JSON.stringify(window.DP1_CONTEXT)
    );

    console.log("[DP1] Contexte chargé", window.DP1_CONTEXT);
    return window.DP1_CONTEXT;

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

// ===============================
// DP1 — ACTION : RECALCUL PARCELLE (API cadastre)
// ===============================

// ⚠️ Mets ici TON endpoint cadastre (backend SmartPitch/DP)
// Priorité : CADASTRE_POINT_API > SMARTPITCH_API_BASE + /api/cadastre/by-point > localhost:3000
function getCadastreApiBase() {
  if (window.CADASTRE_POINT_API) return window.CADASTRE_POINT_API;
  const base = window.SMARTPITCH_API_BASE || "";
  if (base) return base.replace(/\/$/, "") + "/api/cadastre/by-point";
  // Dev Vite : proxy /api → localhost:3000 → URL relative
  if (typeof window !== "undefined" && (window.location.port === "5173" || window.location.port === "5174")) {
    return window.location.origin + "/api/cadastre/by-point";
  }
  return "http://localhost:3000/api/cadastre/by-point";
}

// récupère le point courant (priorité : marker -> DP1_STATE -> center map)
function getCurrentPointWGS84() {
  // 1) marker
  if (parcelleMarkerFeature?.getGeometry) {
    const c = parcelleMarkerFeature.getGeometry().getCoordinates();
    const [lon, lat] = ol.proj.toLonLat(c);
    return { lat, lon };
  }

  // 2) state
  if (window.DP1_STATE?.currentPoint) {
    return window.DP1_STATE.currentPoint; // {lat, lon}
  }

  // 3) center map
  if (map?.getView) {
    const c = map.getView().getCenter();
    if (c) {
      const [lon, lat] = ol.proj.toLonLat(c);
      return { lat, lon };
    }
  }

  return null;
}

async function fetchCadastreByPoint(lat, lon) {
  const base = getCadastreApiBase();
  const url =
    `${base}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
  console.log("[DP1][CADASTRE] calling", url);

  const headers = {};
  const token = typeof localStorage !== "undefined" && localStorage.getItem("solarnext_token");
  if (token) headers.Authorization = "Bearer " + token;

  const res = await fetch(url, { method: "GET", headers });
  if (!res.ok) throw new Error(`CADASTRE API HTTP ${res.status}`);
  return await res.json();
}

// ======================================================
// DP1 — Snap initial au centroïde parcellaire (AUTO)
// Pourquoi : les coords ERPNext (lat/lon) pointent souvent sur l'adresse (voie),
// pas sur la parcelle. On améliore le centrage initial en “snappant” au centroïde
// de la parcelle détectée, tout en laissant l’utilisateur libre de déplacer ensuite.
// - Aucune modif backend
// - Ne modifie pas /cadastre/by-point
// - Ne change pas le comportement des boutons Recalculer / Valider
// ======================================================
function extractGeoJsonGeometry(maybeGeo) {
  if (!maybeGeo) return null;
  // cas 1) GeoJSON Geometry direct
  if (maybeGeo.type && maybeGeo.coordinates) return maybeGeo;
  // cas 2) Feature
  if (maybeGeo.type === "Feature" && maybeGeo.geometry) return maybeGeo.geometry;
  // cas 3) FeatureCollection
  if (
    maybeGeo.type === "FeatureCollection" &&
    Array.isArray(maybeGeo.features) &&
    maybeGeo.features[0] &&
    maybeGeo.features[0].geometry
  ) {
    return maybeGeo.features[0].geometry;
  }
  return null;
}

function computeRingCentroidXY(ring) {
  // ring: [[x,y], [x,y], ...] (idéalement fermé)
  if (!Array.isArray(ring) || ring.length < 3) return null;

  let area2 = 0; // 2*A
  let cx6a = 0;  // 6*A*Cx
  let cy6a = 0;  // 6*A*Cy

  // Assurer une boucle : si non fermé, on boucle virtuellement
  const n = ring.length;
  const last = ring[n - 1];
  const first = ring[0];
  const isClosed = last && first && last[0] === first[0] && last[1] === first[1];

  const limit = isClosed ? n - 1 : n;
  for (let i = 0; i < limit; i++) {
    const p0 = ring[i];
    const p1 = ring[(i + 1) % limit];
    if (!p0 || !p1) continue;
    const x0 = Number(p0[0]);
    const y0 = Number(p0[1]);
    const x1 = Number(p1[0]);
    const y1 = Number(p1[1]);
    if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) {
      continue;
    }
    const cross = x0 * y1 - x1 * y0;
    area2 += cross;
    cx6a += (x0 + x1) * cross;
    cy6a += (y0 + y1) * cross;
  }

  if (!Number.isFinite(area2) || Math.abs(area2) < 1e-12) {
    // fallback : moyenne des points
    let sx = 0, sy = 0, c = 0;
    for (const p of ring) {
      if (!p) continue;
      const x = Number(p[0]);
      const y = Number(p[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      sx += x; sy += y; c += 1;
    }
    if (c === 0) return null;
    return { x: sx / c, y: sy / c, areaAbs: 0 };
  }

  const cx = cx6a / (3 * area2); // (6A)/(?) -> 3*area2 = 6A
  const cy = cy6a / (3 * area2);
  return { x: cx, y: cy, areaAbs: Math.abs(area2 / 2) };
}

function computeGeoJsonCentroidWgs84(geoJsonGeometry) {
  const g = extractGeoJsonGeometry(geoJsonGeometry);
  if (!g) return null;
  if (!window.ol?.format?.GeoJSON || !window.ol?.proj?.toLonLat) return null;

  let geom3857 = null;
  try {
    const geoJsonFormat = new ol.format.GeoJSON();
    geom3857 = geoJsonFormat.readGeometry(g, {
      dataProjection: "EPSG:4326",
      featureProjection: "EPSG:3857"
    });
  } catch (_) {
    geom3857 = null;
  }
  if (!geom3857 || typeof geom3857.getType !== "function") return null;

  const type = geom3857.getType();

  // Point → trivial
  if (type === "Point" && typeof geom3857.getCoordinates === "function") {
    const xy = geom3857.getCoordinates();
    const [lon, lat] = ol.proj.toLonLat(xy);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  }

  // Polygon/MultiPolygon → centroïde (anneau extérieur) en EPSG:3857, puis retour WGS84
  let best = null; // {x,y,areaAbs}
  try {
    if (type === "Polygon") {
      const coords = geom3857.getCoordinates(); // [ring1, ring2(hole), ...]
      const outer = Array.isArray(coords) ? coords[0] : null;
      best = computeRingCentroidXY(outer);
    } else if (type === "MultiPolygon") {
      const polys = geom3857.getCoordinates(); // [[[ring...]], [[ring...]], ...]
      if (Array.isArray(polys)) {
        for (const poly of polys) {
          const outer = Array.isArray(poly) ? poly[0] : null;
          const c = computeRingCentroidXY(outer);
          if (!c) continue;
          if (!best || (c.areaAbs || 0) > (best.areaAbs || 0)) best = c;
        }
      }
    } else {
      // fallback conservateur : centre de l'extent (évite de casser sur d'autres types)
      if (typeof geom3857.getExtent === "function" && window.ol?.extent?.getCenter) {
        const centerXY = ol.extent.getCenter(geom3857.getExtent());
        const [lon, lat] = ol.proj.toLonLat(centerXY);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return { lat, lon };
      }
      return null;
    }
  } catch (_) {
    best = null;
  }

  if (!best || !Number.isFinite(best.x) || !Number.isFinite(best.y)) return null;
  const [lon, lat] = ol.proj.toLonLat([best.x, best.y]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

async function snapDP1MarkerToDetectedParcelCentroid() {
  // ⚠️ Snapping uniquement au chargement (ne doit pas simuler "Recalculer"/"Valider")
  const p = getCurrentPointWGS84();
  if (!p) return false;

  try {
    const cad = await fetchCadastreByPoint(p.lat, p.lon);
    if (!cad || !cad.geometry) return false;

    const centroid = computeGeoJsonCentroidWgs84(cad.geometry);
    if (!centroid) return false;

    // Déplacer le marker + source de vérité "point courant"
    setParcelleMarker(centroid.lon, centroid.lat);
    window.DP1_STATE.currentPoint = { lat: centroid.lat, lon: centroid.lon };
    // On ne touche pas selectedParcel ici (pour ne pas modifier l'UI hors action utilisateur)

    return true;
  } catch (e) {
    console.warn("[DP1][SNAP] Cadastre indisponible ou géométrie invalide, snapping ignoré", e);
    return false;
  }
}

// bouton "Recalculer la parcelle"
const btnRecalc = modal.querySelector("#dp1-map-recalc");
if (btnRecalc) {
  btnRecalc.addEventListener("click", async () => {
    const p = getCurrentPointWGS84();
    if (!p) return;

    try {
      const cad = await fetchCadastreByPoint(p.lat, p.lon);

      // ✅ on stocke dans l’état DP1 (source)
      window.DP1_STATE.lastCentroid = { lat: p.lat, lon: p.lon };
      window.DP1_STATE.selectedParcel = cad; // doit contenir section/numero/surface/etc
      window.DP1_STATE.isValidated = false;

      // ✅ rafraîchir immédiatement l’UI "Parcelle validée"
      refreshDP1ParcelleUI();

      console.log("[DP1] Cadastre recalculé", cad);
    } catch (e) {
      console.error("[DP1] Erreur API cadastre", e);
    }
  });
}
// ===============================
// DP1 — ACTION : VALIDER PARCELLE
// ===============================

const btnValidate = modal.querySelector("#dp1-map-validate");
if (btnValidate) {
  btnValidate.addEventListener("click", async () => {
    console.log("[DP1][VALIDATE] Début");

    const p = getCurrentPointWGS84();
    if (!p) {
      console.warn("[DP1][VALIDATE] Validation impossible : aucun point (marker/centre)");
      return;
    }

    if (modal.dataset.generating === "1") {
      console.warn("[DP1][VALIDATE] Génération déjà en cours, ignoré");
      return;
    }

    // Centroid = source de vérité (lat, lon), indépendant du cadastre
    window.DP1_STATE.lastCentroid = { lat: p.lat, lon: p.lon };
    window.DP1_STATE.currentPoint = { lat: p.lat, lon: p.lon };
    window.DP1_STATE.isValidated = false;

    let cad;
    try {
      cad = await fetchCadastreByPoint(p.lat, p.lon);
      window.DP1_STATE.selectedParcel = cad;
      console.log("[DP1][VALIDATE] Cadastre récupéré", cad);
    } catch (e) {
      console.error("[DP1][CADASTRE] Erreur récupération parcelle", e);
      window.DP1_STATE.selectedParcel = null;
      alert("Impossible de récupérer les données cadastrales (section, parcelle, surface).\nVérifiez que vous êtes connecté au CRM et que le backend est accessible.");
      return;
    }

    if (!cad || (!cad.section && !cad.numero)) {
      console.warn("[DP1][CADASTRE] Réponse incomplète (section/numero manquants)", cad);
      window.DP1_STATE.selectedParcel = null;
      alert("La parcelle n'a pas pu être identifiée à cet emplacement.\nDéplacez le marqueur au centre de la parcelle et réessayez.");
      return;
    }

    modal.dataset.generating = "1";

    try {
      ensureMap();
      if (!map) {
        console.warn("[DP1][VALIDATE] Carte indisponible");
        return;
      }
      const view = map.getView();
      view.setCenter(ol.proj.fromLonLat([p.lon, p.lat]));
      map.renderSync();

      await runDP1ViewGeneration();

      localStorage.setItem("dp1_parcelle", JSON.stringify({ centroid: window.DP1_STATE.lastCentroid }));
      window.DP1_STATE.isValidated = true;
      console.log("[DP1][VALIDATE] Parcelle validée et persistée");
    } catch (err) {
      console.error("[DP1][VALIDATE] Erreur", err);
    } finally {
      modal.dataset.generating = "0";
      closeModal();
    }
  });
}


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
  // Marker feature (unique) + interaction drag
let parcelleMarkerFeature = null;
let markerModify = null;

// ======================================================
// DP1 — RAFRAÎCHIR UI PARCELLE VALIDÉE (source unique : DP1_STATE.selectedParcel)
// ======================================================
function refreshDP1ParcelleUI() {
  const card = document.getElementById("dp1-parcelle-info");
  if (!card) return;

  const cad = window.DP1_STATE?.selectedParcel || null;

  const sectionEl = document.getElementById("dp1-info-section");
  const parcelleEl = document.getElementById("dp1-info-parcelle");
  const surfaceEl = document.getElementById("dp1-info-surface");

  if (!sectionEl || !parcelleEl || !surfaceEl) return;

  if (!cad) {
    sectionEl.textContent = "—";
    parcelleEl.textContent = "—";
    surfaceEl.textContent = "—";
    card.hidden = true;
    return;
  }

  const section = cad.section || "—";
  const numeroFull = [cad.section, cad.numero].filter(Boolean).join(" ").trim();
  const surfaceText = cad.surface_m2 ? `${cad.surface_m2} m²` : "—";

  sectionEl.textContent = section;
  parcelleEl.textContent = numeroFull || "—";
  surfaceEl.textContent = surfaceText;

  // afficher la carte dès qu’une parcelle est disponible
  card.hidden = false;

  console.log("🟢 UI Parcelle rafraîchie depuis DP1_STATE.selectedParcel", cad);
}

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
  const coords = ol.proj.fromLonLat([lon, lat]);

  // 1ère fois : on crée la feature
  if (!parcelleMarkerFeature) {
    parcelleMarkerFeature = new ol.Feature({
      geometry: new ol.geom.Point(coords)
    });

    parcelleMarkerFeature.setStyle(
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

    source.clear();
    source.addFeature(parcelleMarkerFeature);
    return;
  }

  // sinon : on déplace la feature existante
  parcelleMarkerFeature.getGeometry().setCoordinates(coords);
}

function enableMarkerDrag() {
  if (!map || !parcelleMarkerLayer) return;
  if (markerModify) return; // anti double bind

  markerModify = new ol.interaction.Modify({
    source: parcelleMarkerLayer.getSource(),
    pixelTolerance: 16
  });

  map.addInteraction(markerModify);

  markerModify.on("modifyend", () => {
    if (!parcelleMarkerFeature) return;

    const coords = parcelleMarkerFeature.getGeometry().getCoordinates();
    const [lon, lat] = ol.proj.toLonLat(coords);

    window.DP1_STATE.currentPoint = { lat, lon };

    if (window.DP1_STATE?.markDirty) window.DP1_STATE.markDirty();
    else window.DP1_STATE.isValidated = false;

    console.log("[DP1] Marker déplacé -> currentPoint", { lat, lon });
  });
}

// --------------------------
// Center map from lead
// Priorité : lat/lon ERPNext → fallback BAN
// --------------------------
async function centerMapFromLead() {
  if (!window.DP1_CONTEXT) return null;

  const { lat, lon, adresse, cp, ville } = window.DP1_CONTEXT;

  // ======================================================
  // 1️⃣ PRIORITÉ ABSOLUE — coordonnées ERPNext
  // ======================================================
  if (typeof lat === "number" && typeof lon === "number") {
    setParcelleMarker(lon, lat);
    return ol.proj.fromLonLat([lon, lat]);
  }

  // ======================================================
  // 2️⃣ FALLBACK — géocodage BAN (adresse)
  // ======================================================
  if (!adresse || !ville) return null;

  try {
    const q = encodeURIComponent(`${adresse} ${cp || ""} ${ville}`);
    const res = await fetch(
      `https://api-adresse.data.gouv.fr/search/?q=${q}&limit=1`
    );
    if (!res.ok) return null;

    const json = await res.json();
    if (!json.features?.length) return null;

    const [lonBan, latBan] = json.features[0].geometry.coordinates;

    setParcelleMarker(lonBan, latBan);

    return ol.proj.fromLonLat([lonBan, latBan]);
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
  enableMarkerDrag();

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
// DP1 — Génération des 3 vues (1/20000, 1/5000, 1/650) → slots dp1-view-1/2/3
// Utilisée par "Générer" et par "Valider la parcelle".
// Prérequis : map déjà centrée sur le point voulu, DP1_STATE.currentPoint à jour.
// --------------------------
async function runDP1ViewGeneration() {
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
  await waitTilesIdle(3000);
  await waitRenderComplete(1500);

  await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => setTimeout(r, 180));

  // 📸 CAPTURES
  await captureIntoSlot('[data-slot="dp1-view-3"]');
  setDP1Scale(5000);
  await waitTilesIdle(2000);
  await waitRenderComplete(1200);
  await captureIntoSlot('[data-slot="dp1-view-2"]');
  setDP1Scale(20000);
  await waitTilesIdle(2000);
  await waitRenderComplete(1200);
  await captureIntoSlot('[data-slot="dp1-view-1"]');

  setDP1Scale(650);
  if (window.DP1_UI?.setState) window.DP1_UI.setState("GENERATED");

  const viewport = map.getViewport();
  const rect = viewport.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  function fireWheel(deltaY) {
    viewport.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY,
        deltaMode: 0,
        clientX: cx,
        clientY: cy
      })
    );
  }
  fireWheel(160);
  await new Promise(r => setTimeout(r, 120));
  fireWheel(-140);
  await new Promise(r => setTimeout(r, 140));
  fireWheel(40);
  await new Promise(r => setTimeout(r, 80));
  fireWheel(-40);
  await new Promise(r => setTimeout(r, 160));

  await waitTilesIdle(3500);
  await waitRenderComplete(1800);
  await captureIntoSlot('[data-slot="dp1-view-3"]');
  if (typeof writeDP1CadastreFromCurrentPoint === "function") {
    writeDP1CadastreFromCurrentPoint();
  }
  // Rafraîchit l’UI "Parcelle validée" uniquement à partir de DP1_STATE.selectedParcel
  refreshDP1ParcelleUI();
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

  // 5bis) Snapping auto : si une parcelle est détectée depuis le point initial,
  // on repositionne le marker au centroïde avant le rendu final (UX : meilleur centrage).
  const snapped = await snapDP1MarkerToDetectedParcelCentroid();
  if (snapped) {
    const p2 = window.DP1_STATE?.currentPoint;
    if (p2 && map?.getView) {
      const view = map.getView();
      view.setCenter(ol.proj.fromLonLat([p2.lon, p2.lat]));
    }
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

// ===============================
// DP1 — Bouton "Modifier la position"
// ===============================
const editBtn = document.getElementById("dp1-parcelle-edit");
if (editBtn) {
  editBtn.addEventListener("click", () => {
    window.DP1_STATE.isValidated = false;
    openModal();
    console.log("✏️ Modification de la parcelle demandée");
  });
}


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
function initDP1_ImagePreview() {
  const preview = document.querySelector(".dp-image-preview");
  if (!preview) return;

  const previewImg = preview.querySelector("img");

  // OUVERTURE au clic sur une image DP1
  document.addEventListener("click", (e) => {
    const img = e.target.closest(".dp-generated img");
    if (!img) return;

    previewImg.src = img.src;
    preview.setAttribute("aria-hidden", "false");
    document.body.classList.add("dp-lock-scroll");
  });

  // FERMETURE au clic
  preview.addEventListener("click", () => {
    preview.setAttribute("aria-hidden", "true");
    previewImg.src = "";
    document.body.classList.remove("dp-lock-scroll");
  });

  // FERMETURE avec ESC
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      preview.setAttribute("aria-hidden", "true");
      previewImg.src = "";
      document.body.classList.remove("dp-lock-scroll");
    }
  });
}
// ======================================================
// DP1 — RÉCUPÉRATION DES 3 PLANS POUR PDF
// ======================================================
function collectDP1Images() {
  const slots = {
    view_20000: document.querySelector('[data-slot="dp1-view-1"] img'),
    view_5000: document.querySelector('[data-slot="dp1-view-2"] img'),
    view_650: document.querySelector('[data-slot="dp1-view-3"] img')
  };

  const images = {};

  for (const [key, img] of Object.entries(slots)) {
    if (!img || !img.src || !img.src.startsWith("data:image")) {
      console.warn(`DP1 image manquante ou invalide : ${key}`);
      return null;
    }
    images[key] = img.src; // data:image/png;base64,...
  }

  console.log("✅ DP1 images récupérées", images);
  return images;
}


// ======================================================
// DP1 — GÉNÉRATION PDF (COMME LE MANDAT)
// ======================================================
async function generateDP1PDF() {
  const images = collectDP1Images();
  if (!images) {
    alert("Images DP1 manquantes");
    return;
  }

  const cad = window.DP1_STATE?.selectedParcel;
  const ctx = window.DP1_CONTEXT || null;

  const dp1Data = {
    client: {
      nom: ctx ? (ctx.nom ?? "—") : "—",
      adresse: ctx ? (ctx.adresse ?? "—") : "—",
      cp: ctx ? (ctx.cp ?? "—") : "—",
      ville: ctx ? (ctx.ville ?? "—") : "—"
    },
    parcelle: {
      numero: cad
        ? [cad.section, cad.numero].filter(Boolean).join(" ")
        : "—",
      surface_m2: cad?.surface_m2 ?? null
    },
    images: {
      "20000": images.view_20000,
      "5000": images.view_5000,
      "650": images.view_650
    },
    note: "Document généré automatiquement"
  };

  const res = await fetch("http://localhost:3000/pdf/render/dp1/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dp1Data })
  });

  if (!res.ok) {
    alert("Erreur PDF DP1");
    return;
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");

  const a = document.createElement("a");
  a.href = url;
  a.download = "dp1-plan-situation.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

// ======================================================
// DP2 — ÉTATS UI (EMPTY / GENERATED) — STRICTEMENT COMME DP1
// ======================================================
function initDP2_UIStates() {
  const dp2Page = document.getElementById("dp2-page");
  if (!dp2Page) return;

  // ⚠️ DP2 contient 2 ".dp-page-actions" (header + bouton "Éditer...")
  // On cible STRICTEMENT l'action header (cohérent avec DP1).
  const actions = dp2Page.querySelector(".dp-page-head .dp-page-actions");
  if (!actions) return;

  window.DP2_UI = window.DP2_UI || {};
  window.DP2_UI.state = "EMPTY";

  window.DP2_UI.setState = function (nextState) {
    window.DP2_UI.state = nextState;

    // Bouton de téléchargement dans le MODAL DP2 (footer) :
    // - visible uniquement après capture
    // - ne ferme jamais le modal
    const modalDl = document.getElementById("dp2-modal-download");
    const modalCaptureBtn = document.getElementById("dp2-capture-btn");
    if (modalDl && modalDl.dataset.bound !== "1") {
      modalDl.dataset.bound = "1";
      modalDl.addEventListener("click", (e) => {
        e.preventDefault();
        generateDP2PDF();
      });
    }

    // ===============================
    // ÉTAT EMPTY
    // ===============================
    if (nextState === "EMPTY") {
      // Règle : bouton visible uniquement quand le plan DP2 est prêt
      actions.innerHTML = ``;
      if (modalDl) modalDl.style.display = "none";
      // Mode CAPTURE (avant plan) : on affiche le bouton "Capturer le plan"
      if (modalCaptureBtn) modalCaptureBtn.style.display = "inline-flex";
      return;
    }

    // ===============================
    // ÉTAT GENERATED
    // ===============================
    if (nextState === "GENERATED") {
      actions.innerHTML = `
        <button class="dp-btn dp-btn-primary" type="button" id="dp2-download">
          Télécharger DP2
        </button>
      `;

      const dl = document.getElementById("dp2-download");
      if (dl) {
        dl.addEventListener("click", () => {
          generateDP2PDF();
        });
      }

      if (modalDl) modalDl.style.display = "inline-flex";
      // Mode DESSIN (après capture) : le bouton "Capturer le plan" ne doit plus apparaître
      if (modalCaptureBtn) modalCaptureBtn.style.display = "none";
      return;
    }
  };

  // état initial (si capture déjà faite, on affiche le bouton)
  if (window.DP2_STATE?.capture?.imageBase64) {
    window.DP2_UI.setState("GENERATED");
  } else {
    window.DP2_UI.setState("EMPTY");
  }
}

// ======================================================
// DP4 — ÉTATS UI (DOWNLOAD PDF) — PATTERN DP1/DP2
// Règle : bouton visible uniquement si au moins 1 rendu final existe.
// ======================================================
function initDP4_UIStates() {
  const dp4Page = document.getElementById("dp4-page");
  if (!dp4Page) return;

  const actions = dp4Page.querySelector(".dp-page-head .dp-page-actions");
  if (!actions) return;

  window.DP4_UI = window.DP4_UI || {};
  window.DP4_UI.state = "EMPTY";

  window.DP4_UI.setState = function setState(nextState) {
    window.DP4_UI.state = nextState;

    const beforeFinal = typeof dp4GetFinalRenderFor === "function" ? dp4GetFinalRenderFor("before") : null;
    const afterFinal = typeof dp4GetFinalRenderFor === "function" ? dp4GetFinalRenderFor("after") : null;
    const ready =
      !!(beforeFinal && typeof beforeFinal.imageBase64 === "string" && beforeFinal.imageBase64.startsWith("data:image")) ||
      !!(afterFinal && typeof afterFinal.imageBase64 === "string" && afterFinal.imageBase64.startsWith("data:image"));

    if (!ready) {
      actions.innerHTML = ``;
      return;
    }

    actions.innerHTML = `
      <button class="dp-btn dp-btn-primary" type="button" id="dp4-download">
        Télécharger DP4
      </button>
    `;

    const dl = document.getElementById("dp4-download");
    if (dl) {
      dl.addEventListener("click", (e) => {
        e.preventDefault();
        generateDP4PDF();
      });
    }
  };

  // état initial
  window.DP4_UI.setState("AUTO");
}

// ======================================================
// DP2 — IMAGE FINALE (fond capture + overlay canvas)
// - 1 seule image base64 envoyée au backend (images.plan)
// ======================================================
async function collectDP2FinalPlanImage() {
  const imgEl = document.getElementById("dp2-captured-image");
  const overlayCanvas = document.getElementById("dp2-draw-canvas");

  if (!window.DP2_STATE?.capture?.imageBase64) {
    console.warn("[DP2 PDF] capture absente");
    return null;
  }

  if (!imgEl || !imgEl.src || !imgEl.src.startsWith("data:image")) {
    console.warn("[DP2 PDF] image de fond DP2 absente/invalide");
    return null;
  }

  if (!overlayCanvas || overlayCanvas.width <= 0 || overlayCanvas.height <= 0) {
    console.warn("[DP2 PDF] canvas overlay DP2 absent/invalide");
    return null;
  }

  // Forcer un dernier rendu si une fonction de rendu existe (sans refactor)
  if (typeof window.renderDP2FromState === "function") {
    try { window.renderDP2FromState(); } catch (_) {}
  } else if (typeof renderDP2FromState === "function") {
    try { renderDP2FromState(); } catch (_) {}
  }

  // Offscreen = buffer final (dimensions natives)
  const out = document.createElement("canvas");
  const w = imgEl.naturalWidth || overlayCanvas.width;
  const h = imgEl.naturalHeight || overlayCanvas.height;
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(imgEl, 0, 0, w, h);
  ctx.drawImage(overlayCanvas, 0, 0, w, h);

  return out.toDataURL("image/png");
}

// ======================================================
// PDF — CLIENT (SOURCE UNIQUE = DP1_CONTEXT) — DP2/DP3
// Objectif : DP3 lit EXACTEMENT comme DP2 (data.client.*)
// ======================================================
function buildPdfClientFromDP1Context() {
  const ctx = window.DP1_CONTEXT || null;
  return {
    nom: ctx ? (ctx.nom ?? "—") : "—",
    adresse: ctx ? (ctx.adresse ?? "—") : "—",
    cp: ctx ? (ctx.cp ?? "—") : "—",
    ville: ctx ? (ctx.ville ?? "—") : "—"
  };
}

// ======================================================
// DP2 — GÉNÉRATION PDF (COPIE DP1)
// ======================================================
async function generateDP2PDF() {
  const plan = await collectDP2FinalPlanImage();
  if (!plan) {
    alert("Image DP2 manquante");
    return;
  }

  const cad = window.DP1_STATE?.selectedParcel;

  const categoryRaw = window.DP2_STATE?.photoCategory ?? null;
  const categoryLabel =
    categoryRaw === "before"
      ? "Avant travaux"
      : categoryRaw === "after"
        ? "Après travaux"
        : "—";

  const scale = window.DP2_STATE?.scale_m_per_px;
  const scaleLabel =
    typeof scale === "number" && scale > 0
      ? `${scale.toFixed(3)} m / px`
      : "—";

  const model = window.DP2_STATE?.panelModel ?? null;
  const panels = window.DP2_STATE?.panels || [];
  let panelCount = 0;
  for (const p of panels) {
    if (p && p.type === "panel" && p.visible === true) panelCount++;
  }

  const modulePv = model
    ? {
      manufacturer: model.manufacturer || "—",
      reference: model.reference || "—",
      power_w: model.power_w != null ? `${model.power_w} W` : "—",
      dimensions:
        model.width_m != null && model.height_m != null
          ? `${model.width_m} m × ${model.height_m} m`
          : "—",
      count: panelCount
    }
    : {
      manufacturer: "—",
      reference: "—",
      power_w: "—",
      dimensions: "—",
      count: panelCount
    };

  const legend =
    typeof window.getDP2GlobalLegendForPdf === "function"
      ? (window.getDP2GlobalLegendForPdf() || [])
      : [];

  const dp2Data = {
    client: buildPdfClientFromDP1Context(),
    parcelle: {
      numero: cad
        ? [cad.section, cad.numero].filter(Boolean).join(" ")
        : "—",
      surface_m2: cad?.surface_m2 ?? null
    },
    dp2: {
      category: categoryLabel,
      scale: scaleLabel,
      modulePv,
      legend
    },
    images: {
      plan
    },
  };

  const res = await fetch("http://localhost:3000/pdf/render/dp2/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dp2Data })
  });

  if (!res.ok) {
    alert("Erreur PDF DP2");
    return;
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");

  const a = document.createElement("a");
  a.href = url;
  a.download = "dp2-plan-masse.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

// ======================================================
// DP4 — GÉNÉRATION PDF (PIPELINE IDENTIQUE DP2/DP3)
// - Source image : DP4_FINAL_RENDER_V1 (rendu final stocké)
// - 1 ou 2 pages (before / after)
// ======================================================
async function generateDP4PDF() {
  // A) Charger l’état DP4 complet (DP4_STATE_V1) (2 plans)
  try { dp4EnsureStateLoadedOnce(); } catch (_) {}

  const dp4State = window.DP4_STATE || null;
  const cad = window.DP1_STATE?.selectedParcel;

  // B) Charger DP4_FINAL_RENDER_V1 (rendus finaux)
  const beforeFinal = typeof dp4GetFinalRenderFor === "function" ? dp4GetFinalRenderFor("before") : null;
  const afterFinal = typeof dp4GetFinalRenderFor === "function" ? dp4GetFinalRenderFor("after") : null;

  const pages = [];

  function hasLineTypeInRoofGeometry(plan, type) {
    const arr = Array.isArray(plan?.roofGeometry) ? plan.roofGeometry : [];
    for (const o of arr) {
      if (o && o.type === type) return true;
    }
    return false;
  }

  function computeBaseLegendFromPlan(plan) {
    // Réutiliser au maximum la logique DP2 :
    // - base via window.getDP2GlobalLegendForPdf() si disponible
    // - sinon fallback local (mêmes clés/règles)
    // Format DP4 demandé : [{ key, count }, ...]

    // 1) Base via getDP2GlobalLegendForPdf() (sans effets de bord)
    const getLegend = window.getDP2GlobalLegendForPdf;
    if (typeof getLegend === "function") {
      const hadDP2State = !!window.DP2_STATE;
      const prevBiz = window.DP2_STATE?.businessObjects;
      const prevPanels = window.DP2_STATE?.panels;
      try {
        if (!window.DP2_STATE) window.DP2_STATE = {};
        window.DP2_STATE.businessObjects = Array.isArray(plan?.businessObjects) ? plan.businessObjects : [];
        window.DP2_STATE.panels = Array.isArray(plan?.panels) ? plan.panels : [];

        const base = getLegend() || [];
        const normalized = Array.isArray(base)
          ? base
              .map((it) => ({
                key: it?.legendKey,
                count: typeof it?.count === "number" ? it.count : 0,
              }))
              .filter((it) => !!it.key)
          : [];

        if (normalized.length) return normalized;
      } catch (_) {
        // ignore (fallback ci-dessous)
      } finally {
        try { if (!window.DP2_STATE) window.DP2_STATE = {}; } catch (_) {}
        try { window.DP2_STATE.businessObjects = prevBiz; } catch (_) {}
        try { window.DP2_STATE.panels = prevPanels; } catch (_) {}
        if (!hadDP2State) {
          try { delete window.DP2_STATE; } catch (_) { window.DP2_STATE = undefined; }
        }
      }
    }

    // 2) Fallback local
    const counts = {};

    const business = Array.isArray(plan?.businessObjects) ? plan.businessObjects : [];
    for (const obj of business) {
      if (!obj || obj.visible !== true) continue;
      if (!obj.legendKey) continue;
      counts[obj.legendKey] = (counts[obj.legendKey] || 0) + 1;
    }

    const panels = Array.isArray(plan?.panels) ? plan.panels : [];
    let panelCount = 0;
    for (const p of panels) {
      if (p && p.type === "panel" && p.visible === true) panelCount++;
    }
    if (panelCount > 0) counts["PANNEAUX_PV"] = panelCount;

    const orderedKeys = [];
    try {
      if (Array.isArray(DP2_BUSINESS_OBJECT_TYPES_ORDER) && DP2_BUSINESS_OBJECT_META) {
        for (const t of DP2_BUSINESS_OBJECT_TYPES_ORDER) {
          const k = DP2_BUSINESS_OBJECT_META?.[t]?.legendKey;
          if (k && counts[k]) orderedKeys.push(k);
        }
      }
    } catch (_) {}

    if (panelCount > 0) orderedKeys.push("PANNEAUX_PV");

    for (const k of Object.keys(counts)) {
      if (!orderedKeys.includes(k)) orderedKeys.push(k);
    }

    return orderedKeys.map((key) => ({ key, count: counts[key] || 0 }));
  }

  function addLegendExtras(baseLegend, plan) {
    const legend = Array.isArray(baseLegend) ? [...baseLegend] : [];
    if (hasLineTypeInRoofGeometry(plan, "measure_line")) {
      legend.push({ key: "COTES", count: 1 });
    }
    if (hasLineTypeInRoofGeometry(plan, "ridge_line")) {
      legend.push({ key: "FAITAGE", count: 1 });
    }
    return legend;
  }

  function getScaleMPerPx(plan) {
    const s =
      plan?.capture?.scale_m_per_px ??
      dp4State?.plans?.[plan?.photoCategory]?.capture?.scale_m_per_px ??
      dp4State?.capture?.scale_m_per_px ??
      null;
    return (typeof s === "number" && Number.isFinite(s) && s > 0) ? s : null;
  }

  function getImageNaturalHeight(src) {
    return new Promise((resolve) => {
      if (!(typeof src === "string" && src.startsWith("data:image"))) return resolve(0);
      const img = new Image();
      img.onload = () => resolve(img.naturalHeight || 0);
      img.onerror = () => resolve(0);
      img.src = src;
    });
  }

  async function buildPage(category, label, finalObj) {
    const plan = dp4State?.plans?.[category] || null;
    const planImageBase64 = finalObj?.imageBase64 || null;
    if (!plan || !(typeof planImageBase64 === "string" && planImageBase64.startsWith("data:image"))) return null;

    const scale_m_per_px = getScaleMPerPx(plan);
    const imgH = await getImageNaturalHeight(planImageBase64);
    const viewHeightMetersRaw = (typeof imgH === "number" && imgH > 0 && scale_m_per_px) ? imgH * scale_m_per_px : null;
    const viewHeightMeters =
      typeof viewHeightMetersRaw === "number" && Number.isFinite(viewHeightMetersRaw)
        ? Math.round(viewHeightMetersRaw * 10) / 10
        : null;

    const baseLegend = computeBaseLegendFromPlan(plan);
    const legend = addLegendExtras(baseLegend, plan);

    return {
      category,
      label,
      planImageBase64,
      roofType: plan.roofType ?? null,
      panelModel: plan.panelModel ?? null,
      viewHeightMeters,
      legend
    };
  }

  // C) Construire pages[] (before/after)
  if (beforeFinal) {
    const p = await buildPage("before", "Avant travaux", beforeFinal);
    if (p) pages.push(p);
  }
  if (afterFinal) {
    const p = await buildPage("after", "Après travaux", afterFinal);
    if (p) pages.push(p);
  }

  if (!pages.length) {
    alert("DP4 : aucun rendu final trouvé (DP4_FINAL_RENDER_V1). Validez au moins un plan (Avant/Après).");
    return;
  }

  const dp4Data = {
    meta: {
      generatedAt: new Date().toISOString(),
      titleBase: "DP4 – Plan de toiture",
    },
    client: buildPdfClientFromDP1Context(),
    parcel: {
      numero: cad ? [cad.section, cad.numero].filter(Boolean).join(" ") : "—",
      surface_m2: cad?.surface_m2 ?? null
    },
    pages
  };

  // D) POST vers backend (pattern DP2/DP3)
  const res = await fetch("http://localhost:3000/pdf/render/dp4/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dp4Data })
  });

  if (!res.ok) {
    alert("Erreur PDF DP4");
    return;
  }

  // E) Download blob
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");

  const a = document.createElement("a");
  a.href = url;

  const hasBefore = pages.some((p) => p.category === "before");
  const hasAfter = pages.some((p) => p.category === "after");
  if (hasBefore && hasAfter) {
    a.download = "DP4_Plan_de_toiture_Avant_Apres.pdf";
  } else if (hasBefore) {
    a.download = "DP4_Plan_de_toiture_Avant.pdf";
  } else {
    a.download = "DP4_Plan_de_toiture_Apres.pdf";
  }

  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

// --------------------------
// DP2 — STATE GLOBAL (source de vérité unique)
// --------------------------
// Catalogue PV (DP2) — en dur, prêt pour la légende PDF plus tard
const DP2_PANEL_CATALOG = {
  longi_x10_artist: {
    manufacturer: "LONGi Solar",
    reference: "LR7-54HVB-485M",
    power_w: 485,
    width_m: 1.134,
    height_m: 1.800
  },
  longi_x10_explorer: {
    manufacturer: "LONGi Solar",
    reference: "LR7-54HVH-485M",
    power_w: 485,
    width_m: 1.134,
    height_m: 1.800
  }
};

// --------------------------
// DP2 — FORMES MÉTIER (ÉTAPE 6)
// Outils contrôlés : pas de dessin libre, objets normalisés pour la légende PDF.
// --------------------------
const DP2_BUSINESS_OBJECT_META = {
  // IMPORTANT : types et legendKey figés (ne pas modifier)
  compteur: { legendKey: "COMPTEUR_ELECTRIQUE", label: "Compteur électrique", icon: "🔌", defaultW: 80, defaultH: 50 },
  disjoncteur: { legendKey: "DISJONCTEUR", label: "Disjoncteur", icon: "⛔", defaultW: 80, defaultH: 50 },
  batterie: { legendKey: "BATTERIE_STOCKAGE", label: "Batterie de stockage", icon: "🔋", defaultW: 90, defaultH: 55 },
  sens_pente: { legendKey: "SENS_PENTE", label: "Sens de la pente", icon: "↘", defaultW: 90, defaultH: 50 },
  voie_acces: { legendKey: "VOIE_ACCES", label: "Voie d’accès", icon: "🛣", defaultW: 140, defaultH: 40 },
  angle_vue: { legendKey: "ANGLE_PRISE_VUE", label: "Angle de prise de vue", icon: "📷", defaultW: 110, defaultH: 80 },
  nord: { legendKey: "NORD", label: "Flèche Nord", icon: "🧭", defaultW: 70, defaultH: 90 },
  rect: { legendKey: "ANNOTATION_RECTANGLE", label: "Rectangle libre", icon: "▭", defaultW: 120, defaultH: 70 },
  circle: { legendKey: "ANNOTATION_CERCLE", label: "Cercle libre", icon: "◯", defaultW: 90, defaultH: 90 },
  triangle: { legendKey: "ANNOTATION_TRIANGLE", label: "Triangle libre", icon: "△", defaultW: 100, defaultH: 90 },
  arrow: { legendKey: "ANNOTATION_FLECHE", label: "Flèche libre", icon: "➤", defaultW: 120, defaultH: 50 }
};

const DP2_BUSINESS_OBJECT_TYPES_ORDER = [
  "compteur",
  "disjoncteur",
  "batterie",
  "sens_pente",
  "voie_acces",
  "angle_vue",
  "nord",
  "rect",
  "circle",
  "triangle",
  "arrow"
];

// Map d'affichage : legendKey -> { type, meta }
// (aucune logique de détection ici ; seulement un mapping pour retrouver le type depuis legendKey)
const DP2_BUSINESS_LEGEND_BY_KEY = (() => {
  const map = {};
  for (const type of Object.keys(DP2_BUSINESS_OBJECT_META || {})) {
    const meta = DP2_BUSINESS_OBJECT_META[type];
    if (meta && meta.legendKey) map[meta.legendKey] = { type, meta };
  }
  return map;
})();

window.DP2_STATE = window.DP2_STATE || {
  mode: "CAPTURE",        // "CAPTURE" | "EDITION"
  scale_m_per_px: null,   // valeur figée après capture (utiliser scale_m_per_px)
  orientation: "N",
  backgroundImage: null,  // { src, width, height } - indépendant du canvas
  objects: [],            // tableau d'objets à dessiner (source de vérité unique)
  // Contours de bâti — DP2 et DP4 : source unique = buildingContours (jamais building_outline dans objects)
  // Structure recommandée :
  // buildingContours = [{ id, points:[{x,y}], closed:boolean, cuts?:object }, ...]
  buildingContours: [],
  selectedBuildingContourId: null,  // id string (DP2_STATE.buildingContours)
  buildingContourInteraction: null, // état interne drag d'un sommet (non sérialisé)
  lineVertexInteraction: null,       // drag sommet faitage ou mesure (objectIndex, anchor "A"|"B")
  disjoncteurScale: 1,               // Sécurité DP2 disjoncteur — facteur de taille du symbole (sans UI)
  // Panneaux PV (calepinage simple) — stockage dédié (modèle imposé)
  panels: [],
  // Textes (annotations) — stockage dédié (modèle imposé)
  textObjects: [],
  history: [],            // historique pour undo/redo
  currentTool: "select",  // "select" | "pan" | "building_outline" | "measure_line" | "ridge_line"
  selectedObjectId: null, // index dans objects[] pour sélection visuelle uniquement
  selectedPanelId: null,  // id string (DP2_STATE.panels)
  selectedPanelIds: [],   // multi-sélection temporaire (panneaux uniquement)
  selectedTextId: null,   // id string (DP2_STATE.textObjects)
  selectedTextIds: [],    // multi-sélection temporaire (textes uniquement)
  drawingPreview: null,   // { from: {x,y}, to: {x,y}, lengthM: number, isClosing?: boolean, previewType?: "building_outline"|"measure_line"|"ridge_line" } — segment temporaire (non stocké dans objects[])
  // Formes métier (ÉTAPE 6) — objets normalisés (modèle imposé)
  businessObjects: [],            // tableau d'objets métier
  selectedBusinessObjectId: null, // id string (pas un index)
  businessInteraction: null,      // état interne drag/resize/rotate (non sérialisé)
  pvPanelInteraction: null,       // état interne drag/rotate des panneaux PV (non sérialisé)
  panelInteraction: null,         // état interne drag/rotate des panneaux PV (nouveau modèle)
  panelGroupInteraction: null,    // état interne drag/rotate groupé des panneaux (non sérialisé)
  textInteraction: null,          // état interne drag/resize/rotate/create des textes (non sérialisé)
  selectionRect: null,            // rubber-band rect (non sérialisé)
  _lastSelectionRectAt: 0,        // timestamp pour ignorer le click après lasso
  _lastPvPanelInteractionAt: 0,   // timestamp pour ignorer le click "pose" après drag/rotate
  _lastTextInteractionAt: 0,      // timestamp pour ignorer le click après drag/rotate texte
  _lastBuildingContourInteractionAt: 0, // timestamp pour ignorer le click après drag de sommet
  _businessKeyHandlerBound: false,
  // Métadonnées (passives) — pour la légende PDF DP2 (sans génération PDF ici)
  photoCategory: null,    // "before" | "after" | null
  panelModel: null,       // objet du catalogue (DP2_PANEL_CATALOG[...]) ou null
  // Zoom visuel uniquement (affichage image + canvas, sans modifier scale_m_per_px ni les mesures)
  viewZoom: 1,            // facteur d'affichage 0.5 → 3
  viewPanX: 0,            // translation visuelle du plan (pan, px) — purement visuel
  viewPanY: 0,
  // Trait de mesure en cours : point A posé, en attente du clic B
  measureLineStart: null, // { x, y } | null
  // Faîtage en cours : point A posé, en attente du clic B
  ridgeLineStart: null    // { x, y } | null
};

function isDP2BusinessTool(tool) {
  return !!(tool && DP2_BUSINESS_OBJECT_META[tool]);
}

function isDP2TextTool(tool) {
  return tool === "text_free" || tool === "text_DP6" || tool === "text_DP7" || tool === "text_DP8";
}

const DP2_TEXT_MIN_W_PX = 40;
const DP2_TEXT_MIN_H_PX = 20;
const DP2_TEXT_DEFAULT_FONT_SIZE = 16;

// --------------------------
// DP2 — UX : RESET OUTIL ACTIF (neutre)
// - Objectif : aucun outil métier ne reste actif hors contexte de création
// - Contraintes : ne pas toucher au moteur canvas / modèle de données (on ne fait que changer l'état courant)
// --------------------------
function dp2ResetActiveToolToNeutral(options) {
  const opts = options || {};
  const preserveSelection = opts.preserveSelection === true;
  const state = window.DP2_STATE;
  if (!state) return;
  // Ne jamais interrompre un contour bâti ouvert (workflow contrôlé)
  if (typeof hasDP2OpenBuildingOutline === "function" && hasDP2OpenBuildingOutline()) return;

  // Cancel propre d'une création métier "au clic" (objet temporaire ajouté au pointerdown)
  const inter = state.businessInteraction || null;
  const pvInter = state.pvPanelInteraction || null;
  const panelInter = state.panelInteraction || null;
  const textInter = state.textInteraction || null;
  // Annuler toute interaction pointer en cours (drag/resize/rotate/create)
  // Important : évite de laisser un "outil armé" via pointer capture.
  if (inter && typeof inter.pointerId === "number") {
    const canvas = document.getElementById("dp2-draw-canvas");
    if (canvas && typeof canvas.releasePointerCapture === "function") {
      try { canvas.releasePointerCapture(inter.pointerId); } catch (_) {}
    }
  }
  if (pvInter && typeof pvInter.pointerId === "number") {
    const canvas = document.getElementById("dp2-draw-canvas");
    if (canvas && typeof canvas.releasePointerCapture === "function") {
      try { canvas.releasePointerCapture(pvInter.pointerId); } catch (_) {}
    }
  }
  if (panelInter && typeof panelInter.pointerId === "number") {
    const canvas = document.getElementById("dp2-draw-canvas");
    if (canvas && typeof canvas.releasePointerCapture === "function") {
      try { canvas.releasePointerCapture(panelInter.pointerId); } catch (_) {}
    }
  }
  if (textInter && typeof textInter.pointerId === "number") {
    const canvas = document.getElementById("dp2-draw-canvas");
    if (canvas && typeof canvas.releasePointerCapture === "function") {
      try { canvas.releasePointerCapture(textInter.pointerId); } catch (_) {}
    }
  }
  if (inter && inter.part === "create" && inter.id) {
    const items = state.businessObjects || [];
    const idx = items.findIndex((o) => o && o.id === inter.id);
    if (idx >= 0 && inter.hasMoved !== true) {
      items.splice(idx, 1);
      if (state.selectedBusinessObjectId === inter.id) state.selectedBusinessObjectId = null;
    }
  }

  // Purge des états d'interaction (ne doit pas survivre à un reset)
  state.businessInteraction = null;
  state.pvPanelInteraction = null;
  state.panelInteraction = null;
  state.panelGroupInteraction = null;
  state.textInteraction = null;
  state.drawingPreview = null;
  state.selectionRect = null;
  state.measureLineStart = null;
  state.ridgeLineStart = null;
  state.panelPlacementPreview = null;

  if (!preserveSelection) {
    state.selectedBusinessObjectId = null;
    state.selectedPanelId = null;
    state.selectedPanelIds = [];
    state.selectedTextId = null;
    state.selectedTextIds = [];
    state.selectedObjectId = null;
    state.selectedBuildingContourId = null;
  }

  // Mode neutre : on force le tool à null, et les handlers canvas retombent sur "select"
  state.currentTool = null;

  // UI : afficher "Sélection" comme mode actif (SIG/CAO-style), fermer les menus dropdown.
  const toolbar = document.getElementById("dp2-toolbar");
  if (toolbar) {
    toolbar.querySelectorAll(".dp2-tool-btn").forEach((btn) => {
      btn.classList.remove("dp2-tool-active");
      btn.setAttribute("aria-pressed", "false");
    });
  }
  const selectBtn = document.getElementById("dp2-tool-select");
  if (selectBtn) {
    selectBtn.classList.add("dp2-tool-active");
    selectBtn.setAttribute("aria-pressed", "true");
  }

  const measuresBtn = document.getElementById("dp2-tool-measures");
  const measuresMenu = document.getElementById("dp2-measures-menu");
  if (measuresBtn) {
    measuresBtn.classList.remove("dp2-dropdown-open");
    measuresBtn.setAttribute("aria-expanded", "false");
  }
  if (measuresMenu) measuresMenu.hidden = true;
  const measuresIconEl = measuresBtn?.querySelector?.(".dp2-tool-icon") || null;
  const measuresLabelEl = measuresBtn?.querySelector?.(".dp2-tool-label") || null;
  if (measuresIconEl) measuresIconEl.textContent = "📐";
  if (measuresLabelEl) measuresLabelEl.textContent = "Mesures";

  const businessBtn = document.getElementById("dp2-tool-business");
  const businessMenu = document.getElementById("dp2-business-menu");
  if (businessBtn) {
    businessBtn.classList.remove("dp2-dropdown-open");
    businessBtn.setAttribute("aria-expanded", "false");
  }
  if (businessMenu) businessMenu.hidden = true;
  const businessIconEl = businessBtn?.querySelector?.(".dp2-tool-icon") || null;
  const businessLabelEl = businessBtn?.querySelector?.(".dp2-tool-label") || null;
  if (businessIconEl) businessIconEl.textContent = "⬚";
  if (businessLabelEl) businessLabelEl.textContent = "Formes métier";

  const textBtn = document.getElementById("dp2-tool-text");
  const textMenu = document.getElementById("dp2-text-menu");
  if (textBtn) {
    textBtn.classList.remove("dp2-dropdown-open");
    textBtn.setAttribute("aria-expanded", "false");
  }
  if (textMenu) textMenu.hidden = true;
  const textIconEl = textBtn?.querySelector?.(".dp2-tool-icon") || null;
  const textLabelEl = textBtn?.querySelector?.(".dp2-tool-label") || null;
  if (textIconEl) textIconEl.textContent = "T";
  if (textLabelEl) textLabelEl.textContent = "Texte";

  // Curseur pan éventuel sur le wrap (déplacement visuel uniquement)
  const imgWrap = document.getElementById("dp2-captured-image-wrap");
  if (imgWrap) imgWrap.classList.remove("dp2-tool-pan");

  if (typeof renderDP2FromState === "function") renderDP2FromState();
}

function createDP2BusinessObject(type, geometry) {
  const meta = DP2_BUSINESS_OBJECT_META[type];
  if (!meta) {
    console.warn("[DP2] Type métier inconnu :", type);
    return null;
  }
  const g = geometry || {};
  const id = "biz_" + Date.now() + "_" + Math.random().toString(16).slice(2);
  return {
    id,
    type,
    legendKey: meta.legendKey,
    geometry: {
      x: typeof g.x === "number" ? g.x : 0,
      y: typeof g.y === "number" ? g.y : 0,
      width: typeof g.width === "number" ? g.width : (meta.defaultW || 80),
      height: typeof g.height === "number" ? g.height : (meta.defaultH || 50),
      rotation: typeof g.rotation === "number" ? g.rotation : 0
    },
    visible: true
  };
}

function createDP2TextObject(textKind, content, geometry, fontSize) {
  const g = geometry || {};
  const id = "text_" + Date.now() + "_" + Math.random().toString(16).slice(2);
  return {
    id,
    type: "text",
    textKind: textKind === "DP6" || textKind === "DP7" || textKind === "DP8" ? textKind : "free",
    content: typeof content === "string" ? content : "",
    geometry: {
      x: typeof g.x === "number" ? g.x : 0,
      y: typeof g.y === "number" ? g.y : 0,
      width: typeof g.width === "number" ? g.width : DP2_TEXT_MIN_W_PX,
      height: typeof g.height === "number" ? g.height : DP2_TEXT_MIN_H_PX,
      rotation: typeof g.rotation === "number" ? g.rotation : 0
    },
    fontSize: typeof fontSize === "number" && fontSize > 0 ? fontSize : DP2_TEXT_DEFAULT_FONT_SIZE,
    visible: true
  };
}

// Légende globale (PDF) — format validé : [{ legendKey, count }, ...]
// Scope validé : uniquement les objets "formes métier" (businessObjects).
window.getDP2GlobalLegendForPdf = function getDP2GlobalLegendForPdf() {
  const items = window.DP2_STATE?.businessObjects || [];
  const counts = {};
  for (const obj of items) {
    if (!obj || obj.visible !== true) continue;
    if (!obj.legendKey) continue;
    counts[obj.legendKey] = (counts[obj.legendKey] || 0) + 1;
  }
  // Panneaux PV (DP2_STATE.panels) — clé globale (overlay)
  const panels = window.DP2_STATE?.panels || [];
  let panelCount = 0;
  for (const p of panels) {
    if (p && p.type === "panel" && p.visible === true) panelCount++;
  }
  if (panelCount > 0) {
    counts["PANNEAUX_PV"] = panelCount;
  }
  // Ordonner de façon stable selon l'ordre officiel des types
  const orderedKeys = [];
  for (const t of DP2_BUSINESS_OBJECT_TYPES_ORDER) {
    const k = DP2_BUSINESS_OBJECT_META[t]?.legendKey;
    if (k && counts[k]) orderedKeys.push(k);
  }
  if (panelCount > 0) orderedKeys.push("PANNEAUX_PV");
  // Ajouter d'éventuelles clés restantes (fallback)
  for (const k of Object.keys(counts)) {
    if (!orderedKeys.includes(k)) orderedKeys.push(k);
  }
  return orderedKeys.map((legendKey) => ({ legendKey, count: counts[legendKey] || 0 }));
};

function syncDP2LegendOverlayUI() {
  const listEl = document.getElementById("dp2-legend-list");
  const emptyEl = document.getElementById("dp2-legend-empty");
  if (!listEl) return; // DP2 pas monté

  // DP2 : la légende n'est utile que quand l'overlay d'édition DP2 est ouvert
  const modal = document.getElementById("dp2-map-modal");
  if (modal && modal.getAttribute("aria-hidden") === "true") return;

  // Stocker la signature sur un host stable (modal si possible)
  const host = modal || listEl;

  const getLegend = window.getDP2GlobalLegendForPdf;
  const legendItems = typeof getLegend === "function" ? (getLegend() || []) : [];

  // Signature stable pour éviter de re-rendre sur chaque renderDP2FromState (mousemove, etc.)
  const signature = Array.isArray(legendItems)
    ? legendItems.map((it) => `${it?.legendKey || ""}:${typeof it?.count === "number" ? it.count : 0}`).join("|")
    : "invalid";
  if (host.dataset && host.dataset.dp2LegendSig === signature) return;
  if (host.dataset) host.dataset.dp2LegendSig = signature;

  if (!Array.isArray(legendItems) || legendItems.length === 0) {
    // Reset
    listEl.innerHTML = "";
    if (emptyEl) emptyEl.hidden = false;
    return;
  }
  if (emptyEl) emptyEl.hidden = true;

  // Reset
  listEl.innerHTML = "";

  for (const item of legendItems) {
    const legendKey = item?.legendKey;
    const count = typeof item?.count === "number" ? item.count : 0;
    if (!legendKey) continue;

    const entry = DP2_BUSINESS_LEGEND_BY_KEY[legendKey] || null;
    const type = entry?.type || null;
    const meta = entry?.meta || null;
    const label =
      legendKey === "PANNEAUX_PV"
        ? "Panneaux photovoltaïques"
        : (meta?.label || String(legendKey));

    const row = document.createElement("div");
    row.className = "dp2-legend-row";

    // Miniature : rendu EXACT via la même fonction canvas que le plan (1 seule implémentation graphique)
    const miniWrap = document.createElement("div");
    miniWrap.className = "dp2-legend-mini";
    const miniCanvas = document.createElement("canvas");
    miniCanvas.className = "dp2-legend-mini-canvas";
    // Taille interne (buffer) : un peu plus grande que le CSS pour netteté
    miniCanvas.width = 104;
    miniCanvas.height = 68;
    miniCanvas.setAttribute("aria-hidden", "true");
    miniWrap.appendChild(miniCanvas);

    const labelEl = document.createElement("span");
    labelEl.className = "dp2-legend-label";
    labelEl.textContent = label;

    const countEl = document.createElement("span");
    countEl.className = "dp2-legend-count";
    countEl.textContent = count > 1 ? `×${count}` : "";

    row.appendChild(miniWrap);
    row.appendChild(labelEl);
    row.appendChild(countEl);
    listEl.appendChild(row);

    // Dessiner la miniature (après insertion DOM ok aussi, mais pas requis)
    try {
      const ctx = miniCanvas.getContext("2d");
      if (!ctx) continue;
      ctx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
      if (legendKey === "PANNEAUX_PV") {
        const bw = 90;
        const bh = 55;
        const pad = 10;
        const scale = Math.max(0.01, Math.min((miniCanvas.width - pad * 2) / bw, (miniCanvas.height - pad * 2) / bh));
        const dx = (miniCanvas.width - bw * scale) / 2;
        const dy = (miniCanvas.height - bh * scale) / 2;
        ctx.save();
        ctx.translate(dx, dy);
        ctx.scale(scale, scale);
        renderDP2PanelRect(ctx, { x: 0, y: 0, width: bw, height: bh, rotation: 0 }, DP2_PANEL_STYLE);
        ctx.restore();
        continue;
      }

      if (typeof renderDP2BusinessObject !== "function") continue;
      if (!type || !meta) continue;

      const bw = meta.defaultW || 80;
      const bh = meta.defaultH || 50;
      const pad = 10;
      const scale = Math.max(0.01, Math.min((miniCanvas.width - pad * 2) / bw, (miniCanvas.height - pad * 2) / bh));
      const dx = (miniCanvas.width - bw * scale) / 2;
      const dy = (miniCanvas.height - bh * scale) / 2;

      ctx.save();
      ctx.translate(dx, dy);
      ctx.scale(scale, scale);
      const dummy = {
        id: "legend_dummy",
        type,
        legendKey,
        geometry: { x: 0, y: 0, width: bw, height: bh, rotation: 0 },
        visible: true
      };
      renderDP2BusinessObject(ctx, dummy);
      ctx.restore();
    } catch (_) {}
  }
}

let dp2ToastTimer = null;
function showDP2Toast(message) {
  const toolbar = document.getElementById("dp2-toolbar");
  if (!toolbar) return;

  let el = toolbar.querySelector(".dp2-toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "dp2-toast";
    toolbar.appendChild(el);
  }

  el.textContent = message;

  if (dp2ToastTimer) clearTimeout(dp2ToastTimer);
  dp2ToastTimer = setTimeout(() => {
    try { el.remove(); } catch (_) {}
  }, 2600);
}

function syncDP2PanelMetadataUI() {
  const manufacturerEl = document.getElementById("dp2-panel-manufacturer");
  const referenceEl = document.getElementById("dp2-panel-reference");
  const powerEl = document.getElementById("dp2-panel-power");
  const dimensionsEl = document.getElementById("dp2-panel-dimensions");

  if (!manufacturerEl || !referenceEl || !powerEl || !dimensionsEl) return;

  const model = window.DP2_STATE?.panelModel || null;

  if (!model) {
    manufacturerEl.textContent = "—";
    referenceEl.textContent = "—";
    powerEl.textContent = "—";
    dimensionsEl.textContent = "—";
    return;
  }

  manufacturerEl.textContent = model.manufacturer || "—";
  referenceEl.textContent = model.reference || "—";
  powerEl.textContent = typeof model.power_w === "number" ? `${model.power_w} Wc` : "—";

  const h = typeof model.height_m === "number" ? model.height_m.toFixed(2) : null;
  const w = typeof model.width_m === "number" ? model.width_m.toFixed(2) : null;
  dimensionsEl.textContent = h && w ? `${h} × ${w} m` : "—";
}

function initDP2MetadataUI() {
  // Catégorie Avant / Après (DP2)
  const photoCategorySelect = document.getElementById("dp2-photo-category");
  if (photoCategorySelect) {
    // sync état -> UI si déjà défini
    if (window.DP2_STATE?.photoCategory != null && photoCategorySelect.value !== window.DP2_STATE.photoCategory) {
      photoCategorySelect.value = window.DP2_STATE.photoCategory;
    }

    photoCategorySelect.addEventListener("change", (e) => {
      const value = e.target?.value || "";
      window.DP2_STATE.photoCategory = value || null;
    });
  }

  // Sélection module PV (DP2)
  const panelSelect = document.getElementById("dp2-panel-select");
  if (panelSelect) {
    // sync état -> UI si déjà défini (on tente de retrouver la key via reference)
    if (window.DP2_STATE?.panelModel) {
      const currentRef = window.DP2_STATE.panelModel.reference;
      const key = Object.keys(DP2_PANEL_CATALOG).find((k) => DP2_PANEL_CATALOG[k]?.reference === currentRef);
      if (key) panelSelect.value = key;
    } else {
      // sync UI -> état au chargement UNIQUEMENT si l'état n'est pas déjà défini
      const initialKey = panelSelect.value || "";
      window.DP2_STATE.panelModel = DP2_PANEL_CATALOG[initialKey] || null;
    }
    syncDP2PanelMetadataUI();

    panelSelect.addEventListener("change", (e) => {
      const value = e.target?.value || "";
      window.DP2_STATE.panelModel = DP2_PANEL_CATALOG[value] || null;
      syncDP2PanelMetadataUI();

      // Si l’utilisateur retire le module PV pendant l’outil "Panneaux", on désactive immédiatement l’outil.
      if (window.DP2_STATE?.currentTool === "panels" && !window.DP2_STATE.panelModel) {
        showDP2Toast("Sélectionnez un module PV dans Paramètres.");
        dp2ResetActiveToolToNeutral({ preserveSelection: true, reason: "panel_model_unset" });
      }
    });
  }
}

// ======================================================
// DP4 — PARAMÈTRES (COPIE STRICTE DP2 + 1 champ roofType)
// - Graphique uniquement
// - Stockage dans window.DP4_STATE.roofType
// - Synchronisation des paramètres DP4 -> DP2_STATE (moteur DP2 réutilisé en profil DP4_ROOF)
// ======================================================

let dp4ToastTimer = null;
function showDP4Toast(message) {
  // DP4 réutilise la toolbar DP2 dans l'overlay : on accroche la toast au même endroit.
  const toolbar = document.getElementById("dp2-toolbar");
  if (!toolbar) return;

  let el = toolbar.querySelector(".dp4-toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "dp2-toast dp4-toast";
    toolbar.appendChild(el);
  }

  el.textContent = message;

  if (dp4ToastTimer) clearTimeout(dp4ToastTimer);
  dp4ToastTimer = setTimeout(() => {
    try { el.remove(); } catch (_) {}
  }, 2600);
}

// Copie stricte du catalogue DP2 (mêmes valeurs)
const DP4_PANEL_CATALOG = {
  longi_x10_artist: {
    manufacturer: "LONGi",
    reference: "Hi-MO X10 Artist",
    power_w: 485,
    width_m: 1.134,
    height_m: 2 + 0.382
  },
  longi_x10_explorer: {
    manufacturer: "LONGi",
    reference: "Hi-MO X10 Explorer",
    power_w: 485,
    width_m: 1.134,
    height_m: 2 + 0.382
  }
};

function syncDP4PanelMetadataUI() {
  const manufacturerEl = document.getElementById("dp4-panel-manufacturer");
  const referenceEl = document.getElementById("dp4-panel-reference");
  const powerEl = document.getElementById("dp4-panel-power");
  const dimensionsEl = document.getElementById("dp4-panel-dimensions");
  if (!manufacturerEl || !referenceEl || !powerEl || !dimensionsEl) return;

  const model = window.DP4_STATE?.panelModel || null;
  if (!model) {
    manufacturerEl.textContent = "—";
    referenceEl.textContent = "—";
    powerEl.textContent = "—";
    dimensionsEl.textContent = "—";
    return;
  }

  manufacturerEl.textContent = model.manufacturer || "—";
  referenceEl.textContent = model.reference || "—";
  powerEl.textContent = typeof model.power_w === "number" ? `${model.power_w} Wc` : "—";

  const h = typeof model.height_m === "number" ? model.height_m.toFixed(2) : null;
  const w = typeof model.width_m === "number" ? model.width_m.toFixed(2) : null;
  dimensionsEl.textContent = h && w ? `${h} × ${w} m` : "—";
}

function syncDP4ScaleUI() {
  const el = document.getElementById("dp4-scale");
  if (!el) return;
  // NETTOYAGE UI (DP4) :
  // - Ne pas afficher de texte "Échelle : ... m/px" (éviter doublons / info technique).
  // - La référence visuelle est le repère métrique (trait fixe + ≈ Xm) sur le plan.
  try { el.hidden = true; } catch (_) {}
  el.textContent = "";
}

// ======================================================
// DP4 — REPÈRE MÉTRIQUE (UI uniquement)
// - Trait de largeur FIXE en px (constante)
// - Valeur en mètres recalculée via DP4_STATE.capture.scale_m_per_px
// - Aucune interaction utilisateur
// - Ne dépend pas du zoom visuel (reste constant en pixels)
// ======================================================
const DP4_METRIC_MARKER_WIDTH_PX = 100; // FIXE (exigence)

function dp4FormatMetersForMarker(distanceM) {
  if (!(typeof distanceM === "number" && Number.isFinite(distanceM) && distanceM > 0)) return "—";
  const rounded = Math.round(distanceM * 10) / 10; // 1 décimale max
  // 1 décimale maximum : si entier, ne pas afficher ".0"
  return rounded % 1 === 0 ? String(rounded.toFixed(0)) : String(rounded.toFixed(1));
}

function dp4EnsureMetricMarkerOverlayMounted() {
  const host = document.getElementById("dp2-captured-image-wrap");
  if (!host) return null;

  let root = document.getElementById("dp4-metric-marker");
  if (root && host.contains(root)) return root;

  // Nettoyage si un node traîne ailleurs
  if (root && root.parentNode) {
    try { root.parentNode.removeChild(root); } catch (_) {}
  }

  root = document.createElement("div");
  root.id = "dp4-metric-marker";
  root.setAttribute("aria-hidden", "true");
  // Important : overlay hors dp2-zoom-container => non affecté par le zoom visuel
  root.style.cssText = [
    "position:absolute",
    "left:12px",
    "bottom:12px",
    "display:flex",
    "align-items:center",
    "gap:8px",
    "padding:6px 8px",
    "background:rgba(255,255,255,0.88)",
    "border:1px solid rgba(0,0,0,0.18)",
    "border-radius:4px",
    "box-shadow:0 1px 3px rgba(0,0,0,0.12)",
    "pointer-events:none",
    "user-select:none",
    "font-size:12px",
    "line-height:1",
    "color:#111"
  ].join(";");

  const line = document.createElement("div");
  line.id = "dp4-metric-marker-line";
  line.style.cssText = [
    `width:${DP4_METRIC_MARKER_WIDTH_PX}px`,
    "height:2px",
    "background:#222"
  ].join(";");

  const label = document.createElement("div");
  label.id = "dp4-metric-marker-label";
  label.textContent = "≈ — m";

  root.appendChild(line);
  root.appendChild(label);
  host.appendChild(root);
  return root;
}

function syncDP4MetricMarkerOverlayUI() {
  const root = dp4EnsureMetricMarkerOverlayMounted();
  if (!root) return;

  const label = root.querySelector("#dp4-metric-marker-label");
  if (!label) return;

  // Source de calcul EXCLUSIVE (exigence) : DP4_STATE.capture.scale_m_per_px
  const scale_m_per_px = window.DP4_STATE?.capture?.scale_m_per_px;
  if (!(typeof scale_m_per_px === "number" && Number.isFinite(scale_m_per_px) && scale_m_per_px > 0)) {
    label.textContent = "≈ — m";
    return;
  }

  const distanceM = DP4_METRIC_MARKER_WIDTH_PX * scale_m_per_px;
  const formatted = dp4FormatMetersForMarker(distanceM);
  label.textContent = `≈ ${formatted} m`;
}

function syncDP4ViewHeightUI() {
  const el = document.getElementById("dp4-view-height");
  if (!el) return;

  // Source de vérité existante : scale_m_per_px (déjà calculée/figée à la capture).
  const scale_m_per_px = window.DP2_STATE?.scale_m_per_px;
  const canvas = document.getElementById("dp2-draw-canvas");
  const imageHeightPx = canvas && Number.isFinite(canvas.height) ? canvas.height : null;

  if (!(typeof scale_m_per_px === "number" && scale_m_per_px > 0) || !(typeof imageHeightPx === "number" && imageHeightPx > 0)) {
    el.textContent = "Hauteur de vue : —";
    return;
  }

  const heightM = imageHeightPx * scale_m_per_px;
  const rounded = Math.round(heightM * 10) / 10; // 1 décimale max
  el.textContent = `Hauteur de vue : ${rounded} m`;
}

function initDP4MetadataUI() {
  window.DP4_STATE = window.DP4_STATE || dp4DefaultState();

  // Catégorie Avant / Après (DP4)
  const photoCategorySelect = document.getElementById("dp4-photo-category");
  if (photoCategorySelect) {
    if (window.DP4_STATE?.photoCategory != null && photoCategorySelect.value !== window.DP4_STATE.photoCategory) {
      photoCategorySelect.value = window.DP4_STATE.photoCategory;
    }
    photoCategorySelect.addEventListener("change", (e) => {
      const value = e.target?.value || "";
      window.DP4_STATE.photoCategory = value || null;
      if (window.DP2_STATE) window.DP2_STATE.photoCategory = window.DP4_STATE.photoCategory;
    });
  }

  // Sélection module PV (DP4)
  const panelSelect = document.getElementById("dp4-panel-select");
  if (panelSelect) {
    if (window.DP4_STATE?.panelModel) {
      const currentRef = window.DP4_STATE.panelModel.reference;
      const key = Object.keys(DP4_PANEL_CATALOG).find((k) => DP4_PANEL_CATALOG[k]?.reference === currentRef);
      if (key) panelSelect.value = key;
    } else {
      const initialKey = panelSelect.value || "";
      window.DP4_STATE.panelModel = DP4_PANEL_CATALOG[initialKey] || null;
      if (window.DP2_STATE) window.DP2_STATE.panelModel = window.DP4_STATE.panelModel;
    }
    syncDP4PanelMetadataUI();

    panelSelect.addEventListener("change", (e) => {
      const value = e.target?.value || "";
      window.DP4_STATE.panelModel = DP4_PANEL_CATALOG[value] || null;
      if (window.DP2_STATE) window.DP2_STATE.panelModel = window.DP4_STATE.panelModel;
      syncDP4PanelMetadataUI();

      if (window.DP2_STATE?.currentTool === "panels" && !window.DP2_STATE.panelModel) {
        showDP4Toast("Sélectionnez un module PV dans Paramètres.");
        dp2ResetActiveToolToNeutral({ preserveSelection: true, reason: "dp4_panel_model_unset" });
      }
    });
  }

  // DP4 UNIQUEMENT : type de toit (graphique uniquement)
  const roofTypeSelect = document.getElementById("dp4-roof-type");
  if (roofTypeSelect) {
    const current = window.DP4_STATE?.roofType ?? null;
    if (current != null && roofTypeSelect.value !== current) {
      roofTypeSelect.value = current;
    }
    roofTypeSelect.addEventListener("change", (e) => {
      const value = e.target?.value || "";
      window.DP4_STATE.roofType = value || null;
    });
  }

  syncDP4ScaleUI();
  syncDP4ViewHeightUI();
  syncDP4MetricMarkerOverlayUI();
}

function syncDP4LegendOverlayUI() {
  const listEl = document.getElementById("dp4-legend-list");
  const emptyEl = document.getElementById("dp4-legend-empty");
  if (!listEl) return; // DP4 pas monté

  const modal = document.getElementById("dp4-map-modal");
  if (modal && modal.getAttribute("aria-hidden") === "true") return;

  const host = modal || listEl;
  const getLegend = window.getDP2GlobalLegendForPdf;
  const legendItems = typeof getLegend === "function" ? (getLegend() || []) : [];

  const signature = Array.isArray(legendItems)
    ? legendItems.map((it) => `${it?.legendKey || ""}:${typeof it?.count === "number" ? it.count : 0}`).join("|")
    : "invalid";
  if (host.dataset && host.dataset.dp4LegendSig === signature) return;
  if (host.dataset) host.dataset.dp4LegendSig = signature;

  if (!Array.isArray(legendItems) || legendItems.length === 0) {
    listEl.innerHTML = "";
    if (emptyEl) emptyEl.hidden = false;
    return;
  }
  if (emptyEl) emptyEl.hidden = true;

  listEl.innerHTML = "";

  for (const item of legendItems) {
    const legendKey = item?.legendKey;
    const count = typeof item?.count === "number" ? item.count : 0;
    if (!legendKey) continue;

    const entry = DP2_BUSINESS_LEGEND_BY_KEY[legendKey] || null;
    const type = entry?.type || null;
    const meta = entry?.meta || null;
    const label =
      legendKey === "PANNEAUX_PV"
        ? "Panneaux photovoltaïques"
        : (meta?.label || String(legendKey));

    const row = document.createElement("div");
    row.className = "dp2-legend-row";

    const miniWrap = document.createElement("div");
    miniWrap.className = "dp2-legend-mini";
    const miniCanvas = document.createElement("canvas");
    miniCanvas.className = "dp2-legend-mini-canvas";
    miniCanvas.width = 104;
    miniCanvas.height = 68;
    miniCanvas.setAttribute("aria-hidden", "true");
    miniWrap.appendChild(miniCanvas);

    const labelEl = document.createElement("span");
    labelEl.className = "dp2-legend-label";
    labelEl.textContent = label;

    const countEl = document.createElement("span");
    countEl.className = "dp2-legend-count";
    countEl.textContent = count > 1 ? `×${count}` : "";

    row.appendChild(miniWrap);
    row.appendChild(labelEl);
    row.appendChild(countEl);
    listEl.appendChild(row);

    try {
      const ctx = miniCanvas.getContext("2d");
      if (!ctx) continue;
      ctx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
      if (legendKey === "PANNEAUX_PV") {
        const bw = 90;
        const bh = 55;
        const pad = 10;
        const scale = Math.max(0.01, Math.min((miniCanvas.width - pad * 2) / bw, (miniCanvas.height - pad * 2) / bh));
        const dx = (miniCanvas.width - bw * scale) / 2;
        const dy = (miniCanvas.height - bh * scale) / 2;
        ctx.save();
        ctx.translate(dx, dy);
        ctx.scale(scale, scale);
        renderDP2PanelRect(ctx, { x: 0, y: 0, width: bw, height: bh, rotation: 0 }, DP2_PANEL_STYLE);
        ctx.restore();
        continue;
      }

      if (typeof renderDP2BusinessObject !== "function") continue;
      if (!type || !meta) continue;

      const bw = meta.defaultW || 80;
      const bh = meta.defaultH || 50;
      const pad = 10;
      const scale = Math.max(0.01, Math.min((miniCanvas.width - pad * 2) / bw, (miniCanvas.height - pad * 2) / bh));
      const dx = (miniCanvas.width - bw * scale) / 2;
      const dy = (miniCanvas.height - bh * scale) / 2;

      ctx.save();
      ctx.translate(dx, dy);
      ctx.scale(scale, scale);
      const dummy = {
        id: "legend_dummy",
        type,
        legendKey,
        geometry: { x: 0, y: 0, width: bw, height: bh, rotation: 0 },
        visible: true
      };
      renderDP2BusinessObject(ctx, dummy);
      ctx.restore();
    } catch (_) {}
  }
}

// Préparation des données de légende DP2 (sans génération PDF)
function getDP2PanelLegendData() {
  return {
    category: window.DP2_STATE?.photoCategory ?? null,
    panel: window.DP2_STATE?.panelModel ?? null
  };
}

// Un seul contour bâti autorisé. Retourne l'objet building_outline s'il existe.
function getDP2BuildingOutline() {
  const objects = window.DP2_STATE?.objects || [];
  return objects.find((obj, idx) => obj && obj.type === "building_outline") || null;
}

// Profil éditeur : DP2 (plan de masse) vs DP4 (toiture)
function dp2IsDP4RoofProfile() {
  return window.DP2_STATE?.editorProfile === "DP4_ROOF";
}

// DP4 : plusieurs polygones possibles. Helpers dédiés (sans casser DP2 historique).
function dp2GetAllBuildingOutlines() {
  const objects = window.DP2_STATE?.objects || [];
  return objects.filter((o) => o && o.type === "building_outline");
}

// DP4 : plusieurs polygones possibles. On cible toujours le DERNIER contour non fermé.
function dp2GetOpenBuildingOutline() {
  const outlines = dp2GetAllBuildingOutlines();
  for (let i = outlines.length - 1; i >= 0; i--) {
    const o = outlines[i];
    if (o && o.closed === false && Array.isArray(o.points) && o.points.length >= 1) return o;
  }
  return null;
}

function dp2GetActiveBuildingOutlineForDrawing() {
  // DP2 et DP4 : contour stocké dans buildingContours[]
  return dp2GetOpenBuildingContour();
}

// True si un contour bâti est en cours (non fermé) → bloque les autres outils.
function hasDP2OpenBuildingOutline() {
  const outline = dp2GetOpenBuildingContour();
  return !!(outline && outline.closed === false && Array.isArray(outline.points) && outline.points.length >= 2);
}

// --------------------------
// DP2 — BUILDING CONTOURS (DP2 uniquement)
// --------------------------
function dp2EnsureBuildingContoursState() {
  const s = window.DP2_STATE;
  if (!s) return;
  if (!Array.isArray(s.buildingContours)) s.buildingContours = [];
  if (s.selectedBuildingContourId == null) s.selectedBuildingContourId = null;
  if (s.buildingContourInteraction == null) s.buildingContourInteraction = null;
  if (s.lineVertexInteraction == null) s.lineVertexInteraction = null;
}

function dp2NewBuildingContourId() {
  return "bct_" + Date.now() + "_" + Math.random().toString(16).slice(2);
}

function dp2GetBuildingContours() {
  dp2EnsureBuildingContoursState();
  return window.DP2_STATE?.buildingContours || [];
}

function dp2GetBuildingContourById(id) {
  if (!id) return null;
  const list = dp2GetBuildingContours();
  for (const c of list) {
    if (c && c.id === id) return c;
  }
  return null;
}

function dp2GetOpenBuildingContour() {
  const list = dp2GetBuildingContours();
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    if (c && c.closed === false && Array.isArray(c.points) && c.points.length >= 1) return c;
  }
  return null;
}

function dp2SetSelectedBuildingContourId(id) {
  dp2EnsureBuildingContoursState();
  window.DP2_STATE.selectedBuildingContourId = id || null;
  // Sélection contour = désélectionner les autres types (UX cohérente)
  window.DP2_STATE.selectedObjectId = null;
  window.DP2_STATE.selectedBusinessObjectId = null;
  dp2ClearSelectedPanels();
  dp2ClearSelectedTexts();
}

function dp2ClearSelectedBuildingContour() {
  dp2EnsureBuildingContoursState();
  window.DP2_STATE.selectedBuildingContourId = null;
}

// --------------------------
// DP2 — GÉOMÉTRIE (FAÎTAGE)
// - Ne modifie JAMAIS les points du contour.
// - Ajoute uniquement des "cuts" (cotes structurées) sur les segments intersectés.
// --------------------------
function dp2Round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function dp2Cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

// Intersection de segments [p->p2] et [q->q2]
// Retourne { x, y, t, u } si intersection, sinon null.
function dp2SegmentIntersection(p, p2, q, q2) {
  const rx = p2.x - p.x;
  const ry = p2.y - p.y;
  const sx = q2.x - q.x;
  const sy = q2.y - q.y;
  const denom = dp2Cross(rx, ry, sx, sy);
  const qpX = q.x - p.x;
  const qpY = q.y - p.y;

  const EPS = 1e-9;
  if (Math.abs(denom) < EPS) {
    // Parallèle ou colinéaire : pas de "cut" robuste (on ignore)
    return null;
  }

  const t = dp2Cross(qpX, qpY, sx, sy) / denom;
  const u = dp2Cross(qpX, qpY, rx, ry) / denom;

  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;

  return { x: p.x + t * rx, y: p.y + t * ry, t, u };
}

function applyRidgeLineCutsToBuildingOutline(ridgeA, ridgeB) {
  // DP2 / DP4 : même moteur — contour sélectionné ou premier de la liste (buildingContours)
  const id = window.DP2_STATE?.selectedBuildingContourId || null;
  let outline = id ? dp2GetBuildingContourById(id) : null;
  if (!outline) {
    const list = dp2GetBuildingContours();
    if (list.length === 1) outline = list[0];
  }
  if (!outline || !Array.isArray(outline.points) || outline.points.length < 2) return;

  const scale = window.DP2_STATE?.scale_m_per_px;
  if (typeof scale !== "number" || scale <= 0) return;

  const points = outline.points;
  const segments = outline.closed ? points.length : points.length - 1;

  const dx = ridgeB.x - ridgeA.x;
  const dy = ridgeB.y - ridgeA.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;

  const ux = dx / len;
  const uy = dy / len;
  let minX = points[0].x, maxX = points[0].x, minY = points[0].y, maxY = points[0].y;
  for (let k = 1; k < points.length; k++) {
    const pt = points[k];
    if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  const extend = Math.max(diag * 2, 500);
  const ridgeExtA = { x: ridgeA.x - ux * extend, y: ridgeA.y - uy * extend };
  const ridgeExtB = { x: ridgeB.x + ux * extend, y: ridgeB.y + uy * extend };

  const EPS_T = 1e-6;
  const intersections = [];
  for (let i = 0; i < segments; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const inter = dp2SegmentIntersection(p1, p2, ridgeExtA, ridgeExtB);
    if (!inter) continue;
    if (inter.t < EPS_T || inter.t > 1 - EPS_T) continue;
    intersections.push({ inter, i, p1, p2 });
  }

  const DEDUPE_PX = 0.5;
  for (let a = 0; a < intersections.length; a++) {
    for (let b = intersections.length - 1; b > a; b--) {
      const ia = intersections[a].inter, ib = intersections[b].inter;
      if (Math.hypot(ia.x - ib.x, ia.y - ib.y) < DEDUPE_PX) {
        intersections.splice(b, 1);
      }
    }
  }

  if (intersections.length < 2) {
    outline.cuts = {};
    return;
  }

  const s = (inter, extA) => (inter.x - extA.x) * ux + (inter.y - extA.y) * uy;
  intersections.sort((a, b) => s(a.inter, ridgeExtA) - s(b.inter, ridgeExtA));
  const first = intersections[0];
  const last = intersections[intersections.length - 1];

  outline.cuts = {};
  for (const entry of [first, last]) {
    const { inter, i, p1, p2 } = entry;
    const I = { x: inter.x, y: inter.y };
    const l1Px = Math.hypot(I.x - p1.x, I.y - p1.y);
    const l2Px = Math.hypot(p2.x - I.x, p2.y - I.y);
    outline.cuts[i] = [
      { a: { x: p1.x, y: p1.y }, b: { x: I.x, y: I.y }, lengthM: dp2Round2(l1Px * scale) },
      { a: { x: I.x, y: I.y }, b: { x: p2.x, y: p2.y }, lengthM: dp2Round2(l2Px * scale) }
    ];
  }
}

function setDP2ModeCapture() {
  window.DP2_STATE.mode = "CAPTURE";
  console.log("[DP2] Mode = CAPTURE");
}

function setDP2ModeEdition() {
  window.DP2_STATE.mode = "EDITION";
  console.log("[DP2] Mode = EDITION");
}

// --------------------------
// DP2 — INIT EDITOR (CANVAS)
// --------------------------
function initDP2Editor() {
  if (!window.DP2_STATE || !window.DP2_STATE.capture) {
    console.warn("[DP2] Impossible d'initialiser l'éditeur : capture absente");
    return;
  }

  const img = document.getElementById("dp2-captured-image");
  const canvas = document.getElementById("dp2-draw-canvas");

  if (!img || !canvas) {
    console.warn("[DP2] Image ou canvas manquant pour l'éditeur");
    return;
  }

  // Synchronisation canvas ↔ image
  // ⚠️ CANVAS = CALQUE PUR : ne jamais dessiner directement dessus
  // Tout dessin doit passer par DP2_STATE.objects[] puis renderDP2FromState()
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.style.position = "absolute";
  canvas.style.top = "0";
  canvas.style.left = "0";
  canvas.style.pointerEvents = "auto";
  canvas.style.zIndex = "2";

  // Initialisation état global DP2 (éditeur)
  // ⚠️ backgroundImage reste INDÉPENDANTE du canvas (image HTML séparée)
  window.DP2_STATE.backgroundImage = {
    src: img.src,
    width: img.naturalWidth,
    height: img.naturalHeight
  };

  if (!Array.isArray(window.DP2_STATE.objects)) {
    window.DP2_STATE.objects = [];
  }

  if (!Array.isArray(window.DP2_STATE.history)) {
    window.DP2_STATE.history = [];
  }

  if (!Array.isArray(window.DP2_STATE.businessObjects)) {
    window.DP2_STATE.businessObjects = [];
  }

  if (window.DP2_STATE.selectedBusinessObjectId == null) {
    window.DP2_STATE.selectedBusinessObjectId = null;
  }

  // Stockage dédié PANNEAUX PV (calepinage simple)
  if (!Array.isArray(window.DP2_STATE.panels)) {
    window.DP2_STATE.panels = [];
  }
  if (window.DP2_STATE.selectedPanelId == null) {
    window.DP2_STATE.selectedPanelId = null;
  }
  if (!Array.isArray(window.DP2_STATE.selectedPanelIds)) {
    window.DP2_STATE.selectedPanelIds = [];
  }

  // Stockage dédié TEXTES (annotations)
  if (!Array.isArray(window.DP2_STATE.textObjects)) {
    window.DP2_STATE.textObjects = [];
  }
  if (window.DP2_STATE.selectedTextId == null) {
    window.DP2_STATE.selectedTextId = null;
  }
  if (!Array.isArray(window.DP2_STATE.selectedTextIds)) {
    window.DP2_STATE.selectedTextIds = [];
  }

  // Migration douce (compat) : anciens objets {type:"pv_panel"} → DP2_STATE.panels[]
  // - Évite d’avoir 2 sources de vérité pour les panneaux
  // - Ne touche pas aux autres objets du plan
  try {
    const objs = window.DP2_STATE.objects || [];
    const kept = [];
    for (let i = 0; i < objs.length; i++) {
      const o = objs[i];
      if (o && o.type === "pv_panel") {
        const w = o.width || 0;
        const h = o.height || 0;
        if (w > 0 && h > 0) {
          const id = "panel_" + Date.now() + "_" + Math.random().toString(16).slice(2);
          const geom = {
            x: typeof o.x === "number" ? o.x : 0,
            y: typeof o.y === "number" ? o.y : 0,
            width: w,
            height: h,
            rotation: typeof o.rotation === "number" ? o.rotation : 0
          };
          if (typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile()) {
            geom.displayScaleX = 1;
            geom.displayScaleY = 1;
          }
          window.DP2_STATE.panels.push({
            id,
            type: "panel",
            geometry: geom,
            lockedSize: true,
            visible: true
          });
          if (window.DP2_STATE.selectedObjectId === i) {
            window.DP2_STATE.selectedObjectId = null;
            window.DP2_STATE.selectedPanelId = id;
          }
        }
        continue; // ne pas garder dans objects[]
      }
      kept.push(o);
    }
    if (kept.length !== objs.length) window.DP2_STATE.objects = kept;
  } catch (_) {}

  // Migration douce (compat DP2) : anciens objets {type:"building_outline"} → DP2_STATE.buildingContours[]
  // DP2 et DP4 utilisent le même moteur (buildingContours).
  try {
    dp2EnsureBuildingContoursState();
    const objs = window.DP2_STATE.objects || [];
    const kept = [];
    for (let i = 0; i < objs.length; i++) {
      const o = objs[i];
      if (o && o.type === "building_outline") {
        const pts = Array.isArray(o.points) ? o.points : [];
        const id = (o.id && typeof o.id === "string") ? o.id : dp2NewBuildingContourId();
        // Éviter doublons si déjà migré
        if (!dp2GetBuildingContourById(id)) {
          window.DP2_STATE.buildingContours.push({
            id,
            points: pts.map((p) => ({ x: typeof p?.x === "number" ? p.x : 0, y: typeof p?.y === "number" ? p.y : 0 })),
            closed: o.closed === true,
            cuts: o.cuts && typeof o.cuts === "object" ? o.cuts : undefined
          });
        }
        // Si cet objet était sélectionné (ancienne sélection), migrer vers selectedBuildingContourId
        if (window.DP2_STATE.selectedObjectId === i) {
          window.DP2_STATE.selectedObjectId = null;
          window.DP2_STATE.selectedBuildingContourId = id;
        }
        continue; // ne pas garder dans objects[]
      }
      kept.push(o);
    }
    if (kept.length !== objs.length) window.DP2_STATE.objects = kept;
  } catch (_) {}

  // Garantir que scale_m_per_px est défini depuis capture.resolution
  if (window.DP2_STATE.scale_m_per_px == null && window.DP2_STATE.capture?.resolution != null) {
    window.DP2_STATE.scale_m_per_px = window.DP2_STATE.capture.resolution;
  }

  console.log("[DP2] Éditeur initialisé", {
    background: window.DP2_STATE.backgroundImage,
    scale: window.DP2_STATE.scale_m_per_px,
    objects: window.DP2_STATE.objects.length
  });

  // Rendu initial depuis l'état
  renderDP2FromState();

  // Zoom visuel : conteneur image + canvas (sans modifier scale_m_per_px)
  initDP2ViewZoom();

  // Barre d'outils déjà initialisée en amont dans initDP2() (DOM-only). Ici : uniquement canvas + events canvas.
  initDP2CanvasEvents();
}

// --------------------------
// DP2 — ACTIONS DESSIN (Undo / Redo / Supprimer)
// Contraintes : UI-only, ne touche pas au flux de capture ni à l’overlay.
// --------------------------
function dp2EnsureHistoryStacks() {
  const state = window.DP2_STATE;
  if (!state) return { undo: [], redo: [] };
  // On conserve DP2_STATE.history comme un ARRAY (contrainte "pas de nouveaux états globaux")
  // Format: history[0] = undoStack, history[1] = redoStack
  if (!Array.isArray(state.history)) state.history = [];
  if (!Array.isArray(state.history[0])) state.history[0] = [];
  if (!Array.isArray(state.history[1])) state.history[1] = [];
  return { undo: state.history[0], redo: state.history[1] };
}

function dp2CloneForHistory(value) {
  // Deep clone stable pour objets simples (POJO)
  // (DP2_STATE contient uniquement des objets sérialisables côté "dessin")
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
  } catch (_) {}
  return JSON.parse(JSON.stringify(value));
}

function dp2SnapshotForHistory() {
  const state = window.DP2_STATE;
  if (!state) return null;
  return {
    objects: dp2CloneForHistory(state.objects || []),
    // DP2 uniquement : contours de bâti (DP4 conserve l'ancien stockage dans objects[])
    buildingContours: dp2CloneForHistory(Array.isArray(state.buildingContours) ? state.buildingContours : []),
    panels: dp2CloneForHistory(state.panels || []),
    textObjects: dp2CloneForHistory(state.textObjects || []),
    businessObjects: dp2CloneForHistory(state.businessObjects || []),
    selectedObjectId: state.selectedObjectId != null ? state.selectedObjectId : null,
    selectedBuildingContourId: state.selectedBuildingContourId || null,
    selectedPanelId: state.selectedPanelId || null,
    selectedPanelIds: dp2CloneForHistory(Array.isArray(state.selectedPanelIds) ? state.selectedPanelIds : []),
    selectedBusinessObjectId: state.selectedBusinessObjectId || null,
    selectedTextId: state.selectedTextId || null,
    selectedTextIds: dp2CloneForHistory(Array.isArray(state.selectedTextIds) ? state.selectedTextIds : [])
  };
}

function dp2ApplyHistorySnapshot(snap) {
  const state = window.DP2_STATE;
  if (!state || !snap) return;
  state.objects = Array.isArray(snap.objects) ? snap.objects : [];
  state.buildingContours = Array.isArray(snap.buildingContours) ? snap.buildingContours : [];
  state.selectedBuildingContourId = snap.selectedBuildingContourId || null;
  state.panels = Array.isArray(snap.panels) ? snap.panels : [];
  state.textObjects = Array.isArray(snap.textObjects) ? snap.textObjects : [];
  state.businessObjects = Array.isArray(snap.businessObjects) ? snap.businessObjects : [];
  state.selectedObjectId = snap.selectedObjectId != null ? snap.selectedObjectId : null;
  // Compat: anciennes entrées history n'ont pas selectedPanelIds
  const snapIds = Array.isArray(snap.selectedPanelIds) ? snap.selectedPanelIds : [];
  state.selectedPanelIds = snapIds.length ? snapIds : (snap.selectedPanelId ? [snap.selectedPanelId] : []);
  state.selectedPanelId = state.selectedPanelIds.length === 1 ? state.selectedPanelIds[0] : null;
  state.selectedBusinessObjectId = snap.selectedBusinessObjectId || null;
  // Compat: anciennes entrées history n'ont pas selectedTextIds
  const snapTextIds = Array.isArray(snap.selectedTextIds) ? snap.selectedTextIds : [];
  state.selectedTextIds = snapTextIds.length ? snapTextIds : (snap.selectedTextId ? [snap.selectedTextId] : []);
  state.selectedTextId = state.selectedTextIds.length === 1 ? state.selectedTextIds[0] : null;
  // Ne jamais restaurer des états d'interaction non sérialisés
  state.businessInteraction = null;
  state.panelInteraction = null;
  state.panelGroupInteraction = null;
  state.textInteraction = null;
  state.selectionRect = null;
  state.buildingContourInteraction = null;
  state.lineVertexInteraction = null;
  renderDP2FromState();
}

function dp2CommitHistoryPoint() {
  const snap = dp2SnapshotForHistory();
  if (!snap) return;
  const { undo, redo } = dp2EnsureHistoryStacks();
  undo.push(snap);
  // Toute nouvelle action invalide le redo
  redo.length = 0;
  syncDP2DrawActionsUI();
}

function dp2Undo() {
  const { undo, redo } = dp2EnsureHistoryStacks();
  if (!undo.length) return;
  const current = dp2SnapshotForHistory();
  const prev = undo.pop();
  if (current) redo.push(current);
  dp2ApplyHistorySnapshot(prev);
  syncDP2DrawActionsUI();
}

function dp2Redo() {
  const { undo, redo } = dp2EnsureHistoryStacks();
  if (!redo.length) return;
  const current = dp2SnapshotForHistory();
  const next = redo.pop();
  if (current) undo.push(current);
  dp2ApplyHistorySnapshot(next);
  syncDP2DrawActionsUI();
}

function dp2DeleteSelected() {
  const state = window.DP2_STATE;
  if (!state) return;

  const bizId = state.selectedBusinessObjectId || null;
  const panelIds = typeof dp2GetEffectiveSelectedPanelIds === "function" ? dp2GetEffectiveSelectedPanelIds() : [];
  const textIds = typeof dp2GetEffectiveSelectedTextIds === "function" ? dp2GetEffectiveSelectedTextIds() : [];
  const objIdx = state.selectedObjectId != null ? state.selectedObjectId : null;
  const contourId = state.selectedBuildingContourId || null;

  if (!bizId && (!panelIds || !panelIds.length) && (!textIds || !textIds.length) && objIdx == null && !contourId) return;

  dp2CommitHistoryPoint();

  // Priorité : textes (annotations)
  if (textIds && textIds.length) {
    const idSet = new Set(textIds.filter(Boolean));
    const items = Array.isArray(state.textObjects) ? state.textObjects : [];
    const kept = [];
    for (const t of items) {
      if (!t || !t.id || !idSet.has(t.id)) kept.push(t);
    }
    state.textObjects = kept;
    dp2ClearSelectedTexts();
    state.textInteraction = null;
    renderDP2FromState();
    return;
  }

  // Priorité : objet métier (handles) si présent
  if (bizId) {
    const items = state.businessObjects || [];
    const idx = items.findIndex((o) => o && o.id === bizId);
    if (idx >= 0) items.splice(idx, 1);
    state.selectedBusinessObjectId = null;
    renderDP2FromState();
    return;
  }

  // Ensuite : panneaux PV (DP2_STATE.panels)
  if (panelIds && panelIds.length) {
    const idSet = new Set(panelIds.filter(Boolean));
    const items = Array.isArray(state.panels) ? state.panels : [];
    const kept = [];
    for (const p of items) {
      if (!p || !p.id || !idSet.has(p.id)) kept.push(p);
    }
    state.panels = kept;
    // Après suppression : purge sélection + bbox/interaction groupée
    dp2ClearSelectedPanels();
    state.selectionRect = null;
    state.panelGroupInteraction = null;
    state.panelInteraction = null;
    renderDP2FromState();
    return;
  }

  // Ensuite : contour de bâti (DP2 uniquement)
  if (contourId) {
    const list = Array.isArray(state.buildingContours) ? state.buildingContours : [];
    const idx = list.findIndex((c) => c && c.id === contourId);
    if (idx >= 0) list.splice(idx, 1);
    state.selectedBuildingContourId = null;
    state.buildingContourInteraction = null;
    state.lineVertexInteraction = null;
    renderDP2FromState();
    return;
  }

  // Sinon : objet "classique" (objects[])
  const objs = state.objects || [];
  if (typeof objIdx === "number" && objIdx >= 0 && objIdx < objs.length) {
    objs.splice(objIdx, 1);
    state.selectedObjectId = null;
    renderDP2FromState();
  }
}

function syncDP2DrawActionsUI() {
  const undoBtn = document.getElementById("dp2-action-undo");
  const redoBtn = document.getElementById("dp2-action-redo");
  const delBtn = document.getElementById("dp2-action-delete");
  if (!undoBtn && !redoBtn && !delBtn) return; // UI DP2 pas monté

  const state = window.DP2_STATE;
  const hasPanelsSelection =
    !!(state && (
      (typeof dp2GetEffectiveSelectedPanelIds === "function" && dp2GetEffectiveSelectedPanelIds().length >= 1) ||
      state.selectedPanelId ||
      (Array.isArray(state.selectedPanelIds) && state.selectedPanelIds.length >= 1)
    ));
  const hasTextSelection =
    !!(state && (
      (typeof dp2GetEffectiveSelectedTextIds === "function" && dp2GetEffectiveSelectedTextIds().length >= 1) ||
      state.selectedTextId ||
      (Array.isArray(state.selectedTextIds) && state.selectedTextIds.length >= 1)
    ));
  const hasSelection = !!(state && (state.selectedBusinessObjectId || hasPanelsSelection || hasTextSelection || state.selectedObjectId != null));

  if (delBtn) delBtn.disabled = !hasSelection;

  const { undo, redo } = dp2EnsureHistoryStacks();
  if (undoBtn) undoBtn.disabled = !(undo && undo.length);
  if (redoBtn) redoBtn.disabled = !(redo && redo.length);
}

function initDP2DrawActions() {
  const wrap = document.getElementById("dp2-captured-image-wrap");
  const host = document.getElementById("dp2-draw-actions");
  if (!wrap || !host) return;

  if (host.dataset.bound === "1") return;
  host.dataset.bound = "1";

  const undoBtn = document.getElementById("dp2-action-undo");
  const redoBtn = document.getElementById("dp2-action-redo");
  const delBtn = document.getElementById("dp2-action-delete");

  undoBtn?.addEventListener("click", () => dp2Undo());
  redoBtn?.addEventListener("click", () => dp2Redo());
  delBtn?.addEventListener("click", () => dp2DeleteSelected());

  // État initial
  syncDP2DrawActionsUI();
}

// --------------------------
// DP2 — ZOOM VISUEL (image + canvas synchronisés, facteur d'affichage uniquement)
// Ne modifie PAS scale_m_per_px, ni les mesures, ni les objets stockés.
// Limites : 0.5× → 3×. Zoom centré sur la position de la souris.
// --------------------------
const DP2_VIEW_ZOOM_MIN = 0.5;
const DP2_VIEW_ZOOM_MAX = 3;

// Applique la transform visuelle du conteneur zoom : translate(pan) + scale(zoom). Ne touche pas à scale_m_per_px ni aux objets.
function applyDP2ViewTransform() {
  const zoomContainer = document.getElementById("dp2-zoom-container");
  if (!zoomContainer) return;
  const panX = window.DP2_STATE.viewPanX != null ? window.DP2_STATE.viewPanX : 0;
  const panY = window.DP2_STATE.viewPanY != null ? window.DP2_STATE.viewPanY : 0;
  const zoom = window.DP2_STATE.viewZoom != null ? window.DP2_STATE.viewZoom : 1;
  zoomContainer.style.transform = "translate(" + panX + "px, " + panY + "px) scale(" + zoom + ")";
}

function initDP2ViewZoom() {
  const wrap = document.getElementById("dp2-captured-image-wrap");
  const zoomContainer = document.getElementById("dp2-zoom-container");
  if (!wrap || !zoomContainer) return;

  const viewZoom = window.DP2_STATE.viewZoom != null ? window.DP2_STATE.viewZoom : 1;
  window.DP2_STATE.viewZoom = Math.max(DP2_VIEW_ZOOM_MIN, Math.min(DP2_VIEW_ZOOM_MAX, viewZoom));
  if (window.DP2_STATE.viewPanX == null) window.DP2_STATE.viewPanX = 0;
  if (window.DP2_STATE.viewPanY == null) window.DP2_STATE.viewPanY = 0;

  zoomContainer.style.position = "relative";
  zoomContainer.style.transformOrigin = "50% 50%";
  applyDP2ViewTransform();

  wrap.addEventListener("wheel", (e) => {
    const zoomContainerEl = document.getElementById("dp2-zoom-container");
    if (!zoomContainerEl) return;
    const rect = zoomContainerEl.getBoundingClientRect();
    const currentZoom = window.DP2_STATE.viewZoom || 1;
    const originX = (e.clientX - rect.left) / currentZoom;
    const originY = (e.clientY - rect.top) / currentZoom;
    const factor = e.deltaY > 0 ? 1 / 1.15 : 1.15;
    const newZoom = Math.max(DP2_VIEW_ZOOM_MIN, Math.min(DP2_VIEW_ZOOM_MAX, currentZoom * factor));
    if (newZoom === currentZoom) return;
    window.DP2_STATE.viewZoom = newZoom;
    zoomContainerEl.style.transformOrigin = originX + "px " + originY + "px";
    applyDP2ViewTransform();
    e.preventDefault();
  }, { passive: false });

  // ——— Pan (déplacement visuel du plan) : mousedown → mousemove → mouseup
  let panStart = null;
  function onPanMove(e) {
    if (!panStart) return;
    const dx = e.clientX - panStart.clientX;
    const dy = e.clientY - panStart.clientY;
    window.DP2_STATE.viewPanX = panStart.viewPanX + dx;
    window.DP2_STATE.viewPanY = panStart.viewPanY + dy;
    applyDP2ViewTransform();
  }
  function onPanUp() {
    if (panStart) {
      wrap.classList.remove("dp2-panning");
      document.body.classList.remove("dp2-panning");
    }
    panStart = null;
    document.removeEventListener("mousemove", onPanMove);
    document.removeEventListener("mouseup", onPanUp);
  }
  wrap.addEventListener("mousedown", (e) => {
    if (window.DP2_STATE?.currentTool !== "pan") return;
    e.preventDefault();
    panStart = {
      clientX: e.clientX,
      clientY: e.clientY,
      viewPanX: window.DP2_STATE.viewPanX != null ? window.DP2_STATE.viewPanX : 0,
      viewPanY: window.DP2_STATE.viewPanY != null ? window.DP2_STATE.viewPanY : 0
    };
    wrap.classList.add("dp2-panning");
    document.body.classList.add("dp2-panning");
    document.addEventListener("mousemove", onPanMove);
    document.addEventListener("mouseup", onPanUp);
  });
}

// --------------------------
// DP2 — COORDONNÉES CANVAS (souris → pixels canvas)
// --------------------------
function getDP2CanvasCoords(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / (rect.width || 1);
  const scaleY = canvas.height / (rect.height || 1);
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

// Canvas (pixels) → coordonnées client (pour positionner l’overlay choix du point)
function getDP2CanvasToClient(canvas, canvasX, canvasY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / (rect.width || 1);
  const scaleY = canvas.height / (rect.height || 1);
  return {
    clientX: rect.left + canvasX / scaleX,
    clientY: rect.top + canvasY / scaleY
  };
}

// --------------------------
// DP2 — BARRE D'OUTILS (ÉTAPE 4)
// Tant que contour bâti non fermé → seul outil actif = contour bâti (sélection bloquée).
// --------------------------
function initDP2Toolbar() {
  const selectBtn = document.getElementById("dp2-tool-select");
  const panBtn = document.getElementById("dp2-tool-pan");
  const panelsBtn = document.getElementById("dp2-tool-panels");
  const textBtn = document.getElementById("dp2-tool-text");
  const textMenu = document.getElementById("dp2-text-menu");
  const textIconEl = textBtn?.querySelector?.(".dp2-tool-icon") || null;
  const textLabelEl = textBtn?.querySelector?.(".dp2-tool-label") || null;
  const measuresBtn = document.getElementById("dp2-tool-measures");
  const measuresMenu = document.getElementById("dp2-measures-menu");
  const measuresIconEl = measuresBtn?.querySelector?.(".dp2-tool-icon") || null;
  const measuresLabelEl = measuresBtn?.querySelector?.(".dp2-tool-label") || null;
  const businessBtn = document.getElementById("dp2-tool-business");
  const businessMenu = document.getElementById("dp2-business-menu");
  const businessIconEl = businessBtn?.querySelector?.(".dp2-tool-icon") || null;
  const businessLabelEl = businessBtn?.querySelector?.(".dp2-tool-label") || null;

  const MEASURES_TOOL_META = {
    building_outline: { icon: "⬛", label: "Contour bâti" },
    measure_line: { icon: "↔", label: "Trait de mesure" },
    ridge_line: { icon: "▲", label: "Faîtage" }
  };
  const TEXT_TOOL_META = {
    text_free: { icon: "T", label: "Texte libre" },
    text_DP6: { icon: "T", label: "DP6" },
    text_DP7: { icon: "T", label: "DP7" },
    text_DP8: { icon: "T", label: "DP8" }
  };

  function isMeasuresTool(tool) {
    return tool === "building_outline" || tool === "measure_line" || tool === "ridge_line";
  }

  function isBusinessTool(tool) {
    return isDP2BusinessTool(tool);
  }

  function isTextTool(tool) {
    return isDP2TextTool(tool);
  }

  function syncMeasuresButtonDisplay(tool) {
    if (!measuresBtn || !measuresIconEl || !measuresLabelEl) return;
    const meta = MEASURES_TOOL_META[tool];
    if (meta) {
      measuresIconEl.textContent = meta.icon;
      measuresLabelEl.textContent = meta.label;
    } else {
      measuresIconEl.textContent = "📐";
      measuresLabelEl.textContent = "Mesures";
    }
  }

  function syncBusinessButtonDisplay(tool) {
    if (!businessBtn || !businessIconEl || !businessLabelEl) return;
    const meta = DP2_BUSINESS_OBJECT_META[tool];
    if (meta) {
      businessIconEl.textContent = meta.icon || "⬚";
      businessLabelEl.textContent = meta.label || "Formes métier";
    } else {
      businessIconEl.textContent = "⬚";
      businessLabelEl.textContent = "Formes métier";
    }
  }

  function syncTextButtonDisplay(tool) {
    if (!textBtn || !textIconEl || !textLabelEl) return;
    const meta = TEXT_TOOL_META[tool];
    if (meta) {
      textIconEl.textContent = meta.icon;
      textLabelEl.textContent = meta.label;
    } else {
      textIconEl.textContent = "T";
      textLabelEl.textContent = "Texte";
    }
  }

  function closeMeasuresMenu() {
    if (!measuresBtn || !measuresMenu) return;
    measuresBtn.classList.remove("dp2-dropdown-open");
    measuresBtn.setAttribute("aria-expanded", "false");
    measuresMenu.hidden = true;
  }

  function closeBusinessMenu() {
    if (!businessBtn || !businessMenu) return;
    businessBtn.classList.remove("dp2-dropdown-open");
    businessBtn.setAttribute("aria-expanded", "false");
    businessMenu.hidden = true;
  }

  function closeTextMenu() {
    if (!textBtn || !textMenu) return;
    textBtn.classList.remove("dp2-dropdown-open");
    textBtn.setAttribute("aria-expanded", "false");
    textMenu.hidden = true;
  }

  function openMeasuresMenu() {
    if (!measuresBtn || !measuresMenu) return;
    const toolbar = document.getElementById("dp2-toolbar");
    const toolbarRect = toolbar?.getBoundingClientRect?.();
    const btnRect = measuresBtn.getBoundingClientRect();
    if (toolbarRect) {
      // Positionner le menu sous le bouton "Mesures" (dans le repère de la toolbar)
      measuresMenu.style.left = `${Math.max(0, btnRect.left - toolbarRect.left)}px`;
      measuresMenu.style.top = `${Math.max(0, btnRect.bottom - toolbarRect.top + 6)}px`;
      measuresMenu.style.minWidth = `${Math.max(220, Math.round(btnRect.width))}px`;
    }
    measuresBtn.classList.add("dp2-dropdown-open");
    measuresBtn.setAttribute("aria-expanded", "true");
    measuresMenu.hidden = false;
  }

  function openBusinessMenu() {
    if (!businessBtn || !businessMenu) return;
    const toolbar = document.getElementById("dp2-toolbar");
    const toolbarRect = toolbar?.getBoundingClientRect?.();
    const btnRect = businessBtn.getBoundingClientRect();
    if (toolbarRect) {
      businessMenu.style.left = `${Math.max(0, btnRect.left - toolbarRect.left)}px`;
      businessMenu.style.top = `${Math.max(0, btnRect.bottom - toolbarRect.top + 6)}px`;
      businessMenu.style.minWidth = `${Math.max(260, Math.round(btnRect.width))}px`;
    }
    businessBtn.classList.add("dp2-dropdown-open");
    businessBtn.setAttribute("aria-expanded", "true");
    businessMenu.hidden = false;
  }

  function openTextMenu() {
    if (!textBtn || !textMenu) return;
    const toolbar = document.getElementById("dp2-toolbar");
    const toolbarRect = toolbar?.getBoundingClientRect?.();
    const btnRect = textBtn.getBoundingClientRect();
    if (toolbarRect) {
      textMenu.style.left = `${Math.max(0, btnRect.left - toolbarRect.left)}px`;
      textMenu.style.top = `${Math.max(0, btnRect.bottom - toolbarRect.top + 6)}px`;
      textMenu.style.minWidth = `${Math.max(200, Math.round(btnRect.width))}px`;
    }
    textBtn.classList.add("dp2-dropdown-open");
    textBtn.setAttribute("aria-expanded", "true");
    textMenu.hidden = false;
  }

  function toggleMeasuresMenu() {
    if (!measuresMenu || !measuresBtn) return;
    closeBusinessMenu();
    if (!measuresMenu.hidden) closeMeasuresMenu();
    else openMeasuresMenu();
  }

  function toggleBusinessMenu() {
    if (!businessMenu || !businessBtn) return;
    closeMeasuresMenu();
    closeTextMenu();
    if (!businessMenu.hidden) closeBusinessMenu();
    else openBusinessMenu();
  }

  function toggleTextMenu() {
    if (!textMenu || !textBtn) return;
    closeMeasuresMenu();
    closeBusinessMenu();
    if (!textMenu.hidden) closeTextMenu();
    else openTextMenu();
  }

  function tryActivateBuildingOutline() {
    if (hasDP2OpenBuildingOutline()) return;
    setActiveTool("building_outline");
  }

  function setActiveTool(tool) {
    window.DP2_STATE.currentTool = tool;
    // Changement d'outil : annuler la sélection groupée temporaire (panneaux uniquement)
    if (Array.isArray(window.DP2_STATE.selectedPanelIds) && window.DP2_STATE.selectedPanelIds.length >= 2) {
      window.DP2_STATE.selectedPanelIds = [];
      window.DP2_STATE.selectedPanelId = null;
    }
    // Changement d’outil : désélectionner textes (règle UX) + annuler interaction texte en cours
    if (Array.isArray(window.DP2_STATE.selectedTextIds) && window.DP2_STATE.selectedTextIds.length >= 1) {
      dp2ClearSelectedTexts();
    }
    window.DP2_STATE.textInteraction = null;
    // Annuler le lasso et toute interaction groupée en cours
    window.DP2_STATE.selectionRect = null;
    window.DP2_STATE.panelGroupInteraction = null;
    if (tool !== "measure_line") {
      window.DP2_STATE.measureLineStart = null;
    }
    if (tool !== "ridge_line") {
      window.DP2_STATE.ridgeLineStart = null;
    }
    window.DP2_STATE.drawingPreview = null;
    if (tool !== "panels") {
      window.DP2_STATE.panelPlacementPreview = null;
      // Changement d’outil = annulation robuste d’une interaction panneau en cours
      const inter = window.DP2_STATE.panelInteraction || null;
      if (inter && typeof inter.pointerId === "number") {
        const canvas = document.getElementById("dp2-draw-canvas");
        if (canvas && typeof canvas.releasePointerCapture === "function") {
          try { canvas.releasePointerCapture(inter.pointerId); } catch (_) {}
        }
      }
      window.DP2_STATE.panelInteraction = null;
    }
    // Enlever .dp2-tool-active de TOUS les boutons de la toolbar
    const toolbar = document.getElementById("dp2-toolbar");
    if (toolbar) {
      toolbar.querySelectorAll(".dp2-tool-btn").forEach((btn) => {
        btn.classList.remove("dp2-tool-active");
        btn.setAttribute("aria-pressed", "false");
      });
    }
    // Ajouter .dp2-tool-active UNIQUEMENT au bouton correspondant
    const activeBtn = tool === "select"
      ? selectBtn
      : tool === "pan"
        ? panBtn
        : tool === "panels"
          ? panelsBtn
        : isTextTool(tool)
          ? textBtn
          : isMeasuresTool(tool)
            ? measuresBtn
            : isBusinessTool(tool)
              ? businessBtn
              : null;
    if (activeBtn) {
      activeBtn.classList.add("dp2-tool-active");
      activeBtn.setAttribute("aria-pressed", "true");
    }
    syncMeasuresButtonDisplay(tool);
    syncBusinessButtonDisplay(tool);
    syncTextButtonDisplay(tool);
    // Curseur Pan sur le wrap (déplacement visuel uniquement)
    const imgWrap = document.getElementById("dp2-captured-image-wrap");
    if (imgWrap) imgWrap.classList.toggle("dp2-tool-pan", tool === "pan");
    renderDP2FromState();
  }

  function updateToolbarState() {
    const open = hasDP2OpenBuildingOutline();
    if (open) {
      window.DP2_STATE.currentTool = "building_outline";
      selectBtn?.classList.remove("dp2-tool-active");
      selectBtn?.setAttribute("aria-pressed", "false");
      panBtn?.classList.remove("dp2-tool-active");
      panBtn?.setAttribute("aria-pressed", "false");
      panelsBtn?.classList.remove("dp2-tool-active");
      panelsBtn?.setAttribute("aria-pressed", "false");
      measuresBtn?.classList.add("dp2-tool-active");
      measuresBtn?.setAttribute("aria-pressed", "true");
      syncMeasuresButtonDisplay("building_outline");
      closeMeasuresMenu();
      const imgWrap = document.getElementById("dp2-captured-image-wrap");
      if (imgWrap) imgWrap.classList.remove("dp2-tool-pan");
    }
    selectBtn?.classList.toggle("dp2-tool-btn-disabled", open);
    if (selectBtn) selectBtn.disabled = open;
    panBtn?.classList.toggle("dp2-tool-btn-disabled", open);
    if (panBtn) panBtn.disabled = open;
    panelsBtn?.classList.toggle("dp2-tool-btn-disabled", open);
    if (panelsBtn) panelsBtn.disabled = open;
    textBtn?.classList.toggle("dp2-tool-btn-disabled", open);
    if (textBtn) textBtn.disabled = open;
    businessBtn?.classList.toggle("dp2-tool-btn-disabled", open);
    if (businessBtn) businessBtn.disabled = open;
    // Le dropdown regroupe les outils métier : on bloque l'ouverture si contour non fermé
    // (via hasDP2OpenBuildingOutline() dans les handlers), sans griser le bouton actif.
  }

  selectBtn?.addEventListener("click", () => {
    if (hasDP2OpenBuildingOutline()) return;
    // UX : Sélection = mode neutre (aucune création possible, seulement sélection/déplacement)
    dp2ResetActiveToolToNeutral({ preserveSelection: true, reason: "select_tool_click" });
    // Exigence: clic sur "Sélection" = reset (annule la sélection groupée)
    if (window.DP2_STATE) {
      window.DP2_STATE.selectedPanelIds = [];
      window.DP2_STATE.selectedPanelId = null;
      window.DP2_STATE.selectedTextIds = [];
      window.DP2_STATE.selectedTextId = null;
      window.DP2_STATE.selectionRect = null;
      window.DP2_STATE.panelGroupInteraction = null;
      renderDP2FromState();
    }
  });

  panBtn?.addEventListener("click", () => {
    if (hasDP2OpenBuildingOutline()) return;
    setActiveTool("pan");
  });

  panelsBtn?.addEventListener("click", () => {
    if (hasDP2OpenBuildingOutline()) return;
    const model = window.DP2_STATE?.panelModel || null;
    if (!model) {
      showDP2Toast("Sélectionnez un module PV dans Paramètres.");
      return;
    }
    const scale = window.DP2_STATE?.scale_m_per_px;
    if (typeof scale !== "number" || scale <= 0) {
      showDP2Toast("Capture requise (échelle indisponible).");
      return;
    }
    const dims = dp2GetPanelDimsPx();
    if (!dims) {
      showDP2Toast("Module invalide (dimensions manquantes).");
      return;
    }
    setActiveTool("panels");
  });

  textBtn?.addEventListener("click", (e) => {
    if (hasDP2OpenBuildingOutline()) return;
    e.preventDefault();
    e.stopPropagation();
    toggleTextMenu();
  });

  measuresBtn?.addEventListener("click", (e) => {
    if (hasDP2OpenBuildingOutline()) return;
    e.preventDefault();
    e.stopPropagation();
    toggleMeasuresMenu();
  });

  businessBtn?.addEventListener("click", (e) => {
    if (hasDP2OpenBuildingOutline()) return;
    e.preventDefault();
    e.stopPropagation();
    toggleBusinessMenu();
  });

  textMenu?.addEventListener("click", (e) => {
    const li = e.target?.closest?.("li[data-textkind]");
    if (!li) return;
    if (hasDP2OpenBuildingOutline()) return;
    const kind = li.getAttribute("data-textkind");
    const tool =
      kind === "DP6" ? "text_DP6"
      : kind === "DP7" ? "text_DP7"
      : kind === "DP8" ? "text_DP8"
      : "text_free";
    setActiveTool(tool);
    closeTextMenu();
  });

  measuresMenu?.addEventListener("click", (e) => {
    const li = e.target?.closest?.("li[data-tool]");
    if (!li) return;
    if (hasDP2OpenBuildingOutline()) return;
    const tool = li.getAttribute("data-tool");
    if (tool === "building_outline") {
      tryActivateBuildingOutline();
    } else if (tool === "measure_line" || tool === "ridge_line") {
      setActiveTool(tool);
    }
    closeMeasuresMenu();
  });

  businessMenu?.addEventListener("click", (e) => {
    const li = e.target?.closest?.("li[data-tool]");
    if (!li) return;
    if (hasDP2OpenBuildingOutline()) return;
    const tool = li.getAttribute("data-tool");
    if (tool && isBusinessTool(tool)) {
      setActiveTool(tool);
    }
    closeBusinessMenu();
  });

  document.addEventListener("click", (e) => {
    if (!measuresBtn || !measuresMenu) return;
    const clickedMeasures = measuresBtn.contains(e.target) || measuresMenu.contains(e.target);
    const clickedBusiness = businessBtn && businessMenu && (businessBtn.contains(e.target) || businessMenu.contains(e.target));
    const clickedText = textBtn && textMenu && (textBtn.contains(e.target) || textMenu.contains(e.target));
    if (clickedMeasures || clickedBusiness || clickedText) return;
    closeMeasuresMenu();
    closeBusinessMenu();
    closeTextMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const objs = window.DP2_STATE?.objects || [];
      const idx = objs.findIndex(o => o && o.__parcelEdge);
      if (idx >= 0) {
        objs.splice(idx, 1);
        if (typeof dp2RemoveMeasureResizePreviewOverlay === "function") dp2RemoveMeasureResizePreviewOverlay();
        if (typeof renderDP2FromState === "function") renderDP2FromState();
        e.preventDefault();
        return;
      }
      closeMeasuresMenu();
      closeBusinessMenu();
      closeTextMenu();
    }
    if (e.key === "Enter") {
      const objs = window.DP2_STATE?.objects || [];
      const obj = objs.find(o => o && o.type === "measure_line" && typeof o.resizeAnchor === "string");
      if (obj) {
        if (typeof dp2CommitMeasureResize === "function") dp2CommitMeasureResize(obj);
        if (typeof dp2RemoveMeasureResizePreviewOverlay === "function") dp2RemoveMeasureResizePreviewOverlay();
        if (typeof renderDP2FromState === "function") renderDP2FromState();
        e.preventDefault();
      }
    }
  });

  // UX : clic hors zone de dessin => reset outil métier + désélection
  // (on ignore la toolbar/menus/overlay pour ne pas casser les interactions existantes)
  if (window.__DP2_OUTSIDE_CANVAS_RESET_BOUND !== true) {
    window.__DP2_OUTSIDE_CANVAS_RESET_BOUND = true;
    document.addEventListener("pointerdown", (e) => {
      const canvas = document.getElementById("dp2-draw-canvas");
      const wrap = document.getElementById("dp2-captured-image-wrap");
      if (!canvas || !wrap) return;

      const toolbarEl = document.getElementById("dp2-toolbar");
      const settingsPanelEl = document.getElementById("dp2-settings-panel");

      const target = e.target;
      const inWrap = wrap.contains(target);
      const inToolbar = toolbarEl ? toolbarEl.contains(target) : false;
      const inSettingsPanel = settingsPanelEl ? settingsPanelEl.contains(target) : false;
      if (inWrap || inToolbar || inSettingsPanel) return;

      dp2ResetActiveToolToNeutral({ preserveSelection: false, reason: "outside_canvas_click" });
    }, true);
  }

  setActiveTool(window.DP2_STATE.currentTool || "select");
  updateToolbarState();
}

// --------------------------
// DP2 — HIT-TEST (sélection : quel objet sous le clic ?)
// Pour building_outline : distance au segment ou au sommet (seuil ~12 px).
// --------------------------
function dp2HitTest(canvas, x, y) {
  const objects = window.DP2_STATE?.objects || [];
  const threshold = 12;

  // ----- PASS 1 : priorité sommets explicites ridge_line / measure_line (avant contour bâti)
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (!obj || !obj.type) continue;
    if (obj.type === "ridge_line" && obj.a && obj.b) {
      const dA = Math.hypot((obj.a.x || 0) - x, (obj.a.y || 0) - y);
      if (dA <= threshold) return { kind: "object", index: i, vertexAnchor: "A" };
      const dB = Math.hypot((obj.b.x || 0) - x, (obj.b.y || 0) - y);
      if (dB <= threshold) return { kind: "object", index: i, vertexAnchor: "B" };
    }
    if (obj.type === "measure_line" && obj.a && obj.b && !obj.__parcelEdge) {
      const dA = Math.hypot((obj.a.x || 0) - x, (obj.a.y || 0) - y);
      if (dA <= threshold) return { kind: "object", index: i, vertexAnchor: "A" };
      const dB = Math.hypot((obj.b.x || 0) - x, (obj.b.y || 0) - y);
      if (dB <= threshold) return { kind: "object", index: i, vertexAnchor: "B" };
    }
  }

  // ----- PASS 2 : hit-test historique (contour bâti + reste des objets)
  // DP2 / DP4 : contours de bâti stockés dans DP2_STATE.buildingContours[]
  const contours = dp2GetBuildingContours();
  for (let i = contours.length - 1; i >= 0; i--) {
    const c = contours[i];
    if (!c || !Array.isArray(c.points) || c.points.length < 2) continue;
    // Sommets
    for (let p = 0; p < c.points.length; p++) {
      const pt = c.points[p];
      const d = Math.hypot((pt?.x || 0) - x, (pt?.y || 0) - y);
      if (d <= threshold) return { kind: "building_contour", id: c.id, vertexIndex: p };
    }
    // Segments
    const pts = c.points;
    const n = c.closed ? pts.length : pts.length - 1;
    for (let s = 0; s < n; s++) {
      const p1 = pts[s];
      const p2 = pts[(s + 1) % pts.length];
      const dx = (p2?.x || 0) - (p1?.x || 0);
      const dy = (p2?.y || 0) - (p1?.y || 0);
      const len = Math.hypot(dx, dy) || 1;
      const t = Math.max(0, Math.min(1, ((x - (p1?.x || 0)) * dx + (y - (p1?.y || 0)) * dy) / (len * len)));
      const projX = (p1?.x || 0) + t * dx;
      const projY = (p1?.y || 0) + t * dy;
      if (Math.hypot(x - projX, y - projY) <= threshold) return { kind: "building_contour", id: c.id, vertexIndex: null };
    }
  }

  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (!obj || !obj.type) continue;
    // Panneaux PV (objet métier dédié) : hit-test rotation + poignée rotation
    if (obj.type === "pv_panel") {
      const w = obj.width || 0;
      const h = obj.height || 0;
      if (!(w > 0) || !(h > 0)) continue;
      const cx = (obj.x || 0) + w / 2;
      const cy = (obj.y || 0) + h / 2;
      const rot = obj.rotation || 0;
      const dx = x - cx;
      const dy = y - cy;
      const c = Math.cos(-rot);
      const s = Math.sin(-rot);
      const lx = dx * c - dy * s;
      const ly = dx * s + dy * c;
      const inside = lx >= -w / 2 && lx <= w / 2 && ly >= -h / 2 && ly <= h / 2;
      // Rotation handle : au-dessus du centre haut du bbox (dans repère local)
      const rotateHandleOffset = 18;
      const rhX = 0;
      const rhY = -h / 2 - rotateHandleOffset;
      const onRotateHandle = Math.hypot(lx - rhX, ly - rhY) <= 10;
      if (inside || onRotateHandle) return { kind: "object", index: i };
    }
    // ridge_line : sommets A/B puis segment (même logique que contour de bâti)
    if (obj.type === "ridge_line" && obj.a && obj.b) {
      const dA = Math.hypot((obj.a.x || 0) - x, (obj.a.y || 0) - y);
      if (dA <= threshold) return { kind: "object", index: i, vertexAnchor: "A" };
      const dB = Math.hypot((obj.b.x || 0) - x, (obj.b.y || 0) - y);
      if (dB <= threshold) return { kind: "object", index: i, vertexAnchor: "B" };
      const ax = obj.a.x || 0;
      const ay = obj.a.y || 0;
      const dx = (obj.b.x || 0) - ax;
      const dy = (obj.b.y || 0) - ay;
      const len = Math.hypot(dx, dy) || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (len * len)));
      const projX = ax + t * dx;
      const projY = ay + t * dy;
      if (Math.hypot(x - projX, y - projY) <= threshold) return { kind: "object", index: i };
    }
    // measure_line (hors __parcelEdge) : sommets A/B puis segment (même logique que contour)
    if (obj.type === "measure_line" && obj.a && obj.b && !obj.__parcelEdge) {
      const dA = Math.hypot((obj.a.x || 0) - x, (obj.a.y || 0) - y);
      if (dA <= threshold) return { kind: "object", index: i, vertexAnchor: "A" };
      const dB = Math.hypot((obj.b.x || 0) - x, (obj.b.y || 0) - y);
      if (dB <= threshold) return { kind: "object", index: i, vertexAnchor: "B" };
      const ax = obj.a.x || 0;
      const ay = obj.a.y || 0;
      const dx = (obj.b.x || 0) - ax;
      const dy = (obj.b.y || 0) - ay;
      const len = Math.hypot(dx, dy) || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (len * len)));
      const projX = ax + t * dx;
      const projY = ay + t * dy;
      if (Math.hypot(x - projX, y - projY) <= threshold) return { kind: "object", index: i };
    }
    if (obj.type === "building_outline" && obj.points && obj.points.length >= 2) {
      for (let p = 0; p < obj.points.length; p++) {
        const pt = obj.points[p];
        const d = Math.hypot(pt.x - x, pt.y - y);
        if (d <= threshold) return { kind: "object", index: i };
      }
      const pts = obj.points;
      const n = obj.closed ? pts.length : pts.length - 1;
      for (let s = 0; s < n; s++) {
        const p1 = pts[s];
        const p2 = pts[(s + 1) % pts.length];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy) || 1;
        const t = Math.max(0, Math.min(1, ((x - p1.x) * dx + (y - p1.y) * dy) / (len * len)));
        const projX = p1.x + t * dx;
        const projY = p1.y + t * dy;
        if (Math.hypot(x - projX, y - projY) <= threshold) return { kind: "object", index: i };
      }
    }
  }
  return null;
}

// (hit-test measure_line : segment uniquement, voir dp2HitTest)
// l’étiquette, sinon null.
// --------------------------
const DP2_PARCEL_SEGMENT_HIT_THRESHOLD = 18;

function dp2HitTestParcelSegmentClosest(canvas, x, y) {
  const contours = dp2GetBuildingContours();
  let bestDist = Infinity;
  let best = null;
  for (let c = 0; c < contours.length; c++) {
    const contour = contours[c];
    if (!contour || !contour.id || !Array.isArray(contour.points)) continue;
    const pts = contour.points;
    const n = contour.closed ? pts.length : Math.max(0, pts.length - 1);
    for (let i = 0; i < n; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % pts.length];
      if (!p1 || !p2) continue;
      const ax = p1.x || 0;
      const ay = p1.y || 0;
      const bx = p2.x || 0;
      const by = p2.y || 0;
      const dx = bx - ax;
      const dy = by - ay;
      const lenSq = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lenSq));
      const projX = ax + t * dx;
      const projY = ay + t * dy;
      const d = Math.hypot(x - projX, y - projY);
      if (d <= DP2_PARCEL_SEGMENT_HIT_THRESHOLD && d < bestDist) {
        bestDist = d;
        best = { contourId: contour.id, segmentIndex: i, a: { x: ax, y: ay }, b: { x: bx, y: by } };
      }
    }
  }
  return best;
}

// DP2 — Hit-test étiquette de cote (texte "X,XX m") sur un segment de contour jaune. Pour drag visuel uniquement.
function dp2HitTestParcelSegmentLabel(canvas, x, y) {
  const contours = dp2GetBuildingContours();
  const objects = window.DP2_STATE?.objects || [];
  const halfW = 32;
  const halfH = 12;
  let best = null;
  for (let c = contours.length - 1; c >= 0; c--) {
    const contour = contours[c];
    if (!contour || !contour.id || !Array.isArray(contour.points)) continue;
    const pts = contour.points;
    const scale = window.DP2_STATE?.scale_m_per_px;
    if (pts.length < 2 || typeof scale !== "number" || scale <= 0) continue;
    const segments = contour.closed ? pts.length : pts.length - 1;
    const offMap = contour.labelOffsets && typeof contour.labelOffsets === "object" ? contour.labelOffsets : {};
    for (let i = segments - 1; i >= 0; i--) {
      const parcelEdgeML = objects.find(
        o => o && o.type === "measure_line" && o.__parcelEdge && o.__parcelEdge.contourId === contour.id && o.__parcelEdge.segmentIndex === i
      );
      if (parcelEdgeML) continue;
      const p1 = pts[i];
      const p2 = pts[(i + 1) % pts.length];
      if (!p1 || !p2) continue;
      const cutParts = contour.cuts && contour.cuts[i];
      let lx; let ly;
      if (Array.isArray(cutParts) && cutParts.length === 2 && cutParts[0]?.a && cutParts[0]?.b && cutParts[1]?.a && cutParts[1]?.b) {
        const m0x = (cutParts[0].a.x + cutParts[0].b.x) / 2;
        const m0y = (cutParts[0].a.y + cutParts[0].b.y) / 2;
        const m1x = (cutParts[1].a.x + cutParts[1].b.x) / 2;
        const m1y = (cutParts[1].a.y + cutParts[1].b.y) / 2;
        lx = (m0x + m1x) / 2;
        ly = (m0y + m1y) / 2;
      } else {
        lx = (p1.x + p2.x) / 2;
        ly = (p1.y + p2.y) / 2;
      }
      const off = offMap[i] && typeof offMap[i].x === "number" && typeof offMap[i].y === "number" ? offMap[i] : { x: 0, y: 0 };
      lx += off.x;
      ly += off.y;
      if (x >= lx - halfW && x <= lx + halfW && y >= ly - halfH && y <= ly + halfH)
        return { contourId: contour.id, segmentIndex: i };
    }
  }
  return null;
}

// DP2 — Hit-test repères A/B (measure_line avec requestedLengthM, sans resizeAnchor). Rayon ~11px. Inclut __parcelEdge (clic A/B sur le plan).
function dp2HitTestMeasureLineAnchor(canvas, x, y) {
  const objects = window.DP2_STATE?.objects || [];
  const R = 11;
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (!obj || obj.type !== "measure_line" || !obj.a || !obj.b) continue;
    if (typeof obj.requestedLengthM !== "number" || (obj.resizeAnchor === "A" || obj.resizeAnchor === "B")) continue;
    const dA = Math.hypot(x - obj.a.x, y - obj.a.y);
    const dB = Math.hypot(x - obj.b.x, y - obj.b.y);
    if (dA <= R && dA <= dB) return { objectIndex: i, anchor: "A" };
    if (dB <= R) return { objectIndex: i, anchor: "B" };
  }
  return null;
}

// DP2 — Hit-test étiquette de mesure (label longueur) : zone cliquable pour déplacement visuel uniquement.
// Ne teste pas le segment, uniquement la zone du texte (centre + labelOffset, box ~64×24 px).
// En mode prévisualisation (resizeAnchor A/B) on ne propose pas le drag d’étiquette.
function dp2HitTestMeasureLabel(canvas, x, y) {
  const objects = window.DP2_STATE?.objects || [];
  const halfW = 32;
  const halfH = 12;
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (!obj || obj.type !== "measure_line" || !obj.a || !obj.b || obj.__parcelEdge) continue;
    if (getMeasureLinePreviewPoints(obj)) continue;
    const midX = (obj.a.x + obj.b.x) / 2;
    const midY = (obj.a.y + obj.b.y) / 2;
    const offset = obj.labelOffset && typeof obj.labelOffset.x === "number" && typeof obj.labelOffset.y === "number"
      ? obj.labelOffset
      : { x: 0, y: 0 };
    const lx = midX + offset.x;
    const ly = midY + offset.y;
    if (x >= lx - halfW && x <= lx + halfW && y >= ly - halfH && y <= ly + halfH)
      return { kind: "measure_label", index: i };
  }
  return null;
}

// DP2 — Hit-test étiquette faîtage (label longueur) : même zone 64×24 que mesure, pour drag.
function dp2HitTestRidgeLabel(canvas, x, y) {
  const objects = window.DP2_STATE?.objects || [];
  const halfW = 32;
  const halfH = 12;
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (!obj || obj.type !== "ridge_line" || !obj.a || !obj.b) continue;
    const midX = (obj.a.x + obj.b.x) / 2;
    const midY = (obj.a.y + obj.b.y) / 2;
    const offset = obj.labelOffset && typeof obj.labelOffset.x === "number" && typeof obj.labelOffset.y === "number"
      ? obj.labelOffset
      : { x: 0, y: 0 };
    const lx = midX + offset.x;
    const ly = midY + offset.y;
    if (x >= lx - halfW && x <= lx + halfW && y >= ly - halfH && y <= ly + halfH)
      return { kind: "ridge_label", index: i };
  }
  return null;
}

function dp2IsMeasureLineEditingActive(obj) {
  if (!obj || obj.type !== "measure_line") return false;
  if (typeof obj.requestedLengthM === "number") return true;
  return false;
}
function dp2IsAnyMeasureOverlayOpen() {
  return !!document.getElementById("dp2-measure-anchor-overlay") ||
         !!document.getElementById("dp2-measure-resize-preview-overlay");
}

// --------------------------
// DP2 — PANNEAUX PV (calepinage simple)
// Stockage dédié : DP2_STATE.panels[] (modèle imposé)
// - Taille en px dérivée du module PV sélectionné + scale_m_per_px (aucune saisie manuelle)
// - Non redimensionnable (lockedSize=true)
// - Rotation libre (poignée rotation)
// - Snap intelligent : collage bord à bord droite/gauche/haut/bas (panneau↔panneau)
//   v1 : snap uniquement si rotations identiques (à epsilon près)
// --------------------------
const DP2_PANEL_STYLE = {
  fill: "rgba(17, 24, 39, 0.92)",      // très sombre (imprimable, lisible)
  stroke: "rgba(17, 24, 39, 0.98)",
  lineWidth: 1.5
};
const DP2_PANEL_PREVIEW_STYLE = {
  fill: "rgba(0, 0, 0, 1)",            // NOIR plein (preview)
  stroke: "rgba(0, 0, 0, 1)",
  lineWidth: 1
};
const DP2_PANEL_GHOST_STYLE = {
  fill: "rgba(200, 200, 200, 0.35)",   // GRIS clair semi-transparent (fantôme)
  stroke: "rgba(160, 160, 160, 0.55)",
  lineWidth: 1
};
const DP2_PANEL_SNAP_TOL_PX = 12;
const DP2_PANEL_SNAP_ANGLE_EPS_RAD = Math.PI / 90; // ~2°

function dp2NormalizeAngleRad(a) {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function dp2MetersToCanvasPx(meters) {
  const scale = window.DP2_STATE?.scale_m_per_px;
  if (typeof scale !== "number" || scale <= 0) return null;
  if (typeof meters !== "number" || !(meters > 0)) return null;
  return meters / scale;
}

function dp2GetPanelDimsPx() {
  const model = window.DP2_STATE?.panelModel || null;
  if (!model) return null;
  const wPx = dp2MetersToCanvasPx(model.width_m);
  const hPx = dp2MetersToCanvasPx(model.height_m);
  if (!(wPx > 0) || !(hPx > 0)) return null;
  return { wPx, hPx };
}

function dp2GetPanelById(id) {
  const items = window.DP2_STATE?.panels || [];
  for (const p of items) {
    if (p && p.id === id) return p;
  }
  return null;
}

function dp2PanelCenterFromGeometry(g) {
  const w = g?.width || 0;
  const h = g?.height || 0;
  return { x: (g?.x || 0) + w / 2, y: (g?.y || 0) + h / 2 };
}

function dp2GetEffectiveSelectedPanelIds() {
  const state = window.DP2_STATE;
  if (!state) return [];
  const ids = Array.isArray(state.selectedPanelIds) ? state.selectedPanelIds.filter(Boolean) : [];
  if (ids.length) return ids;
  const single = state.selectedPanelId || null;
  return single ? [single] : [];
}

function dp2SetSelectedPanelIds(ids) {
  const state = window.DP2_STATE;
  if (!state) return;
  const uniq = [];
  const seen = new Set();
  for (const id of Array.isArray(ids) ? ids : []) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    uniq.push(id);
  }
  state.selectedPanelIds = uniq;
  state.selectedPanelId = uniq.length === 1 ? uniq[0] : null;
  // Multi-sélection = panneaux uniquement : désélectionner les autres types
  state.selectedObjectId = null;
  state.selectedBusinessObjectId = null;
  state.selectedBuildingContourId = null;
  dp2ClearSelectedTexts();
}

function dp2ClearSelectedPanels() {
  const state = window.DP2_STATE;
  if (!state) return;
  state.selectedPanelIds = [];
  state.selectedPanelId = null;
}

function dp2GetTextById(id) {
  const items = window.DP2_STATE?.textObjects || [];
  for (const t of items) {
    if (t && t.id === id) return t;
  }
  return null;
}

function dp2GetEffectiveSelectedTextIds() {
  const state = window.DP2_STATE;
  if (!state) return [];
  const ids = Array.isArray(state.selectedTextIds) ? state.selectedTextIds.filter(Boolean) : [];
  if (ids.length) return ids;
  const single = state.selectedTextId || null;
  return single ? [single] : [];
}

function dp2SetSelectedTextIds(ids) {
  const state = window.DP2_STATE;
  if (!state) return;
  const uniq = [];
  const seen = new Set();
  for (const id of Array.isArray(ids) ? ids : []) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    uniq.push(id);
  }
  state.selectedTextIds = uniq;
  state.selectedTextId = uniq.length === 1 ? uniq[0] : null;
  // Multi-sélection = textes uniquement : désélectionner les autres types
  state.selectedObjectId = null;
  state.selectedBusinessObjectId = null;
  state.selectedBuildingContourId = null;
  dp2ClearSelectedPanels();
}

function dp2ClearSelectedTexts() {
  const state = window.DP2_STATE;
  if (!state) return;
  state.selectedTextIds = [];
  state.selectedTextId = null;
}

function dp2PointInAABB(x, y, aabb) {
  if (!aabb) return false;
  return x >= aabb.minX && x <= aabb.maxX && y >= aabb.minY && y <= aabb.maxY;
}

function dp2PanelWorldAABB(g) {
  const w = g?.width || 0;
  const h = g?.height || 0;
  if (!(w > 0) || !(h > 0)) return null;
  const rot = g?.rotation || 0;
  const cx = (g?.x || 0) + w / 2;
  const cy = (g?.y || 0) + h / 2;
  const sx = (typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile()) ? (g?.displayScaleX ?? g?.displayScale ?? 1) : 1;
  const sy = (typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile()) ? (g?.displayScaleY ?? g?.displayScale ?? 1) : 1;
  const hw = (w / 2) * sx;
  const hh = (h / 2) * sy;
  const cornersLocal = [
    { x: -hw, y: -hh },
    { x: +hw, y: -hh },
    { x: +hw, y: +hh },
    { x: -hw, y: +hh }
  ];
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of cornersLocal) {
    const wx = cx + (p.x * c - p.y * s);
    const wy = cy + (p.x * s + p.y * c);
    if (wx < minX) minX = wx;
    if (wy < minY) minY = wy;
    if (wx > maxX) maxX = wx;
    if (wy > maxY) maxY = wy;
  }
  return { minX, minY, maxX, maxY, cx, cy };
}

function dp2PanelsGroupAABB(ids) {
  const items = window.DP2_STATE?.panels || [];
  const idSet = new Set(Array.isArray(ids) ? ids : []);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let count = 0;
  for (const p of items) {
    if (!p || p.type !== "panel" || p.visible !== true || !p.geometry) continue;
    if (!idSet.has(p.id)) continue;
    const aabb = dp2PanelWorldAABB(p.geometry);
    if (!aabb) continue;
    count++;
    if (aabb.minX < minX) minX = aabb.minX;
    if (aabb.minY < minY) minY = aabb.minY;
    if (aabb.maxX > maxX) maxX = aabb.maxX;
    if (aabb.maxY > maxY) maxY = aabb.maxY;
  }
  if (count < 2) return null;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { minX, minY, maxX, maxY, cx, cy };
}

function dp2HitTestPanelGroup(x, y) {
  const ids = dp2GetEffectiveSelectedPanelIds();
  if (ids.length < 2) return null;
  const aabb = dp2PanelsGroupAABB(ids);
  if (!aabb) return null;
  const rotateHandleOffset = 18;
  const hr = 8;
  const hx = aabb.cx;
  const hy = aabb.minY - rotateHandleOffset;
  const onRotate = Math.hypot(x - hx, y - hy) <= hr;
  if (onRotate) return { part: "rotate", aabb };
  if (typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile()) {
    const scaleHx = aabb.maxX + 14;
    const scaleHy = aabb.maxY + 14;
    const half = 4;
    const onScale = Math.abs(x - scaleHx) <= half && Math.abs(y - scaleHy) <= half;
    if (onScale) return { part: "scale", aabb };
  }
  if (dp2PointInAABB(x, y, aabb)) return { part: "body", aabb };
  return null;
}

function dp2PanelHitTestPart(panel, x, y) {
  if (!panel || panel.type !== "panel" || panel.visible !== true || !panel.geometry) return null;
  const g = panel.geometry;
  const w = g.width || 0;
  const h = g.height || 0;
  if (!(w > 0) || !(h > 0)) return null;

  const c0 = dp2PanelCenterFromGeometry(g);
  const rot = g.rotation || 0;
  const dx = x - c0.x;
  const dy = y - c0.y;
  const c = Math.cos(-rot);
  const s = Math.sin(-rot);
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  const inside = lx >= -w / 2 && lx <= w / 2 && ly >= -h / 2 && ly <= h / 2;
  const rotateHandleOffset = 18;
  const rhX = 0;
  const rhY = -h / 2 - rotateHandleOffset;
  const onRotateHandle = Math.hypot(lx - rhX, ly - rhY) <= 8;
  if (onRotateHandle) return "rotate";
  if (typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile()) {
    const half = 4;
    const sx = g.displayScaleX ?? g.displayScale ?? 1;
    const sy = g.displayScaleY ?? g.displayScale ?? 1;
    const wEff = w * sx;
    const hEff = h * sy;
    const handleX = wEff / 2 + 14;
    const handleY = hEff / 2 + 14;
    const onScale = Math.abs(lx - handleX) <= half && Math.abs(ly - handleY) <= half;
    if (onScale) return "scale";
  }
  if (inside) return "body";
  return null;
}

function dp2HitTestPanel(x, y) {
  const items = window.DP2_STATE?.panels || [];
  for (let i = items.length - 1; i >= 0; i--) {
    const panel = items[i];
    const part = dp2PanelHitTestPart(panel, x, y);
    if (part) return { id: panel.id, part };
  }
  return null;
}

function dp2TrySnapPanel(previewGeom, pointerWorld, excludePanelId) {
  const items = window.DP2_STATE?.panels || [];
  const gA = previewGeom || null;
  if (!gA) return null;
  const wA = gA.width || 0;
  const hA = gA.height || 0;
  if (!(wA > 0) || !(hA > 0)) return null;
  const rotA = gA.rotation || 0;
  const aCenter = dp2PanelCenterFromGeometry(gA);

  const tol = DP2_PANEL_SNAP_TOL_PX;
  const angleTol = DP2_PANEL_SNAP_ANGLE_EPS_RAD;

  let best = null; // { score, targetCenterWorld:{x,y} }

  for (const b of items) {
    if (!b || b.type !== "panel" || b.visible !== true || !b.geometry) continue;
    if (excludePanelId && b.id === excludePanelId) continue;
    const gB = b.geometry;
    const wB = gB.width || 0;
    const hB = gB.height || 0;
    if (!(wB > 0) || !(hB > 0)) continue;

    const rotB = gB.rotation || 0;
    const dRot = Math.abs(dp2NormalizeAngleRad(rotA - rotB));
    if (dRot > angleTol) continue;

    const bCenter = dp2PanelCenterFromGeometry(gB);

    // A center in B-local coordinates
    const relX = aCenter.x - bCenter.x;
    const relY = aCenter.y - bCenter.y;
    const c = Math.cos(-rotB);
    const s = Math.sin(-rotB);
    const ax = relX * c - relY * s;
    const ay = relX * s + relY * c;

    const hxA = wA / 2;
    const hyA = hA / 2;
    const hxB = wB / 2;
    const hyB = hB / 2;

    const cyAlign = [0, hyA - hyB, hyB - hyA]; // centre, haut, bas
    const cxAlign = [0, hxA - hxB, hxB - hxA]; // centre, gauche, droite

    const candidates = [];
    // collé à droite / collé à gauche
    for (const cy of cyAlign) {
      candidates.push({ cx: +hxB + hxA, cy });
      candidates.push({ cx: -hxB - hxA, cy });
    }
    // collé en haut / collé en bas
    for (const cx0 of cxAlign) {
      candidates.push({ cx: cx0, cy: +hyB + hyA });
      candidates.push({ cx: cx0, cy: -hyB - hyA });
    }

    for (const cand of candidates) {
      const dx = Math.abs(ax - cand.cx);
      const dy = Math.abs(ay - cand.cy);
      if (dx > tol || dy > tol) continue;

      // cand center in world coordinates
      const cwX = bCenter.x + (cand.cx * Math.cos(rotB) - cand.cy * Math.sin(rotB));
      const cwY = bCenter.y + (cand.cx * Math.sin(rotB) + cand.cy * Math.cos(rotB));

      const px = pointerWorld?.x != null ? pointerWorld.x : aCenter.x;
      const py = pointerWorld?.y != null ? pointerWorld.y : aCenter.y;
      const score = Math.hypot(px - cwX, py - cwY); // distance au pointeur

      if (best && score >= best.score) continue;
      best = {
        score,
        targetCenterWorld: { x: cwX, y: cwY }
      };
    }
  }

  return best;
}

// --------------------------
// DP2 — HIT-TEST (formes métier) + helpers géométriques (ÉTAPE 6)
// --------------------------
function getDP2BusinessObjectById(id) {
  const items = window.DP2_STATE?.businessObjects || [];
  for (const obj of items) {
    if (obj && obj.id === id) return obj;
  }
  return null;
}

function dp2BusinessWorldToLocal(obj, x, y) {
  const g = obj?.geometry;
  const w = g?.width || 0;
  const h = g?.height || 0;
  const cx = (g?.x || 0) + w / 2;
  const cy = (g?.y || 0) + h / 2;
  const rot = g?.rotation || 0;
  const dx = x - cx;
  const dy = y - cy;
  const c = Math.cos(-rot);
  const s = Math.sin(-rot);
  return {
    x: dx * c - dy * s + cx,
    y: dx * s + dy * c + cy,
    cx,
    cy
  };
}

function dp2TextWorldToLocal(textObj, x, y) {
  const g = textObj?.geometry;
  const w = g?.width || 0;
  const h = g?.height || 0;
  const cx = (g?.x || 0) + w / 2;
  const cy = (g?.y || 0) + h / 2;
  const rot = g?.rotation || 0;
  const dx = x - cx;
  const dy = y - cy;
  const c = Math.cos(-rot);
  const s = Math.sin(-rot);
  return { x: dx * c - dy * s + cx, y: dx * s + dy * c + cy, cx, cy };
}

function dp2TextsGroupAABB(ids) {
  const items = window.DP2_STATE?.textObjects || [];
  const idSet = new Set(Array.isArray(ids) ? ids : []);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let count = 0;
  for (const t of items) {
    if (!t || t.type !== "text" || t.visible !== true || !t.geometry) continue;
    if (!idSet.has(t.id)) continue;
    const aabb = dp2PanelWorldAABB(t.geometry); // même géométrie qu’un panneau (x,y,w,h,rot)
    if (!aabb) continue;
    count++;
    if (aabb.minX < minX) minX = aabb.minX;
    if (aabb.minY < minY) minY = aabb.minY;
    if (aabb.maxX > maxX) maxX = aabb.maxX;
    if (aabb.maxY > maxY) maxY = aabb.maxY;
  }
  if (count < 2) return null;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { minX, minY, maxX, maxY, cx, cy };
}

function dp2HitTestText(x, y) {
  const state = window.DP2_STATE;
  const items = state?.textObjects || [];
  const handleSize = 10;
  const rotateHandleR = 8;
  const rotateHandleOffset = 18;
  const selectedIds = typeof dp2GetEffectiveSelectedTextIds === "function" ? dp2GetEffectiveSelectedTextIds() : [];
  const selectedSingleId = selectedIds.length === 1 ? selectedIds[0] : null;

  function isDPKind(kind) {
    return kind === "DP6" || kind === "DP7" || kind === "DP8";
  }

  for (let i = items.length - 1; i >= 0; i--) {
    const obj = items[i];
    if (!obj || obj.type !== "text" || obj.visible !== true || !obj.geometry) continue;
    const g = obj.geometry;
    const w = g.width || 0;
    const h = g.height || 0;
    if (!(w > 0) || !(h > 0)) continue;

    const local = dp2TextWorldToLocal(obj, x, y);
    const lx = local.x;
    const ly = local.y;
    const inside = lx >= g.x && lx <= g.x + w && ly >= g.y && ly <= g.y + h;

    // Handles uniquement sur le texte déjà sélectionné (évite des actions inattendues)
    if (selectedSingleId && obj.id === selectedSingleId) {
      const rhX = g.x + w / 2;
      const rhY = g.y - rotateHandleOffset;
      if (Math.hypot(lx - rhX, ly - rhY) <= rotateHandleR) return { id: obj.id, part: "rotate" };

      const kind = obj.textKind || "free";
      // DP6/DP7/DP8 : une seule poignée resize (coin bas-droit), resize uniforme strict
      if (isDPKind(kind)) {
        const hx = g.x + w;
        const hy = g.y + h;
        if (lx >= hx - handleSize && lx <= hx + handleSize && ly >= hy - handleSize && ly <= hy + handleSize) {
          return { id: obj.id, part: "resize", handle: "br" };
        }
      } else {
        // Texte libre : poignées classiques (coins + côtés), resize libre (W/H indépendants)
        const handles = [
          { handle: "tl", x: g.x, y: g.y },
          { handle: "tr", x: g.x + w, y: g.y },
          { handle: "bl", x: g.x, y: g.y + h },
          { handle: "br", x: g.x + w, y: g.y + h },
          { handle: "tm", x: g.x + w / 2, y: g.y },
          { handle: "bm", x: g.x + w / 2, y: g.y + h },
          { handle: "ml", x: g.x, y: g.y + h / 2 },
          { handle: "mr", x: g.x + w, y: g.y + h / 2 }
        ];
        for (const hh of handles) {
          if (lx >= hh.x - handleSize && lx <= hh.x + handleSize && ly >= hh.y - handleSize && ly <= hh.y + handleSize) {
            return { id: obj.id, part: "resize", handle: hh.handle };
          }
        }
      }
    }

    if (inside) return { id: obj.id, part: "body" };
  }
  return null;
}

function dp2NormalizeRectFromDrag(ax, ay, bx, by, minSize) {
  const min = typeof minSize === "number" ? minSize : 8;
  const x = Math.min(ax, bx);
  const y = Math.min(ay, by);
  const w = Math.max(min, Math.abs(bx - ax));
  const h = Math.max(min, Math.abs(by - ay));
  return { x, y, width: w, height: h };
}

function dp2IsVectorCreateBusinessType(type) {
  return type === "sens_pente" || type === "voie_acces" || type === "arrow" || type === "angle_vue";
}

function dp2HitTestBusiness(x, y) {
  const items = window.DP2_STATE?.businessObjects || [];
  const handleSize = 10;
  const rotateHandleR = 8;
  const rotateHandleOffset = 18;
  // En mode "Sélection" (neutre), on conserve uniquement sélection/déplacement :
  // pas de handles resize/rotate, donc pas d'actions associées.
  const tool = window.DP2_STATE?.currentTool || "select";
  const allowHandles = isDP2BusinessTool(tool);

  for (let i = items.length - 1; i >= 0; i--) {
    const obj = items[i];
    if (!obj || obj.visible !== true || !obj.geometry) continue;
    const g = obj.geometry;
    const w = g.width || 0;
    const h = g.height || 0;
    if (!(w > 0) || !(h > 0)) continue;

    // Convertir le point monde -> repère non-rotaté (local) via rotation inverse autour du centre
    const local = dp2BusinessWorldToLocal(obj, x, y);
    const lx = local.x;
    const ly = local.y;

    const inside = lx >= g.x && lx <= g.x + w && ly >= g.y && ly <= g.y + h;

    if (allowHandles) {
      // Rotation handle : au-dessus du centre haut du bbox
      const rhX = g.x + w / 2;
      const rhY = g.y - rotateHandleOffset;
      if (Math.hypot(lx - rhX, ly - rhY) <= rotateHandleR) {
        return { id: obj.id, part: "rotate" };
      }

      // Resize handle : coin bas-droit
      const hx = g.x + w;
      const hy = g.y + h;
      if (lx >= hx - handleSize && lx <= hx + handleSize && ly >= hy - handleSize && ly <= hy + handleSize) {
        return { id: obj.id, part: "resize" };
      }
    }

    if (inside) return { id: obj.id, part: "body" };
  }
  return null;
}

// --------------------------
// DP2 — ÉVÉNEMENTS CANVAS (clic / double-clic)
// Contour bâti : ajout de points, fermeture (clic proche premier point ou double-clic).
// --------------------------
const DP2_CLOSE_THRESHOLD_PX = 15;

function initDP2CanvasEvents() {
  const canvas = document.getElementById("dp2-draw-canvas");
  if (!canvas) return;
  // Anti double-binding (si le DOM est re-monté / réutilisé)
  if (canvas.dataset.dp2Bound === "1") return;
  canvas.dataset.dp2Bound = "1";

  // Bind suppression clavier (une seule fois)
  if (window.DP2_STATE && window.DP2_STATE._businessKeyHandlerBound !== true) {
    window.DP2_STATE._businessKeyHandlerBound = true;
    window.addEventListener("keydown", (e) => {
      const key = e.key;
      if (key !== "Delete" && key !== "Backspace") return;
      const activeEl = document.activeElement;
      const typing =
        activeEl &&
        (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable);
      if (typing) return;

      const bizId = window.DP2_STATE?.selectedBusinessObjectId || null;
      const panelIds = typeof dp2GetEffectiveSelectedPanelIds === "function" ? dp2GetEffectiveSelectedPanelIds() : [];
      const textIds = typeof dp2GetEffectiveSelectedTextIds === "function" ? dp2GetEffectiveSelectedTextIds() : [];
      // IMPORTANT: au clavier, on ne supprime QUE formes métier + panneaux + textes (pas les objets standards).
      if (!bizId && (!panelIds || !panelIds.length) && (!textIds || !textIds.length)) return;

      dp2CommitHistoryPoint();

      // 0) Textes (suppression groupée)
      if (textIds && textIds.length) {
        const idSet = new Set(textIds.filter(Boolean));
        const items = Array.isArray(window.DP2_STATE.textObjects) ? window.DP2_STATE.textObjects : [];
        const kept = [];
        for (const t of items) {
          if (!t || !t.id || !idSet.has(t.id)) kept.push(t);
        }
        window.DP2_STATE.textObjects = kept;
        dp2ClearSelectedTexts();
        window.DP2_STATE.textInteraction = null;
        renderDP2FromState();
        e.preventDefault();
        return;
      }

      // 1) Priorité : forme métier
      if (bizId) {
        const items = window.DP2_STATE.businessObjects || [];
        const idx = items.findIndex((o) => o && o.id === bizId);
        if (idx >= 0) {
          items.splice(idx, 1);
          window.DP2_STATE.selectedBusinessObjectId = null;
          renderDP2FromState();
          e.preventDefault();
        }
        return;
      }

      // 2) Ensuite : panneau PV (suppression groupée si multi-sélection active)
      if (panelIds && panelIds.length) {
        const idSet = new Set(panelIds.filter(Boolean));
        const items = Array.isArray(window.DP2_STATE.panels) ? window.DP2_STATE.panels : [];
        const kept = [];
        for (const p of items) {
          if (!p || !p.id || !idSet.has(p.id)) kept.push(p);
        }
        window.DP2_STATE.panels = kept;
        dp2ClearSelectedPanels();
        window.DP2_STATE.selectionRect = null;
        window.DP2_STATE.panelGroupInteraction = null;
        window.DP2_STATE.panelInteraction = null;
        renderDP2FromState();
        e.preventDefault();
      }
    });
  }

  // Interaction pointer (formes métier + panneaux PV) : création / move / resize / rotation
  canvas.addEventListener("pointerdown", (e) => {
    const tool = window.DP2_STATE?.currentTool || "select";
    if (tool === "pan") return;
    if (tool !== "select" && tool !== "panels" && !isDP2BusinessTool(tool) && !isDP2TextTool(tool)) return;

    const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);

    // 0) Étiquette de mesure (label) : candidat au drag (seuil 4px en pointermove) — uniquement outil Sélection, avant tout autre hit
    if (tool === "select") {
      const hitLabel = dp2HitTestMeasureLabel(canvas, coords.x, coords.y);
      if (hitLabel && hitLabel.kind === "measure_label" && typeof hitLabel.index === "number") {
        const obj = window.DP2_STATE?.objects?.[hitLabel.index];
        if (!dp2IsAnyMeasureOverlayOpen() && !dp2IsMeasureLineEditingActive(obj)) {
          const offset = obj?.labelOffset && typeof obj.labelOffset.x === "number" && typeof obj.labelOffset.y === "number"
            ? { x: obj.labelOffset.x, y: obj.labelOffset.y }
            : { x: 0, y: 0 };
          window.DP2_STATE.measureLabelDragCandidate = {
            objectIndex: hitLabel.index,
            pointerId: e.pointerId,
            startCanvasX: coords.x,
            startCanvasY: coords.y,
            startOffsetX: offset.x,
            startOffsetY: offset.y
          };
          try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
          e.preventDefault();
          renderDP2FromState();
          return;
        }
      }
    }

    // 0) DP2 — Drag étiquette de cote (segment jaune) : déplacement visuel uniquement
    if (tool === "select") {
      const hitParcelLabel = dp2HitTestParcelSegmentLabel(canvas, coords.x, coords.y);
      if (hitParcelLabel && hitParcelLabel.contourId != null && typeof hitParcelLabel.segmentIndex === "number") {
        const contour = dp2GetBuildingContourById(hitParcelLabel.contourId);
        if (contour) {
          dp2CommitHistoryPoint();
          if (!contour.labelOffsets || typeof contour.labelOffsets !== "object") contour.labelOffsets = {};
          const off = contour.labelOffsets[hitParcelLabel.segmentIndex];
          const ox = off && typeof off.x === "number" ? off.x : 0;
          const oy = off && typeof off.y === "number" ? off.y : 0;
          window.DP2_STATE.parcelLabelDrag = {
            contourId: hitParcelLabel.contourId,
            segmentIndex: hitParcelLabel.segmentIndex,
            pointerId: e.pointerId,
            startClientX: e.clientX,
            startClientY: e.clientY,
            startCanvasX: coords.x,
            startCanvasY: coords.y,
            startOffsetX: ox,
            startOffsetY: oy
          };
          try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
          e.preventDefault();
          renderDP2FromState();
          return;
        }
      }
    }

    // DP2 — Drag étiquette faîtage (label longueur) : même logique que étiquette mesure
    if (tool === "select") {
      const hitRidgeLabel = dp2HitTestRidgeLabel(canvas, coords.x, coords.y);
      if (hitRidgeLabel && hitRidgeLabel.kind === "ridge_label" && typeof hitRidgeLabel.index === "number") {
        const obj = window.DP2_STATE?.objects?.[hitRidgeLabel.index];
        if (obj && obj.type === "ridge_line") {
          const offset = obj.labelOffset && typeof obj.labelOffset.x === "number" && typeof obj.labelOffset.y === "number"
            ? { x: obj.labelOffset.x, y: obj.labelOffset.y }
            : { x: 0, y: 0 };
          dp2CommitHistoryPoint();
          window.DP2_STATE.ridgeLabelDrag = {
            objectIndex: hitRidgeLabel.index,
            pointerId: e.pointerId,
            startCanvasX: coords.x,
            startCanvasY: coords.y,
            startOffsetX: offset.x,
            startOffsetY: offset.y
          };
          try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
          e.preventDefault();
          renderDP2FromState();
          return;
        }
      }
    }

    // 0) DP2 — Contours de bâti : sélection + drag d'un sommet (uniquement en mode Sélection)
    if (tool === "select") {
      const hitAny = dp2HitTest(canvas, coords.x, coords.y);
      if (hitAny && hitAny.kind === "building_contour" && hitAny.id) {
        dp2SetSelectedBuildingContourId(hitAny.id);
        // Drag seulement si on est sur un sommet
        if (typeof hitAny.vertexIndex === "number") {
          const contour = dp2GetBuildingContourById(hitAny.id);
          const pt = contour?.points?.[hitAny.vertexIndex] || null;
          if (contour && pt) {
            dp2CommitHistoryPoint();
            window.DP2_STATE.buildingContourInteraction = {
              id: hitAny.id,
              vertexIndex: hitAny.vertexIndex,
              pointerId: e.pointerId,
              offsetX: coords.x - (pt.x || 0),
              offsetY: coords.y - (pt.y || 0),
              hasMoved: false
            };
            try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
            e.preventDefault();
            renderDP2FromState();
            return;
          }
        }
        // Clic sur contour (pas sur sommet) = sélection simple
        renderDP2FromState();
        return;
      }
    }

    // DP2 — Drag sommet faitage ou mesure (même logique que contour de bâti)
    if (tool === "select") {
      const hitLine = dp2HitTest(canvas, coords.x, coords.y);
      if (hitLine && hitLine.kind === "object" && (hitLine.vertexAnchor === "A" || hitLine.vertexAnchor === "B")) {
        const obj = window.DP2_STATE?.objects?.[hitLine.index];
        if (obj && (obj.type === "ridge_line" || obj.type === "measure_line") && obj.a && obj.b) {
          const pt = hitLine.vertexAnchor === "A" ? obj.a : obj.b;
          dp2CommitHistoryPoint();
          window.DP2_STATE.lineVertexInteraction = {
            objectIndex: hitLine.index,
            anchor: hitLine.vertexAnchor,
            pointerId: e.pointerId,
            offsetX: coords.x - (pt.x || 0),
            offsetY: coords.y - (pt.y || 0),
            hasMoved: false
          };
          try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
          e.preventDefault();
          renderDP2FromState();
          return;
        }
      }
    }

    const hitText = dp2HitTestText(coords.x, coords.y);

    // 0) Textes (annotations) : sélection + move/resize/rotate
    if (hitText && hitText.id) {
      const obj = dp2GetTextById(hitText.id);
      if (!obj || !obj.geometry) return;
      dp2ClearSelectedPanels();
      window.DP2_STATE.selectedBusinessObjectId = null;
      window.DP2_STATE.selectedObjectId = null;
      dp2SetSelectedTextIds([obj.id]);
      // Éviter qu'un click "outil panneaux" pose un panneau après sélection texte
      window.DP2_STATE._lastTextInteractionAt = Date.now();
      // Interaction uniquement si sélection unique
      if (dp2GetEffectiveSelectedTextIds().length === 1) {
        dp2CommitHistoryPoint();
        const g = obj.geometry;
        const cx = g.x + (g.width || 0) / 2;
        const cy = g.y + (g.height || 0) / 2;
        window.DP2_STATE.textInteraction = {
          id: obj.id,
          part: hitText.part,
          resizeHandle: hitText.part === "resize" ? (hitText.handle || "br") : null,
          pointerId: e.pointerId,
          startClientX: e.clientX,
          startClientY: e.clientY,
          startX: g.x,
          startY: g.y,
          startW: g.width,
          startH: g.height,
          startRotation: g.rotation || 0,
          startFontSize: typeof obj.fontSize === "number" ? obj.fontSize : DP2_TEXT_DEFAULT_FONT_SIZE,
          cx,
          cy,
          startAngle: Math.atan2(coords.y - cy, coords.x - cx),
          hasMoved: false
        };
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        e.preventDefault();
      }
      renderDP2FromState();
      return;
    }

    // 0bis) Outil texte actif : rubber-band de création (prioritaire sur le reste)
    if (isDP2TextTool(tool)) {
      dp2ClearSelectedPanels();
      window.DP2_STATE.selectedBusinessObjectId = null;
      window.DP2_STATE.selectedObjectId = null;
      dp2ClearSelectedTexts();
      window.DP2_STATE.textInteraction = {
        part: "create",
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        anchorX: coords.x,
        anchorY: coords.y,
        curX: coords.x,
        curY: coords.y,
        tool,
        hasMoved: false
      };
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
      renderDP2FromState();
      return;
    }

    const hitBiz = dp2HitTestBusiness(coords.x, coords.y);

    // 1) Priorité : objets métier (dessinés au-dessus des objets standards)
    if (hitBiz && hitBiz.id) {
      const obj = getDP2BusinessObjectById(hitBiz.id);
      if (!obj || !obj.geometry) return;
      // Sélection panneaux (simple ou groupée) => désélectionnée si on touche un objet métier
      dp2ClearSelectedPanels();
      dp2ClearSelectedTexts();
      window.DP2_STATE.selectedBuildingContourId = null;
      window.DP2_STATE.selectedBusinessObjectId = obj.id;
      dp2CommitHistoryPoint();

      const g = obj.geometry;
      const cx = g.x + (g.width || 0) / 2;
      const cy = g.y + (g.height || 0) / 2;
      window.DP2_STATE.businessInteraction = {
        id: obj.id,
        part: hitBiz.part,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: g.x,
        startY: g.y,
        startW: g.width,
        startH: g.height,
        startRotation: g.rotation || 0,
        cx,
        cy,
        startAngle: Math.atan2(coords.y - cy, coords.x - cx),
        hasMoved: false
      };
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
      renderDP2FromState();
      return;
    }

    // 1bis) Sélection groupée panneaux : si l'utilisateur clique dans la bbox de groupe / poignée rotation
    if (tool === "select") {
      const groupHit = dp2HitTestPanelGroup(coords.x, coords.y);
      if (groupHit && groupHit.part) {
        const ids = dp2GetEffectiveSelectedPanelIds();
        if (ids.length >= 2) {
          const startById = {};
          for (const id of ids) {
            const p = dp2GetPanelById(id);
            if (!p || !p.geometry) continue;
            startById[id] = {
              x: p.geometry.x || 0,
              y: p.geometry.y || 0,
              rotation: p.geometry.rotation || 0,
              width: p.geometry.width || 0,
              height: p.geometry.height || 0,
              displayScaleX: p.geometry.displayScaleX ?? p.geometry.displayScale ?? 1,
              displayScaleY: p.geometry.displayScaleY ?? p.geometry.displayScale ?? 1
            };
          }
          dp2CommitHistoryPoint();
          const firstId = ids[0];
          const firstStart = startById[firstId];
          const firstPanel = firstId ? dp2GetPanelById(firstId) : null;
          const groupScaleInit = groupHit.part === "scale" && typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile() ? {
            basisAngle: (firstPanel?.geometry?.rotation ?? firstStart?.rotation ?? 0),
            startScaleX: firstStart?.displayScaleX ?? 1,
            startScaleY: firstStart?.displayScaleY ?? 1
          } : undefined;
          window.DP2_STATE.panelGroupInteraction = {
            ids,
            part: groupHit.part,
            pointerId: e.pointerId,
            startClientX: e.clientX,
            startClientY: e.clientY,
            groupCx: groupHit.aabb?.cx,
            groupCy: groupHit.aabb?.cy,
            startAngle: Math.atan2(coords.y - (groupHit.aabb?.cy || 0), coords.x - (groupHit.aabb?.cx || 0)),
            startById,
            startPointerX: groupHit.part === "scale" ? coords.x : undefined,
            startPointerY: groupHit.part === "scale" ? coords.y : undefined,
            hasMoved: false,
            basisAngle: groupScaleInit?.basisAngle,
            startScaleX: groupScaleInit?.startScaleX,
            startScaleY: groupScaleInit?.startScaleY
          };
          try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
          e.preventDefault();
          renderDP2FromState();
          return;
        }
      }
    }

    // 2) Panneaux PV : sélection / move / rotation (sans resize)
    // En outil "Panneaux", le clic vide doit créer (géré dans le handler click) → ici seulement si hit panneau.
    const hitPanel = dp2HitTestPanel(coords.x, coords.y);
    if (hitPanel && hitPanel.id) {
      const panel = dp2GetPanelById(hitPanel.id);
      if (!panel || !panel.geometry) return;
      dp2SetSelectedPanelIds([panel.id]);
      // Démarrer interaction
      dp2CommitHistoryPoint();
      const g = panel.geometry;
      const w = g.width || 0;
      const h = g.height || 0;
      const cx = (g.x || 0) + w / 2;
      const cy = (g.y || 0) + h / 2;
      window.DP2_STATE.panelInteraction = {
        id: panel.id,
        part: hitPanel.part,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: g.x || 0,
        startY: g.y || 0,
        startRotation: g.rotation || 0,
        cx,
        cy,
        startAngle: Math.atan2(coords.y - cy, coords.x - cx),
        startScaleX: hitPanel.part === "scale" ? (g.displayScaleX ?? g.displayScale ?? 1) : undefined,
        startScaleY: hitPanel.part === "scale" ? (g.displayScaleY ?? g.displayScale ?? 1) : undefined,
        startPointerX: hitPanel.part === "scale" ? coords.x : undefined,
        startPointerY: hitPanel.part === "scale" ? coords.y : undefined,
        hasMoved: false
      };
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
      renderDP2FromState();
      return;
    }

    // 2bis) En mode Sélection : clic sur zone vide => démarrer un rectangle de sélection (rubber-band)
    if (tool === "select") {
      const hitStdIdx = dp2HitTest(canvas, coords.x, coords.y);
      if (hitStdIdx != null) return; // zone non vide (objet ou contour) : laisser le click handler gérer la sélection
      window.DP2_STATE.selectionRect = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: coords.x,
        startY: coords.y,
        curX: coords.x,
        curY: coords.y,
        hasMoved: false
      };
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
      renderDP2FromState();
      return;
    }

    // Create new (business tool)
    if (isDP2BusinessTool(tool)) {
      const meta = DP2_BUSINESS_OBJECT_META[tool];
      const vectorCreate = dp2IsVectorCreateBusinessType(tool);
      dp2ClearSelectedTexts();
      dp2CommitHistoryPoint();
      const created = createDP2BusinessObject(tool, {
        x: coords.x,
        y: coords.y,
        width: 1,
        height: 1,
        rotation: 0
      });
      if (!created) return;
      window.DP2_STATE.businessObjects.push(created);
      window.DP2_STATE.selectedBusinessObjectId = created.id;
      window.DP2_STATE.businessInteraction = {
        id: created.id,
        part: "create",
        pointerId: e.pointerId,
        anchorX: coords.x,
        anchorY: coords.y,
        metaDefaultW: meta?.defaultW || 80,
        metaDefaultH: meta?.defaultH || 50,
        createMode: vectorCreate ? "vector" : "box",
        hasMoved: false
      };
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
      renderDP2FromState();
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    // Candidat drag label : promouvoir en vrai drag après seuil 4px
    const cand = window.DP2_STATE?.measureLabelDragCandidate || null;
    if (cand && typeof cand.pointerId === "number" && cand.pointerId === e.pointerId) {
      const cur = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
      const dist = Math.hypot(cur.x - (cand.startCanvasX || 0), cur.y - (cand.startCanvasY || 0));
      if (dist < 4) return;
      window.DP2_STATE.measureLabelDrag = {
        objectIndex: cand.objectIndex,
        pointerId: cand.pointerId,
        startCanvasX: cand.startCanvasX,
        startCanvasY: cand.startCanvasY,
        startOffsetX: cand.startOffsetX,
        startOffsetY: cand.startOffsetY
      };
      delete window.DP2_STATE.measureLabelDragCandidate;
    }

    // DP2 — Drag étiquette de cote (segment jaune) : déplacement visuel uniquement
    const pld = window.DP2_STATE?.parcelLabelDrag || null;
    if (pld && typeof pld.pointerId === "number" && pld.pointerId === e.pointerId) {
      const contour = dp2GetBuildingContourById(pld.contourId);
      if (contour) {
        const cur = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
        const dx = cur.x - (pld.startCanvasX || 0);
        const dy = cur.y - (pld.startCanvasY || 0);
        if (!contour.labelOffsets || typeof contour.labelOffsets !== "object") contour.labelOffsets = {};
        contour.labelOffsets[pld.segmentIndex] = {
          x: (pld.startOffsetX || 0) + dx,
          y: (pld.startOffsetY || 0) + dy
        };
        renderDP2FromState();
      }
      return;
    }

    // DP2 — Drag étiquette de mesure (déplacement visuel uniquement) — jamais pour __parcelEdge (édition contour)
    const mld = window.DP2_STATE?.measureLabelDrag || null;
    if (mld && typeof mld.pointerId === "number" && mld.pointerId === e.pointerId) {
      const obj = window.DP2_STATE?.objects?.[mld.objectIndex];
      if (obj && obj.type === "measure_line" && !obj.__parcelEdge) {
        const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
        const dx = coords.x - (mld.startCanvasX || 0);
        const dy = coords.y - (mld.startCanvasY || 0);
        obj.labelOffset = {
          x: (mld.startOffsetX || 0) + dx,
          y: (mld.startOffsetY || 0) + dy
        };
        renderDP2FromState();
      }
      return;
    }

    // DP2 — Drag étiquette faîtage (même logique que mesure)
    const rld = window.DP2_STATE?.ridgeLabelDrag || null;
    if (rld && typeof rld.pointerId === "number" && rld.pointerId === e.pointerId) {
      const obj = window.DP2_STATE?.objects?.[rld.objectIndex];
      if (obj && obj.type === "ridge_line") {
        const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
        const dx = coords.x - (rld.startCanvasX || 0);
        const dy = coords.y - (rld.startCanvasY || 0);
        obj.labelOffset = {
          x: (rld.startOffsetX || 0) + dx,
          y: (rld.startOffsetY || 0) + dy
        };
        renderDP2FromState();
      }
      return;
    }

    // Curseur "move" au survol d'une étiquette de mesure ou d'une cote de parcelle (outil Sélection)
    // DP4 : curseur ns-resize sur handle scale panneau/groupe
    const tool = window.DP2_STATE?.currentTool || "select";
    if (tool === "select" && !mld && !pld && !rld) {
      const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
      if (typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile()) {
        const groupHit = dp2HitTestPanelGroup(coords.x, coords.y);
        if (groupHit && groupHit.part === "scale") {
          canvas.style.cursor = "nwse-resize";
        } else {
          const hitPanel = dp2HitTestPanel(coords.x, coords.y);
          if (hitPanel && hitPanel.part === "scale") {
            canvas.style.cursor = "nwse-resize";
          } else {
            let showMove = false;
            const hitLabel = dp2HitTestMeasureLabel(canvas, coords.x, coords.y);
            if (hitLabel && hitLabel.kind === "measure_label" && !dp2IsAnyMeasureOverlayOpen()) {
              const obj = window.DP2_STATE?.objects?.[hitLabel.index];
              showMove = !dp2IsMeasureLineEditingActive(obj);
            }
            if (!showMove && dp2HitTestParcelSegmentLabel(canvas, coords.x, coords.y))
              showMove = true;
            if (!showMove && dp2HitTestRidgeLabel(canvas, coords.x, coords.y))
              showMove = true;
            canvas.style.cursor = showMove ? "move" : "";
          }
        }
      } else {
        let showMove = false;
        const hitLabel = dp2HitTestMeasureLabel(canvas, coords.x, coords.y);
        if (hitLabel && hitLabel.kind === "measure_label" && !dp2IsAnyMeasureOverlayOpen()) {
          const obj = window.DP2_STATE?.objects?.[hitLabel.index];
          showMove = !dp2IsMeasureLineEditingActive(obj);
        }
        if (!showMove && dp2HitTestParcelSegmentLabel(canvas, coords.x, coords.y))
          showMove = true;
        if (!showMove && dp2HitTestRidgeLabel(canvas, coords.x, coords.y))
          showMove = true;
        canvas.style.cursor = showMove ? "move" : "";
      }
    }

    // DP2 — Drag sommet contour de bâti (buildingContours)
    const bci = window.DP2_STATE?.buildingContourInteraction || null;
    if (bci && bci.id && typeof bci.vertexIndex === "number") {
      const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
      const contour = dp2GetBuildingContourById(bci.id);
      if (contour && Array.isArray(contour.points) && contour.points[bci.vertexIndex]) {
        const pt = contour.points[bci.vertexIndex];
        const nx = coords.x - (bci.offsetX || 0);
        const ny = coords.y - (bci.offsetY || 0);
        if (Math.abs(nx - (pt.x || 0)) > 1 || Math.abs(ny - (pt.y || 0)) > 1) bci.hasMoved = true;
        pt.x = nx;
        pt.y = ny;
        // Les cuts (faîtage) deviennent invalides si un sommet bouge : purge sans recalcul
        try { delete contour.cuts; } catch (_) { contour.cuts = undefined; }
        renderDP2FromState();
        return;
      }
    }

    // DP2 — Drag sommet faitage ou mesure (même logique que contour)
    const lvi = window.DP2_STATE?.lineVertexInteraction || null;
    if (lvi && typeof lvi.objectIndex === "number" && (lvi.anchor === "A" || lvi.anchor === "B")) {
      const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
      const objs = window.DP2_STATE?.objects || [];
      const obj = objs[lvi.objectIndex];
      if (obj && (obj.type === "ridge_line" || obj.type === "measure_line") && obj.a && obj.b) {
        const pt = lvi.anchor === "A" ? obj.a : obj.b;
        const nx = coords.x - (lvi.offsetX || 0);
        const ny = coords.y - (lvi.offsetY || 0);
        if (Math.abs(nx - (pt.x || 0)) > 1 || Math.abs(ny - (pt.y || 0)) > 1) lvi.hasMoved = true;
        pt.x = nx;
        pt.y = ny;
        renderDP2FromState();
        return;
      }
    }

    const groupInter = window.DP2_STATE?.panelGroupInteraction || null;
    if (groupInter && Array.isArray(groupInter.ids) && groupInter.ids.length >= 2) {
      const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
      const startCanvas = getDP2CanvasCoords(canvas, groupInter.startClientX, groupInter.startClientY);
      const dx = coords.x - startCanvas.x;
      const dy = coords.y - startCanvas.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) groupInter.hasMoved = true;

      const groupCx = typeof groupInter.groupCx === "number" ? groupInter.groupCx : 0;
      const groupCy = typeof groupInter.groupCy === "number" ? groupInter.groupCy : 0;

      if (groupInter.part === "body") {
        for (const id of groupInter.ids) {
          const panel = dp2GetPanelById(id);
          const start = groupInter.startById?.[id] || null;
          if (!panel || !panel.geometry || !start) continue;
          panel.geometry.x = (start.x || 0) + dx;
          panel.geometry.y = (start.y || 0) + dy;
        }
        renderDP2FromState();
        return;
      }

      if (groupInter.part === "rotate") {
        const angle = Math.atan2(coords.y - groupCy, coords.x - groupCx);
        const delta = angle - (groupInter.startAngle || 0);
        const c = Math.cos(delta);
        const s = Math.sin(delta);
        for (const id of groupInter.ids) {
          const panel = dp2GetPanelById(id);
          const start = groupInter.startById?.[id] || null;
          if (!panel || !panel.geometry || !start) continue;
          const w = start.width || panel.geometry.width || 0;
          const h = start.height || panel.geometry.height || 0;
          const startCx = (start.x || 0) + w / 2;
          const startCy = (start.y || 0) + h / 2;
          const relX = startCx - groupCx;
          const relY = startCy - groupCy;
          const newCx = groupCx + (relX * c - relY * s);
          const newCy = groupCy + (relX * s + relY * c);
          panel.geometry.x = newCx - w / 2;
          panel.geometry.y = newCy - h / 2;
          panel.geometry.rotation = (start.rotation || 0) + delta;
        }
        groupInter.hasMoved = true;
        renderDP2FromState();
        return;
      }

      if (groupInter.part === "scale") {
        const a = groupInter.basisAngle ?? 0;
        const axisXx = Math.cos(a);
        const axisXy = Math.sin(a);
        const axisYx = -Math.sin(a);
        const axisYy = Math.cos(a);
        const dx = coords.x - (groupInter.startPointerX ?? coords.x);
        const dy = coords.y - (groupInter.startPointerY ?? coords.y);
        const deltaLocalX = dx * axisXx + dy * axisXy;
        const deltaLocalY = dx * axisYx + dy * axisYy;
        let newScaleX = (groupInter.startScaleX ?? 1) + deltaLocalX * 0.005;
        let newScaleY = (groupInter.startScaleY ?? 1) + deltaLocalY * 0.005;
        newScaleX = Math.max(0.6, Math.min(1.4, newScaleX));
        newScaleY = Math.max(0.6, Math.min(1.4, newScaleY));
        const startScaleX = groupInter.startScaleX ?? 1;
        const startScaleY = groupInter.startScaleY ?? 1;
        for (const id of groupInter.ids) {
          const panel = dp2GetPanelById(id);
          const start = groupInter.startById?.[id] || null;
          if (!panel || !panel.geometry || !start) continue;
          const w = start.width || panel.geometry.width || 0;
          const h = start.height || panel.geometry.height || 0;
          const startCx = (start.x || 0) + w / 2;
          const startCy = (start.y || 0) + h / 2;
          const relWorldX = startCx - groupCx;
          const relWorldY = startCy - groupCy;
          const relLocalX = relWorldX * axisXx + relWorldY * axisXy;
          const relLocalY = relWorldX * axisYx + relWorldY * axisYy;
          const newRelLocalX = relLocalX * (newScaleX / startScaleX);
          const newRelLocalY = relLocalY * (newScaleY / startScaleY);
          const newRelWorldX = newRelLocalX * axisXx + newRelLocalY * axisYx;
          const newRelWorldY = newRelLocalX * axisXy + newRelLocalY * axisYy;
          const newCx = groupCx + newRelWorldX;
          const newCy = groupCy + newRelWorldY;
          panel.geometry.x = newCx - w / 2;
          panel.geometry.y = newCy - h / 2;
          const panelStartScaleX = start.displayScaleX ?? 1;
          const panelStartScaleY = start.displayScaleY ?? 1;
          panel.geometry.displayScaleX = panelStartScaleX * (newScaleX / startScaleX);
          panel.geometry.displayScaleY = panelStartScaleY * (newScaleY / startScaleY);
        }
        groupInter.hasMoved = true;
        renderDP2FromState();
        return;
      }
    }

    const selRect = window.DP2_STATE?.selectionRect || null;
    if (selRect && typeof selRect.pointerId === "number") {
      const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
      selRect.curX = coords.x;
      selRect.curY = coords.y;
      const dx = coords.x - (selRect.startX || 0);
      const dy = coords.y - (selRect.startY || 0);
      if (Math.hypot(dx, dy) > 4) selRect.hasMoved = true;
      renderDP2FromState();
      return;
    }

    const textInter = window.DP2_STATE?.textInteraction || null;
    if (textInter && typeof textInter.pointerId === "number") {
      const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);

      if (textInter.part === "create") {
        textInter.curX = coords.x;
        textInter.curY = coords.y;
        const dx = coords.x - (textInter.anchorX || 0);
        const dy = coords.y - (textInter.anchorY || 0);
        if (Math.hypot(dx, dy) > 4) textInter.hasMoved = true;
        renderDP2FromState();
        return;
      }

      if (textInter.id) {
        const obj = dp2GetTextById(textInter.id);
        if (!obj || !obj.geometry) return;
        const g = obj.geometry;

        if (textInter.part === "body") {
          const startCanvas = getDP2CanvasCoords(canvas, textInter.startClientX, textInter.startClientY);
          const dx = coords.x - startCanvas.x;
          const dy = coords.y - startCanvas.y;
          g.x = (textInter.startX || 0) + dx;
          g.y = (textInter.startY || 0) + dy;
          if (Math.abs(dx) > 2 || Math.abs(dy) > 2) textInter.hasMoved = true;
          renderDP2FromState();
          return;
        }

        if (textInter.part === "resize") {
          const tmpObj = {
            geometry: {
              x: textInter.startX,
              y: textInter.startY,
              width: textInter.startW,
              height: textInter.startH,
              rotation: textInter.startRotation
            }
          };
          const local = dp2TextWorldToLocal(tmpObj, coords.x, coords.y);

          const kind = obj.textKind || "free";
          const startW = Math.max(1, textInter.startW || 1);
          const startH = Math.max(1, textInter.startH || 1);
          const startX = typeof textInter.startX === "number" ? textInter.startX : 0;
          const startY = typeof textInter.startY === "number" ? textInter.startY : 0;
          const fs0 = typeof textInter.startFontSize === "number" ? textInter.startFontSize : DP2_TEXT_DEFAULT_FONT_SIZE;

          // DP6/DP7/DP8 : resize uniforme STRICT + fontSize proportionnelle (comportement historique)
          if (kind === "DP6" || kind === "DP7" || kind === "DP8") {
            const rawW = Math.max(1, (local.x - startX));
            const rawH = Math.max(1, (local.y - startY));
            let scale = Math.max(rawW / startW, rawH / startH);
            const minScale = Math.max(DP2_TEXT_MIN_W_PX / startW, DP2_TEXT_MIN_H_PX / startH);
            if (scale < minScale) scale = minScale;
            g.x = startX;
            g.y = startY;
            g.width = startW * scale;
            g.height = startH * scale;
            obj.fontSize = Math.max(6, fs0 * scale);
            textInter.hasMoved = true;
            renderDP2FromState();
            return;
          }

          // Texte libre : resize NON uniforme autorisé (W/H indépendants),
          // fontSize s’adapte UNIQUEMENT à la hauteur (scale vertical).
          const left0 = startX;
          const top0 = startY;
          const right0 = startX + startW;
          const bottom0 = startY + startH;
          let left = left0;
          let top = top0;
          let right = right0;
          let bottom = bottom0;

          const handle = textInter.resizeHandle || "br";
          switch (handle) {
            case "br": right = local.x; bottom = local.y; break;
            case "tr": right = local.x; top = local.y; break;
            case "bl": left = local.x; bottom = local.y; break;
            case "tl": left = local.x; top = local.y; break;
            case "mr": right = local.x; break;
            case "ml": left = local.x; break;
            case "bm": bottom = local.y; break;
            case "tm": top = local.y; break;
            default: right = local.x; bottom = local.y; break;
          }

          const minW = DP2_TEXT_MIN_W_PX;
          const minH = DP2_TEXT_MIN_H_PX;

          // Empêcher inversion / maintenir taille min selon le côté manipulé
          if ((right - left) < minW) {
            const leftMoves = handle === "tl" || handle === "bl" || handle === "ml";
            if (leftMoves) left = right - minW;
            else right = left + minW;
          }
          if ((bottom - top) < minH) {
            const topMoves = handle === "tl" || handle === "tr" || handle === "tm";
            if (topMoves) top = bottom - minH;
            else bottom = top + minH;
          }

          g.x = left;
          g.y = top;
          g.width = Math.max(1, right - left);
          g.height = Math.max(1, bottom - top);

          const scaleY = g.height / startH;
          obj.fontSize = Math.max(6, fs0 * scaleY);
          textInter.hasMoved = true;
          renderDP2FromState();
          return;
        }

        if (textInter.part === "rotate") {
          const cx = textInter.cx;
          const cy = textInter.cy;
          const angle = Math.atan2(coords.y - cy, coords.x - cx);
          const delta = angle - textInter.startAngle;
          g.rotation = (textInter.startRotation || 0) + delta;
          textInter.hasMoved = true;
          renderDP2FromState();
          return;
        }
      }
    }

    const panelInter = window.DP2_STATE?.panelInteraction || null;
    if (panelInter && panelInter.id) {
      const panel = dp2GetPanelById(panelInter.id);
      if (!panel || !panel.geometry) return;
      const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
      const g = panel.geometry;
      const w = g.width || 0;
      const h = g.height || 0;
      const cx = (g.x || 0) + w / 2;
      const cy = (g.y || 0) + h / 2;

      if (panelInter.part === "body") {
        const startCanvas = getDP2CanvasCoords(canvas, panelInter.startClientX, panelInter.startClientY);
        const dx = coords.x - startCanvas.x;
        const dy = coords.y - startCanvas.y;
        g.x = (panelInter.startX || 0) + dx;
        g.y = (panelInter.startY || 0) + dy;
        panelInter.hasMoved = true;

        // Snap intelligent (collage) : en déplacement, uniquement panneau↔panneau (rotation identique)
        const snap = dp2TrySnapPanel(g, coords, panelInter.id);
        if (snap && snap.targetCenterWorld) {
          g.x = snap.targetCenterWorld.x - w / 2;
          g.y = snap.targetCenterWorld.y - h / 2;
        }

        renderDP2FromState();
        return;
      }

      if (panelInter.part === "rotate") {
        const angle = Math.atan2(coords.y - cy, coords.x - cx);
        const delta = angle - panelInter.startAngle;
        g.rotation = (panelInter.startRotation || 0) + delta;
        panelInter.hasMoved = true;
        renderDP2FromState();
        return;
      }

      if (panelInter.part === "scale") {
        const dx = coords.x - (panelInter.startPointerX ?? coords.x);
        const dy = coords.y - (panelInter.startPointerY ?? coords.y);
        const angle = panelInter.startRotation ?? 0;
        const axisXx = Math.cos(angle);
        const axisXy = Math.sin(angle);
        const axisYx = -Math.sin(angle);
        const axisYy = Math.cos(angle);
        const deltaLocalX = dx * axisXx + dy * axisXy;
        const deltaLocalY = dx * axisYx + dy * axisYy;
        let newScaleX = (panelInter.startScaleX ?? 1) + deltaLocalX * 0.005;
        let newScaleY = (panelInter.startScaleY ?? 1) + deltaLocalY * 0.005;
        newScaleX = Math.max(0.6, Math.min(1.4, newScaleX));
        newScaleY = Math.max(0.6, Math.min(1.4, newScaleY));
        g.displayScaleX = newScaleX;
        g.displayScaleY = newScaleY;
        panelInter.hasMoved = true;
        renderDP2FromState();
        return;
      }
    }

    const inter = window.DP2_STATE?.businessInteraction || null;
    if (!inter || !inter.id) return;
    const obj = getDP2BusinessObjectById(inter.id);
    if (!obj || !obj.geometry) return;

    const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
    const g = obj.geometry;

    if (inter.part === "create") {
      const dx = coords.x - inter.anchorX;
      const dy = coords.y - inter.anchorY;
      if ((inter.createMode || "box") === "vector") {
        const len = Math.hypot(dx, dy);
        if (len > 2) inter.hasMoved = true;
        if (inter.hasMoved) {
          const minLen = 16;
          const w = Math.max(minLen, len);
          const rot = Math.atan2(dy, dx);

          // Centre monde = milieu entre ancre et curseur (taille + orientation)
          const centerX = inter.anchorX + dx / 2;
          const centerY = inter.anchorY + dy / 2;

          let h = Math.max(12, inter.metaDefaultH || 50);
          // Angle de prise de vue : hauteur suffisante pour contenir le cône (2 rayons)
          if (obj.type === "angle_vue") {
            const a = Math.PI / 6; // ouverture ~30°
            const neededHalf = Math.sin(a) * w;
            h = Math.max(24, neededHalf * 2 + 8);
          }

          g.width = w;
          g.height = h;
          g.rotation = rot;
          g.x = centerX - w / 2;
          g.y = centerY - h / 2;
        }
      } else {
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) inter.hasMoved = true;
        if (inter.hasMoved) {
          const rect = dp2NormalizeRectFromDrag(inter.anchorX, inter.anchorY, coords.x, coords.y, 10);
          g.x = rect.x;
          g.y = rect.y;
          g.width = rect.width;
          g.height = rect.height;
        }
      }
      renderDP2FromState();
      return;
    }

    if (inter.part === "body") {
      const dx = coords.x - (getDP2CanvasCoords(canvas, inter.startClientX, inter.startClientY).x);
      const dy = coords.y - (getDP2CanvasCoords(canvas, inter.startClientX, inter.startClientY).y);
      g.x = (inter.startX || 0) + dx;
      g.y = (inter.startY || 0) + dy;
      inter.hasMoved = true;
      renderDP2FromState();
      return;
    }

    if (inter.part === "resize") {
      // Resize dans le repère local (inverse-rotation) basé sur la rotation au début
      const tmpObj = {
        geometry: {
          x: inter.startX,
          y: inter.startY,
          width: inter.startW,
          height: inter.startH,
          rotation: inter.startRotation
        }
      };
      const local = dp2BusinessWorldToLocal(tmpObj, coords.x, coords.y);
      const minSize = 12;
      g.x = inter.startX;
      g.y = inter.startY;
      g.width = Math.max(minSize, (local.x - inter.startX));
      g.height = Math.max(minSize, (local.y - inter.startY));
      renderDP2FromState();
      return;
    }

    if (inter.part === "rotate") {
      const cx = inter.cx;
      const cy = inter.cy;
      const angle = Math.atan2(coords.y - cy, coords.x - cx);
      const delta = angle - inter.startAngle;
      g.rotation = (inter.startRotation || 0) + delta;
      renderDP2FromState();
    }
  });

  canvas.addEventListener("pointerup", (e) => {
    const cand = window.DP2_STATE?.measureLabelDragCandidate || null;
    if (cand && typeof cand.pointerId === "number" && cand.pointerId === e.pointerId) {
      window.DP2_STATE.measureLabelDragCandidate = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      renderDP2FromState();
      return;
    }
    const mld = window.DP2_STATE?.measureLabelDrag || null;
    if (mld && typeof mld.pointerId === "number" && mld.pointerId === e.pointerId) {
      window.DP2_STATE.measureLabelDrag = null;
      window.DP2_STATE._lastMeasureLabelDragAt = Date.now();
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      renderDP2FromState();
      return;
    }

    const pld = window.DP2_STATE?.parcelLabelDrag || null;
    if (pld && typeof pld.pointerId === "number" && pld.pointerId === e.pointerId) {
      window.DP2_STATE.parcelLabelDrag = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      renderDP2FromState();
      return;
    }

    const rld = window.DP2_STATE?.ridgeLabelDrag || null;
    if (rld && typeof rld.pointerId === "number" && rld.pointerId === e.pointerId) {
      window.DP2_STATE.ridgeLabelDrag = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      renderDP2FromState();
      return;
    }

    const bci = window.DP2_STATE?.buildingContourInteraction || null;
    if (bci && typeof bci.pointerId === "number" && bci.pointerId === e.pointerId) {
      window.DP2_STATE.buildingContourInteraction = null;
      window.DP2_STATE._lastBuildingContourInteractionAt = Date.now();
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      renderDP2FromState();
      return;
    }

    const lvi = window.DP2_STATE?.lineVertexInteraction || null;
    if (lvi && typeof lvi.pointerId === "number" && lvi.pointerId === e.pointerId) {
      const obj = window.DP2_STATE?.objects?.[lvi.objectIndex];
      if (obj && obj.type === "ridge_line" && obj.a && obj.b) {
        applyRidgeLineCutsToBuildingOutline(obj.a, obj.b);
      }
      window.DP2_STATE.lineVertexInteraction = null;
      window.DP2_STATE._lastLineVertexInteractionAt = Date.now();
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      renderDP2FromState();
      return;
    }

    const groupInter = window.DP2_STATE?.panelGroupInteraction || null;
    if (groupInter && Array.isArray(groupInter.ids) && groupInter.ids.length >= 2) {
      window.DP2_STATE.panelGroupInteraction = null;
      if (groupInter.hasMoved) window.DP2_STATE._lastSelectionRectAt = Date.now();
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      renderDP2FromState();
      return;
    }

    const selRect = window.DP2_STATE?.selectionRect || null;
    if (selRect && typeof selRect.pointerId === "number") {
      window.DP2_STATE.selectionRect = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      if (selRect.hasMoved) {
        const ax = selRect.startX || 0;
        const ay = selRect.startY || 0;
        const bx = selRect.curX || ax;
        const by = selRect.curY || ay;
        const minX = Math.min(ax, bx);
        const minY = Math.min(ay, by);
        const maxX = Math.max(ax, bx);
        const maxY = Math.max(ay, by);
        const rect = { minX, minY, maxX, maxY };

        const selectedPanels = [];
        const items = window.DP2_STATE?.panels || [];
        for (const p of items) {
          if (!p || p.type !== "panel" || p.visible !== true || !p.geometry) continue;
          const g = p.geometry;
          const center = dp2PanelCenterFromGeometry(g);
          const centerInside = center.x >= minX && center.x <= maxX && center.y >= minY && center.y <= maxY;
          if (centerInside) {
            selectedPanels.push(p.id);
            continue;
          }
          const aabb = dp2PanelWorldAABB(g);
          if (!aabb) continue;
          const bboxInside = aabb.minX >= minX && aabb.maxX <= maxX && aabb.minY >= minY && aabb.maxY <= maxY;
          if (bboxInside) selectedPanels.push(p.id);
        }

        const selectedTexts = [];
        const texts = window.DP2_STATE?.textObjects || [];
        for (const t of texts) {
          if (!t || t.type !== "text" || t.visible !== true || !t.geometry) continue;
          const g = t.geometry;
          const center = dp2PanelCenterFromGeometry(g);
          const centerInside = center.x >= minX && center.x <= maxX && center.y >= minY && center.y <= maxY;
          if (centerInside) {
            selectedTexts.push(t.id);
            continue;
          }
          const aabb = dp2PanelWorldAABB(g);
          if (!aabb) continue;
          const bboxInside = aabb.minX >= minX && aabb.maxX <= maxX && aabb.minY >= minY && aabb.maxY <= maxY;
          if (bboxInside) selectedTexts.push(t.id);
        }

        // UX : lasso peut sélectionner panneaux OU textes.
        // Si des textes sont trouvés, on privilégie la sélection texte (annotations).
        if (selectedTexts.length) dp2SetSelectedTextIds(selectedTexts);
        else dp2SetSelectedPanelIds(selectedPanels);
        window.DP2_STATE._lastSelectionRectAt = Date.now();
      }
      renderDP2FromState();
      return;
    }

    const textInter = window.DP2_STATE?.textInteraction || null;
    if (textInter && typeof textInter.pointerId === "number") {
      window.DP2_STATE.textInteraction = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}

      if (textInter.part === "create") {
        if (textInter.hasMoved) {
          const ax = textInter.anchorX || 0;
          const ay = textInter.anchorY || 0;
          const bx = textInter.curX != null ? textInter.curX : ax;
          const by = textInter.curY != null ? textInter.curY : ay;
          const rect = dp2NormalizeRectFromDrag(ax, ay, bx, by, 1);
          const w = Math.max(DP2_TEXT_MIN_W_PX, rect.width);
          const h = Math.max(DP2_TEXT_MIN_H_PX, rect.height);

          const tool = textInter.tool || "text_free";
          const textKind =
            tool === "text_DP6" ? "DP6"
            : tool === "text_DP7" ? "DP7"
            : tool === "text_DP8" ? "DP8"
            : "free";
          const content =
            textKind === "DP6" ? "DP6"
            : textKind === "DP7" ? "DP7"
            : textKind === "DP8" ? "DP8"
            : "Double-cliquez pour éditer";

          dp2CommitHistoryPoint();
          const created = createDP2TextObject(textKind, content, {
            x: rect.x,
            y: rect.y,
            width: w,
            height: h,
            rotation: 0
          }, DP2_TEXT_DEFAULT_FONT_SIZE);
          window.DP2_STATE.textObjects.push(created);
          dp2SetSelectedTextIds([created.id]);
          window.DP2_STATE._lastTextInteractionAt = Date.now();

          // Création terminée : retour au mode neutre
          dp2ResetActiveToolToNeutral({ preserveSelection: true, reason: "text_created" });
          renderDP2FromState();
          return;
        }
        renderDP2FromState();
        return;
      }

      if (textInter.hasMoved) window.DP2_STATE._lastTextInteractionAt = Date.now();
      renderDP2FromState();
      return;
    }

    const panelInter = window.DP2_STATE?.panelInteraction || null;
    if (panelInter && panelInter.id) {
      window.DP2_STATE.panelInteraction = null;
      if (panelInter.hasMoved) window.DP2_STATE._lastPvPanelInteractionAt = Date.now();
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      renderDP2FromState();
      return;
    }

    const inter = window.DP2_STATE?.businessInteraction || null;
    if (!inter || !inter.id) return;
    const obj = getDP2BusinessObjectById(inter.id);
    if (obj && obj.geometry && inter.part === "create" && inter.hasMoved !== true) {
      if ((inter.createMode || "box") === "vector") {
        // Interdit : création à taille fixe au clic pour les outils "vector"
        const items = window.DP2_STATE?.businessObjects || [];
        const idx = items.findIndex((o) => o && o.id === inter.id);
        if (idx >= 0) items.splice(idx, 1);
        if (window.DP2_STATE?.selectedBusinessObjectId === inter.id) {
          window.DP2_STATE.selectedBusinessObjectId = null;
        }
      } else {
        // Click simple : créer avec taille par défaut centrée sur le point
        const w = inter.metaDefaultW || 80;
        const h = inter.metaDefaultH || 50;
        obj.geometry.x = (inter.anchorX || 0) - w / 2;
        obj.geometry.y = (inter.anchorY || 0) - h / 2;
        obj.geometry.width = w;
        obj.geometry.height = h;
        obj.geometry.rotation = 0;
      }
    }
    window.DP2_STATE.businessInteraction = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    renderDP2FromState();
  });

  canvas.addEventListener("mousemove", (e) => {
    const tool = window.DP2_STATE?.currentTool || "select";
    if (tool === "pan") return;

    const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
    const scale = window.DP2_STATE?.scale_m_per_px;

    // Panneaux PV : preview NOIRE sous souris + fantôme GRIS (snap) — aucune insertion dans DP2_STATE.panels ici
    if (tool === "panels") {
      const dims = dp2GetPanelDimsPx();
      if (!dims) {
        showDP2Toast("Sélectionnez un module PV dans Paramètres.");
        dp2ResetActiveToolToNeutral({ preserveSelection: true, reason: "panel_dims_missing" });
        return;
      }

      const wPx = dims.wPx;
      const hPx = dims.hPx;
      const selectedId = window.DP2_STATE?.selectedPanelId || null;
      const selected = selectedId ? dp2GetPanelById(selectedId) : null;
      const rot = selected?.geometry?.rotation != null ? selected.geometry.rotation : 0;

      const previewGeom = {
        x: coords.x - wPx / 2,
        y: coords.y - hPx / 2,
        width: wPx,
        height: hPx,
        rotation: rot
      };

      const snap = dp2TrySnapPanel(previewGeom, coords);
      let ghostGeom = previewGeom;
      let snapped = false;
      if (snap && snap.targetCenterWorld) {
        ghostGeom = {
          x: snap.targetCenterWorld.x - wPx / 2,
          y: snap.targetCenterWorld.y - hPx / 2,
          width: wPx,
          height: hPx,
          rotation: rot
        };
        snapped = Math.hypot(ghostGeom.x - previewGeom.x, ghostGeom.y - previewGeom.y) > 0.5;
      }

      window.DP2_STATE.panelPlacementPreview = { preview: previewGeom, ghost: ghostGeom, snapped };
      renderDP2FromState();
      return;
    }

    // Trait de mesure : preview A → souris (mesure en temps réel)
    if (tool === "measure_line" && window.DP2_STATE.measureLineStart) {
      const from = window.DP2_STATE.measureLineStart;
      const dx = coords.x - from.x;
      const dy = coords.y - from.y;
      const lengthPx = Math.hypot(dx, dy);
      const lengthM = typeof scale === "number" && scale > 0 ? lengthPx * scale : 0;
      window.DP2_STATE.drawingPreview = {
        from: { x: from.x, y: from.y },
        to: { x: coords.x, y: coords.y },
        lengthM
      };
      renderDP2FromState();
      return;
    }
    if (tool === "measure_line") {
      if (window.DP2_STATE.drawingPreview != null) {
        window.DP2_STATE.drawingPreview = null;
        renderDP2FromState();
      }
      return;
    }

    // Faîtage : preview A → souris (mesure en temps réel)
    if (tool === "ridge_line" && window.DP2_STATE.ridgeLineStart) {
      const from = window.DP2_STATE.ridgeLineStart;
      const dx = coords.x - from.x;
      const dy = coords.y - from.y;
      const lengthPx = Math.hypot(dx, dy);
      const lengthM = typeof scale === "number" && scale > 0 ? lengthPx * scale : 0;
      window.DP2_STATE.drawingPreview = {
        from: { x: from.x, y: from.y },
        to: { x: coords.x, y: coords.y },
        lengthM,
        previewType: "ridge_line"
      };
      renderDP2FromState();
      return;
    }
    if (tool === "ridge_line") {
      if (window.DP2_STATE.drawingPreview != null) {
        window.DP2_STATE.drawingPreview = null;
        renderDP2FromState();
      }
      return;
    }

    const outline = dp2GetActiveBuildingOutlineForDrawing();
    if (tool !== "building_outline" || !outline || outline.closed || !outline.points || outline.points.length < 1) {
      if (window.DP2_STATE.drawingPreview != null) {
        window.DP2_STATE.drawingPreview = null;
        renderDP2FromState();
      }
      return;
    }
    const pts = outline.points;
    const last = pts[pts.length - 1];
    const first = pts[0];
    const distToFirst = Math.hypot(coords.x - first.x, coords.y - first.y);
    let toPoint;
    if (pts.length >= 3 && distToFirst <= DP2_CLOSE_THRESHOLD_PX) {
      toPoint = { x: first.x, y: first.y };
    } else {
      toPoint = { x: coords.x, y: coords.y };
    }
    const dx = toPoint.x - last.x;
    const dy = toPoint.y - last.y;
    const lengthPx = Math.hypot(dx, dy);
    const lengthM = typeof scale === "number" && scale > 0 ? lengthPx * scale : 0;
    window.DP2_STATE.drawingPreview = {
      from: { x: last.x, y: last.y },
      to: toPoint,
      lengthM,
      isClosing: pts.length >= 3 && distToFirst <= DP2_CLOSE_THRESHOLD_PX
    };
    renderDP2FromState();
  });

  canvas.addEventListener("mouseleave", () => {
    if (window.DP2_STATE.drawingPreview != null) {
      window.DP2_STATE.drawingPreview = null;
      renderDP2FromState();
    }
    if (window.DP2_STATE?.panelPlacementPreview != null) {
      window.DP2_STATE.panelPlacementPreview = null;
      renderDP2FromState();
    }
    // Ne pas effacer measureLineStart au leave : l'utilisateur peut revenir pour clic B
  });

  canvas.addEventListener("click", (e) => {
    const tool = window.DP2_STATE?.currentTool || "select";
    if (tool === "pan") return;

    const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);

    if (tool === "select") {
      // Choix A/B sur le plan : clic sur repère A ou B = définir resizeAnchor puis prévisualisation
      const hitAnchor = dp2HitTestMeasureLineAnchor(canvas, coords.x, coords.y);
      if (hitAnchor && typeof hitAnchor.objectIndex === "number" && (hitAnchor.anchor === "A" || hitAnchor.anchor === "B")) {
        const objs = window.DP2_STATE?.objects || [];
        const obj = objs[hitAnchor.objectIndex];
        if (obj && obj.type === "measure_line") {
          obj.resizeAnchor = hitAnchor.anchor;
          renderDP2FromState();
          return;
        }
      }
      // Si un lasso / drag groupé vient de se terminer, ignorer le click (évite d'écraser la sélection groupée)
      const last = window.DP2_STATE?._lastSelectionRectAt || 0;
      if (Date.now() - last < 250) return;
      // Si un drag texte vient de se terminer, ignorer le click (évite d'écraser la sélection après move/resize/rotate)
      const lastText = window.DP2_STATE?._lastTextInteractionAt || 0;
      if (Date.now() - lastText < 250) return;
      // Si un drag de sommet vient de se terminer, ignorer le click (évite une re-sélection "surprise")
      const lastBct = window.DP2_STATE?._lastBuildingContourInteractionAt || 0;
      if (Date.now() - lastBct < 250) return;
      const lastLvi = window.DP2_STATE?._lastLineVertexInteractionAt || 0;
      if (Date.now() - lastLvi < 250) return;

      const hitText = dp2HitTestText(coords.x, coords.y);
      if (hitText && hitText.id) {
        dp2ClearSelectedBuildingContour();
        dp2SetSelectedTextIds([hitText.id]);
        renderDP2FromState();
        return;
      }

      const hitPanel = dp2HitTestPanel(coords.x, coords.y);
      if (hitPanel && hitPanel.id) {
        dp2ClearSelectedBuildingContour();
        dp2SetSelectedPanelIds([hitPanel.id]);
        renderDP2FromState();
        return;
      }

      const hitAny = dp2HitTest(canvas, coords.x, coords.y);
      if (hitAny && hitAny.kind === "building_contour") {
        dp2SetSelectedBuildingContourId(hitAny.id || null);
      } else {
        const idx = hitAny && hitAny.kind === "object" ? hitAny.index : null;
        window.DP2_STATE.selectedObjectId = idx;
        dp2ClearSelectedBuildingContour();
        dp2ClearSelectedPanels();
        dp2ClearSelectedTexts();
        window.DP2_STATE.selectedBusinessObjectId = null;
      }
      renderDP2FromState();
      return;
    }

    // Trait de mesure : clic 1 = point A, clic 2 = point B (trait définitif), outil reste actif
    if (tool === "measure_line") {
      if (window.DP2_STATE.measureLineStart == null) {
        window.DP2_STATE.measureLineStart = { x: coords.x, y: coords.y };
        window.DP2_STATE.drawingPreview = null;
        renderDP2FromState();
        return;
      }
      const a = window.DP2_STATE.measureLineStart;
      dp2CommitHistoryPoint();
      window.DP2_STATE.objects.push({
        type: "measure_line",
        a: { x: a.x, y: a.y },
        b: { x: coords.x, y: coords.y }
      });
      window.DP2_STATE.measureLineStart = null;
      window.DP2_STATE.drawingPreview = null;
      renderDP2FromState();
      return;
    }

    // Faîtage : clic 1 = point A, clic 2 = point B (faîtage définitif), outil reste actif
    if (tool === "ridge_line") {
      if (window.DP2_STATE.ridgeLineStart == null) {
        window.DP2_STATE.ridgeLineStart = { x: coords.x, y: coords.y };
        window.DP2_STATE.drawingPreview = null;
        renderDP2FromState();
        return;
      }
      const a = window.DP2_STATE.ridgeLineStart;
      const ridgeA = { x: a.x, y: a.y };
      const ridgeB = { x: coords.x, y: coords.y };
      dp2CommitHistoryPoint();
      window.DP2_STATE.objects.push({
        type: "ridge_line",
        a: ridgeA,
        b: ridgeB
      });
      // Application structurante sur les COTES du contour bâti (sans toucher aux points)
      applyRidgeLineCutsToBuildingOutline(ridgeA, ridgeB);

      window.DP2_STATE.ridgeLineStart = null;
      window.DP2_STATE.drawingPreview = null;
      renderDP2FromState();
      return;
    }

    // Panneaux PV : poser un module à taille réelle (m → px via scale_m_per_px), rotatif, non redimensionnable,
    // avec collage automatique intelligent entre panneaux.
    if (tool === "panels") {
      // Si un drag/rotate vient de se terminer, ignorer le click (évite une pose involontaire)
      const last = window.DP2_STATE?._lastPvPanelInteractionAt || 0;
      if (Date.now() - last < 250) return;
      // Si une interaction texte vient de se terminer, ignorer le click (évite de poser un panneau en cliquant un texte)
      const lastText = window.DP2_STATE?._lastTextInteractionAt || 0;
      if (Date.now() - lastText < 250) return;

      // Si clic sur un panneau existant : sélection (pas de création)
      const hit = dp2HitTestPanel(coords.x, coords.y);
      if (hit && hit.id) {
        dp2SetSelectedPanelIds([hit.id]);
        renderDP2FromState();
        return;
      }

      const dims = dp2GetPanelDimsPx();
      if (!dims) {
        showDP2Toast("Sélectionnez un module PV dans Paramètres.");
        dp2ResetActiveToolToNeutral({ preserveSelection: true, reason: "panel_dims_missing_click" });
        return;
      }

      const wPx = dims.wPx;
      const hPx = dims.hPx;
      const selectedId = window.DP2_STATE?.selectedPanelId || null;
      const selected = selectedId ? dp2GetPanelById(selectedId) : null;
      const rot = selected?.geometry?.rotation != null ? selected.geometry.rotation : 0;

      // Position finale = fantôme (snap) si actif, sinon pose libre
      const previewState = window.DP2_STATE?.panelPlacementPreview || null;
      let placeGeom = previewState?.ghost || null;
      if (!placeGeom) {
        const previewGeom = {
          x: coords.x - wPx / 2,
          y: coords.y - hPx / 2,
          width: wPx,
          height: hPx,
          rotation: rot
        };
        const snap = dp2TrySnapPanel(previewGeom, coords);
        if (snap && snap.targetCenterWorld) {
          placeGeom = {
            x: snap.targetCenterWorld.x - wPx / 2,
            y: snap.targetCenterWorld.y - hPx / 2,
            width: wPx,
            height: hPx,
            rotation: rot
          };
        } else {
          placeGeom = previewGeom;
        }
      }

      dp2CommitHistoryPoint();
      const panels = window.DP2_STATE.panels || (window.DP2_STATE.panels = []);
      const id = "panel_" + Date.now() + "_" + Math.random().toString(16).slice(2);
      const geom = {
        x: placeGeom.x,
        y: placeGeom.y,
        width: wPx,
        height: hPx,
        rotation: rot
      };
      if (typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile()) {
        geom.displayScaleX = 1;
        geom.displayScaleY = 1;
      }
      panels.push({
        id,
        type: "panel",
        geometry: geom,
        lockedSize: true,
        visible: true
      });
      dp2SetSelectedPanelIds([id]);
      window.DP2_STATE.panelPlacementPreview = null; // recalcul immédiat au prochain move
      renderDP2FromState();
      return;
    }

    if (tool === "building_outline") {
      let contour = dp2GetActiveBuildingOutlineForDrawing();
      if (!contour) {
        window.DP2_STATE.drawingPreview = null;
        dp2CommitHistoryPoint();
        dp2EnsureBuildingContoursState();
        const id = dp2NewBuildingContourId();
        contour = { id, points: [{ x: coords.x, y: coords.y }], closed: false };
        window.DP2_STATE.buildingContours.push(contour);
        window.DP2_STATE.selectedBuildingContourId = id;
        renderDP2FromState();
        return;
      }

      const pts = contour.points;
      const first = pts[0];
      const distToFirst = Math.hypot(coords.x - first.x, coords.y - first.y);
      if (pts.length >= 3 && distToFirst <= DP2_CLOSE_THRESHOLD_PX) {
        window.DP2_STATE.drawingPreview = null;
        dp2CommitHistoryPoint();
        contour.closed = true;
        window.DP2_STATE.selectedBuildingContourId = contour.id;
        window.DP2_STATE.currentTool = "select";
        const selBtn = document.getElementById("dp2-tool-select");
        const measuresBtn = document.getElementById("dp2-tool-measures");
        const measuresIconEl = measuresBtn?.querySelector?.(".dp2-tool-icon") || null;
        const measuresLabelEl = measuresBtn?.querySelector?.(".dp2-tool-label") || null;
        selBtn?.classList.add("dp2-tool-active");
        selBtn?.classList.remove("dp2-tool-btn-disabled");
        if (selBtn) selBtn.disabled = false;
        measuresBtn?.classList.remove("dp2-tool-active");
        measuresBtn?.classList.remove("dp2-dropdown-open");
        measuresBtn?.setAttribute("aria-pressed", "false");
        measuresBtn?.setAttribute("aria-expanded", "false");
        const measuresMenu = document.getElementById("dp2-measures-menu");
        if (measuresMenu) measuresMenu.hidden = true;
        if (measuresIconEl) measuresIconEl.textContent = "📐";
        if (measuresLabelEl) measuresLabelEl.textContent = "Mesures";
        renderDP2FromState();
        return;
      }

      window.DP2_STATE.drawingPreview = null;
      dp2CommitHistoryPoint();
      contour.points.push({ x: coords.x, y: coords.y });
      renderDP2FromState();
    }
  });

  canvas.addEventListener("dblclick", (e) => {
    e.preventDefault();
    const tool = window.DP2_STATE?.currentTool || "select";
    if (tool === "pan") return;
    const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
    const objs = window.DP2_STATE?.objects || [];

    function openMeasureLineEdit(objectIndex) {
      const obj = objs[objectIndex];
      if (!obj || obj.type !== "measure_line" || !obj.a || !obj.b) return false;
      const scale = window.DP2_STATE?.scale_m_per_px;
      const lengthPx = Math.hypot(obj.b.x - obj.a.x, obj.b.y - obj.a.y);
      const lengthM = typeof scale === "number" && scale > 0 ? lengthPx * scale : 0;
      const currentStr = lengthM.toFixed(2).replace(".", ",");
      const raw = window.prompt("Longueur (m) :", currentStr);
      if (raw != null) {
        const normalized = String(raw).trim().replace(",", ".");
        const num = parseFloat(normalized);
        if (!Number.isNaN(num) && num >= 0) {
          // __parcelEdge : commit uniquement à la validation, pas à la saisie
          if (!obj.__parcelEdge) dp2CommitHistoryPoint();
          obj.requestedLengthM = num;
          renderDP2FromState();
          return true;
        }
      }
      return false;
    }

    // Double-clic sur l'étiquette de mesure (label) → édition valeur uniquement, puis choix explicite du point (overlay)
    const hitLabel = dp2HitTestMeasureLabel(canvas, coords.x, coords.y);
    if (hitLabel && hitLabel.kind === "measure_label" && typeof hitLabel.index === "number") {
      window.DP2_STATE.measureLabelDrag = null;
      window.DP2_STATE.measureLabelDragCandidate = null;
      const lastDrag = window.DP2_STATE._lastMeasureLabelDragAt || 0;
      if (Date.now() - lastDrag > 300) {
        if (openMeasureLineEdit(hitLabel.index)) {
          dp2ShowMeasureAnchorChoiceOverlay(canvas, hitLabel.index);
        }
        return;
      }
    }

    // Double-clic sur un measure_line existant (segment) → édition longueur puis choix A/B (overlay)
    const hitAny = dp2HitTest(canvas, coords.x, coords.y);
    if (hitAny && hitAny.kind === "object" && typeof hitAny.index === "number") {
      const obj = objs[hitAny.index];
      if (obj && obj.type === "measure_line") {
        if (openMeasureLineEdit(hitAny.index)) {
          dp2ShowMeasureAnchorChoiceOverlay(canvas, hitAny.index);
        }
        return;
      }
    }

    // Double-clic sur une cote de parcelle (segment jaune) → measure_line TEMPORAIRE, champ inline (pas prompt), puis A/B sur le plan, valider
    const hitParcelSegment = dp2HitTestParcelSegmentClosest(canvas, coords.x, coords.y);
    if (hitParcelSegment && hitParcelSegment.contourId != null && typeof hitParcelSegment.segmentIndex === "number") {
      window.DP2_STATE.objects.push({
        type: "measure_line",
        a: { x: hitParcelSegment.a.x, y: hitParcelSegment.a.y },
        b: { x: hitParcelSegment.b.x, y: hitParcelSegment.b.y },
        requestedLengthM: null,
        resizeAnchor: null,
        __parcelEdge: { contourId: hitParcelSegment.contourId, segmentIndex: hitParcelSegment.segmentIndex }
      });
      const newIdx = window.DP2_STATE.objects.length - 1;
      dp2ShowParcelEdgeInlineInput(canvas, newIdx);
      renderDP2FromState();
      return;
    }

    // 1) Contour bâti : double-clic = fermeture (comportement existant)
    if (tool === "building_outline") {
      const outline = dp2GetActiveBuildingOutlineForDrawing();
      // Règle DP (plan de masse) : fermeture autorisée uniquement si au moins 3 points.
      if (!outline || outline.closed || outline.points.length < 3) return;
      window.DP2_STATE.drawingPreview = null;
      dp2CommitHistoryPoint();
      outline.closed = true;
      if (outline.id) {
        window.DP2_STATE.selectedBuildingContourId = outline.id;
      }
      window.DP2_STATE.currentTool = "select";
      const selBtn = document.getElementById("dp2-tool-select");
      const measuresBtn = document.getElementById("dp2-tool-measures");
      const measuresIconEl = measuresBtn?.querySelector?.(".dp2-tool-icon") || null;
      const measuresLabelEl = measuresBtn?.querySelector?.(".dp2-tool-label") || null;
      selBtn?.classList.add("dp2-tool-active");
      selBtn?.classList.remove("dp2-tool-btn-disabled");
      if (selBtn) selBtn.disabled = false;
      measuresBtn?.classList.remove("dp2-tool-active");
      measuresBtn?.classList.remove("dp2-dropdown-open");
      measuresBtn?.setAttribute("aria-pressed", "false");
      measuresBtn?.setAttribute("aria-expanded", "false");
      const measuresMenu = document.getElementById("dp2-measures-menu");
      if (measuresMenu) measuresMenu.hidden = true;
      if (measuresIconEl) measuresIconEl.textContent = "📐";
      if (measuresLabelEl) measuresLabelEl.textContent = "Mesures";
      renderDP2FromState();
      return;
    }

    // 2) Texte libre : double-clic = édition simple (prompt)
    const hitText = dp2HitTestText(coords.x, coords.y);
    if (hitText && hitText.id) {
      const t = dp2GetTextById(hitText.id);
      if (t && t.type === "text" && t.visible === true && t.textKind === "free") {
        const current = typeof t.content === "string" ? t.content : "";
        const next = window.prompt("Texte :", current);
        if (next != null) {
          dp2CommitHistoryPoint();
          t.content = String(next);
          dp2SetSelectedTextIds([t.id]);
          renderDP2FromState();
        }
      }
    }
  });
}

// --------------------------
// DP2 — MOTEUR DE RENDU PASSIF (ÉTAPE 3)
// Source de vérité unique : DP2_STATE.objects[]
// Efface le canvas et redessine tous les objets selon leur type
// Aucun événement, aucun outil, aucun ajout automatique
// --------------------------
function renderDP2FromState() {
  const canvas = document.getElementById("dp2-draw-canvas");
  if (!canvas) {
    console.warn("[DP2] Canvas introuvable pour rendu");
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    console.warn("[DP2] Contexte 2D introuvable");
    return;
  }

  // Vérifier que DP2_STATE est initialisé
  if (!window.DP2_STATE) {
    console.warn("[DP2] DP2_STATE non initialisé");
    return;
  }

  if (dp2IsDP4RoofProfile()) {
    const t = Date.now();
    if (!window._dp4DebugLastLog || t - window._dp4DebugLastLog > 2000) {
      window._dp4DebugLastLog = t;
      console.log("[DP4][DEBUG] canvas: buildingContours=", (window.DP2_STATE.buildingContours || []).length);
    }
  }

  // Effacer le canvas (calque pur)
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Parcourir tous les objets depuis la source de vérité unique
  const objects = window.DP2_STATE.objects || [];

  // Contours de bâti : DP2 et DP4 utilisent buildingContours (source unique pendant l'édition)
  const contours = dp2GetBuildingContours();
  const activeId = window.DP2_STATE?.selectedBuildingContourId || null;
  const isDP4Roof = typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile();

  for (const c of contours) {
    renderDP2BuildingContour(ctx, c, {
      // En DP4 édition : toujours doré
      active: isDP4Roof ? true : !!(c && activeId && c.id === activeId)
    });
  }

  // Rendu standard (DP2) : une seule passe dans l'ordre des objets.
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (!obj || !obj.type) {
      console.warn("[DP2] Objet invalide ignoré", obj);
      continue;
    }

    // Dessiner selon le type d'objet
    switch (obj.type) {
      case "rectangle":
        renderRectangle(ctx, obj);
        break;
      case "pv_panel":
        renderPvPanel(ctx, obj);
        break;
      case "line":
        renderLine(ctx, obj);
        break;
      case "circle":
        renderCircle(ctx, obj);
        break;
      case "polygon":
        renderPolygon(ctx, obj);
        break;
      case "text":
        renderText(ctx, obj);
        break;
      case "building_outline":
        renderBuildingOutline(ctx, obj);
        break;
      case "measure_line":
        // __parcelEdge = support temporaire pour édition contour : jamais dessiner de segment vert
        if (!obj.__parcelEdge) renderMeasureLine(ctx, obj, i);
        break;
      case "ridge_line":
        renderRidgeLine(ctx, obj);
        break;
      default:
        console.warn("[DP2] Type d'objet non supporté :", obj.type);
    }
  }

  // Panneaux PV (calepinage simple) : source de vérité dédiée DP2_STATE.panels[]
  const panels = window.DP2_STATE.panels || [];
  for (const panel of panels) {
    renderDP2Panel(ctx, panel);
  }

  // Formes métier (ÉTAPE 6) : calque au-dessus des objets existants
  const businessObjects = window.DP2_STATE.businessObjects || [];
  for (const obj of businessObjects) {
    renderDP2BusinessObject(ctx, obj);
  }

  // Textes (annotations) : calque au-dessus (hors légende)
  const textObjects = window.DP2_STATE.textObjects || [];
  for (const obj of textObjects) {
    renderDP2TextObject(ctx, obj);
  }

  // Sélection visuelle uniquement : surligner l'objet sélectionné
  const selectedId = window.DP2_STATE.selectedObjectId;
  if (selectedId != null && objects[selectedId]) {
    renderSelectionHighlight(ctx, objects[selectedId]);
  }

  // Sélection + handles (panneaux PV)
  const selectedPanelIds = dp2GetEffectiveSelectedPanelIds();
  if (selectedPanelIds.length >= 2) {
    renderDP2PanelGroupSelection(ctx, selectedPanelIds);
  } else if (selectedPanelIds.length === 1) {
    const selPanel = dp2GetPanelById(selectedPanelIds[0]);
    if (selPanel) renderDP2PanelSelection(ctx, selPanel);
  }

  // Sélection + handles (formes métier)
  const selectedBizId = window.DP2_STATE.selectedBusinessObjectId;
  if (selectedBizId) {
    const sel = getDP2BusinessObjectById(selectedBizId);
    if (sel) renderDP2BusinessSelection(ctx, sel);
  }

  // Sélection + handles (textes)
  const selectedTextIds = typeof dp2GetEffectiveSelectedTextIds === "function" ? dp2GetEffectiveSelectedTextIds() : [];
  if (selectedTextIds.length >= 2) {
    renderDP2TextGroupSelection(ctx, selectedTextIds);
  } else if (selectedTextIds.length === 1) {
    const selText = dp2GetTextById(selectedTextIds[0]);
    if (selText) renderDP2TextSelection(ctx, selText);
  }

  // Prévisualisation dynamique : contour bâti (segment temporaire) ou trait de mesure (A → souris)
  const preview = window.DP2_STATE.drawingPreview;
  if (preview && preview.from && preview.to) {
    ctx.save();
    ctx.setLineDash([6, 4]);
    // Contraste : mesure = vert clair discret, faîtage = vert plus sombre et plus épais
    ctx.strokeStyle = preview.previewType === "ridge_line" ? "#0b6e4f" : "#2ecc71";
    ctx.lineWidth = preview.previewType === "ridge_line" ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(preview.from.x, preview.from.y);
    ctx.lineTo(preview.to.x, preview.to.y);
    ctx.stroke();
    ctx.setLineDash([]);
    const midX = (preview.from.x + preview.to.x) / 2;
    const midY = (preview.from.y + preview.to.y) / 2;
    const text = (preview.lengthM != null ? preview.lengthM.toFixed(2) : "0,00").replace(".", ",") + " m";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillStyle = "#1f2937";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, midX, midY);
    ctx.restore();
  }

  // Trait de mesure : point A seul (en attente du clic B)
  const measureLineStart = window.DP2_STATE.measureLineStart;
  if (window.DP2_STATE.currentTool === "measure_line" && measureLineStart) {
    ctx.save();
    dp2DrawLinePoint(ctx, measureLineStart.x, measureLineStart.y, DP2_MEASURE_POINT_STROKE);
    ctx.restore();
  }

  // Faîtage : point A seul (en attente du clic B)
  const ridgeLineStart = window.DP2_STATE.ridgeLineStart;
  if (window.DP2_STATE.currentTool === "ridge_line" && ridgeLineStart) {
    ctx.save();
    dp2DrawLinePoint(ctx, ridgeLineStart.x, ridgeLineStart.y, DP2_RIDGE_POINT_STROKE);
    ctx.restore();
  }

  // Prévisualisation panneaux PV (NOIR) + fantôme snap (GRIS)
  const pp = window.DP2_STATE.panelPlacementPreview || null;
  if (window.DP2_STATE.currentTool === "panels" && pp && pp.preview) {
    if (pp.snapped && pp.ghost) renderDP2PanelRect(ctx, pp.ghost, DP2_PANEL_GHOST_STYLE);
    renderDP2PanelRect(ctx, pp.preview, DP2_PANEL_PREVIEW_STYLE);
  }

  // Rectangle de sélection (lasso rectangulaire) — visuel uniquement
  const sr = window.DP2_STATE.selectionRect || null;
  if (sr && typeof sr.startX === "number" && typeof sr.startY === "number") {
    const ax = sr.startX;
    const ay = sr.startY;
    const bx = typeof sr.curX === "number" ? sr.curX : ax;
    const by = typeof sr.curY === "number" ? sr.curY : ay;
    const x = Math.min(ax, bx);
    const y = Math.min(ay, by);
    const w = Math.abs(bx - ax);
    const h = Math.abs(by - ay);
    ctx.save();
    ctx.fillStyle = "rgba(59, 130, 246, 0.14)";   // bleu clair
    ctx.strokeStyle = "rgba(59, 130, 246, 0.95)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Prévisualisation création texte (rubber-band)
  const ti = window.DP2_STATE?.textInteraction || null;
  if (ti && ti.part === "create" && typeof ti.anchorX === "number" && typeof ti.anchorY === "number") {
    const ax = ti.anchorX;
    const ay = ti.anchorY;
    const bx = typeof ti.curX === "number" ? ti.curX : ax;
    const by = typeof ti.curY === "number" ? ti.curY : ay;
    const x = Math.min(ax, bx);
    const y = Math.min(ay, by);
    const w = Math.abs(bx - ax);
    const h = Math.abs(by - ay);
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "rgba(17, 24, 39, 0.95)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Légende overlay (lecture seule) : toujours basée sur getDP2GlobalLegendForPdf()
  // -> maj automatique à chaque ajout/suppression (via les rendus successifs)
  // DP4 (toiture) : synchroniser la géométrie en continu (sans calculs, sans calepinage)
  try {
    if (typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile() && typeof dp4SyncRoofGeometryFromDP2State === "function") {
      dp4SyncRoofGeometryFromDP2State();
    }
  } catch (_) {}
  syncDP2LegendOverlayUI();
  syncDP2DrawActionsUI();
  dp2SyncMeasureResizePreviewOverlay();
}

// --------------------------
// DP2 — OVERLAY PRÉVISUALISATION (Valider uniquement) — measure_line avec requestedLengthM + resizeAnchor
// Aucun commit géométrique : Valider = fermer l’overlay (état prêt pour PROMPT 5), Annuler = effacer preview
// --------------------------
// DP2 — COMMIT GÉOMÉTRIQUE D'UNE MESURE (PROMPT 5)
// Applique réellement requestedLengthM sur obj.a ou obj.b
// --------------------------
function dp2CommitMeasureResize(obj) {
  if (
    !obj ||
    obj.type !== "measure_line" ||
    typeof obj.requestedLengthM !== "number" ||
    (obj.resizeAnchor !== "A" && obj.resizeAnchor !== "B")
  ) return;

  const scale = window.DP2_STATE?.scale_m_per_px;
  if (!scale || scale <= 0) return;

  // Branche __parcelEdge : appliquer la longueur au segment du contour puis supprimer la measure_line temporaire
  const parcelEdge = obj.__parcelEdge;
  if (parcelEdge && parcelEdge.contourId != null && typeof parcelEdge.segmentIndex === "number") {
    const contour = dp2GetBuildingContourById(parcelEdge.contourId);
    if (!contour || !Array.isArray(contour.points) || contour.points.length < 2) return;
    const pts = contour.points;
    const n = pts.length;
    const segIdx = parcelEdge.segmentIndex;
    const p1 = pts[segIdx];
    const p2 = pts[(segIdx + 1) % n];
    if (!p1 || !p2) return;
    const ax = p1.x;
    const ay = p1.y;
    const bx = p2.x;
    const by = p2.y;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthPx = Math.sqrt(dx * dx + dy * dy);
    if (lengthPx <= 0) return;
    const lengthM = lengthPx * scale;
    const deltaM = obj.requestedLengthM - lengthM;
    const deltaPx = deltaM / scale;
    const ux = dx / lengthPx;
    const uy = dy / lengthPx;

    dp2CommitHistoryPoint();
    if (obj.resizeAnchor === "A") {
      pts[segIdx].x = ax - ux * deltaPx;
      pts[segIdx].y = ay - uy * deltaPx;
    } else {
      const idx2 = (segIdx + 1) % n;
      pts[idx2].x = bx + ux * deltaPx;
      pts[idx2].y = by + uy * deltaPx;
    }
    const objects = window.DP2_STATE?.objects || [];
    const idx = objects.indexOf(obj);
    if (idx >= 0) objects.splice(idx, 1);
    return;
  }

  const ax = obj.a.x;
  const ay = obj.a.y;
  const bx = obj.b.x;
  const by = obj.b.y;

  const dx = bx - ax;
  const dy = by - ay;
  const lengthPx = Math.sqrt(dx * dx + dy * dy);
  if (lengthPx <= 0) return;

  const lengthM = lengthPx * scale;
  const deltaM = obj.requestedLengthM - lengthM;
  const deltaPx = deltaM / scale;

  const ux = dx / lengthPx;
  const uy = dy / lengthPx;

  // Commit historique AVANT modification
  dp2CommitHistoryPoint();

  if (obj.resizeAnchor === "A") {
    obj.a = {
      x: ax - ux * deltaPx,
      y: ay - uy * deltaPx
    };
  } else {
    obj.b = {
      x: bx + ux * deltaPx,
      y: by + uy * deltaPx
    };
  }

  // Nettoyage état temporaire
  delete obj.requestedLengthM;
  delete obj.resizeAnchor;
}

function dp2RemoveMeasureResizePreviewOverlay() {
  const el = document.getElementById("dp2-measure-resize-preview-overlay");
  if (el && el.parentNode) el.parentNode.removeChild(el);
  if (window._dp2MeasureResizePreviewOutsideHandler) {
    document.removeEventListener("click", window._dp2MeasureResizePreviewOutsideHandler);
    window._dp2MeasureResizePreviewOutsideHandler = null;
  }
}

function dp2SyncMeasureResizePreviewOverlay() {
  const objects = window.DP2_STATE?.objects || [];
  let previewObj = null;
  let previewIndex = -1;
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (obj && obj.type === "measure_line" && obj.a && obj.b &&
        typeof obj.requestedLengthM === "number" && (obj.resizeAnchor === "A" || obj.resizeAnchor === "B")) {
      previewObj = obj;
      previewIndex = i;
      break;
    }
  }

  const canvas = document.getElementById("dp2-draw-canvas");
  const container = document.getElementById("dp2-zoom-container");
  if (!canvas || !container) return;

  if (!previewObj || previewIndex < 0) {
    dp2RemoveMeasureResizePreviewOverlay();
    return;
  }

  const midX = (previewObj.a.x + previewObj.b.x) / 2;
  const midY = (previewObj.a.y + previewObj.b.y) / 2;
  const labelY = midY + 22;
  const pt = getDP2CanvasToClient(canvas, midX, labelY);
  const containerRect = container.getBoundingClientRect();
  let left = pt.clientX - containerRect.left - 90;
  let top = pt.clientY - containerRect.top + 4;

  let overlay = document.getElementById("dp2-measure-resize-preview-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "dp2-measure-resize-preview-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Valider la modification");
    overlay.style.cssText = "position:absolute;z-index:51;display:flex;flex-direction:column;gap:6px;padding:8px;background:rgba(17,24,39,0.95);color:#f3f4f6;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.3);font:13px system-ui,sans-serif;";
    const title = document.createElement("div");
    title.textContent = "Prévisualisation — aucun changement appliqué tant que vous ne validez pas";
    title.style.cssText = "font-weight:600;margin-bottom:2px;";
    overlay.appendChild(title);
    const btnValider = document.createElement("button");
    btnValider.type = "button";
    btnValider.textContent = "Valider la modification";
    btnValider.style.cssText = "padding:6px 10px;border:1px solid rgba(255,255,255,0.3);border-radius:6px;background:#059669;color:#fff;cursor:pointer;font:inherit;";
    overlay.appendChild(btnValider);

    btnValider.onclick = () => {
      const objects = window.DP2_STATE?.objects || [];
      const obj = objects.find(
        o => o && o.type === "measure_line" && typeof o.resizeAnchor === "string"
      );

      if (obj) {
        dp2CommitMeasureResize(obj);
      }

      dp2RemoveMeasureResizePreviewOverlay();
      if (window._dp2MeasureResizePreviewOutsideHandler) {
        document.removeEventListener("click", window._dp2MeasureResizePreviewOutsideHandler);
        window._dp2MeasureResizePreviewOutsideHandler = null;
      }
      renderDP2FromState();
    };

    overlay.addEventListener("click", (e) => e.stopPropagation());
    container.appendChild(overlay);
  }
  function cancelPreview() {
    const objects = window.DP2_STATE?.objects || [];
    const obj = objects.find(
      o => o && o.type === "measure_line" && typeof o.resizeAnchor === "string"
    );
    if (obj) {
      if (obj.__parcelEdge != null) {
        const idx = objects.indexOf(obj);
        if (idx >= 0) objects.splice(idx, 1);
      } else {
        delete obj.requestedLengthM;
        delete obj.resizeAnchor;
      }
    }
    dp2RemoveMeasureResizePreviewOverlay();
    if (window._dp2MeasureResizePreviewOutsideHandler) {
      document.removeEventListener("click", window._dp2MeasureResizePreviewOutsideHandler);
      window._dp2MeasureResizePreviewOutsideHandler = null;
    }
    renderDP2FromState();
  }
  if (!window._dp2MeasureResizePreviewOutsideHandler) {
    window._dp2MeasureResizePreviewOutsideHandler = function outsidePreview(e) {
      if (overlay && overlay.contains(e.target)) return;
      cancelPreview();
    };
    setTimeout(() => document.addEventListener("click", window._dp2MeasureResizePreviewOutsideHandler), 0);
  }
  left = Math.max(4, left);
  top = Math.max(4, top);
  overlay.style.left = left + "px";
  overlay.style.top = top + "px";
  const ow = overlay.offsetWidth || 200;
  const oh = overlay.offsetHeight || 120;
  if (left + ow > containerRect.width - 4) left = Math.max(4, containerRect.width - 4 - ow);
  if (top + oh > containerRect.height - 4) top = Math.max(4, containerRect.height - 4 - oh);
  overlay.style.left = left + "px";
  overlay.style.top = top + "px";
}

// --------------------------
// DP2 — OVERLAY CHOIX DU POINT À DÉPLACER (measure_line, après édition requestedLengthM)
// Aucune modification géométrique : choix explicite A ou B, stocké dans obj.resizeAnchor
// --------------------------
function dp2RemoveMeasureAnchorChoiceOverlay() {
  const el = document.getElementById("dp2-measure-anchor-overlay");
  if (el && el.parentNode) el.parentNode.removeChild(el);
  const guard = document.getElementById("dp2-measure-anchor-overlay-guard");
  if (guard && guard.parentNode) guard.parentNode.removeChild(guard);
  document.removeEventListener("click", window._dp2MeasureAnchorChoiceOutsideHandler);
  window._dp2MeasureAnchorChoiceOutsideHandler = null;
}

function dp2SyncMeasureAnchorChoiceOverlay() {
  // Choix A/B se fait par clic direct sur les repères A/B sur le plan — pas d’overlay "A ou B"
  dp2RemoveMeasureAnchorChoiceOverlay();
}

// DP2 — Édition inline de la cote de parcelle (remplace le prompt) : input DOM positionné sur le segment
function dp2ShowParcelEdgeInlineInput(canvas, objectIndex) {
  const objs = window.DP2_STATE?.objects || [];
  const obj = objs[objectIndex];
  if (!obj || obj.type !== "measure_line" || !obj.a || !obj.b || !obj.__parcelEdge) return;
  const container = document.getElementById("dp2-zoom-container");
  if (!container) return;
  const scale = window.DP2_STATE?.scale_m_per_px;
  const lengthPx = Math.hypot(obj.b.x - obj.a.x, obj.b.y - obj.a.y);
  const lengthM = typeof scale === "number" && scale > 0 ? lengthPx * scale : 0;
  const currentStr = lengthM.toFixed(2).replace(".", ",");
  const midX = (obj.a.x + obj.b.x) / 2;
  const midY = (obj.a.y + obj.b.y) / 2;
  const pt = getDP2CanvasToClient(canvas, midX, midY);
  const containerRect = container.getBoundingClientRect();
  const leftPx = pt.clientX - containerRect.left;
  const topPx = pt.clientY - containerRect.top;
  const input = document.createElement("input");
  input.id = "dp2-parcel-edge-inline-input";
  input.type = "text";
  input.value = currentStr;
  input.style.cssText = "position:absolute;left:" + (leftPx - 32) + "px;top:" + (topPx - 10) + "px;width:64px;height:22px;padding:0 4px;background:#fff;border:1px solid #9ca3af;border-radius:4px;font:12px system-ui,sans-serif;color:#1f2937;z-index:55;box-sizing:border-box;";
  container.appendChild(input);
  input.focus();
  input.select();
  function commit(val) {
    const normalized = String(val).trim().replace(",", ".");
    const num = parseFloat(normalized);
    if (!Number.isNaN(num) && num >= 0) {
      obj.requestedLengthM = num;
      if (typeof renderDP2FromState === "function") renderDP2FromState();
    }
  }
  function cancel() {
    if (input.parentNode) input.parentNode.removeChild(input);
    const idx = (window.DP2_STATE?.objects || []).indexOf(obj);
    if (idx >= 0) window.DP2_STATE.objects.splice(idx, 1);
    if (typeof renderDP2FromState === "function") renderDP2FromState();
  }
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(input.value);
      if (input.parentNode) input.parentNode.removeChild(input);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  });
  input.addEventListener("blur", () => {
    commit(input.value);
    if (input.parentNode) input.parentNode.removeChild(input);
  });
}

function dp2ShowMeasureAnchorChoiceOverlay(canvas, objectIndex) {
  const objs = window.DP2_STATE?.objects || [];
  const obj = objs[objectIndex];
  if (!obj || obj.type !== "measure_line" || !obj.a || !obj.b || typeof obj.requestedLengthM !== "number") return;
  if (obj.resizeAnchor === "A" || obj.resizeAnchor === "B") return;

  dp2RemoveMeasureAnchorChoiceOverlay();

  const container = document.getElementById("dp2-zoom-container");
  if (!container) return;

  const midX = (obj.a.x + obj.b.x) / 2;
  const midY = (obj.a.y + obj.b.y) / 2;
  const pt = getDP2CanvasToClient(canvas, midX, midY);
  const containerRect = container.getBoundingClientRect();
  const left = pt.clientX - containerRect.left - 95;
  const top = pt.clientY - containerRect.top - 8;

  const overlay = document.createElement("div");
  overlay.id = "dp2-measure-anchor-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "Choisir le point à déplacer");
  overlay.style.cssText = "position:absolute;z-index:52;display:flex;flex-direction:column;gap:6px;padding:10px;background:rgba(17,24,39,0.96);color:#f3f4f6;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,0.35);font:13px system-ui,sans-serif;min-width:160px;";
  const title = document.createElement("div");
  title.textContent = "Quel point déplacer ?";
  title.style.cssText = "font-weight:600;margin-bottom:2px;";
  overlay.appendChild(title);

  const btnA = document.createElement("button");
  btnA.type = "button";
  btnA.textContent = "Déplacer point A";
  btnA.style.cssText = "padding:8px 12px;border:1px solid rgba(255,255,255,0.25);border-radius:6px;background:#16a34a;color:#fff;cursor:pointer;font:inherit;text-align:left;";
  overlay.appendChild(btnA);

  const btnB = document.createElement("button");
  btnB.type = "button";
  btnB.textContent = "Déplacer point B";
  btnB.style.cssText = "padding:8px 12px;border:1px solid rgba(255,255,255,0.25);border-radius:6px;background:#2563eb;color:#fff;cursor:pointer;font:inherit;text-align:left;";
  overlay.appendChild(btnB);

  const btnAnnuler = document.createElement("button");
  btnAnnuler.type = "button";
  btnAnnuler.textContent = "Annuler";
  btnAnnuler.style.cssText = "padding:6px 10px;border:1px solid rgba(255,255,255,0.3);border-radius:6px;background:transparent;color:#9ca3af;cursor:pointer;font:inherit;";
  overlay.appendChild(btnAnnuler);

  function applyChoice(anchor) {
    const o = window.DP2_STATE?.objects?.[objectIndex];
    if (o && o.type === "measure_line") {
      o.resizeAnchor = anchor;
    }
    dp2RemoveMeasureAnchorChoiceOverlay();
    renderDP2FromState();
  }

  function cancelChoice() {
    const o = window.DP2_STATE?.objects?.[objectIndex];
    if (o && o.type === "measure_line" && o.__parcelEdge != null) {
      const objects = window.DP2_STATE?.objects || [];
      const idx = objects.indexOf(o);
      if (idx >= 0) objects.splice(idx, 1);
    }
    dp2RemoveMeasureAnchorChoiceOverlay();
    renderDP2FromState();
  }

  btnA.onclick = (e) => { e.stopPropagation(); applyChoice("A"); };
  btnB.onclick = (e) => { e.stopPropagation(); applyChoice("B"); };
  btnAnnuler.onclick = (e) => { e.stopPropagation(); cancelChoice(); };

  overlay.addEventListener("click", (e) => e.stopPropagation());

  overlay.style.left = Math.max(4, left) + "px";
  overlay.style.top = Math.max(4, top) + "px";
  container.appendChild(overlay);

  window._dp2MeasureAnchorChoiceOutsideHandler = function outsideHandler(e) {
    if (overlay.contains(e.target)) return;
    const guard = document.getElementById("dp2-measure-anchor-overlay-guard");
    if (guard && guard.contains(e.target)) return;
    cancelChoice();
    document.removeEventListener("click", window._dp2MeasureAnchorChoiceOutsideHandler);
    window._dp2MeasureAnchorChoiceOutsideHandler = null;
  };
  setTimeout(() => document.addEventListener("click", window._dp2MeasureAnchorChoiceOutsideHandler), 0);
}

// --------------------------
// DP2 — HELPERS DE RENDU PAR TYPE D'OBJET
// --------------------------
function renderRectangle(ctx, obj) {
  // obj: { type: "rectangle", x, y, width, height, fillStyle?, strokeStyle?, lineWidth?, rotation? }
  ctx.save();
  
  if (obj.rotation) {
    const cx = obj.x + (obj.width || 0) / 2;
    const cy = obj.y + (obj.height || 0) / 2;
    ctx.translate(cx, cy);
    ctx.rotate(obj.rotation);
    ctx.translate(-cx, -cy);
  }

  if (obj.fillStyle) {
    ctx.fillStyle = obj.fillStyle;
    ctx.fillRect(obj.x, obj.y, obj.width || 0, obj.height || 0);
  }

  if (obj.strokeStyle) {
    ctx.strokeStyle = obj.strokeStyle;
    ctx.lineWidth = obj.lineWidth || 1;
    ctx.strokeRect(obj.x, obj.y, obj.width || 0, obj.height || 0);
  }

  ctx.restore();
}

function renderPvPanel(ctx, obj) {
  // obj: { type:"pv_panel", x,y,width,height,rotation }
  const w = obj.width || 0;
  const h = obj.height || 0;
  if (!(w > 0) || !(h > 0)) return;

  const cx = (obj.x || 0) + w / 2;
  const cy = (obj.y || 0) + h / 2;
  const rot = obj.rotation || 0;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);

  const x = -w / 2;
  const y = -h / 2;

  // Corps panneau (rendu sobre et fidèle à la légende)
  ctx.fillStyle = DP2_PANEL_STYLE.fill;
  ctx.strokeStyle = DP2_PANEL_STYLE.stroke;
  ctx.lineWidth = DP2_PANEL_STYLE.lineWidth;
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

// --------------------------
// DP2 — RENDU PANNEAUX PV (DP2_STATE.panels[])
// Modèle imposé :
// { id, type:"panel", geometry:{x,y,width,height,rotation}, lockedSize:true, visible:true }
// --------------------------
function renderDP2PanelRect(ctx, geom, style) {
  const g = geom || null;
  const w = g?.width || 0;
  const h = g?.height || 0;
  if (!(w > 0) || !(h > 0)) return;

  const isDP4Roof = typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile();
  const scaleX = isDP4Roof ? (g.displayScaleX ?? g.displayScale ?? 1) : 1;
  const scaleY = isDP4Roof ? (g.displayScaleY ?? g.displayScale ?? 1) : 1;

  const cx = (g.x || 0) + w / 2;
  const cy = (g.y || 0) + h / 2;
  const rot = g.rotation || 0;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  if (isDP4Roof && (scaleX !== 1 || scaleY !== 1)) ctx.scale(scaleX, scaleY);

  const x = -w / 2;
  const y = -h / 2;

  const st = style || DP2_PANEL_STYLE;
  ctx.fillStyle = st.fill;
  ctx.strokeStyle = st.stroke;
  ctx.lineWidth = st.lineWidth || 1;
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fill();
  if (st.stroke) ctx.stroke();

  ctx.restore();
}

function renderDP2Panel(ctx, panel) {
  if (!panel || panel.type !== "panel" || panel.visible !== true || !panel.geometry) return;
  renderDP2PanelRect(ctx, panel.geometry, DP2_PANEL_STYLE);
}

function renderDP2PanelSelection(ctx, panel) {
  if (!panel || panel.type !== "panel" || panel.visible !== true || !panel.geometry) return;
  const g = panel.geometry;
  const w = g.width || 0;
  const h = g.height || 0;
  if (!(w > 0) || !(h > 0)) return;

  const cx = (g.x || 0) + w / 2;
  const cy = (g.y || 0) + h / 2;
  const rot = g.rotation || 0;
  const rotateHandleOffset = 18;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);

  const x = -w / 2;
  const y = -h / 2;

  // bbox
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);

  // poignée rotation (pas de resize)
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(0, y - rotateHandleOffset);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, y - rotateHandleOffset, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile()) {
    const sx = g.displayScaleX ?? g.displayScale ?? 1;
    const sy = g.displayScaleY ?? g.displayScale ?? 1;
    const wEff = w * sx;
    const hEff = h * sy;
    const scaleHandleX = wEff / 2 + 14;
    const scaleHandleY = hEff / 2 + 14;
    ctx.fillStyle = "#C39847";
    ctx.fillRect(scaleHandleX - 4, scaleHandleY - 4, 8, 8);
  }

  ctx.restore();
}

function renderDP2PanelGroupSelection(ctx, panelIds) {
  const ids = Array.isArray(panelIds) ? panelIds : [];
  if (ids.length < 2) return;
  const aabb = dp2PanelsGroupAABB(ids);
  if (!aabb) return;

  const x = aabb.minX;
  const y = aabb.minY;
  const w = aabb.maxX - aabb.minX;
  const h = aabb.maxY - aabb.minY;
  if (!(w > 0) || !(h > 0)) return;

  const rotateHandleOffset = 18;

  ctx.save();

  // bbox groupe (axis-aligned)
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);

  // poignée rotation unique (haut-centre)
  const hx = aabb.cx;
  const hy = y - rotateHandleOffset;
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(hx, y);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(hx, hy, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile()) {
    const scaleHx = aabb.maxX + 14;
    const scaleHy = aabb.maxY + 14;
    ctx.fillStyle = "#C39847";
    ctx.fillRect(scaleHx - 4, scaleHy - 4, 8, 8);
  }

  ctx.restore();
}

function renderLine(ctx, obj) {
  // obj: { type: "line", x1, y1, x2, y2, strokeStyle?, lineWidth? }
  ctx.save();
  
  ctx.beginPath();
  ctx.moveTo(obj.x1 || 0, obj.y1 || 0);
  ctx.lineTo(obj.x2 || 0, obj.y2 || 0);
  
  if (obj.strokeStyle) {
    ctx.strokeStyle = obj.strokeStyle;
    ctx.lineWidth = obj.lineWidth || 1;
    ctx.stroke();
  }
  
  ctx.restore();
}

function renderCircle(ctx, obj) {
  // obj: { type: "circle", x, y, radius, fillStyle?, strokeStyle?, lineWidth? }
  ctx.save();
  
  ctx.beginPath();
  ctx.arc(obj.x || 0, obj.y || 0, obj.radius || 0, 0, Math.PI * 2);
  
  if (obj.fillStyle) {
    ctx.fillStyle = obj.fillStyle;
    ctx.fill();
  }
  
  if (obj.strokeStyle) {
    ctx.strokeStyle = obj.strokeStyle;
    ctx.lineWidth = obj.lineWidth || 1;
    ctx.stroke();
  }
  
  ctx.restore();
}

function renderPolygon(ctx, obj) {
  // obj: { type: "polygon", points: [{x, y}, ...], fillStyle?, strokeStyle?, lineWidth? }
  if (!obj.points || !Array.isArray(obj.points) || obj.points.length < 2) {
    return;
  }
  
  ctx.save();
  
  ctx.beginPath();
  ctx.moveTo(obj.points[0].x || 0, obj.points[0].y || 0);
  for (let i = 1; i < obj.points.length; i++) {
    ctx.lineTo(obj.points[i].x || 0, obj.points[i].y || 0);
  }
  ctx.closePath();
  
  if (obj.fillStyle) {
    ctx.fillStyle = obj.fillStyle;
    ctx.fill();
  }
  
  if (obj.strokeStyle) {
    ctx.strokeStyle = obj.strokeStyle;
    ctx.lineWidth = obj.lineWidth || 1;
    ctx.stroke();
  }
  
  ctx.restore();
}

function renderText(ctx, obj) {
  // obj: { type: "text", x, y, text, font?, fillStyle?, strokeStyle?, textAlign?, textBaseline? }
  ctx.save();
  
  if (obj.font) {
    ctx.font = obj.font;
  }
  if (obj.textAlign) {
    ctx.textAlign = obj.textAlign;
  }
  if (obj.textBaseline) {
    ctx.textBaseline = obj.textBaseline;
  }
  
  if (obj.fillStyle && obj.text) {
    ctx.fillStyle = obj.fillStyle;
    ctx.fillText(obj.text, obj.x || 0, obj.y || 0);
  }
  
  if (obj.strokeStyle && obj.text) {
    ctx.strokeStyle = obj.strokeStyle;
    ctx.lineWidth = obj.lineWidth || 1;
    ctx.strokeText(obj.text, obj.x || 0, obj.y || 0);
  }
  
  ctx.restore();
}

// --------------------------
// DP2 — PRÉVISUALISATION MESURE (sans modifier obj.a / obj.b)
// Condition : obj.requestedLengthM défini, obj.resizeAnchor "A" ou "B".
// Retourne { aPreview: {x,y}, bPreview: {x,y}, deltaPx, lengthM } ou null.
// --------------------------
function getMeasureLinePreviewPoints(obj) {
  if (!obj || !obj.a || !obj.b) return null;
  const requested = typeof obj.requestedLengthM === "number" && obj.requestedLengthM >= 0 ? obj.requestedLengthM : null;
  const anchor = obj.resizeAnchor === "A" || obj.resizeAnchor === "B" ? obj.resizeAnchor : null;
  if (requested == null || !anchor) return null;

  const scale = window.DP2_STATE?.scale_m_per_px;
  if (typeof scale !== "number" || scale <= 0) return null;

  const dx = obj.b.x - obj.a.x;
  const dy = obj.b.y - obj.a.y;
  const lengthPx = Math.hypot(dx, dy);
  if (lengthPx < 1e-6) return null;

  const lengthM = lengthPx * scale;
  const deltaM = requested - lengthM;
  const deltaPx = deltaM / scale;
  const ux = dx / lengthPx;
  const uy = dy / lengthPx;

  let aPreview, bPreview;
  if (anchor === "A") {
    aPreview = { x: obj.a.x - ux * deltaPx, y: obj.a.y - uy * deltaPx };
    bPreview = { x: obj.b.x, y: obj.b.y };
  } else {
    aPreview = { x: obj.a.x, y: obj.a.y };
    bPreview = { x: obj.b.x + ux * deltaPx, y: obj.b.y + uy * deltaPx };
  }
  return { aPreview, bPreview, deltaPx, lengthM };
}

// --------------------------
// DP2 — RENDU TRAIT DE MESURE (cote DP indépendante)
// Objet : { type: "measure_line", a: { x, y }, b: { x, y }, requestedLengthM?, resizeAnchor?: "A"|"B" }
// objectIndex : optionnel, pour feedback visuel (point à déplacer surligné, autre atténué)
// En mode prévisualisation (requestedLengthM + resizeAnchor) : segment en pointillés, flèche, longueur demandée.
// --------------------------
function renderMeasureLine(ctx, obj, objectIndex) {
  if (!obj.a || !obj.b) return;
  // measure_line liée à un contour (__parcelEdge) : jamais rendue ici, preview dessinée sur le contour
  if (obj.__parcelEdge) return;
  const scale = window.DP2_STATE?.scale_m_per_px;
  const anchor = obj.resizeAnchor === "A" || obj.resizeAnchor === "B" ? obj.resizeAnchor : null;
  const preview = getMeasureLinePreviewPoints(obj);

  ctx.save();

  if (preview) {
    // Prévisualisation dynamique (requestedLengthM + resizeAnchor) : segment pointillés, flèche, longueur demandée. Aucun commit sur obj.a/obj.b.
    // On ne dessine que le preview (pas le segment obj.a→obj.b) pour éviter le dédoublement visuel du point déplacé.
    ctx.strokeStyle = "#2ecc71";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(preview.aPreview.x, preview.aPreview.y);
    ctx.lineTo(preview.bPreview.x, preview.bPreview.y);
    ctx.stroke();
    ctx.setLineDash([]);

    const from = anchor === "A" ? obj.a : obj.b;
    const to = anchor === "A" ? preview.aPreview : preview.bPreview;
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    if (dist > 2) {
      const ax = (to.x - from.x) / dist;
      const ay = (to.y - from.y) / dist;
      const headLen = Math.min(12, dist * 0.4);
      const tipX = to.x - ax * headLen;
      const tipY = to.y - ay * headLen;
      const perpX = -ay;
      const perpY = ax;
      ctx.strokeStyle = "#0f0";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(tipX + perpX * 4, tipY + perpY * 4);
      ctx.lineTo(tipX - perpX * 4, tipY - perpY * 4);
      ctx.closePath();
      ctx.fillStyle = "#0f0";
      ctx.fill();
      ctx.stroke();
    }

    const fixed = anchor === "A" ? obj.b : obj.a;
    const movedPreview = anchor === "A" ? preview.aPreview : preview.bPreview;
    ctx.fillStyle = "rgba(150, 150, 150, 0.7)";
    ctx.beginPath();
    ctx.arc(fixed.x, fixed.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0f0";
    ctx.beginPath();
    ctx.arc(movedPreview.x, movedPreview.y, 6, 0, Math.PI * 2);
    ctx.fill();

    const midX = (preview.aPreview.x + preview.bPreview.x) / 2;
    const midY = (preview.aPreview.y + preview.bPreview.y) / 2;
    const off = obj.labelOffset && typeof obj.labelOffset.x === "number" && typeof obj.labelOffset.y === "number" ? obj.labelOffset : { x: 0, y: 0 };
    const text = (typeof obj.requestedLengthM === "number" ? obj.requestedLengthM : 0).toFixed(2).replace(".", ",") + " m";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillStyle = "#1f2937";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, midX + off.x, midY + off.y);
  } else if (typeof obj.requestedLengthM === "number" && obj.requestedLengthM >= 0 && obj.resizeAnchor !== "A" && obj.resizeAnchor !== "B") {
    // Choix du point à déplacer : segment + repères A (vert) et B (bleu) sur le plan, label
    ctx.strokeStyle = "#2ecc71";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(obj.a.x, obj.a.y);
    ctx.lineTo(obj.b.x, obj.b.y);
    ctx.stroke();
    const r = 11;
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#16a34a";
    ctx.beginPath();
    ctx.arc(obj.a.x, obj.a.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText("A", obj.a.x, obj.a.y);
    ctx.fillStyle = "#2563eb";
    ctx.beginPath();
    ctx.arc(obj.b.x, obj.b.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText("B", obj.b.x, obj.b.y);
    const midX = (obj.a.x + obj.b.x) / 2;
    const midY = (obj.a.y + obj.b.y) / 2;
    const off = obj.labelOffset && typeof obj.labelOffset.x === "number" && typeof obj.labelOffset.y === "number" ? obj.labelOffset : { x: 0, y: 0 };
    const text = obj.requestedLengthM.toFixed(2).replace(".", ",") + " m";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillStyle = "#1f2937";
    ctx.fillText(text, midX + off.x, midY + off.y);
  } else {
    // Comportement normal (pas de prévisualisation) — points comme contour de bâti (6px, blanc, stroke)
    ctx.strokeStyle = "#2ecc71";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(obj.a.x, obj.a.y);
    ctx.lineTo(obj.b.x, obj.b.y);
    ctx.stroke();
    dp2DrawLinePoint(ctx, obj.a.x, obj.a.y, DP2_MEASURE_POINT_STROKE);
    dp2DrawLinePoint(ctx, obj.b.x, obj.b.y, DP2_MEASURE_POINT_STROKE);

    if (typeof scale === "number" && scale > 0) {
      const dx = obj.b.x - obj.a.x;
      const dy = obj.b.y - obj.a.y;
      const lengthPx = Math.hypot(dx, dy);
      const lengthM = lengthPx * scale;
      const midX = (obj.a.x + obj.b.x) / 2;
      const midY = (obj.a.y + obj.b.y) / 2;
      const requested = typeof obj.requestedLengthM === "number" && obj.requestedLengthM >= 0 ? obj.requestedLengthM : null;
      const text = requested != null
        ? requested.toFixed(2).replace(".", ",") + " m"
        : lengthM.toFixed(2).replace(".", ",") + " m";
      const off = obj.labelOffset && typeof obj.labelOffset.x === "number" && typeof obj.labelOffset.y === "number" ? obj.labelOffset : { x: 0, y: 0 };
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillStyle = "#1f2937";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, midX + off.x, midY + off.y);
    }
  }
  ctx.restore();
}

// DP2 — Style des points faitage/mesure (aligné contour de bâti : 6px, blanc, stroke)
const DP2_RIDGE_POINT_STROKE = "#0b6e4f";
const DP2_MEASURE_POINT_STROKE = "#2ecc71";

function dp2DrawLinePoint(ctx, x, y, strokeColor) {
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = strokeColor || "#C39847";
  ctx.lineWidth = 2;
  ctx.stroke();
}

// --------------------------
// DP2 — RENDU FAÎTAGE (segment structurant)
// Objet : { type: "ridge_line", a: { x, y }, b: { x, y }, labelOffset?: { x, y } }
// Points comme contour de bâti ; mesure dynamique (longueur en m) + label déplaçable.
// --------------------------
function renderRidgeLine(ctx, obj) {
  if (!obj.a || !obj.b) return;
  const scale = window.DP2_STATE?.scale_m_per_px;
  ctx.save();
  ctx.strokeStyle = "#0b6e4f";
  ctx.lineWidth = 3;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(obj.a.x, obj.a.y);
  ctx.lineTo(obj.b.x, obj.b.y);
  ctx.stroke();
  dp2DrawLinePoint(ctx, obj.a.x, obj.a.y, DP2_RIDGE_POINT_STROKE);
  dp2DrawLinePoint(ctx, obj.b.x, obj.b.y, DP2_RIDGE_POINT_STROKE);
  if (typeof scale === "number" && scale > 0) {
    const lengthM = Math.hypot(obj.b.x - obj.a.x, obj.b.y - obj.a.y) * scale;
    const midX = (obj.a.x + obj.b.x) / 2;
    const midY = (obj.a.y + obj.b.y) / 2;
    const off = obj.labelOffset && typeof obj.labelOffset.x === "number" && typeof obj.labelOffset.y === "number" ? obj.labelOffset : { x: 0, y: 0 };
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillStyle = "#1f2937";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(lengthM.toFixed(2).replace(".", ",") + " m", midX + off.x, midY + off.y);
  }
  ctx.restore();
}

// --------------------------
// DP2 — RENDU CONTOUR BÂTI + MESURES (ÉTAPE 4)
// Objet : { type: "building_outline", points: [{x,y}, ...], closed: boolean }
// Mesures générées dynamiquement via scale_m_per_px (affichage au milieu de chaque segment)
// --------------------------
function renderBuildingOutline(ctx, obj) {
  if (!obj.points || !Array.isArray(obj.points) || obj.points.length < 1) {
    return;
  }
  const scale = window.DP2_STATE?.scale_m_per_px;
  const points = obj.points;

  ctx.save();

  // Polyligne (trait) — dès 2 points ; avec 1 point on affiche seulement le sommet (début de trait)
  if (points.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    if (obj.closed) {
      ctx.closePath();
    }
    ctx.strokeStyle = obj.strokeStyle || "#1e40af";
    ctx.lineWidth = obj.lineWidth != null ? obj.lineWidth : 2;
    ctx.stroke();
    if (obj.closed && (obj.fillStyle != null)) {
      ctx.fillStyle = obj.fillStyle || "rgba(30, 64, 175, 0.08)";
      ctx.fill();
    }
  }

  // Points (sommets) — visibles dès le premier clic
  ctx.fillStyle = "#1e40af";
  for (let i = 0; i < points.length; i++) {
    ctx.beginPath();
    ctx.arc(points[i].x, points[i].y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Mesures : longueur de chaque segment en mètres, texte au milieu du segment (segments définitifs uniquement)
  if (points.length >= 2 && typeof scale === "number" && scale > 0) {
    const segments = obj.closed ? points.length : points.length - 1;
    for (let i = 0; i < segments; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];

      // Segments "coupés" par un faîtage : ne pas afficher la cote globale, afficher L1 et L2
      const cutParts = obj.cuts && obj.cuts[i];
      if (Array.isArray(cutParts) && cutParts.length === 2 && cutParts[0]?.a && cutParts[0]?.b && cutParts[1]?.a && cutParts[1]?.b) {
        for (const part of cutParts) {
          const a = part.a;
          const b = part.b;
          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2;
          const lenM =
            typeof part.lengthM === "number"
              ? part.lengthM
              : Math.hypot(b.x - a.x, b.y - a.y) * scale;
          const text = lenM.toFixed(2).replace(".", ",") + " m";
          ctx.font = "12px system-ui, sans-serif";
          ctx.fillStyle = "#1f2937";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(text, midX, midY);
        }
        continue;
      }

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const lengthPx = Math.sqrt(dx * dx + dy * dy);
      const lengthM = lengthPx * scale;
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      const text = lengthM.toFixed(2).replace(".", ",") + " m";
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillStyle = "#1f2937";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, midX, midY);
    }
  }

  ctx.restore();
}

// --------------------------
// DP2 — RENDU CONTOURS DE BÂTI (multi, éditables) — DP2 UNIQUEMENT
// --------------------------
const DP2_BUILDING_CONTOUR_ACTIVE_STROKE = "#C39847";
const DP2_BUILDING_CONTOUR_INACTIVE_STROKE = "#6b7280";

function renderDP2BuildingContour(ctx, contour, options) {
  if (!contour || !Array.isArray(contour.points) || contour.points.length < 1) return;
  const opt = options || {};
  const active = opt.active === true;
  const scale = window.DP2_STATE?.scale_m_per_px;
  const pts = contour.points;

  ctx.save();

  // Polyligne / polygone
  if (pts.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (contour.closed) ctx.closePath();
    ctx.strokeStyle = active ? DP2_BUILDING_CONTOUR_ACTIVE_STROKE : DP2_BUILDING_CONTOUR_INACTIVE_STROKE;
    ctx.lineWidth = active ? 2.5 : 2;
    ctx.setLineDash([]);
    ctx.stroke();
    if (contour.closed) {
      ctx.fillStyle = active ? "rgba(195, 152, 71, 0.10)" : "rgba(107, 114, 128, 0.06)";
      ctx.fill();
    }
  }

  // Poignées (sommets) : uniquement sur le contour actif
  if (active) {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = DP2_BUILDING_CONTOUR_ACTIVE_STROKE;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // Mesures : longueur de chaque segment en mètres (mêmes règles que le rendu historique)
  if (pts.length >= 2 && typeof scale === "number" && scale > 0) {
    const segments = contour.closed ? pts.length : pts.length - 1;
    const objects = window.DP2_STATE?.objects || [];
    for (let i = 0; i < segments; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % pts.length];
      const parcelEdgeML = objects.find(
        o => o && o.type === "measure_line" && o.__parcelEdge && o.__parcelEdge.contourId === contour.id && o.__parcelEdge.segmentIndex === i
      );
      const parcelEdgeEditing = !!parcelEdgeML;

      if (parcelEdgeEditing) {
        // Après validation de la valeur : repères A/B sur les deux sommets (plan uniquement, pas d'overlay)
        const hasValue = typeof parcelEdgeML.requestedLengthM === "number";
        const noAnchorYet = parcelEdgeML.resizeAnchor !== "A" && parcelEdgeML.resizeAnchor !== "B";
        if (hasValue && noAnchorYet) {
          const R = 11;
          ctx.save();
          ctx.font = "bold 11px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.beginPath();
          ctx.arc(p1.x, p1.y, R, 0, Math.PI * 2);
          ctx.fillStyle = "#16a34a";
          ctx.fill();
          ctx.strokeStyle = "#0f766e";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.fillStyle = "#fff";
          ctx.fillText("A", p1.x, p1.y);
          ctx.beginPath();
          ctx.arc(p2.x, p2.y, R, 0, Math.PI * 2);
          ctx.fillStyle = "#2563eb";
          ctx.fill();
          ctx.strokeStyle = "#1d4ed8";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.fillStyle = "#fff";
          ctx.fillText("B", p2.x, p2.y);
          ctx.restore();
        }
        // Prévisualisation édition contour : pointillé + flèche + UN SEUL label sur le segment jaune (pas de segment vert)
        const preview = parcelEdgeML && typeof parcelEdgeML.requestedLengthM === "number" && (parcelEdgeML.resizeAnchor === "A" || parcelEdgeML.resizeAnchor === "B")
          ? getMeasureLinePreviewPoints(parcelEdgeML)
          : null;
        if (preview) {
          ctx.save();
          ctx.setLineDash([6, 4]);
          ctx.strokeStyle = DP2_BUILDING_CONTOUR_ACTIVE_STROKE;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(preview.aPreview.x, preview.aPreview.y);
          ctx.lineTo(preview.bPreview.x, preview.bPreview.y);
          ctx.stroke();
          ctx.setLineDash([]);
          const anchor = parcelEdgeML.resizeAnchor;
          const from = anchor === "A" ? parcelEdgeML.a : parcelEdgeML.b;
          const to = anchor === "A" ? preview.aPreview : preview.bPreview;
          const dist = Math.hypot(to.x - from.x, to.y - from.y);
          if (dist > 2) {
            const ax = (to.x - from.x) / dist;
            const ay = (to.y - from.y) / dist;
            const headLen = Math.min(12, dist * 0.4);
            const tipX = to.x - ax * headLen;
            const tipY = to.y - ay * headLen;
            const perpX = -ay;
            const perpY = ax;
            ctx.strokeStyle = "#1f2937";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(to.x, to.y);
            ctx.lineTo(tipX + perpX * 4, tipY + perpY * 4);
            ctx.lineTo(tipX - perpX * 4, tipY - perpY * 4);
            ctx.closePath();
            ctx.fillStyle = "#1f2937";
            ctx.fill();
            ctx.stroke();
          }
          const midX = (preview.aPreview.x + preview.bPreview.x) / 2;
          const midY = (preview.aPreview.y + preview.bPreview.y) / 2;
          const text = (typeof parcelEdgeML.requestedLengthM === "number" ? parcelEdgeML.requestedLengthM : 0).toFixed(2).replace(".", ",") + " m";
          ctx.font = "12px system-ui, sans-serif";
          ctx.fillStyle = "#1f2937";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(text, midX, midY);
          ctx.restore();
        }
        continue;
      }

      const offMap = contour.labelOffsets && typeof contour.labelOffsets === "object" ? contour.labelOffsets : {};
      const segOff = offMap[i] && typeof offMap[i].x === "number" && typeof offMap[i].y === "number" ? offMap[i] : { x: 0, y: 0 };
      const cutParts = contour.cuts && contour.cuts[i];
      if (Array.isArray(cutParts) && cutParts.length === 2 && cutParts[0]?.a && cutParts[0]?.b && cutParts[1]?.a && cutParts[1]?.b) {
        for (const part of cutParts) {
          const a = part.a;
          const b = part.b;
          let midX = (a.x + b.x) / 2;
          let midY = (a.y + b.y) / 2;
          midX += segOff.x;
          midY += segOff.y;
          const lenM =
            typeof part.lengthM === "number"
              ? part.lengthM
              : Math.hypot(b.x - a.x, b.y - a.y) * scale;
          const text = lenM.toFixed(2).replace(".", ",") + " m";
          ctx.font = "12px system-ui, sans-serif";
          ctx.fillStyle = "#1f2937";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(text, midX, midY);
        }
        continue;
      }

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const lengthPx = Math.sqrt(dx * dx + dy * dy);
      const lengthM = lengthPx * scale;
      let midX = (p1.x + p2.x) / 2;
      let midY = (p1.y + p2.y) / 2;
      midX += segOff.x;
      midY += segOff.y;
      const text = lengthM.toFixed(2).replace(".", ",") + " m";
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillStyle = "#1f2937";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, midX, midY);
    }
  }

  ctx.restore();
}

// --------------------------
// DP2 — SURVOL SÉLECTION (visuel uniquement)
// --------------------------
function renderSelectionHighlight(ctx, obj) {
  if (!obj || !obj.type) return;
  // Panneaux PV : sélection + poignée rotation (sans resize)
  if (obj.type === "pv_panel") {
    const w = obj.width || 0;
    const h = obj.height || 0;
    if (!(w > 0) || !(h > 0)) return;
    const cx = (obj.x || 0) + w / 2;
    const cy = (obj.y || 0) + h / 2;
    const rot = obj.rotation || 0;
    const rotateHandleOffset = 18;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    const x = -w / 2;
    const y = -h / 2;
    // bbox
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    // poignée rotation
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(0, y - rotateHandleOffset);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(0, y - rotateHandleOffset, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.strokeStyle = "#6366f1";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  if (obj.type === "building_outline" && obj.points && obj.points.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(obj.points[0].x, obj.points[0].y);
    for (let i = 1; i < obj.points.length; i++) {
      ctx.lineTo(obj.points[i].x, obj.points[i].y);
    }
    if (obj.closed) ctx.closePath();
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

// --------------------------
// DP2 — TEXTES (annotations) : rendu + sélection
// Modèle imposé :
// { id, type:"text", textKind:"free"|"DP6"|"DP7"|"DP8", content, geometry:{x,y,width,height,rotation}, fontSize, visible:true }
// --------------------------
function dp2WrapTextLines(ctx, text, maxWidth) {
  const raw = typeof text === "string" ? text : "";
  const paragraphs = raw.split(/\r?\n/);
  const lines = [];
  const maxW = Math.max(1, maxWidth || 1);

  function pushLine(s) {
    lines.push(s);
  }

  for (const para of paragraphs) {
    const words = String(para).split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      pushLine("");
      continue;
    }
    let cur = "";
    for (const w of words) {
      const next = cur ? (cur + " " + w) : w;
      if (ctx.measureText(next).width <= maxW) {
        cur = next;
        continue;
      }
      if (cur) pushLine(cur);
      // Mot trop long : fallback coupe caractère par caractère
      if (ctx.measureText(w).width > maxW) {
        let chunk = "";
        for (const ch of String(w)) {
          const tryChunk = chunk + ch;
          if (ctx.measureText(tryChunk).width <= maxW) {
            chunk = tryChunk;
          } else {
            if (chunk) pushLine(chunk);
            chunk = ch;
          }
        }
        cur = chunk;
      } else {
        cur = w;
      }
    }
    if (cur) pushLine(cur);
  }
  return lines;
}

function renderDP2TextObject(ctx, obj) {
  if (!obj || obj.type !== "text" || obj.visible !== true || !obj.geometry) return;
  const g = obj.geometry;
  const w = g.width || 0;
  const h = g.height || 0;
  if (!(w > 0) || !(h > 0)) return;

  const cx = g.x + w / 2;
  const cy = g.y + h / 2;
  const rot = g.rotation || 0;
  const fontSize = typeof obj.fontSize === "number" && obj.fontSize > 0 ? obj.fontSize : DP2_TEXT_DEFAULT_FONT_SIZE;
  const pad = Math.max(4, Math.min(10, Math.min(w, h) * 0.10));

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);

  ctx.fillStyle = "#111827";
  ctx.font = `${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const maxWidth = Math.max(1, w - pad * 2);
  const lineHeight = Math.max(10, fontSize * 1.2);
  let lines = dp2WrapTextLines(ctx, obj.content, maxWidth);

  const maxLines = Math.max(1, Math.floor(Math.max(1, h - pad * 2) / lineHeight));
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    // Ellipsis simple sur la dernière ligne
    const lastIdx = lines.length - 1;
    let s = lines[lastIdx];
    while (s.length > 0 && ctx.measureText(s + "…").width > maxWidth) s = s.slice(0, -1);
    lines[lastIdx] = (s || "").trimEnd() + "…";
  }

  const totalH = lines.length * lineHeight;
  let y0 = -totalH / 2 + lineHeight / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], 0, y0 + i * lineHeight);
  }

  ctx.restore();
}

function renderDP2TextSelection(ctx, obj) {
  if (!obj || obj.type !== "text" || obj.visible !== true || !obj.geometry) return;
  const g = obj.geometry;
  const w = g.width || 0;
  const h = g.height || 0;
  if (!(w > 0) || !(h > 0)) return;

  const cx = g.x + w / 2;
  const cy = g.y + h / 2;
  const rot = g.rotation || 0;
  const rotateHandleOffset = 18;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);

  const x = -w / 2;
  const y = -h / 2;

  // bbox
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);

  // Poignées resize :
  // - texte libre : coins + côtés
  // - DP6/DP7/DP8 : une seule poignée (coin bas-droit)
  const kind = obj.textKind || "free";
  const isDPKind = kind === "DP6" || kind === "DP7" || kind === "DP8";
  const drawHandle = (hx, hy) => {
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(hx - 6, hy - 6, 12, 12);
    ctx.fill();
    ctx.stroke();
  };
  if (isDPKind) {
    drawHandle(x + w, y + h);
  } else {
    // Coins
    drawHandle(x, y);
    drawHandle(x + w, y);
    drawHandle(x, y + h);
    drawHandle(x + w, y + h);
    // Côtés
    drawHandle(x + w / 2, y);
    drawHandle(x + w / 2, y + h);
    drawHandle(x, y + h / 2);
    drawHandle(x + w, y + h / 2);
  }

  // poignée rotation (haut-centre)
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(0, y - rotateHandleOffset);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, y - rotateHandleOffset, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function renderDP2TextGroupSelection(ctx, textIds) {
  const ids = Array.isArray(textIds) ? textIds : [];
  if (ids.length < 2) return;
  const aabb = dp2TextsGroupAABB(ids);
  if (!aabb) return;
  const x = aabb.minX;
  const y = aabb.minY;
  const w = aabb.maxX - aabb.minX;
  const h = aabb.maxY - aabb.minY;
  if (!(w > 0) || !(h > 0)) return;

  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
  ctx.restore();
}

// --------------------------
// DP2 — RENDU FORMES MÉTIER (ÉTAPE 6)
// Modèle imposé : {id,type,legendKey,geometry:{x,y,width,height,rotation},visible:true}
// --------------------------
function renderDP2BusinessObject(ctx, obj) {
  if (!obj || obj.visible !== true || !obj.geometry || !obj.type) return;
  const g = obj.geometry;
  const w = g.width || 0;
  const h = g.height || 0;
  if (!(w > 0) || !(h > 0)) return;

  const cx = g.x + w / 2;
  const cy = g.y + h / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(g.rotation || 0);

  const x = -w / 2;
  const y = -h / 2;

  // Style par défaut (sobre, lisible sur fond plan)
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(17, 24, 39, 0.95)";
  ctx.fillStyle = "transparent";

  function roundedRect(rx, ry, rw, rh, r) {
    const rr = Math.max(0, Math.min(r, Math.min(rw, rh) / 2));
    ctx.beginPath();
    ctx.moveTo(rx + rr, ry);
    ctx.lineTo(rx + rw - rr, ry);
    ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + rr);
    ctx.lineTo(rx + rw, ry + rh - rr);
    ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - rr, ry + rh);
    ctx.lineTo(rx + rr, ry + rh);
    ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - rr);
    ctx.lineTo(rx, ry + rr);
    ctx.quadraticCurveTo(rx, ry, rx + rr, ry);
    ctx.closePath();
  }

  switch (obj.type) {
    // Batterie : rectangle BLEU (abstrait, non figuratif)
    case "batterie": {
      // Règles : 1 info = 1 couleur ; forme simple ; aucun pictogramme
      const blue = "#2563eb";
      const pad = Math.max(6, Math.min(12, Math.min(w, h) * 0.14));
      ctx.setLineDash([]);
      ctx.strokeStyle = blue;
      ctx.fillStyle = blue;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(x + pad, y + pad, Math.max(1, w - pad * 2), Math.max(1, h - pad * 2));
      ctx.fill();
      ctx.stroke();
      break;
    }

    // Compteur électrique : carré VERT (abstrait, non figuratif)
    case "compteur": {
      // Règles : 1 info = 1 couleur ; forme simple ; aucun pictogramme
      const green = "#16a34a";
      const pad = Math.max(6, Math.min(12, Math.min(w, h) * 0.14));
      const size = Math.max(1, Math.min(w, h) - pad * 2); // carré dans le bbox
      const sx = -size / 2;
      const sy = -size / 2;
      ctx.setLineDash([]);
      ctx.strokeStyle = green;
      ctx.fillStyle = green;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(sx, sy, size, size);
      ctx.fill();
      ctx.stroke();
      break;
    }

    // Disjoncteur : symbole "interdiction" vectoriel (sans emoji)
    case "disjoncteur": {
      // Règles : sens interdit ⛔, ROUGE, aucun fond supplémentaire
      const red = "#dc2626";
      const rr = Math.min(w, h) * 0.5;

      ctx.setLineDash([]);
      ctx.strokeStyle = red;
      ctx.fillStyle = "transparent";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-rr * 0.72, rr * 0.72);
      ctx.lineTo(rr * 0.72, -rr * 0.72);
      ctx.stroke();
      break;
    }

    // Annotations géométriques
    case "rect": {
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.stroke();
      break;
    }
    case "circle": {
      ctx.beginPath();
      ctx.ellipse(0, 0, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "triangle": {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      ctx.stroke();
      break;
    }

    // Flèche libre (neutre)
    case "arrow": {
      const x1 = -w / 2;
      const x2 = w / 2;
      const yy = 0;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(17, 24, 39, 0.95)";
      ctx.beginPath();
      ctx.moveTo(x1, yy);
      ctx.lineTo(x2, yy);
      ctx.stroke();
      const head = Math.max(10, Math.min(18, w / 4));
      ctx.fillStyle = "rgba(17, 24, 39, 0.95)";
      ctx.beginPath();
      ctx.moveTo(x2, yy);
      ctx.lineTo(x2 - head, yy - head * 0.55);
      ctx.lineTo(x2 - head, yy + head * 0.55);
      ctx.closePath();
      ctx.fill();
      break;
    }

    // Sens de la pente : ROUGE, flèche fine, pointe fine et allongée (évoque la gravité)
    case "sens_pente": {
      const red = "rgba(220, 38, 38, 0.98)";
      const x1 = -w / 2;
      const x2 = w / 2;
      // Légère diagonale descendante pour évoquer clairement la pente / gravité
      const yOffset = Math.min(12, Math.max(4, h * 0.22));
      const y1 = -yOffset;
      const y2 = yOffset;
      ctx.lineWidth = 1.6;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash([]);
      ctx.strokeStyle = red;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      // Pointe : chevron long et étroit (pas un triangle "massif")
      const headLen = Math.max(14, Math.min(26, w / 2.8));
      const headHalfWidth = Math.max(3.5, Math.min(7.5, headLen * 0.22));
      ctx.beginPath();
      // Construire la pointe autour de la direction du segment (x1,y1)->(x2,y2)
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      // Vecteur normal (perpendiculaire) pour l'ouverture du chevron
      const nx = -uy;
      const ny = ux;
      const tipX = x2;
      const tipY = y2;
      const backX = tipX - ux * headLen;
      const backY = tipY - uy * headLen;
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(backX + nx * headHalfWidth, backY + ny * headHalfWidth);
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(backX - nx * headHalfWidth, backY - ny * headHalfWidth);
      ctx.stroke();
      break;
    }

    // Voie d’accès : violet pointillé, style "chemin" (pas une flèche pleine)
    case "voie_acces": {
      // Règles : ligne pointillée VIOLET, sans flèche / sans tête directionnelle
      const violet = "#7c3aed";
      const x1 = -w / 2;
      const x2 = w / 2;
      const yy = 0;
      ctx.lineWidth = 2;
      ctx.strokeStyle = violet;
      ctx.fillStyle = "transparent";
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(x1, yy);
      ctx.lineTo(x2, yy);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    }

    // Nord : marqueur simple SANS lettre (pas de "N" textuel)
    case "nord": {
      const pad = 10;
      const x1 = x + pad;
      const x2 = x + w - pad;
      const yy = 0;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x1, yy);
      ctx.lineTo(x2, yy);
      ctx.stroke();
      const head = Math.max(10, Math.min(18, w / 4));
      ctx.beginPath();
      ctx.moveTo(x2, yy);
      ctx.lineTo(x2 - head, yy - head / 2);
      ctx.lineTo(x2 - head, yy + head / 2);
      ctx.closePath();
      ctx.fillStyle = "rgba(17, 24, 39, 0.95)";
      ctx.fill();
      break;
    }

    // Angle de prise de vue : cône ouvert (2 lignes divergentes) + arc intérieur (style "Solteo")
    case "angle_vue": {
      const a = Math.PI / 6; // ouverture ~30°
      const baseX = 0;
      const baseY = 0;
      // Rayon borné pour rester strictement dans le bbox
      const pad = Math.max(6, Math.min(12, Math.min(w, h) * 0.12));
      const r = Math.max(10, Math.min((Math.min(w, h) / 2) - pad, Math.min(w, h) * 0.45));
      // Règles : NOIR/GRIS FONCÉ, traits fins, aucune icône appareil photo
      const dark = "#111827";
      ctx.lineWidth = 1.6;
      ctx.setLineDash([]);
      ctx.strokeStyle = dark;
      ctx.fillStyle = "transparent";
      const ex1 = baseX + Math.cos(-a) * r;
      const ey1 = baseY + Math.sin(-a) * r;
      const ex2 = baseX + Math.cos(a) * r;
      const ey2 = baseY + Math.sin(a) * r;
      ctx.beginPath();
      ctx.moveTo(baseX, baseY);
      ctx.lineTo(ex1, ey1);
      ctx.moveTo(baseX, baseY);
      ctx.lineTo(ex2, ey2);
      ctx.stroke();
      // Arc intérieur
      const rArc = r * 0.75;
      ctx.beginPath();
      ctx.arc(baseX, baseY, rArc, -a, a);
      ctx.stroke();
      break;
    }

    default: {
      // Fallback : cadre
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function renderDP2BusinessSelection(ctx, obj) {
  if (!obj || obj.visible !== true || !obj.geometry) return;
  const g = obj.geometry;
  const w = g.width || 0;
  const h = g.height || 0;
  if (!(w > 0) || !(h > 0)) return;

  const cx = g.x + w / 2;
  const cy = g.y + h / 2;
  const rotateHandleOffset = 18;
  const tool = window.DP2_STATE?.currentTool || "select";
  const allowHandles = isDP2BusinessTool(tool);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(g.rotation || 0);

  const x = -w / 2;
  const y = -h / 2;

  // Bounding box
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = "#6366f1";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);

  // En mode "Sélection" (neutre), on cache les handles : move-only.
  if (allowHandles) {
    // Resize handle (bas-droit)
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#6366f1";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(x + w - 6, y + h - 6, 12, 12);
    ctx.fill();
    ctx.stroke();

    // Rotation handle (haut-centre, hors bbox)
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(0, y - rotateHandleOffset);
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(0, y - rotateHandleOffset, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

// --------------------------
// DP2 — SCALE (METERS PER PIXEL)
// --------------------------
function lockDP2Scale() {
  // ⚠️ Si scale_m_per_px est déjà défini, ne pas l'écraser (immutable)
  if (window.DP2_STATE?.scale_m_per_px != null) {
    console.log("[DP2] Échelle déjà verrouillée :", window.DP2_STATE.scale_m_per_px, "m / px");
    return;
  }

  if (!window.DP2_STATE || !window.DP2_STATE.capture) {
    console.warn("[DP2] Impossible de verrouiller l'échelle : capture absente");
    return;
  }

  const scale = window.DP2_STATE.capture.resolution;

  if (typeof scale !== "number" || scale <= 0) {
    console.warn("[DP2] Échelle invalide :", scale);
    return;
  }

  window.DP2_STATE.scale_m_per_px = scale;

  console.log("[DP2] Échelle verrouillée :", scale, "m / px");
}

// --------------------------
// DP2 — MVT : compteur chargement tuiles + attente idle
// --------------------------
let dp2MvtTilesLoadingCount = 0;
let dp2MvtFeatureLogged = false;

function waitMvtTilesIdle(timeoutMs) {
  return new Promise((resolve) => {
    let resolved = false;
    const doResolve = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };
    const check = () => {
      if (dp2MvtTilesLoadingCount <= 0) {
        // Attendre un rendu avant de résoudre (2x rAF)
        requestAnimationFrame(() => {
          requestAnimationFrame(() => doResolve());
        });
        return;
      }
      setTimeout(check, 50);
    };
    setTimeout(() => doResolve(), timeoutMs);
    check();
  });
}

// --------------------------
// DP2 — SOURCE MVT CADASTRE FRANCE (openmaptiles.data.gouv.fr, Etalab)
// Schéma TileJSON : layers parcelles (numero, section), batiments, sections. minzoom 11–16.
// Si CORS bloque, utiliser le proxy backend : DP_API_BASE + "/api/mvt/cadastre/{z}/{x}/{y}.pbf"
// --------------------------
const DP2_CADASTRE_MVT_URL = "https://openmaptiles.data.gouv.fr/data/cadastre/{z}/{x}/{y}.pbf";

// --------------------------
// DP2 — STYLE MVT CADASTRE (contours uniquement, pas de texte custom)
// Parcelles : traits fins gris foncé. Bâtiments : remplissage gris clair. Sections : trait léger.
// Numéros natifs MVT (si présents dans la source) restent gérés par la tuile.
// --------------------------
function styleCadastreMVT(feature) {
  if (!dp2MvtFeatureLogged) {
    dp2MvtFeatureLogged = true;
    const props = feature.getProperties();
    console.log("[DP2 MVT] Première feature — layer:", feature.get("layer"), "keys:", Object.keys(props));
  }

  const layer = feature.get("layer");
  const type = feature.get("type");
  const kind = feature.get("kind");
  const nature = feature.get("nature");
  const geom = feature.getGeometry();
  if (!geom) return null;

  // Détection robuste du type (parcelles, batiments, sections — openmaptiles.data.gouv.fr)
  const isParcelle = layer === "parcelles" || type === "parcelle" || kind === "parcel" || nature === "parcelle";
  const isBatiment = layer === "batiments" || type === "building" || kind === "building" || nature === "batiment";
  const isSection = layer === "sections";

  // ——— Bâtiments : remplissage gris clair discret, contour fin ———
  if (isBatiment) {
    return new ol.style.Style({
      fill: new ol.style.Fill({ color: "rgba(0,0,0,0.06)" }),
      stroke: new ol.style.Stroke({ color: "rgba(0,0,0,0.12)", width: 1 })
    });
  }

  // ——— Sections (optionnel) : trait très léger ———
  if (isSection) {
    return new ol.style.Style({
      fill: new ol.style.Fill({ color: "transparent" }),
      stroke: new ol.style.Stroke({ color: "rgba(0,0,0,0.08)", width: 1 })
    });
  }

  // ——— Parcelles : contour fin gris foncé, pas de texte custom ———
  if (isParcelle) {
    return new ol.style.Style({
      fill: new ol.style.Fill({ color: "transparent" }),
      stroke: new ol.style.Stroke({ color: "#374151", width: 1 })
    });
  }

  // Fallback (autres layers ou schéma inconnu)
  return new ol.style.Style({
    fill: new ol.style.Fill({ color: "transparent" }),
    stroke: new ol.style.Stroke({ color: "#374151", width: 1 })
  });
}

// Forcer un premier rendu utile des couches WMTS à l'ouverture des modals DP2/DP4 (évite écran gris jusqu'au micro zoom).
function forceFirstPaintWMTS(map, wmtsSource, wmtsResolutions) {
  try {
    if (!map || !map.getView) return;
    const v = map.getView();
    if (!v) return;

    // 1) resize + render sync (cas modal)
    try { map.updateSize(); } catch (_) {}
    try { map.renderSync(); } catch (_) {}

    // 2) Jiggle resolution (équivalent micro zoom/dézoom, SANS changer le cadrage final)
    const resList = Array.isArray(wmtsResolutions) ? wmtsResolutions : null;
    const cur = v.getResolution ? v.getResolution() : null;
    if (resList && cur) {
      let idx = resList.indexOf(cur);
      if (idx < 0) {
        // si cur n'est pas exactement dans la liste, trouver le plus proche
        let bestI = 0, bestD = Math.abs(resList[0] - cur);
        for (let i = 1; i < resList.length; i++) {
          const d = Math.abs(resList[i] - cur);
          if (d < bestD) { bestD = d; bestI = i; }
        }
        idx = bestI;
      }
      const altIdx = (idx > 0) ? (idx - 1) : Math.min(1, resList.length - 1);
      const alt = resList[altIdx];

      if (alt && alt !== cur && v.setResolution) {
        v.setResolution(alt);
        try { map.renderSync(); } catch (_) {}
        v.setResolution(cur);
        try { map.renderSync(); } catch (_) {}
      }
    }

    // 3) Dernier safety render après un tick
    requestAnimationFrame(() => {
      try { map.updateSize(); } catch (_) {}
      try { map.renderSync(); } catch (_) {}
    });

    setTimeout(() => {
      try { map.updateSize(); } catch (_) {}
      try { map.renderSync(); } catch (_) {}
    }, 150);

  } catch (_) {}
}

// --------------------------
// DP2 — INIT GLOBAL (CAPTURE MODE)
// Source de vérité UNIQUE : window.DP1_STATE.selectedParcel (geometry, section, parcelle).
// DP2 utilise volontairement la même pile cartographique IGN que DP1 afin de garantir un rendu conforme Géoportail et DP mairie.
// --------------------------
async function initDP2() {
  setDP2ModeCapture();
  dp2MvtTilesLoadingCount = 0;
  dp2MvtFeatureLogged = false;

  // UI DP2 (bouton Télécharger DP2) — même pattern que DP1
  initDP2_UIStates();

  const modal = document.getElementById("dp2-map-modal");
  if (!modal) {
    console.warn("[DP2] dp2-map-modal introuvable (HTML DP2 incomplet).");
    return;
  }

  // Anti double-binding (lié au modal DOM)
  if (modal.dataset.bound === "1") return;
  modal.dataset.bound = "1";

  const mapEl = document.getElementById("dp2-ign-map");
  const scaleEl = document.getElementById("dp2-scale");
  const captureBtn = document.getElementById("dp2-capture-btn");
  const openBtn = document.getElementById("dp2-open-editor");

  if (!mapEl) {
    console.warn("[DP2] dp2-ign-map introuvable (page non prête).");
    return;
  }

  // UI Métadonnées DP2 (passif) : binds select catégorie + module PV
  initDP2MetadataUI();

  if (captureBtn) {
    captureBtn.addEventListener("click", async () => {
      if (window.DP2_MAP && window.DP2_MAP.mvtSource) {
        await waitMvtTilesIdle(2500);
      }
      await captureDP2Map();
    });
  }

  // Toolbar = DOM-only : initialisée dès l'injection de la page (boutons cliquables immédiatement).
  // Canvas = image-dependent : initialisé uniquement dans img.onload via initDP2Editor().
  initDP2Toolbar();
  initDP2DrawActions();

  function closeDP2Modal() {
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("dp-lock-scroll");
    if (document.activeElement) {
      try { document.activeElement.blur(); } catch (_) {}
    }
  }

  function openDP2Modal() {
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("dp-lock-scroll");

    // Créer la map uniquement après que le modal soit visible (conteneur avec taille réelle)
    requestAnimationFrame(async () => {
      await ensureDP2MapReady();
      if (window.DP2_MAP?.map) {
        window.DP2_MAP.map.updateSize();
        window.DP2_MAP.map.renderSync();
      }
      try {
        const m = window.DP2_MAP?.map || null;
        const src = window.DP2_MAP?.mvtSource || null;
        forceFirstPaintWMTS(m, src, window.__DP_WMTS_RESOLUTIONS_PM);
      } catch (_) {}
      syncDP2LegendOverlayUI();
    });
  }

  async function ensureDP2MapReady() {
    if (window.__DP2_INIT_DONE === true && window.DP2_MAP?.map) return;

    // ——— Source de vérité UNIQUE : DP1_STATE.selectedParcel ———
    const selectedParcel = window.DP1_STATE?.selectedParcel || null;
    if (!selectedParcel || !selectedParcel.geometry) {
      console.warn("[DP2] selectedParcel.geometry absente. Aucun affichage.");
      return; // Ne pas poser __DP2_INIT_DONE : ré-init possible après validation DP1
    }

    // ——— Pile cartographique STRICTEMENT identique à DP1 (1:650, Géoportail + filtre Cadastre) ———
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
    window.__DP_WMTS_RESOLUTIONS_PM = WMTS_RESOLUTIONS;
    const WMTS_MATRIX_IDS = WMTS_RESOLUTIONS.map((_, i) => String(i));
    const wmtsGridPM = new ol.tilegrid.WMTS({
      origin: WMTS_ORIGIN,
      resolutions: WMTS_RESOLUTIONS,
      matrixIds: WMTS_MATRIX_IDS
    });

    const view = new ol.View({
      center: [0, 0],
      resolutions: WMTS_RESOLUTIONS,
      constrainResolution: true,
      enableRotation: false
    });

    const map = new ol.Map({
      target: mapEl,
      layers: [],
      view
    });

    // DP2 utilise volontairement la même pile cartographique IGN que DP1 afin de garantir un rendu conforme Géoportail et DP mairie.
    // 1) FOND IGN — WMTS Géoportail PLANIGNV2 (zIndex 0, tileGrid identique DP1) — invisible en DP2 : affichage cadastre seul (référence réglementaire)
    const ignLayerDP2 = new ol.layer.Tile({
      zIndex: 0,
      visible: false,
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
    map.addLayer(ignLayerDP2);

    // 2) FILTRE CADASTRE IGN — WMTS Géoportail PARCELLAIRE_EXPRESS (zIndex 50, tileGrid identique DP1)
    const cadastreLayerDP2 = new ol.layer.Tile({
      zIndex: 50,
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
    map.addLayer(cadastreLayerDP2);

    // ——— 1) GeoJSON → ol.geom.Geometry, extent, zoom automatique strict ———
    let geom = null;
    let extent = null;
    try {
      const geoJsonFormat = new ol.format.GeoJSON();
      geom = geoJsonFormat.readGeometry(selectedParcel.geometry, {
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857"
      });
      if (!geom) throw new Error("readGeometry retourne null");
      extent = geom.getExtent();
      view.fit(extent, {
        padding: [40, 40, 40, 40],
        maxZoom: 20
      });
    } catch (e) {
      console.warn("[DP2] Géométrie parcelle invalide", e);
      return;
    }

    window.DP2_MAP = { map };

    const targetResolution = view.getResolution();
    applySafeInitialResolution(
      window.DP2_MAP.map,
      targetResolution,
      window.__DP_WMTS_RESOLUTIONS_PM
    );

    // ——— 3) Surbillance parcelle DP1 : halo blanc fin + contour bleu (pas de remplissage, pas de texte ; numéro affiché par le cadastre IGN) ———
    const parcelSource = new ol.source.Vector();
    const parcelFeature = new ol.Feature({ geometry: geom });
    parcelSource.addFeature(parcelFeature);
    const parcelVectorLayer = new ol.layer.Vector({
      source: parcelSource,
      zIndex: 200,
      style: [
        new ol.style.Style({
          stroke: new ol.style.Stroke({ color: "rgba(255,255,255,0.95)", width: 4 })
        }),
        new ol.style.Style({
          stroke: new ol.style.Stroke({ color: "#2563eb", width: 4 })
        })
      ]
    });
    map.addLayer(parcelVectorLayer);

    // Échelle (résolution) + forcer réévaluation du style parcelle à chaque zoom
    if (scaleEl) {
      const res = view.getResolution();
      scaleEl.textContent = res ? `Échelle : résolution ${res.toFixed(2)}` : "Échelle : —";
    }
    view.on("change:resolution", () => {
      parcelVectorLayer.changed();
      if (scaleEl) {
        const res = view.getResolution();
        scaleEl.textContent = res ? `Échelle : résolution ${res.toFixed(2)}` : "Échelle : —";
      }
    });

    window.__DP2_INIT_DONE = true; // Uniquement après map IGN + parcelle cible + view.fit() réussis
    console.log("[DP2] Mode CAPTURE prêt (pile IGN identique DP1).");
  }

  // Bind open depuis la page (pattern DP1 : page -> overlay)
  if (openBtn) {
    openBtn.addEventListener("click", (e) => {
      e.preventDefault();
      openDP2Modal();
    });
  }

  // Fermeture identique DP1 : X / bouton / backdrop
  modal.addEventListener("click", (e) => {
    if (
      e.target.closest(".dp-modal-close") ||
      e.target.closest("#dp2-map-cancel") ||
      e.target.classList?.contains?.("dp-modal-backdrop")
    ) {
      e.preventDefault();
      closeDP2Modal();
      return;
    }
  });

  // ESC : fermeture overlay DP2 (ne pas toucher aux autres ESC, ex: menus)
  if (window.__DP2_MODAL_ESC_BOUND !== true) {
    window.__DP2_MODAL_ESC_BOUND = true;
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      // Toujours cibler le modal courant (si la page DP2 est ré-injectée)
      const m = document.getElementById("dp2-map-modal");
      if (!m || m.getAttribute("aria-hidden") !== "false") return;
      e.preventDefault();
      e.stopPropagation();
      m.setAttribute("aria-hidden", "true");
      document.body.classList.remove("dp-lock-scroll");
      if (document.activeElement) {
        try { document.activeElement.blur(); } catch (_) {}
      }
    });
  }
}

// --------------------------
// DP2 — CAPTURE MAP (PLAN DE MASSE)
// --------------------------
async function captureDP2Map() {
  if (!window.DP2_MAP || !window.DP2_MAP.map) {
    console.warn("[DP2] Map DP2 introuvable pour capture");
    return;
  }

  const map = window.DP2_MAP.map;
  const view = map.getView();
  const mapEl = map.getTargetElement();

  lockDPView({ map });

  // Attendre fin de rendu
  await new Promise((resolve) => {
    map.once("rendercomplete", resolve);
    map.renderSync();
  });

  const size = map.getSize();
  if (!size) {
    console.warn("[DP2] Taille de map inconnue");
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = size[0];
  canvas.height = size[1];
  const ctx = canvas.getContext("2d");

  const canvases = mapEl.querySelectorAll(".ol-layer canvas");
  canvases.forEach((c) => {
    if (c.width > 0 && c.height > 0) {
      const opacity = c.parentNode.style.opacity;
      ctx.globalAlpha = opacity === "" ? 1 : Number(opacity);
      const transform = c.style.transform;
      if (transform) {
        const matrix = transform
          .match(/^matrix\(([^\(]*)\)$/)[1]
          .split(",")
          .map(Number);
        ctx.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
      }
      ctx.drawImage(c, 0, 0);
    }
  });

  // ✅ Rose des vents (même asset/style que DP1) : doit être intégrée à l'image capturée
  // Important : cibler spécifiquement l'arrow du modal DP2 (DP1 a aussi une .dp1-north-arrow).
  try {
    const modal = document.getElementById("dp2-map-modal");
    const arrow = modal ? modal.querySelector(".dp1-north-arrow") : null;
    if (arrow) {
      // S'assure que l'image est décodée avant drawImage (sinon: pas de rose des vents dans le PNG)
      if (!(arrow.complete && arrow.naturalWidth > 0)) {
        await Promise.race([
          new Promise((resolve) => { arrow.onload = resolve; arrow.onerror = resolve; }),
          new Promise((resolve) => setTimeout(resolve, 1200))
        ]);
      }

      if (arrow.complete && arrow.naturalWidth > 0) {
        const r = arrow.getBoundingClientRect();
        const mr = mapEl.getBoundingClientRect();
        // On dessine l'image à la position relative au conteneur OpenLayers (#dp2-ign-map)
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.drawImage(
          arrow,
          r.left - mr.left,
          r.top - mr.top,
          r.width,
          r.height
        );
      }
    }
  } catch (_) {}

  const imageBase64 = canvas.toDataURL("image/png");

  // Données métriques
  const resolution = view.getResolution(); // unités projetées / px (Web Mercator : pas m/px au sol)
  const rotation = view.getRotation(); // radians
  const center = view.getCenter();
  const zoom = view.getZoom();

  // ✅ OBLIGATOIRE : width/height pour import DP2→DP4 (dp4DrawDP2ContourOnScreenOverlay, dp4TransformDP2ToDP4PixelsFromCurrentMapView)
  // Sans eux : w2/h2 = 0 → retour anticipé silencieux, contour invisible, transform inopérant
  window.DP2_STATE.capture = {
    imageBase64,
    resolution,
    rotation,
    center,
    zoom,
    width: size[0],
    height: size[1],
    capturedAt: Date.now()
  };

  console.log("[DP2] Capture enregistrée", window.DP2_STATE.capture);

  // ⚠️ ÉTAPE 2 : CALCULER ET FIGER L'ÉCHELLE (UNE SEULE FOIS, IMMUTABLE)
  // En EPSG:3857 (Web Mercator), view.getResolution() donne des m/px à l'équateur uniquement.
  // Au sol (à la latitude du centre), 1 px représente une autre distance : il faut
  // getPointResolution(..., "m") pour obtenir le vrai m/px au centre de la vue.
  // Utiliser scale_m_per_px (pas scale) comme source de vérité unique.
  // Si scale_m_per_px est déjà défini, ne pas l'écraser
  if (window.DP2_STATE.scale_m_per_px == null) {
    const scale_m_per_px = ol.proj.getPointResolution(
      map.getView().getProjection(),
      map.getView().getResolution(),
      map.getView().getCenter(),
      "m"
    );
    window.DP2_STATE.scale_m_per_px = scale_m_per_px;
    console.log("[DP2] scale_m_per_px (ground) =", scale_m_per_px, "m/px");
  } else {
    console.log("[DP2] Échelle déjà figée (ignorée) :", window.DP2_STATE.scale_m_per_px, "m / px");
  }

  // ⚠️ ÉTAPE 3 : VERROUILLER DÉFINITIVEMENT LA CARTE APRÈS CAPTURE
  // Désactiver TOUTES les interactions OpenLayers (zoom, pan, scroll, drag)
  map.getInteractions().forEach(i => i.setActive(false));
  console.log("[DP2] Toutes les interactions OpenLayers désactivées");

  // Masquer la carte
  const mapWrap = document.getElementById("dp2-ign-map");
  if (mapWrap) mapWrap.style.display = "none";

  // Éviter la double rose des vents : elle est maintenant "baked" dans l'image capturée
  try {
    const modal = document.getElementById("dp2-map-modal");
    const arrow = modal ? modal.querySelector(".dp1-north-arrow") : null;
    if (arrow) arrow.style.display = "none";
  } catch (_) {}

  // Afficher l'image capturée comme fond figé
  const imgWrap = document.getElementById("dp2-captured-image-wrap");
  const imgEl = document.getElementById("dp2-captured-image");

  if (imgWrap && imgEl) {
    // Timing image → canvas : n'appeler initDP2Editor qu'une fois l'image
    // entièrement chargée (naturalWidth/naturalHeight > 0), sinon le canvas
    // est initialisé en 0×0 et ne reçoit aucun clic.
    imgEl.onload = function () {
      initDP2Editor();
    };
    imgEl.src = imageBase64;
    imgWrap.style.display = "block";
  } else {
    initDP2Editor();
  }

  const imgElStyle = document.getElementById("dp2-captured-image");
  if (imgElStyle) {
    imgElStyle.style.pointerEvents = "none";
    imgElStyle.style.userSelect = "none";
    imgElStyle.style.transform = "none";
    imgElStyle.style.maxWidth = "100%";
    imgElStyle.style.height = "auto";
  }

  // ⚠️ ÉTAPE 4 : PASSER EN MODE ÉDITION
  setDP2ModeEdition();

  // optionnel : passer l’état UI en GENERATED (bouton Télécharger DP2)
  if (window.DP2_UI?.setState) {
    window.DP2_UI.setState("GENERATED");
  }
}

// ======================================================
// DP3 — PLAN DE COUPE (FRONTEND)
// ======================================================
(function () {
  const DP3_LS_KEY = "DP3_STATE_V1";

  // non persisté (mémoire uniquement)
  let DP3_SELECTED_ID = null;
  let DP3_EDITOR_OPEN = false;
  let DP3_EDITOR_KEY_HANDLER = null;

  function DP3_defaultState() {
    return {
      hasDP3: false,
      typeKey: null, // "surimposition"|"integration"|"toit_terrasse"|"sol"
      baseImage: null, // "photos/xxx.png"
      // "portrait" | "paysage" (utilisé plus tard dans le PDF DP3)
      installationOrientation: "portrait",
      module: null, // module PV sélectionné (objet issu de DP2_PANEL_CATALOG) ou null
      manualImageName: null,
      textBoxes: [
        // { id, x, y, w, h, text, fontSize }
      ],
      validatedAt: null,
    };
  }

  function DP3_loadState() {
    try {
      const raw = localStorage.getItem(DP3_LS_KEY);
      if (!raw) return DP3_defaultState();
      const parsed = JSON.parse(raw);
      const s = { ...DP3_defaultState(), ...(parsed || {}) };
      // compat champs potentiellement manquants
      if (!Array.isArray(s.textBoxes)) s.textBoxes = [];
      // compat/validation
      if (s.installationOrientation !== "portrait" && s.installationOrientation !== "paysage") {
        s.installationOrientation = "portrait";
      }
      return s;
    } catch (e) {
      return DP3_defaultState();
    }
  }

  function DP3_saveState(state) {
    try {
      localStorage.setItem(DP3_LS_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  function DP3_clamp01(v) {
    if (typeof v !== "number" || Number.isNaN(v)) return 0;
    return Math.max(0, Math.min(1, v));
  }

  function DP3_findBoxIndexById(state, id) {
    return (state.textBoxes || []).findIndex((b) => b && b.id === id);
  }

  function DP3_getTypeMap() {
    return {
      surimposition: "photos/Toiture inclinée - surimposition.png",
      integration: "photos/Toit incliné - intégration.png",
      toit_terrasse: "photos/Toiture plate - toit terrasse.png",
      sol: "photos/pose au sol.png",
    };
  }

  function DP3_ensureModalNotDuplicated(modalId) {
    const existing = document.getElementById(modalId);
    if (existing) existing.remove();
  }

  function DP3_buildModalShell(modalId, titleHtml) {
    DP3_ensureModalNotDuplicated(modalId);
    const modal = document.createElement("div");
    modal.className = "dp-modal";
    modal.id = modalId;
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
      <div class="dp-modal-backdrop"></div>
      <div class="dp-modal-panel">
        <div class="dp-modal-header">
          <h2 class="dp-modal-title-solarglobe">${titleHtml}</h2>
          <button class="dp-modal-close" type="button" aria-label="Fermer">✕</button>
        </div>
        <div class="dp-modal-body"></div>
        <div class="dp-modal-footer"></div>
      </div>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  function DP3_showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.setAttribute("aria-hidden", "false");
  }

  function DP3_hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.setAttribute("aria-hidden", "true");
  }

  function DP3_bindModalCloseHandlers(modalId, onClose) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    if (modal.dataset.bound === "1") return;
    modal.dataset.bound = "1";

    modal.addEventListener("click", (e) => {
      if (
        e.target.closest(".dp-modal-close") ||
        e.target.classList?.contains?.("dp-modal-backdrop")
      ) {
        e.preventDefault();
        try {
          onClose && onClose();
        } catch (_) {}
      }
    });
  }

  function DP3_renderHome() {
    const root = document.getElementById("dp3-root");
    if (!root) return;

    const state = window.DP3_STATE;
    const uploadSub = document.getElementById("dp3-upload-sub");
    const previewInner = document.getElementById("dp3-preview-inner");
    const btnDownload = document.getElementById("dp3-download-btn");

    if (uploadSub) {
      const baseText = "Fallback manuel si l’auto-génération n’est pas possible.";
      if (state && state.manualImageName) {
        uploadSub.innerHTML = `${baseText}<br>Image importée : <strong>${state.manualImageName}</strong>`;
      } else {
        uploadSub.textContent = baseText;
      }
    }

    if (previewInner) {
      if (!state || !state.hasDP3) {
        previewInner.classList.add("dp-placeholder");
        previewInner.innerHTML = `
          <div class="dp-placeholder-title">Aucune DP3 créée pour le moment.</div>
          <div class="dp-placeholder-sub">Cliquez sur “Créer nouvelle DP3”.</div>
        `;
      } else {
        const safeSrc = state.baseImage || "";
        previewInner.classList.remove("dp-placeholder");
        previewInner.innerHTML = `
          <div class="dp3-preview">
            <img class="dp3-preview-img" alt="Aperçu DP3" src="${safeSrc}">
            <div class="dp3-preview-badge">DP3 prête</div>
          </div>
        `;
      }
    }

    if (btnDownload) {
      btnDownload.style.display = state && state.hasDP3 ? "" : "none";
    }
  }

  function DP3_imageSrcToDataUrl(src) {
    if (!src || typeof src !== "string") return Promise.resolve(null);
    if (src.startsWith("data:image")) return Promise.resolve(src);

    return new Promise((resolve) => {
      const img = new Image();
      try { img.crossOrigin = "anonymous"; } catch (_) {}
      img.onload = () => {
        try {
          const w = img.naturalWidth || 1;
          const h = img.naturalHeight || 1;
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) return resolve(src);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/png"));
        } catch (_) {
          // fallback : conserver la source si conversion impossible
          resolve(src);
        }
      };
      img.onerror = () => resolve(src);
      img.src = src;
    });
  }

  async function DP3_downloadPDF() {
    const state = window.DP3_STATE || DP3_loadState();
    window.DP3_STATE = state;

    if (!state || !state.hasDP3) {
      alert("DP3 non validée");
      return;
    }
    if (!state.baseImage) {
      alert("Image DP3 manquante");
      return;
    }

    const baseImage = await DP3_imageSrcToDataUrl(state.baseImage);
    if (!baseImage) {
      alert("Image DP3 manquante");
      return;
    }

    const dp3Data = {
      client: buildPdfClientFromDP1Context(),
      typeKey: state.typeKey ?? null,
      installationOrientation: state.installationOrientation === "paysage" ? "paysage" : "portrait",
      module: state.module ?? null,
      baseImage,
      textBoxes: Array.isArray(state.textBoxes) ? state.textBoxes : [],
    };

    const res = await fetch("http://localhost:3000/pdf/render/dp3/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dp3Data })
    });

    if (!res.ok) {
      alert("Erreur PDF DP3");
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");

    const a = document.createElement("a");
    a.href = url;
    a.download = "DP3_Plan_de_coupe.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  function DP3_openTypeModal() {
    const state = window.DP3_STATE || DP3_loadState();
    window.DP3_STATE = state;

    const typeMap = DP3_getTypeMap();
    const modalId = "dp3-type-modal";
    const modal = DP3_buildModalShell(
      modalId,
      `DP3 — Plan de coupe <span class="dp3-modal-subtitle">Choisir un type d’installation</span>`
    );

    modal.classList.add("dp3-type-modal");
    const body = modal.querySelector(".dp-modal-body");
    const footer = modal.querySelector(".dp-modal-footer");

    let DP3_TEMP = { typeKey: null, baseImage: null };

    if (body) {
      body.classList.add("dp3-type-body");
      body.innerHTML = `
        <div class="dp3-type-grid" role="list">
          ${[
            { key: "surimposition", label: "Surimposition", img: typeMap.surimposition },
            { key: "integration", label: "Intégration", img: typeMap.integration },
            { key: "toit_terrasse", label: "Toit terrasse", img: typeMap.toit_terrasse },
            { key: "sol", label: "Pose au sol", img: typeMap.sol },
          ]
            .map(
              (t) => `
            <button type="button" class="dp3-type-card" data-type="${t.key}" role="listitem">
              <img class="dp3-type-card-img" alt="${t.label}" src="${t.img}">
              <div class="dp3-type-card-label">${t.label}</div>
            </button>
          `
            )
            .join("")}
        </div>
      `;
    }

    if (footer) {
      footer.classList.add("dp3-type-footer");
      footer.innerHTML = `
        <button class="dp-btn dp-btn-outline" type="button" id="dp3-type-cancel">Annuler</button>
        <button class="dp-btn dp-btn-primary" type="button" id="dp3-type-confirm" disabled>Confirmer</button>
      `;
    }

    function refreshSelectionUI() {
      const cards = modal.querySelectorAll(".dp3-type-card");
      cards.forEach((c) => {
        const isSel = c.dataset.type === DP3_TEMP.typeKey;
        c.classList.toggle("selected", !!isSel);
      });
      const btnConfirm = modal.querySelector("#dp3-type-confirm");
      if (btnConfirm) btnConfirm.disabled = !DP3_TEMP.typeKey;
    }

    modal.addEventListener("click", (e) => {
      const card = e.target.closest(".dp3-type-card");
      if (!card) return;
      const typeKey = card.dataset.type;
      if (!typeKey || !typeMap[typeKey]) return;
      DP3_TEMP.typeKey = typeKey;
      DP3_TEMP.baseImage = typeMap[typeKey];
      refreshSelectionUI();
    });

    const btnCancel = modal.querySelector("#dp3-type-cancel");
    const btnConfirm = modal.querySelector("#dp3-type-confirm");
    if (btnCancel) {
      btnCancel.addEventListener("click", () => DP3_closeTypeModal());
    }
    if (btnConfirm) {
      btnConfirm.addEventListener("click", () => {
        if (!DP3_TEMP.typeKey || !DP3_TEMP.baseImage) return;

        // "Créer nouvelle DP3" => reset soft, puis ouvrir l’éditeur
        window.DP3_STATE.typeKey = DP3_TEMP.typeKey;
        window.DP3_STATE.baseImage = DP3_TEMP.baseImage;
        window.DP3_STATE.hasDP3 = false;
        window.DP3_STATE.validatedAt = null;
        window.DP3_STATE.installationOrientation = "portrait";
        window.DP3_STATE.module = null;
        window.DP3_STATE.textBoxes = [];
        DP3_saveState(window.DP3_STATE);

        DP3_closeTypeModal();
        DP3_openEditor();
      });
    }

    DP3_bindModalCloseHandlers(modalId, () => DP3_closeTypeModal());
    refreshSelectionUI();
    DP3_showModal(modalId);
  }

  function DP3_closeTypeModal() {
    const modalId = "dp3-type-modal";
    const modal = document.getElementById(modalId);
    if (!modal) return;
    DP3_hideModal(modalId);
    modal.remove();
  }

  function DP3_openEditor() {
    const state = window.DP3_STATE || DP3_loadState();
    window.DP3_STATE = state;

    if (!state.typeKey || !state.baseImage) {
      console.log("[DP3] baseImage manquante, éditeur non ouvert.", state);
      return;
    }

    const modalId = "dp3-editor-modal";
    const modal = DP3_buildModalShell(modalId, `DP3 — Éditeur (Plan de coupe)`);
    modal.classList.add("dp3-editor-modal");
    const body = modal.querySelector(".dp-modal-body");
    const footer = modal.querySelector(".dp-modal-footer");

    if (body) {
      body.classList.add("dp3-editor-body");
      body.innerHTML = `
        <aside class="dp-map-help dp3-editor-left">
          <h3>Paramètres</h3>

          <div class="dp3-field">
            <label class="dp3-label">Type d’installation</label>
            <select id="dp3-installation-orientation" class="dp3-select">
              <option value="portrait">Portrait</option>
              <option value="paysage">Paysage</option>
            </select>
          </div>

          <hr />

          <!-- Modules PV (identique DP2 : choix + lecture seule) -->
          <div class="dp2-field">
            <label class="dp2-label">Module photovoltaïque</label>
            <select id="dp3-panel-select" class="dp2-select">
              <option value="">— Sélectionner un module —</option>
              <option value="longi_x10_artist">LONGi Hi-MO X10 Artist — 485 W</option>
              <option value="longi_x10_explorer">LONGi Hi-MO X10 Explorer — 485 W</option>
            </select>
          </div>

          <div class="dp2-panel-readonly">
            <div><strong>Fabricant :</strong> <span id="dp3-panel-manufacturer">—</span></div>
            <div><strong>Référence :</strong> <span id="dp3-panel-reference">—</span></div>
            <div><strong>Puissance :</strong> <span id="dp3-panel-power">—</span></div>
            <div><strong>Dimensions :</strong> <span id="dp3-panel-dimensions">—</span></div>
          </div>

          <hr />

          <h3>Zones texte</h3>
          <div class="dp3-field">
            <button class="dp-btn dp-btn-primary" type="button" id="dp3-add-textbox">+ Ajouter une zone texte</button>
          </div>

          <div class="dp3-field">
            <label class="dp3-label">Taille de police</label>
            <select id="dp3-fontsize" class="dp3-select">
              <option value="12">12</option>
              <option value="14" selected>14</option>
              <option value="16">16</option>
              <option value="18">18</option>
            </select>
          </div>

          <div class="dp3-field">
            <button class="dp-btn dp-btn-outline" type="button" id="dp3-delete-textbox" disabled>Supprimer la zone</button>
          </div>
        </aside>

        <div class="dp3-editor-canvas">
          <div class="dp3-page">
            <div class="dp3-stage-wrap">
              <div class="dp3-stage" id="dp3-stage">
                <img id="dp3-stage-img" alt="Plan de coupe (base)" src="${state.baseImage}">
                <div class="dp3-overlay" id="dp3-overlay" aria-label="Zones texte"></div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    if (footer) {
      footer.classList.add("dp3-editor-footer");
      footer.innerHTML = `
        <button class="dp-btn dp-btn-outline" type="button" id="dp3-editor-cancel">Annuler</button>
        <button class="dp-btn dp-btn-primary" type="button" id="dp3-editor-validate">Valider</button>
      `;
    }

    function getFontSizeFromUI() {
      const sel = modal.querySelector("#dp3-fontsize");
      const v = sel ? parseInt(sel.value, 10) : 14;
      return Number.isFinite(v) ? v : 14;
    }

    function setDeleteBtnEnabled(enabled) {
      const btn = modal.querySelector("#dp3-delete-textbox");
      if (btn) btn.disabled = !enabled;
    }

    function renderOverlay() {
      const overlay = modal.querySelector("#dp3-overlay");
      if (!overlay) return;
      overlay.innerHTML = "";

      const boxes = window.DP3_STATE.textBoxes || [];
      boxes.forEach((b) => {
        if (!b) return;
        const el = document.createElement("div");
        el.className = "dp3-textbox";
        if (b.id === DP3_SELECTED_ID) el.classList.add("selected");
        el.dataset.id = b.id;
        el.style.left = `${DP3_clamp01(b.x) * 100}%`;
        el.style.top = `${DP3_clamp01(b.y) * 100}%`;
        el.style.width = `${DP3_clamp01(b.w) * 100}%`;
        el.style.height = `${DP3_clamp01(b.h) * 100}%`;
        el.style.fontSize = `${b.fontSize || 14}px`;
        el.tabIndex = 0;

        el.innerHTML = `
          <div class="dp3-textbox-content">${(b.text || "").replace(/</g, "&lt;") || "<span class='dp3-textbox-placeholder'>Texte…</span>"}</div>
          <div class="dp3-resize-handle" title="Redimensionner"></div>
        `;
        overlay.appendChild(el);
      });

      setDeleteBtnEnabled(!!DP3_SELECTED_ID);
    }

    function saveAndRerender() {
      DP3_saveState(window.DP3_STATE);
      renderOverlay();
    }

    function selectBox(id) {
      DP3_SELECTED_ID = id;
      renderOverlay();
    }

    function clearSelection() {
      DP3_SELECTED_ID = null;
      renderOverlay();
    }

    function isEditingElement(el) {
      return !!el?.closest?.(".dp3-textbox")?.querySelector?.(".dp3-textbox-editor");
    }

    function openEditorForBox(boxEl) {
      const id = boxEl.dataset.id;
      const idx = DP3_findBoxIndexById(window.DP3_STATE, id);
      if (idx < 0) return;
      const b = window.DP3_STATE.textBoxes[idx];
      if (!b) return;
      const content = boxEl.querySelector(".dp3-textbox-content");
      if (!content) return;
      if (boxEl.querySelector(".dp3-textbox-editor")) return;

      const ta = document.createElement("textarea");
      ta.className = "dp3-textbox-editor";
      ta.value = b.text || "";
      ta.spellcheck = false;
      ta.style.fontSize = `${b.fontSize || 14}px`;

      content.innerHTML = "";
      content.appendChild(ta);
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);

      const commit = () => {
        const newText = ta.value || "";
        window.DP3_STATE.textBoxes[idx].text = newText;
        DP3_saveState(window.DP3_STATE);
        renderOverlay();
      };

      ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          ta.blur();
        }
        e.stopPropagation();
      });
      ta.addEventListener("blur", () => commit());
    }

    function deleteSelectedBox() {
      if (!DP3_SELECTED_ID) return;
      const idx = DP3_findBoxIndexById(window.DP3_STATE, DP3_SELECTED_ID);
      if (idx < 0) return;
      window.DP3_STATE.textBoxes.splice(idx, 1);
      DP3_SELECTED_ID = null;
      saveAndRerender();
    }

    function bindDragAndResize() {
      const overlay = modal.querySelector("#dp3-overlay");
      if (!overlay) return;

      let active = null; // { mode, id, startX, startY, startBox, overlayW, overlayH }

      function getOverlayMetrics() {
        const w = overlay.clientWidth || 1;
        const h = overlay.clientHeight || 1;
        return { w, h };
      }

      function onPointerMove(e) {
        if (!active) return;
        const state = window.DP3_STATE;
        const idx = DP3_findBoxIndexById(state, active.id);
        if (idx < 0) return;
        const b = state.textBoxes[idx];

        const dx = (e.clientX - active.startX) / active.overlayW;
        const dy = (e.clientY - active.startY) / active.overlayH;

        if (active.mode === "drag") {
          const newX = DP3_clamp01(active.startBox.x + dx);
          const newY = DP3_clamp01(active.startBox.y + dy);
          // clamp max pour éviter dépassement de la boîte
          b.x = DP3_clamp01(Math.min(newX, 1 - b.w));
          b.y = DP3_clamp01(Math.min(newY, 1 - b.h));
        } else if (active.mode === "resize") {
          const minW = 0.12;
          const minH = 0.06;
          const newW = Math.max(minW, DP3_clamp01(active.startBox.w + dx));
          const newH = Math.max(minH, DP3_clamp01(active.startBox.h + dy));
          b.w = Math.min(newW, 1 - b.x);
          b.h = Math.min(newH, 1 - b.y);
        }
        DP3_saveState(state);
        renderOverlay();
      }

      function onPointerUp() {
        if (!active) return;
        active = null;
        try {
          window.removeEventListener("pointermove", onPointerMove, true);
          window.removeEventListener("pointerup", onPointerUp, true);
        } catch (_) {}
      }

      overlay.addEventListener("pointerdown", (e) => {
        const tb = e.target.closest(".dp3-textbox");
        if (!tb) {
          clearSelection();
          return;
        }
        if (isEditingElement(tb)) return;

        const id = tb.dataset.id;
        if (!id) return;
        selectBox(id);

        const isResize = e.target.classList?.contains?.("dp3-resize-handle");
        const mode = isResize ? "resize" : "drag";

        const state = window.DP3_STATE;
        const idx = DP3_findBoxIndexById(state, id);
        if (idx < 0) return;

        const { w: overlayW, h: overlayH } = getOverlayMetrics();
        active = {
          mode,
          id,
          startX: e.clientX,
          startY: e.clientY,
          overlayW,
          overlayH,
          startBox: {
            x: state.textBoxes[idx].x,
            y: state.textBoxes[idx].y,
            w: state.textBoxes[idx].w,
            h: state.textBoxes[idx].h,
          },
        };

        window.addEventListener("pointermove", onPointerMove, true);
        window.addEventListener("pointerup", onPointerUp, true);
        e.preventDefault();
      });

      overlay.addEventListener("dblclick", (e) => {
        const tb = e.target.closest(".dp3-textbox");
        if (!tb) return;
        if (isEditingElement(tb)) return;
        selectBox(tb.dataset.id);
        openEditorForBox(tb);
        e.preventDefault();
      });

      overlay.addEventListener("click", (e) => {
        const tb = e.target.closest(".dp3-textbox");
        if (!tb) return;
        if (isEditingElement(tb)) return;
        selectBox(tb.dataset.id);
      });
    }

    function bindUI() {
      // init champs
      const selOrientation = modal.querySelector("#dp3-installation-orientation");
      const panelSelect = modal.querySelector("#dp3-panel-select");

      if (selOrientation) {
        const current = window.DP3_STATE.installationOrientation;
        selOrientation.value = current === "paysage" ? "paysage" : "portrait";
        selOrientation.addEventListener("change", () => {
          const v = selOrientation.value;
          window.DP3_STATE.installationOrientation = v === "paysage" ? "paysage" : "portrait";
          DP3_saveState(window.DP3_STATE);
        });
      }

      function syncDP3PanelMetadataUI() {
        const manufacturerEl = modal.querySelector("#dp3-panel-manufacturer");
        const referenceEl = modal.querySelector("#dp3-panel-reference");
        const powerEl = modal.querySelector("#dp3-panel-power");
        const dimensionsEl = modal.querySelector("#dp3-panel-dimensions");
        if (!manufacturerEl || !referenceEl || !powerEl || !dimensionsEl) return;

        const model = window.DP3_STATE?.module || null;
        if (!model) {
          manufacturerEl.textContent = "—";
          referenceEl.textContent = "—";
          powerEl.textContent = "—";
          dimensionsEl.textContent = "—";
          return;
        }

        manufacturerEl.textContent = model.manufacturer || "—";
        referenceEl.textContent = model.reference || "—";
        powerEl.textContent = typeof model.power_w === "number" ? `${model.power_w} Wc` : "—";
        const h = typeof model.height_m === "number" ? model.height_m.toFixed(2) : null;
        const w = typeof model.width_m === "number" ? model.width_m.toFixed(2) : null;
        dimensionsEl.textContent = h && w ? `${h} × ${w} m` : "—";
      }

      // Modules PV (DP3) — même logique DP2, mais stockage DP3_STATE.module et aucun rendu image
      if (panelSelect) {
        // sync état -> UI si déjà défini (on tente de retrouver la key via reference)
        if (window.DP3_STATE?.module) {
          const currentRef = window.DP3_STATE.module.reference;
          const key = Object.keys(DP2_PANEL_CATALOG).find((k) => DP2_PANEL_CATALOG[k]?.reference === currentRef);
          if (key) panelSelect.value = key;
        } else {
          // sync UI -> état au chargement UNIQUEMENT si l'état n'est pas déjà défini
          const initialKey = panelSelect.value || "";
          window.DP3_STATE.module = DP2_PANEL_CATALOG[initialKey] || null;
          DP3_saveState(window.DP3_STATE);
        }
        syncDP3PanelMetadataUI();

        panelSelect.addEventListener("change", (e) => {
          const value = e.target?.value || "";
          window.DP3_STATE.module = DP2_PANEL_CATALOG[value] || null;
          DP3_saveState(window.DP3_STATE);
          syncDP3PanelMetadataUI();
        });
      }

      const btnAdd = modal.querySelector("#dp3-add-textbox");
      if (btnAdd) {
        btnAdd.addEventListener("click", () => {
          const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
          const fontSize = getFontSizeFromUI();
          const newBox = {
            id,
            x: 0.35,
            y: 0.35,
            w: 0.3,
            h: 0.12,
            text: "",
            fontSize,
          };
          window.DP3_STATE.textBoxes = window.DP3_STATE.textBoxes || [];
          window.DP3_STATE.textBoxes.push(newBox);
          DP3_SELECTED_ID = id;
          saveAndRerender();
        });
      }

      const selFont = modal.querySelector("#dp3-fontsize");
      if (selFont) {
        selFont.addEventListener("change", () => {
          const fs = getFontSizeFromUI();
          if (!DP3_SELECTED_ID) return;
          const idx = DP3_findBoxIndexById(window.DP3_STATE, DP3_SELECTED_ID);
          if (idx < 0) return;
          window.DP3_STATE.textBoxes[idx].fontSize = fs;
          saveAndRerender();
        });
      }

      const btnDelete = modal.querySelector("#dp3-delete-textbox");
      if (btnDelete) {
        btnDelete.addEventListener("click", () => deleteSelectedBox());
      }

      const btnCancel = modal.querySelector("#dp3-editor-cancel");
      const btnValidate = modal.querySelector("#dp3-editor-validate");
      if (btnCancel) btnCancel.addEventListener("click", () => DP3_closeEditor());
      if (btnValidate) {
        btnValidate.addEventListener("click", () => {
          window.DP3_STATE.hasDP3 = true;
          window.DP3_STATE.validatedAt = Date.now();
          DP3_saveState(window.DP3_STATE);
          DP3_closeEditor(true);
        });
      }
    }

    function bindDeleteKey() {
      if (DP3_EDITOR_KEY_HANDLER) return;
      DP3_EDITOR_KEY_HANDLER = (e) => {
        if (!DP3_EDITOR_OPEN) return;
        if (!DP3_SELECTED_ID) return;
        const editor = modal.querySelector(".dp3-textbox-editor");
        if (editor) return; // pas de suppression quand on édite
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          deleteSelectedBox();
        }
      };
      window.addEventListener("keydown", DP3_EDITOR_KEY_HANDLER, true);
    }

    DP3_bindModalCloseHandlers(modalId, () => DP3_closeEditor());

    // init editor state
    DP3_SELECTED_ID = null;
    DP3_EDITOR_OPEN = true;
    bindUI();
    bindDragAndResize();
    bindDeleteKey();
    renderOverlay();

    DP3_showModal(modalId);
  }

  function DP3_closeEditor(wasValidated) {
    const modalId = "dp3-editor-modal";
    const modal = document.getElementById(modalId);
    if (!modal) return;

    DP3_EDITOR_OPEN = false;
    if (DP3_EDITOR_KEY_HANDLER) {
      try {
        window.removeEventListener("keydown", DP3_EDITOR_KEY_HANDLER, true);
      } catch (_) {}
      DP3_EDITOR_KEY_HANDLER = null;
    }
    DP3_hideModal(modalId);
    modal.remove();

    if (wasValidated) {
      DP3_renderHome();
    }
  }

  window.initDP3 = function initDP3() {
    const root = document.getElementById("dp3-root");
    if (!root) return;

    window.DP3_STATE = DP3_loadState();

    // Bind boutons
    const btnCreate = document.getElementById("dp3-create-btn");
    const btnImport = document.getElementById("dp3-import-btn");
    const btnDownload = document.getElementById("dp3-download-btn");

    if (btnCreate) {
      btnCreate.addEventListener("click", () => DP3_openTypeModal());
    }
    if (btnImport) {
      btnImport.addEventListener("click", () => console.log("DP3 import stub"));
    }
    if (btnDownload) {
      btnDownload.addEventListener("click", () => DP3_downloadPDF());
    }

    // Bind carte add
    const cardAdd = document.getElementById("dp3-card-add");
    const fileInput = document.getElementById("dp3-file-input");
    if (cardAdd && fileInput) {
      const trigger = () => fileInput.click();
      cardAdd.addEventListener("click", trigger);
      const box = cardAdd.querySelector(".dp-upload-box");
      if (box) {
        box.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") trigger();
        });
      }

      fileInput.addEventListener("change", () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        window.DP3_STATE.manualImageName = file.name;
        DP3_saveState(window.DP3_STATE);
        DP3_renderHome();
      });
    }

    // Preview click => si DP3 déjà configurée, ouvrir éditeur pour ajustements
    const cardPreview = document.getElementById("dp3-card-preview");
    if (cardPreview) {
      cardPreview.addEventListener("click", () => {
        if (window.DP3_STATE && window.DP3_STATE.baseImage) DP3_openEditor();
      });
    }

    DP3_renderHome();
  };
})();

// ======================================================
// DP4 — PLAN DE TOITURE (UI ONLY)
// ======================================================

// DP4 : export minimal (format DP2 interne) -> DP4_STATE[cat]
function dp4SyncRoofGeometryFromDP2State() {
  if (!dp2IsDP4RoofProfile()) return;
  window.DP4_STATE = window.DP4_STATE || dp4DefaultState();
  const cat = window.DP4_STATE?.photoCategory ?? window.DP2_STATE?.photoCategory ?? null;
  if (cat !== "before" && cat !== "after") return;
  const stateCat = window.DP4_STATE[cat];
  if (!stateCat) return;
  const objects = window.DP2_STATE?.objects || [];

  // A. Construire roofFromContours TOUJOURS depuis dp2GetBuildingContours()
  const contours = dp2GetBuildingContours();
  const roofFromContours = contours
    .filter((c) => c && c.closed === true && Array.isArray(c.points) && c.points.length >= 3)
    .map((c) => ({
      type: "building_outline",
      points: (c.points || []).map((p) => ({ x: p?.x ?? 0, y: p?.y ?? 0 })),
      closed: true
    }));

  // B. Conserver roofFromObjects pour ridge/measure uniquement
  const roofFromObjects = objects.filter((o) => {
    if (!o || typeof o.type !== "string") return false;
    if (o.type === "measure_line" || o.type === "ridge_line") {
      if (Array.isArray(o.points) && o.points.length >= 2) return true;
      return o.a && o.b && typeof o.a.x === "number" && typeof o.a.y === "number" && typeof o.b.x === "number" && typeof o.b.y === "number";
    }
    return false;
  });

  // C. Composer (contour depuis buildingContours, ridge/measure depuis objects)
  const roofObjects = [...roofFromContours, ...roofFromObjects];
  stateCat.roofGeometry = dp2CloneForHistory(roofObjects);

  // DP4 : persister aussi les paramètres & objets "graphiques" (copie stricte DP2 -> DP4)
  try {
    window.DP4_STATE.photoCategory = window.DP2_STATE?.photoCategory ?? null;
    window.DP4_STATE.panelModel = window.DP2_STATE?.panelModel ?? null;
    stateCat.panels = dp2CloneForHistory(Array.isArray(window.DP2_STATE?.panels) ? window.DP2_STATE.panels : []);
    stateCat.textObjects = dp2CloneForHistory(Array.isArray(window.DP2_STATE?.textObjects) ? window.DP2_STATE.textObjects : []);
    stateCat.businessObjects = dp2CloneForHistory(Array.isArray(window.DP2_STATE?.businessObjects) ? window.DP2_STATE.businessObjects : []);
    stateCat.history = dp2CloneForHistory(Array.isArray(window.DP2_STATE?.history) ? window.DP2_STATE.history : []);
  } catch (_) {}

  if (dp2IsDP4RoofProfile()) {
    console.log("[DP4][DEBUG] after dp4Sync: buildingContours=", (window.DP2_STATE.buildingContours || []).length);
  }

  // UI DP4 : lecture seule
  try { syncDP4LegendOverlayUI(); } catch (_) {}
  try { syncDP4ScaleUI(); } catch (_) {}
}

// ======================================================
// DP4 — PERSISTENCE (2 PLANS : before / after)
// - Un seul moteur DP4 / un seul canvas
// - La catégorie active AU MOMENT DU SAVE décide de tout
// ======================================================
const DP4_LS_KEY = "DP4_STATE_V1";
// ======================================================
// DP4 — RENDU FINAL (NETTOYAGE VISUEL) — PERSISTENCE SÉPARÉE
// Objectif :
// - NE PAS modifier DP4_STATE (état de travail)
// - Stocker un rendu "mairie" (fond blanc, traits gris/noir) pour :
//   - miniatures
//   - base future PDF DP4
// ======================================================
const DP4_FINAL_LS_KEY = "DP4_FINAL_RENDER_V1";

function dp4FinalDefaultStore() {
  return {
    before: null, // { imageBase64, finalizedAt }
    after: null
  };
}

function dp4FinalLoadStore() {
  try {
    const raw = localStorage.getItem(DP4_FINAL_LS_KEY);
    if (!raw) return dp4FinalDefaultStore();
    const parsed = JSON.parse(raw);
    const base = dp4FinalDefaultStore();
    const s = { ...base, ...(parsed || {}) };
    // sanity minimale
    for (const k of ["before", "after"]) {
      const v = s[k];
      if (!v) continue;
      if (typeof v.imageBase64 !== "string" || !v.imageBase64.startsWith("data:image")) s[k] = null;
    }
    return s;
  } catch (_) {
    return dp4FinalDefaultStore();
  }
}

function dp4FinalSaveStore(store) {
  try {
    localStorage.setItem(DP4_FINAL_LS_KEY, JSON.stringify(store || dp4FinalDefaultStore()));
  } catch (_) {}
}

function dp4GetFinalRenderFor(category) {
  const cat = category === "before" || category === "after" ? category : null;
  if (!cat) return null;
  const s = dp4FinalLoadStore();
  return s?.[cat] || null;
}

function dp4IsFinalized(category) {
  const v = dp4GetFinalRenderFor(category);
  return !!(v && typeof v.imageBase64 === "string" && v.imageBase64.startsWith("data:image"));
}

function dp4SetFinalRenderFor(category, imageBase64) {
  const cat = category === "before" || category === "after" ? category : null;
  if (!cat) return;
  if (!(typeof imageBase64 === "string" && imageBase64.startsWith("data:image"))) return;
  const s = dp4FinalLoadStore();
  s[cat] = { imageBase64, finalizedAt: Date.now() };
  dp4FinalSaveStore(s);
}

async function dp4BuildFinalRenderImageBase64FromCurrentDom() {
  // IMPORTANT :
  // - Fond blanc
  // - NE PAS inclure l'image satellite (#dp2-captured-image)
  // - Conserver exactement les mêmes couleurs que le canvas (pas de normalisation gris)
  // - Traits plus fins dans le rendu final uniquement (contours 1.5px, faîtage 2px, mesures 1.2px)
  const overlayCanvas = document.getElementById("dp2-draw-canvas");
  if (!overlayCanvas || overlayCanvas.width <= 0 || overlayCanvas.height <= 0) return null;

  // S'assurer que l'affichage reflète l'état courant (sans recalcul géométrique).
  if (typeof window.renderDP2FromState === "function") {
    try { window.renderDP2FromState(); } catch (_) {}
  } else if (typeof renderDP2FromState === "function") {
    try { renderDP2FromState(); } catch (_) {}
  }

  const w = overlayCanvas.width;
  const h = overlayCanvas.height;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) return null;

  // Fond blanc uniforme (satellite supprimé)
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, w, h);

  // ==========================
  // Calque STRUCTUREL (gris/noir)
  // Types concernés :
  // - building_outline (contours de pans)
  // - measure_line (cotes / lignes de mesure)
  // - ridge_line (faîtage)
  // ==========================
  try {
    const structuralCanvas = document.createElement("canvas");
    structuralCanvas.width = w;
    structuralCanvas.height = h;
    const sctx = structuralCanvas.getContext("2d");
    if (sctx && window.DP2_STATE) {
      const objects = window.DP2_STATE.objects || [];
      // Réduction légère des épaisseurs pour le rendu final
      const ORIGINAL_LINE_WIDTH = sctx.lineWidth;
      // 1) Contours : DP2 et DP4 = buildingContours (source unique)
      if (typeof renderDP2BuildingContour === "function") {
        const contours = dp2GetBuildingContours();
        for (const c of contours) {
          const prevLineWidth = sctx.lineWidth;
          sctx.lineWidth = 1.5;
          renderDP2BuildingContour(sctx, c, { active: false });
          sctx.lineWidth = prevLineWidth;
        }
      }
      // 2) Lignes de mesure + faîtage
      for (const obj of objects) {
        if (!obj || !obj.type) continue;
        if (obj.type === "measure_line" && typeof renderMeasureLine === "function") {
          const prevMeasureWidth = sctx.lineWidth;
          sctx.lineWidth = 1.2;
          renderMeasureLine(sctx, obj);
          sctx.lineWidth = prevMeasureWidth;
        } else if (obj.type === "ridge_line" && typeof renderRidgeLine === "function") {
          const prevRidgeWidth = sctx.lineWidth;
          sctx.lineWidth = 2;
          renderRidgeLine(sctx, obj);
          sctx.lineWidth = prevRidgeWidth;
        }
      }

      ctx.drawImage(structuralCanvas, 0, 0, w, h);
    }
  } catch (_) {}

  // ==========================
  // Calque UTILISATEUR (couleurs originales)
  // - objets "libres" (rectangle/ligne/cercle/polygone/texte/pv_panel...)
  // - panneaux (DP2_STATE.panels)
  // - objets métier (DP2_STATE.businessObjects)
  // - textes (DP2_STATE.textObjects)
  // ==========================
  try {
    const userCanvas = document.createElement("canvas");
    userCanvas.width = w;
    userCanvas.height = h;
    const uctx = userCanvas.getContext("2d");
    if (uctx && window.DP2_STATE) {
      const objects = window.DP2_STATE.objects || [];
      for (const obj of objects) {
        if (!obj || !obj.type) continue;
        // Exclure les éléments structurels (déjà rendus + normalisés)
        if (obj.type === "building_outline" || obj.type === "measure_line" || obj.type === "ridge_line") continue;

        switch (obj.type) {
          case "rectangle":
            if (typeof renderRectangle === "function") renderRectangle(uctx, obj);
            break;
          case "pv_panel":
            if (typeof renderPvPanel === "function") renderPvPanel(uctx, obj);
            break;
          case "line":
            if (typeof renderLine === "function") renderLine(uctx, obj);
            break;
          case "circle":
            if (typeof renderCircle === "function") renderCircle(uctx, obj);
            break;
          case "polygon":
            if (typeof renderPolygon === "function") renderPolygon(uctx, obj);
            break;
          case "text":
            if (typeof renderText === "function") renderText(uctx, obj);
            break;
          default:
            // ignore (types inconnus)
            break;
        }
      }

      // Panneaux PV (calepinage simple)
      const panels = window.DP2_STATE.panels || [];
      if (typeof renderDP2Panel === "function") {
        for (const panel of panels) renderDP2Panel(uctx, panel);
      }

      // Objets métier
      const businessObjects = window.DP2_STATE.businessObjects || [];
      if (typeof renderDP2BusinessObject === "function") {
        for (const obj of businessObjects) renderDP2BusinessObject(uctx, obj);
      }

      // Textes (annotations)
      const textObjects = window.DP2_STATE.textObjects || [];
      if (typeof renderDP2TextObject === "function") {
        for (const obj of textObjects) renderDP2TextObject(uctx, obj);
      }

      ctx.drawImage(userCanvas, 0, 0, w, h);
    }
  } catch (_) {}

  // ==========================
  // Échelle graphique (DÉCLARATIVE, PDF UNIQUEMENT)
  // - Aucun calcul, aucune conversion
  // - N'afficher rien si non défini
  // ==========================
  try {
    const metersRaw = window.DP4_STATE?.scaleGraphicMeters ?? null;
    const meters =
      typeof metersRaw === "number" && Number.isFinite(metersRaw) ? metersRaw : null;
    if (meters === 1 || meters === 2 || meters === 5 || meters === 10) {
      // Format "urbanisme" : trait horizontal + label centré (déclaratif, sans conversion m->px basée sur résolution)
      const margin = Math.max(14, Math.round(Math.min(w, h) * 0.022));
      const pxByMeters = { 1: 110, 2: 160, 5: 240, 10: 320 };
      let barW = pxByMeters[meters] || 200;
      barW = Math.max(80, Math.min(barW, w - margin * 2));

      const x0 = margin;
      const x1 = margin + barW;
      const y = h - margin - 16; // laisse de la place pour le label au-dessus
      const cx = (x0 + x1) / 2;

      ctx.save();
      ctx.strokeStyle = "#111";
      ctx.fillStyle = "#111";

      // Label
      ctx.font = "16px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(`${meters} m`, cx, y - 6);

      // Trait principal
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();

      // Petites marques aux extrémités
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, y - 7);
      ctx.lineTo(x0, y + 7);
      ctx.moveTo(x1, y - 7);
      ctx.lineTo(x1, y + 7);
      ctx.stroke();

      ctx.restore();
    }
  } catch (_) {}

  return out.toDataURL("image/png");
}

function dp4DefaultState() {
  return {
    // Source unique de vérité (menu gauche DP4)
    photoCategory: null, // "before" | "after" | null
    // Échelle graphique (déclarative, PDF uniquement)
    scaleGraphicMeters: null, // ex: 1 | 2 | 5 | 10 | null

    // Données Avant / Après (indépendantes, aucun écrasement)
    before: {
      roofGeometry: [],
      panels: [],
      textObjects: [],
      businessObjects: [],
      history: []
    },
    after: {
      roofGeometry: [],
      panels: [],
      textObjects: [],
      businessObjects: [],
      history: []
    },
    capture: { imageBase64: null },
    roofType: null,
    panelModel: null,

    // 2 plans stockés (persistance)
    plans: {
      before: null,
      after: null
    }
  };
}

function dp4NormalizeLoadedState(raw) {
  const base = dp4DefaultState();
  const s = { ...base, ...(raw || {}) };
  // Sécuriser structures
  s.capture = { ...(base.capture || {}), ...(s.capture || {}) };
  s.plans = { ...(base.plans || {}), ...(s.plans || {}) };
  // Assurer before/after avec structures complètes
  for (const cat of ["before", "after"]) {
    if (!s[cat] || typeof s[cat] !== "object") s[cat] = { ...base[cat] };
    const sc = s[cat];
    if (!Array.isArray(sc.roofGeometry)) sc.roofGeometry = [];
    if (!Array.isArray(sc.panels)) sc.panels = [];
    if (!Array.isArray(sc.textObjects)) sc.textObjects = [];
    if (!Array.isArray(sc.businessObjects)) sc.businessObjects = [];
    if (!Array.isArray(sc.history)) sc.history = [];
  }
  // Migration : ancien état avec roofGeometry au top-level -> before/after
  if (Array.isArray(raw?.roofGeometry) && raw.roofGeometry.length > 0) {
    const targetCat = raw.photoCategory === "after" ? "after" : "before";
    if (!s[targetCat].roofGeometry?.length) s[targetCat].roofGeometry = raw.roofGeometry;
    if (Array.isArray(raw.panels) && !s[targetCat].panels?.length) s[targetCat].panels = raw.panels;
    if (Array.isArray(raw.textObjects) && !s[targetCat].textObjects?.length) s[targetCat].textObjects = raw.textObjects;
    if (Array.isArray(raw.businessObjects) && !s[targetCat].businessObjects?.length) s[targetCat].businessObjects = raw.businessObjects;
    if (Array.isArray(raw.history) && !s[targetCat].history?.length) s[targetCat].history = raw.history;
  }
  // Migration soft : ancien champ string `scaleGraphic` -> `scaleGraphicMeters`
  if (s.scaleGraphicMeters == null && typeof s.scaleGraphic === "string" && s.scaleGraphic) {
    const m = Number(String(s.scaleGraphic).replace(",", ".").replace(/[^\d.]/g, ""));
    if (m === 1 || m === 2 || m === 5 || m === 10) s.scaleGraphicMeters = m;
  }
  if (!(typeof s.scaleGraphicMeters === "number" && Number.isFinite(s.scaleGraphicMeters))) s.scaleGraphicMeters = null;
  if (!(s.scaleGraphicMeters === 1 || s.scaleGraphicMeters === 2 || s.scaleGraphicMeters === 5 || s.scaleGraphicMeters === 10)) {
    s.scaleGraphicMeters = null;
  }
  // Nettoyer l'ancien champ pour éviter toute utilisation accidentelle
  try { delete s.scaleGraphic; } catch (_) {}
  return s;
}

function dp4LoadState() {
  try {
    // DP4 = session-only : ne survit pas à Ctrl+R
    const raw = sessionStorage.getItem(DP4_LS_KEY);
    // Purge legacy : supprimer l'ancien état DP4 persistant (localStorage) une fois
    try { localStorage.removeItem(DP4_LS_KEY); } catch (_) {}
    if (!raw) return dp4DefaultState();
    return dp4NormalizeLoadedState(JSON.parse(raw));
  } catch (_) {
    return dp4DefaultState();
  }
}

function dp4SaveState(state) {
  try {
    const normalized = dp4NormalizeLoadedState(state);
    // DP4 = session-only : stockage temporaire
    sessionStorage.setItem(DP4_LS_KEY, JSON.stringify(normalized));
  } catch (_) {}
}

function dp4EnsureStateLoadedOnce() {
  if (window.__DP4_LS_LOADED === true) return;
  window.__DP4_LS_LOADED = true;
  window.DP4_STATE = dp4NormalizeLoadedState(dp4LoadState());
}

function dp4GetStoredPlan(category) {
  const cat = category === "before" || category === "after" ? category : null;
  if (!cat) return null;
  return window.DP4_STATE?.plans?.[cat] || null;
}

function dp4ApplyStoredPlanToActive(category) {
  const cat = category === "before" || category === "after" ? category : null;
  if (!cat) return;

  // Source unique de vérité (menu gauche)
  window.DP4_STATE = window.DP4_STATE || dp4DefaultState();
  window.DP4_STATE.photoCategory = cat;
  if (window.DP2_STATE) window.DP2_STATE.photoCategory = window.DP4_STATE.photoCategory;

  const plan = dp4GetStoredPlan(cat);
  window.DP4_STATE[cat] = window.DP4_STATE[cat] || { roofGeometry: [], panels: [], textObjects: [], businessObjects: [], history: [] };
  if (!plan) {
    // Nouveau plan : repartir d'un état vide (sans toucher aux autres catégories)
    window.DP4_CAPTURE_IMAGE = null;
    window.DP4_STATE.capture = { imageBase64: null };
    window.DP4_STATE[cat].roofGeometry = [];
    window.DP4_STATE[cat].panels = [];
    window.DP4_STATE[cat].textObjects = [];
    window.DP4_STATE[cat].businessObjects = [];
    window.DP4_STATE[cat].history = [];
    window.DP4_STATE.roofType = null;
    window.DP4_STATE.scaleGraphicMeters = null;
    window.DP4_STATE.panelModel = null;
    return;
  }

  // Charger le plan stocké dans DP4_STATE[cat]
  try {
    window.DP4_STATE.capture = dp2CloneForHistory(plan.capture || { imageBase64: null });
    window.DP4_STATE[cat].roofGeometry = dp2CloneForHistory(Array.isArray(plan.roofGeometry) ? plan.roofGeometry : []);
    window.DP4_STATE[cat].panels = dp2CloneForHistory(Array.isArray(plan.panels) ? plan.panels : []);
    window.DP4_STATE[cat].textObjects = dp2CloneForHistory(Array.isArray(plan.textObjects) ? plan.textObjects : []);
    window.DP4_STATE[cat].businessObjects = dp2CloneForHistory(Array.isArray(plan.businessObjects) ? plan.businessObjects : []);
    window.DP4_STATE[cat].history = dp2CloneForHistory(Array.isArray(plan.history) ? plan.history : []);
    window.DP4_STATE.roofType = plan.roofType ?? null;
    window.DP4_STATE.scaleGraphicMeters =
      typeof plan.scaleGraphicMeters === "number" && Number.isFinite(plan.scaleGraphicMeters)
        ? plan.scaleGraphicMeters
        : null;
    window.DP4_STATE.panelModel = plan.panelModel ?? null;
  } catch (_) {
    // fallback sûr (sans déduction)
    window.DP4_STATE.capture = { imageBase64: null };
    window.DP4_STATE[cat].roofGeometry = [];
  }

  // Piloter l'ouverture : si une capture existe, on saute Google Maps (flow existant)
  const cap = window.DP4_STATE?.capture?.imageBase64 || null;
  window.DP4_CAPTURE_IMAGE = typeof cap === "string" && cap.startsWith("data:image") ? cap : null;
}

function dp4RenderEntryMiniatureFor(category) {
  const cat = category === "before" || category === "after" ? category : null;
  if (!cat) return;

  const card = document.getElementById(`dp4-card-${cat}`);
  const img = document.getElementById(`dp4-thumb-${cat}`);
  if (!card || !img) return;

  const plan = dp4GetStoredPlan(cat);
  // Priorité : rendu final "mairie" s'il existe
  const final = dp4GetFinalRenderFor(cat);
  const thumb = final?.imageBase64 || plan?.thumbnailBase64 || null;

  if (typeof thumb === "string" && thumb.startsWith("data:image")) {
    img.src = thumb;
    card.classList.add("has-thumb");
  } else {
    try { img.removeAttribute("src"); } catch (_) {}
    card.classList.remove("has-thumb");
  }
}

function dp4RenderEntryMiniatures() {
  dp4RenderEntryMiniatureFor("before");
  dp4RenderEntryMiniatureFor("after");
  try {
    if (window.DP4_UI && typeof window.DP4_UI.setState === "function") {
      window.DP4_UI.setState("AUTO");
    }
  } catch (_) {}
}

function dp4ImportBeforeIntoAfter() {
  if (!window.DP4_STATE || !window.DP4_STATE.plans) return;

  const beforePlan = window.DP4_STATE.plans.before;
  if (!beforePlan) {
    alert("Aucun plan Avant travaux à importer.");
    return;
  }

  // Deep clone sécurisé
  const clone = JSON.parse(JSON.stringify(beforePlan));

  // IMPORTANT : on force la catégorie AFTER
  clone.photoCategory = "after";

  // Écrase uniquement AFTER
  window.DP4_STATE.plans.after = clone;

  // Mettre la catégorie active
  window.DP4_STATE.photoCategory = "after";

  // Sauvegarde persistée
  if (typeof dp4SaveState === "function") {
    dp4SaveState(window.DP4_STATE);
  }

  // Rafraîchir la miniature "after"
  dp4RenderEntryMiniatures();

  // Ouvrir directement le canvas DP4
  dp4OpenCanvasFromStoredPlan("after");
}

function dp4OpenCanvasFromStoredPlan(category) {
  if (!window.DP4_STATE || !window.DP4_STATE.plans) return;

  const plan = window.DP4_STATE.plans[category];
  if (!plan) return;

  window.DP4_STATE.photoCategory = category;

  // Injecter capture image
  const imageBase64 = plan.capture?.imageBase64 || null;
  window.DP4_CAPTURE_IMAGE = imageBase64;

  // Charger le plan dans DP4_STATE[category] pour que dp4RenderRoofDrawingStep ait les données
  dp4ApplyStoredPlanToActive(category);

  // Ouvrir le modal (affiche directement l'étape dessin si capture existe)
  if (typeof window.dp4OpenModal === "function") {
    window.dp4OpenModal();
  }
}

async function dp4SaveActivePlanToSelectedCategory() {
  // 1) Synchroniser depuis le moteur DP2 (si on est en DP4_ROOF)
  try { dp4SyncRoofGeometryFromDP2State(); } catch (_) {}

  // 2) Lire EXCLUSIVEMENT la source de vérité : DP4_STATE.photoCategory
  const cat = window.DP4_STATE?.photoCategory ?? null;
  if (cat !== "before" && cat !== "after") return;

  // 3) Miniature :
  // - si plan finalisé => utiliser le rendu final stocké (sans recalcul / sans destruction)
  // - sinon => rendu standard (fond + grille DP4 + overlay) via la même fonction que le PDF DP2
  let thumbnailBase64 = null;
  try {
    const finalized = dp4GetFinalRenderFor(cat);
    if (finalized?.imageBase64) {
      thumbnailBase64 = finalized.imageBase64;
    } else {
      const img = await collectDP2FinalPlanImage();
      if (typeof img === "string" && img.startsWith("data:image")) thumbnailBase64 = img;
    }
  } catch (_) {}

  window.DP4_STATE = window.DP4_STATE || dp4DefaultState();
  window.DP4_STATE.plans = window.DP4_STATE.plans || { before: null, after: null };
  const stateCat = window.DP4_STATE[cat] || { roofGeometry: [], panels: [], textObjects: [], businessObjects: [], history: [] };

  window.DP4_STATE.plans[cat] = {
    photoCategory: cat,
    capture: dp2CloneForHistory(window.DP4_STATE.capture || { imageBase64: null }),
    roofGeometry: dp2CloneForHistory(Array.isArray(stateCat.roofGeometry) ? stateCat.roofGeometry : []),
    roofType: window.DP4_STATE.roofType ?? null,
    scaleGraphicMeters: window.DP4_STATE.scaleGraphicMeters ?? null,
    panelModel: window.DP4_STATE.panelModel ?? null,
    panels: dp2CloneForHistory(Array.isArray(stateCat.panels) ? stateCat.panels : []),
    textObjects: dp2CloneForHistory(Array.isArray(stateCat.textObjects) ? stateCat.textObjects : []),
    businessObjects: dp2CloneForHistory(Array.isArray(stateCat.businessObjects) ? stateCat.businessObjects : []),
    history: dp2CloneForHistory(Array.isArray(stateCat.history) ? stateCat.history : []),
    thumbnailBase64,
    savedAt: Date.now()
  };

  dp4SaveState(window.DP4_STATE);
}

// ======================================================
// GOOGLE MAPS (UTILS) — DP4 / DP6
// - Facteur commun STRICT (DP4 = source de vérité)
// ======================================================
function dpGetProjectCenterForGoogleMaps() {
  // 1) Priorité : point validé/curent côté DP1 (si DP1 a déjà été utilisé)
  const p = window.DP1_STATE?.currentPoint;
  if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) {
    return { center: { lat: p.lat, lng: p.lon }, zoom: 20 };
  }

  // 2) Contexte projet (ERPNext) si disponible
  const ctx = window.DP1_CONTEXT;
  if (ctx && Number.isFinite(ctx.lat) && Number.isFinite(ctx.lon)) {
    return { center: { lat: ctx.lat, lng: ctx.lon }, zoom: 20 };
  }

  // 3) Défaut cohérent (France / zoom "toiture" raisonnable)
  return { center: { lat: 48.8566, lng: 2.3522 }, zoom: 18 };
}

function dpLoadGoogleMapsJsOnce() {
  // Copie stricte DP4 : même sentinelle globale et même callback.
  if (window.google && window.google.maps) return Promise.resolve();
  if (window.__DP4_GOOGLE_MAPS_PROMISE) return window.__DP4_GOOGLE_MAPS_PROMISE;

  window.__DP4_GOOGLE_MAPS_PROMISE = new Promise((resolve, reject) => {
    let done = false;
    const safeResolve = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const safeReject = (err) => {
      if (done) return;
      done = true;
      reject(err);
    };

    const callbackName = "__dp4_googleMapsInit";
    // Si une tentative précédente a laissé le callback, on le remplace.
    window[callbackName] = () => {
      try {
        if (window.google && window.google.maps) safeResolve();
        else safeReject(new Error("Google Maps JS API chargée mais indisponible"));
      } finally {
        try {
          delete window[callbackName];
        } catch (_) {}
      }
    };

    let src = `https://maps.googleapis.com/maps/api/js?v=weekly&callback=${encodeURIComponent(callbackName)}`;

    const GOOGLE_MAPS_API_KEY = "AIzaSyDQMAe4zNsipMna3Ph1ANhJLMpZcdAWC1M";
    src += `&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;

    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.defer = true;
    s.onerror = () => safeReject(new Error("Chargement Google Maps JS API impossible"));
    document.head.appendChild(s);

    // Timeout de sécurité : évite une promesse bloquée si callback non appelé.
    setTimeout(() => {
      if (window.google && window.google.maps) safeResolve();
      else safeReject(new Error("Timeout chargement Google Maps JS API"));
    }, 15000);
  });

  return window.__DP4_GOOGLE_MAPS_PROMISE;
}

async function dpCaptureElementAsPngDataUrl(host) {
  if (!host) return null;
  if (typeof window.html2canvas !== "function") {
    return null;
  }

  const canvas = await window.html2canvas(host, {
    // Objectif : rendu fidèle du conteneur, sans crop ni zoom.
    // Remarque : selon la politique CORS des tuiles, la capture peut être limitée côté navigateur.
    useCORS: true,
    backgroundColor: null,
    scale: 1,
    logging: false,
  });

  try {
    return canvas.toDataURL("image/png");
  } catch (_) {
    return null;
  }
}

// ======================================================
// DP4 — IMPORT DP2 (conversion mathématique pixel ↔ coordonnées)
// Overlay = contour uniquement ; canvas = tout le dessin.
// ======================================================
function dp2PixelToMapCoord(px, py, capture, width, height) {
  const center = capture.center;
  const resolution = capture.resolution;
  const rotation = capture.rotation || 0;

  const dx = (px - width / 2) * resolution;
  const dy = -(py - height / 2) * resolution;

  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  const x = center[0] + cos * dx - sin * dy;
  const y = center[1] + sin * dx + cos * dy;

  return [x, y];
}

function dp4EnsureScreenOverlayCanvas() {
  if (window.DP4_IMPORT_OVERLAY_CANVAS) return window.DP4_IMPORT_OVERLAY_CANVAS;
  const mapEl = document.getElementById("dp4-ign-map");
  if (!mapEl || !mapEl.parentNode) return null;
  const wrapper = mapEl.parentNode; // dp-map-canvas
  const canvas = document.createElement("canvas");
  canvas.id = "dp4-import-overlay-canvas";
  canvas.style.cssText = "position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:5;";
  wrapper.appendChild(canvas);
  const dpr = typeof window.devicePixelRatio === "number" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  const r = wrapper.getBoundingClientRect();
  const w = Math.max(1, Math.floor((r.width || 0) * dpr));
  const h = Math.max(1, Math.floor((r.height || 0) * dpr));
  canvas.width = w;
  canvas.height = h;
  window.DP4_IMPORT_OVERLAY_CANVAS = canvas;
  return canvas;
}

function dp4RemoveScreenOverlayCanvas() {
  if (window.DP4_IMPORT_OVERLAY_CANVAS) {
    try {
      window.DP4_IMPORT_OVERLAY_CANVAS.remove();
    } catch (_) {}
    window.DP4_IMPORT_OVERLAY_CANVAS = null;
  }
}

function dp4DrawDP2ContourOnScreenOverlay() {
  const canvas = window.DP4_IMPORT_OVERLAY_CANVAS;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let points = [];
  if (Array.isArray(window.DP2_STATE?.buildingContours) && window.DP2_STATE.buildingContours.length > 0) {
    const c = window.DP2_STATE.buildingContours[0];
    if (Array.isArray(c?.points)) points = c.points;
  } else {
    const obj = (window.DP2_STATE?.objects || []).find((o) => o && o.type === "building_outline");
    if (obj && Array.isArray(obj.points)) points = obj.points;
  }
  if (points.length < 2) return;

  const w2 = window.DP2_STATE?.capture?.width ?? window.DP2_STATE?.backgroundImage?.width ?? 1;
  const h2 = window.DP2_STATE?.capture?.height ?? window.DP2_STATE?.backgroundImage?.height ?? 1;
  if (w2 <= 0 || h2 <= 0) return;

  const vw = canvas.width;
  const vh = canvas.height;
  const scaleX = vw / w2;
  const scaleY = vh / h2;

  ctx.clearRect(0, 0, vw, vh);
  ctx.save();
  ctx.strokeStyle = "#C39847";
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 10]);
  ctx.beginPath();
  const px = points[0].x * scaleX;
  const py = points[0].y * scaleY;
  ctx.moveTo(px, py);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x * scaleX, points[i].y * scaleY);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function dp4TransformDP2ToDP4PixelsFromCurrentMapView() {
  if (!window.DP4_IMPORT_DP2_ACTIVE) return;
  const cat = window.DP4_STATE?.photoCategory ?? null;
  if (cat !== "before" && cat !== "after") return;

  const dp2Cap = window.DP2_STATE?.capture;
  if (!dp2Cap) return;

  const map = window.DP4_OL_MAP;
  if (!map) return;

  const size = map.getSize();
  if (!size || size[0] <= 0 || size[1] <= 0) return;

  const w2 = dp2Cap.width ?? window.DP2_STATE?.backgroundImage?.width ?? 0;
  const h2 = dp2Cap.height ?? window.DP2_STATE?.backgroundImage?.height ?? 0;
  if (w2 <= 0 || h2 <= 0) return;

  function convertPoint(p) {
    const coord = dp2PixelToMapCoord(p.x, p.y, dp2Cap, w2, h2);
    const pix = map.getPixelFromCoordinate(coord);
    return { x: pix[0], y: pix[1] };
  }

  // TRANSFORMER buildingContours
  if (Array.isArray(window.DP2_STATE.buildingContours)) {
    window.DP2_STATE.buildingContours.forEach((contour) => {
      if (Array.isArray(contour.points)) {
        contour.points = contour.points.map(convertPoint);
      }
    });
  }

  // TRANSFORMER objects
  if (Array.isArray(window.DP2_STATE.objects)) {
    window.DP2_STATE.objects.forEach((obj) => {
      if (!obj) return;
      if (obj.points) obj.points = obj.points.map(convertPoint);
      if (obj.a) obj.a = convertPoint(obj.a);
      if (obj.b) obj.b = convertPoint(obj.b);
      if (obj.geometry) {
        const g = convertPoint(obj.geometry);
        obj.geometry.x = g.x;
        obj.geometry.y = g.y;
      }
    });
  }

  // TRANSFORMER panels
  if (Array.isArray(window.DP2_STATE.panels)) {
    window.DP2_STATE.panels.forEach((p) => {
      if (p?.geometry) {
        const g = convertPoint(p.geometry);
        p.geometry.x = g.x;
        p.geometry.y = g.y;
      }
    });
  }

  // TRANSFORMER textObjects
  if (Array.isArray(window.DP2_STATE.textObjects)) {
    window.DP2_STATE.textObjects.forEach((t) => {
      if (t?.geometry) {
        const g = convertPoint(t.geometry);
        t.geometry.x = g.x;
        t.geometry.y = g.y;
      }
    });
  }

  // TRANSFORMER businessObjects
  if (Array.isArray(window.DP2_STATE.businessObjects)) {
    window.DP2_STATE.businessObjects.forEach((b) => {
      if (b?.geometry) {
        const g = convertPoint(b.geometry);
        b.geometry.x = g.x;
        b.geometry.y = g.y;
      }
    });
  }

  // --- DP4 RULE: contour bâti = buildingContours ONLY ---
  dp2EnsureBuildingContoursState();

  // 1) Si contours vides mais outline présent dans objects -> migrer vers buildingContours
  const objs = Array.isArray(window.DP2_STATE.objects) ? window.DP2_STATE.objects : [];
  const outlines = objs.filter((o) => o && o.type === "building_outline" && Array.isArray(o.points));

  if ((window.DP2_STATE.buildingContours || []).length === 0 && outlines.length > 0) {
    const o = outlines[0];
    const pts = (o.points || []).map((p) => ({ x: Number(p.x), y: Number(p.y) })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (pts.length >= 3) {
      window.DP2_STATE.buildingContours = [{
        id: dp2NewBuildingContourId(),
        points: pts,
        closed: true
      }];
    }
  }

  // 2) DP4: supprimer TOUS les building_outline de objects (source unique = buildingContours)
  window.DP2_STATE.objects = objs.filter((o) => !o || o.type !== "building_outline");

  window.DP4_IMPORT_DP2_ACTIVE = false;

  try {
    window.DP2_STATE.editorProfile = "DP4_ROOF";
    if (typeof dp4SyncRoofGeometryFromDP2State === "function") {
      dp4SyncRoofGeometryFromDP2State();
    }
  } catch (_) {}
}

// ======================================================
// DP4 — OPENLAYERS IGN ORTHO (remplace Google Maps)
// Même mécanisme WMTS que DP2 (Géoportail data.geopf.fr), couche ORTHO.
// ======================================================
function dp4InitIgnOrthoMap(onReady) {
  const host = document.getElementById("dp4-ign-map");
  if (!host || typeof ol === "undefined") return;

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

  function nearestWmtsResolution(targetRes) {
    if (targetRes == null || typeof targetRes !== "number" || !Number.isFinite(targetRes) || targetRes <= 0) {
      return WMTS_RESOLUTIONS[Math.min(17, WMTS_RESOLUTIONS.length - 1)];
    }
    let best = WMTS_RESOLUTIONS[0];
    let bestDiff = Math.abs(WMTS_RESOLUTIONS[0] - targetRes);
    for (let i = 1; i < WMTS_RESOLUTIONS.length; i++) {
      const d = Math.abs(WMTS_RESOLUTIONS[i] - targetRes);
      if (d < bestDiff) {
        bestDiff = d;
        best = WMTS_RESOLUTIONS[i];
      }
    }
    return best;
  }

  const WMTS_MATRIX_IDS = WMTS_RESOLUTIONS.map((_, i) => String(i));
  const wmtsGridPM = new ol.tilegrid.WMTS({
    origin: WMTS_ORIGIN,
    resolutions: WMTS_RESOLUTIONS,
    matrixIds: WMTS_MATRIX_IDS
  });

  const hasDP2Capture =
    window.DP2_STATE &&
    window.DP2_STATE.capture &&
    Array.isArray(window.DP2_STATE.capture.center);

  let center, resolution, rotation;
  if (hasDP2Capture) {
    center = window.DP2_STATE.capture.center;
    rotation = window.DP2_STATE.capture.rotation || 0;
    const dp2Res = window.DP2_STATE.capture.resolution;
    resolution = nearestWmtsResolution(dp2Res);
  } else {
    const { center: centerWgs, zoom: zoomWgs } = dpGetProjectCenterForGoogleMaps();
    center = ol.proj.fromLonLat([centerWgs.lng, centerWgs.lat]);
    rotation = 0;
    const viewTemp = new ol.View({ projection: "EPSG:3857" });
    const rawRes = viewTemp.getResolutionForZoom(zoomWgs);
    resolution = nearestWmtsResolution(rawRes);
  }

  const orthoLayer = new ol.layer.Tile({
    source: new ol.source.WMTS({
      url: "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile",
      layer: "ORTHOIMAGERY.ORTHOPHOTOS",
      matrixSet: "PM",
      format: "image/jpeg",
      style: "normal",
      tileGrid: wmtsGridPM,
      wrapX: false,
      crossOrigin: "anonymous"
    })
  });

  const view = new ol.View({
    projection: "EPSG:3857",
    center: center,
    rotation: rotation,
    resolutions: WMTS_RESOLUTIONS,
    constrainResolution: true,
    resolution: resolution
  });

  // Pas de propriété controls : même syntaxe que DP2 (ol.Map utilise les contrôles par défaut en OL 10.7)
  window.DP4_OL_MAP = new ol.Map({
    target: "dp4-ign-map",
    layers: [orthoLayer],
    view: view
  });

  applySafeInitialResolution(
    window.DP4_OL_MAP,
    resolution,
    WMTS_RESOLUTIONS
  );

  try {
    forceFirstPaintWMTS(
      window.DP4_OL_MAP,
      orthoLayer.getSource(),
      WMTS_RESOLUTIONS
    );
  } catch (_) {}

  if (typeof onReady === "function") {
    window.DP4_OL_MAP.once("rendercomplete", onReady);
  }
}

// ======================================================
// DP4 — SUPPRESSION PLAN
// ======================================================
function dp4DeletePlan(category) {
  const cat = category === "before" || category === "after" ? category : null;
  if (!cat) return;

  if (!confirm("Supprimer définitivement ce plan DP4 ?")) return;

  // 1️⃣ Supprimer plan actif
  if (window.DP4_STATE?.plans) {
    window.DP4_STATE.plans[cat] = null;
  }

  // 2️⃣ Supprimer rendu final
  try {
    const store = dp4FinalLoadStore();
    store[cat] = null;
    dp4FinalSaveStore(store);
  } catch (_) {}

  // 3️⃣ Sauvegarder état propre
  dp4SaveState(window.DP4_STATE);

  // 4️⃣ Reset runtime
  window.DP4_CAPTURE_IMAGE = null;

  // 5️⃣ Rafraîchir miniatures
  dp4RenderEntryMiniatures();
}

// ======================================================
// DP4 — INIT (UI MINIMALE)
// ======================================================
function initDP4() {
  const btnBefore = document.getElementById("dp4-create-before");
  const btnAfter = document.getElementById("dp4-create-after");
  const legacyBtn = document.getElementById("dp4-create");
  const modal = document.getElementById("dp4-map-modal");
  if ((!btnBefore && !btnAfter && !legacyBtn) || !modal) return;

  // Charger l'état DP4 (2 plans) au montage de la page
  dp4EnsureStateLoadedOnce();
  dp4RenderEntryMiniatures();
  try { initDP4_UIStates(); } catch (_) {}

  // Anti double-binding (lié au DOM injecté)
  const bindKeyHost = btnBefore || btnAfter || legacyBtn;
  if (bindKeyHost && bindKeyHost.dataset.bound === "1") return;
  if (bindKeyHost) bindKeyHost.dataset.bound = "1";

  // Références DOM (overlay DP4)
  const titleEl = modal.querySelector(".dp-modal-title-solarglobe");
  const bodyEl = modal.querySelector(".dp-modal-body");
  const validateBtn = document.getElementById("dp4-map-validate");

  // Sauvegarde du "template" de l'étape carte (pour pouvoir la restaurer si besoin)
  const DP4_MODAL_TITLE_INITIAL = titleEl ? titleEl.textContent : "DP4 — Plan de toiture";
  const DP4_MODAL_BODY_INITIAL_HTML = bodyEl ? bodyEl.innerHTML : "";

  function dp4SetValidateVisible(visible) {
    // Visible uniquement quand la carte est chargée (idle), sinon caché.
    if (!validateBtn) return;
    validateBtn.style.display = visible ? "" : "none";
  }

  function dp4SetValidateEnabled(enabled) {
    if (!validateBtn) return;
    validateBtn.disabled = !enabled;
  }

  function dp4GetProjectCenter() {
    return dpGetProjectCenterForGoogleMaps();
  }

  function dp4ResetMapContainer() {
    const el = document.getElementById("dp4-ign-map");
    if (!el) return null;
    const parent = el.parentNode;
    if (!parent) return el;
    const fresh = document.createElement("div");
    fresh.id = "dp4-ign-map";
    fresh.className = "dp-map";
    parent.replaceChild(fresh, el);
    return fresh;
  }

  function dp4DestroyMap() {
    dp4RemoveScreenOverlayCanvas();
    if (window.DP4_OL_MAP) {
      try {
        window.DP4_OL_MAP.setTarget(null);
      } catch (_) {}
      window.DP4_OL_MAP = null;
    }
    dp4ResetMapContainer();
  }

  function dp4RenderMapStep() {
    // Restaure l'étape "carte" (OpenLayers IGN ORTHO) si on a déjà basculé sur une autre vue.
    dp4RestoreMovedDP2Ui();
    if (titleEl) titleEl.textContent = DP4_MODAL_TITLE_INITIAL;
    if (bodyEl && !bodyEl.querySelector("#dp4-ign-map")) {
      bodyEl.innerHTML = DP4_MODAL_BODY_INITIAL_HTML;
    }
    dp4SetValidateVisible(false);
    dp4SetValidateEnabled(true);
    const importBtn = document.getElementById("dp4-import-dp2-btn");
    if (importBtn) importBtn.style.display = "inline-flex";
    // Menu gauche DP4 (copie DP2) : binds + affichages passifs
    try { initDP4MetadataUI(); } catch (_) {}
    try { syncDP4LegendOverlayUI(); } catch (_) {}
  }

  // -----
  // DP4 (toiture) : réutiliser la toolbar DP2 SANS la dupliquer.
  // Stratégie :
  // - si une toolbar DP2 existe déjà ailleurs dans le DOM, on la "déplace" temporairement dans l'overlay DP4,
  //   puis on la restaure à la fermeture (évite doublons d'IDs).
  // - sinon, on extrait le HTML source depuis pages/dp2.html (source de vérité), puis on appelle initDP2Toolbar().
  // -----
  let dp4MovedDP2Ui = null;

  function dp4RestoreMovedDP2Ui() {
    if (!dp4MovedDP2Ui) return;
    const { toolbarEl, toolbarParent, toolbarNext, actionsEl, actionsParent, actionsNext } = dp4MovedDP2Ui;
    try {
      if (toolbarEl && toolbarParent) {
        toolbarParent.insertBefore(toolbarEl, toolbarNext || null);
      }
    } catch (_) {}
    try {
      if (actionsEl && actionsParent) {
        actionsParent.insertBefore(actionsEl, actionsNext || null);
      }
    } catch (_) {}
    dp4MovedDP2Ui = null;
  }

  async function dp4EnsureDP2ToolbarAndActionsMounted() {
    if (!bodyEl) return { createdToolbar: false, createdActions: false };
    const wrap = bodyEl.querySelector("#dp2-captured-image-wrap");
    if (!wrap) return { createdToolbar: false, createdActions: false };

    const zoom = wrap.querySelector("#dp2-zoom-container");
    const insertBeforeEl = zoom || null;

    // Déjà monté dans l'overlay
    if (wrap.querySelector("#dp2-toolbar") && wrap.querySelector("#dp2-draw-actions")) {
      return { createdToolbar: false, createdActions: false };
    }

    // 1) Si DP2 toolbar existe déjà ailleurs, on la déplace temporairement (évite doublons d'IDs).
    const existingToolbar = document.getElementById("dp2-toolbar");
    const existingActions = document.getElementById("dp2-draw-actions");

    const moved = { toolbarEl: null, toolbarParent: null, toolbarNext: null, actionsEl: null, actionsParent: null, actionsNext: null };
    let didMove = false;

    if (existingToolbar && !wrap.contains(existingToolbar)) {
      moved.toolbarEl = existingToolbar;
      moved.toolbarParent = existingToolbar.parentNode;
      moved.toolbarNext = existingToolbar.nextSibling;
      try {
        wrap.insertBefore(existingToolbar, insertBeforeEl);
        didMove = true;
      } catch (_) {}
    }
    if (existingActions && !wrap.contains(existingActions)) {
      moved.actionsEl = existingActions;
      moved.actionsParent = existingActions.parentNode;
      moved.actionsNext = existingActions.nextSibling;
      try {
        wrap.insertBefore(existingActions, insertBeforeEl);
        didMove = true;
      } catch (_) {}
    }

    if (didMove) {
      dp4MovedDP2Ui = moved;
      return { createdToolbar: false, createdActions: false };
    }

    // 2) Sinon : extraire depuis pages/dp2.html (source unique du HTML toolbar).
    let createdToolbar = false;
    let createdActions = false;
    try {
      const res = await fetch("pages/dp2.html", { cache: "no-store" });
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");

      const toolbarTpl = doc.getElementById("dp2-toolbar");
      const actionsTpl = doc.getElementById("dp2-draw-actions");

      if (toolbarTpl && !wrap.querySelector("#dp2-toolbar")) {
        const toolbarNode = document.importNode(toolbarTpl, true);
        wrap.insertBefore(toolbarNode, insertBeforeEl);
        createdToolbar = true;
      }
      if (actionsTpl && !wrap.querySelector("#dp2-draw-actions")) {
        const actionsNode = document.importNode(actionsTpl, true);
        wrap.insertBefore(actionsNode, insertBeforeEl);
        createdActions = true;
      }
    } catch (e) {
      console.warn("[DP4] Impossible de monter la toolbar DP2 depuis pages/dp2.html", e);
    }

    return { createdToolbar, createdActions };
  }

  function dp4RenderRoofDrawingStep() {
    // Nouvelle étape DP4 (même overlay) : "DP4 — Dessin de toiture"
    if (titleEl) titleEl.textContent = "DP4 — Dessin de toiture";
    dp4SetValidateVisible(false);
    dp4SetValidateEnabled(true);
    const importBtn = document.getElementById("dp4-import-dp2-btn");
    if (importBtn) importBtn.style.display = "none";

    if (!bodyEl) return;

    // Même structure visuelle que la carte (colonne aide + zone canvas).
    // IMPORTANT : on réutilise le moteur DP2 (canvas) avec un profil DP4_ROOF.
    bodyEl.innerHTML = `
      <aside class="dp-map-help" id="dp4-settings-panel">
        <h3>Paramètres du plan</h3>

        <div class="dp-hint" style="margin-top: 10px;">
          <!-- DP4 : masqué (remplacé par le repère métrique sur le plan) -->
          <span id="dp4-scale" hidden></span>
          <div class="dp2-field" style="margin-top: 10px;">
            <label class="dp2-label">Hauteur de vue</label>
            <div class="dp2-panel-readonly">
              <span id="dp4-view-height">Hauteur de vue : —</span>
            </div>
          </div>
        </div>

        <!-- Catégorie photo -->
        <div class="dp2-field" style="margin-top: 14px;">
          <label class="dp2-label">Catégorie</label>
          <select id="dp4-photo-category" class="dp2-select">
            <option value="">— Sélectionner —</option>
            <option value="before">Avant travaux</option>
            <option value="after">Après travaux</option>
          </select>
        </div>

        <hr />

        <!-- Modules PV -->
        <div class="dp2-field">
          <label class="dp2-label">Module photovoltaïque</label>
          <select id="dp4-panel-select" class="dp2-select">
            <option value="">— Sélectionner un module —</option>
            <option value="longi_x10_artist">LONGi Hi-MO X10 Artist — 485 W</option>
            <option value="longi_x10_explorer">LONGi Hi-MO X10 Explorer — 485 W</option>
          </select>
        </div>

        <div class="dp2-panel-readonly">
          <div><strong>Fabricant :</strong> <span id="dp4-panel-manufacturer">—</span></div>
          <div><strong>Référence :</strong> <span id="dp4-panel-reference">—</span></div>
          <div><strong>Puissance :</strong> <span id="dp4-panel-power">—</span></div>
          <div><strong>Dimensions :</strong> <span id="dp4-panel-dimensions">—</span></div>
        </div>

        <hr />

        <!-- DP4 UNIQUEMENT : type de toit -->
        <div class="dp2-field">
          <label class="dp2-label">Type de toit</label>
          <select id="dp4-roof-type" class="dp2-select">
            <option value="">— Sélectionner —</option>
            <option value="tuile">tuile</option>
            <option value="ardoise">ardoise</option>
            <option value="bac_acier">Bac acier</option>
            <option value="autre">autre</option>
          </select>
        </div>

        <hr />

        <!-- Légende (lecture seule) : reflète exactement la légende PDF DP2 -->
        <div class="dp2-field dp2-legend-field">
          <div class="dp2-label">Légende</div>
          <div id="dp4-legend-empty" class="dp2-legend-empty" hidden>
            Aucun objet métier sur le plan.
          </div>
          <div id="dp4-legend-list" class="dp2-legend-list" aria-label="Légende du plan"></div>
        </div>

        <hr />

        <!-- ACTION FINALE DP4 (rendu mairie) -->
        <div class="dp2-field" style="margin-top: 10px;">
          <button class="dp-btn dp-btn-primary" type="button" id="dp4-finalize-plan">
            Valider le plan
          </button>
          <div class="dp-hint" style="margin-top: 8px;">
            Le rendu final supprime le fond satellite et normalise les traits (gris/noir).
          </div>
        </div>
      </aside>

      <div class="dp-map-pane">
        <div class="dp-map-canvas" style="position: relative;">
          <!-- DP2 engine mount (IDs DP2, dédiés à cette page DP4) -->
          <div id="dp2-captured-image-wrap" style="display:block; position:absolute; inset:0;">
            <!-- DP2 toolbar + draw actions (HTML réutilisé depuis pages/dp2.html) -->
            <div id="dp2-zoom-container" style="position:relative; transform-origin:50% 50%;">
              <img id="dp2-captured-image" alt="Toiture capturée" style="pointer-events:none;" />
              <canvas id="dp2-draw-canvas" style="pointer-events:auto; z-index:2;"></canvas>
            </div>
          </div>
        </div>
      </div>
    `;

    // Monter la toolbar DP2 (DOM) puis initialiser la logique DP2 standard.
    // Remarque : initDP2Toolbar() suppose que le DOM existe déjà.
    dp4EnsureDP2ToolbarAndActionsMounted().then(({ createdToolbar, createdActions }) => {
      try {
        if (createdToolbar) initDP2Toolbar();
      } catch (_) {}
      try {
        if (createdActions) initDP2DrawActions();
      } catch (_) {}
    });

    // Initialiser l'état DP2 en profil toiture + charger l'image capturée
    window.DP4_STATE = window.DP4_STATE || dp4DefaultState();
    if (window.DP4_CAPTURE_IMAGE) window.DP4_STATE.capture.imageBase64 = window.DP4_CAPTURE_IMAGE;

    window.DP2_STATE = window.DP2_STATE || {};
    window.DP2_STATE.editorProfile = "DP4_ROOF";
    window.DP2_STATE.mode = "EDITION";
    window.DP2_STATE.capture = { imageBase64: window.DP4_STATE.capture.imageBase64 || null, resolution: null };
    // ✅ DP4 : activer la mesure métrique EXACTEMENT comme DP2 (px → m via scale_m_per_px)
    // Source : valeur figée à la capture de la vue toiture (Google Maps).
    window.DP2_STATE.scale_m_per_px =
      typeof window.DP4_STATE?.capture?.scale_m_per_px === "number" && window.DP4_STATE.capture.scale_m_per_px > 0
        ? window.DP4_STATE.capture.scale_m_per_px
        : null;
    // Charger l'état DP4 (graphique) dans le moteur DP2 (profil toiture)
    window.DP2_STATE.photoCategory = window.DP4_STATE?.photoCategory ?? null;
    window.DP2_STATE.panelModel = window.DP4_STATE?.panelModel ?? null;
    window.DP2_STATE.capture.imageBase64 = window.DP4_STATE.capture.imageBase64;

    const cat = window.DP4_STATE?.photoCategory ?? null;
    const stateCat = window.DP4_STATE?.[cat] || null;

    // A. Si cat n'est pas "before" ou "after" → ne rien injecter (laisser vide)
    if ((cat === "before" || cat === "after") && stateCat) {
      const roofGeometry = stateCat.roofGeometry || [];

      // B. Construire DP2_STATE.buildingContours depuis stateCat.roofGeometry (building_outline uniquement)
      const outlinesFromRoof = roofGeometry.filter((o) => o && o.type === "building_outline");
      const contoursConstruits = outlinesFromRoof.map((o, index) => ({
        id: "dp4_contour_" + index,
        points: (o.points || []).map((p) => ({ x: typeof p?.x === "number" ? p.x : 0, y: typeof p?.y === "number" ? p.y : 0 })),
        closed: o.closed === true
      }));
      window.DP2_STATE.buildingContours = contoursConstruits;

      // C. Construire DP2_STATE.objects SANS building_outline (ridge_line, measure_line uniquement)
      window.DP2_STATE.objects = roofGeometry.filter((o) => o && o.type !== "building_outline");

      // D. Safety : ne jamais laisser building_outline dans objects en DP4
      window.DP2_STATE.objects = (window.DP2_STATE.objects || []).filter((o) => o?.type !== "building_outline");

      // E. Reste identique
      window.DP2_STATE.panels = dp2CloneForHistory(stateCat.panels || []);
      window.DP2_STATE.textObjects = dp2CloneForHistory(stateCat.textObjects || []);
      window.DP2_STATE.businessObjects = dp2CloneForHistory(stateCat.businessObjects || []);
      window.DP2_STATE.history = dp2CloneForHistory(stateCat.history || []);
    } else {
      window.DP2_STATE.buildingContours = [];
      window.DP2_STATE.objects = [];
    }

    // Déduplication : contours identiques (mêmes points) → garder un seul par JSON.stringify
    const seen = new Set();
    window.DP2_STATE.buildingContours = (window.DP2_STATE.buildingContours || []).filter((c) => {
      if (!c || !Array.isArray(c.points) || c.points.length < 3) return false;
      const key = JSON.stringify(c.points.map((p) => ({ x: p.x, y: p.y })));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Conserver le flow DP4 existant comme défaut
    window.DP2_STATE.currentTool = window.DP2_STATE.currentTool || "building_outline";
    window.DP2_STATE.selectedObjectId = null;
    window.DP2_STATE.selectedBusinessObjectId = null;
    window.DP2_STATE.selectedPanelId = null;
    window.DP2_STATE.selectedPanelIds = [];
    window.DP2_STATE.selectedTextId = null;
    window.DP2_STATE.selectedTextIds = [];
    window.DP2_STATE.drawingPreview = null;
    window.DP2_STATE.measureLineStart = null;
    window.DP2_STATE.ridgeLineStart = null;

    // Bind UI paramètres DP4 (menu gauche)
    try { initDP4MetadataUI(); } catch (_) {}
    try { syncDP4LegendOverlayUI(); } catch (_) {}

    const imgEl = document.getElementById("dp2-captured-image");
    if (imgEl) {
      imgEl.onload = function () {
        try { initDP2Editor(); } catch (_) {}
        // UI seulement : reflète la hauteur réelle (px) et l'échelle figée (m/px)
        try { syncDP4ScaleUI(); } catch (_) {}
        try { syncDP4ViewHeightUI(); } catch (_) {}
        try { syncDP4MetricMarkerOverlayUI(); } catch (_) {}
      };
      imgEl.src = window.DP2_STATE.capture.imageBase64 || "";
    }

    // Bind "Valider le plan" (sans modal, sans confirmation)
    try {
      const finalizeBtn = document.getElementById("dp4-finalize-plan");
      if (finalizeBtn && finalizeBtn.dataset.bound !== "1") {
        finalizeBtn.dataset.bound = "1";
        finalizeBtn.addEventListener("click", async (e) => {
          e.preventDefault();

          const cat = window.DP4_STATE?.photoCategory ?? window.DP2_STATE?.photoCategory ?? null;
          if (cat !== "before" && cat !== "after") return;
          if (dp4IsFinalized(cat)) {
            // déjà finalisé => fermeture immédiate (retour écran parent)
            try { await dp4CloseModal(); } catch (_) {}
            return;
          }

          finalizeBtn.disabled = true;
          try {
            try { dp4SyncRoofGeometryFromDP2State(); } catch (_) {}
            // ✅ DP4 : persister le plan complet (géométrie + panneaux + objets + historique)
            // Nécessaire pour permettre "Importer Avant Travaux"
            try {
              if (typeof dp4SaveActivePlanToSelectedCategory === "function") {
                dp4SaveActivePlanToSelectedCategory();
              }
            } catch (_) {}
            try {
              console.log("[DP4] plan saved:", cat, "plans.before?", !!window.DP4_STATE?.plans?.before, "plans.after?", !!window.DP4_STATE?.plans?.after);
            } catch (_) {}
            const finalImg = await dp4BuildFinalRenderImageBase64FromCurrentDom();
            if (typeof finalImg === "string" && finalImg.startsWith("data:image")) {
              dp4SetFinalRenderFor(cat, finalImg);
              // Rafraîchir les miniatures (la page derrière le modal peut se mettre à jour)
              try { dp4RenderEntryMiniatures(); } catch (_) {}
              // Fermer automatiquement l'overlay DP4 (retour écran parent)
              try { await dp4CloseModal(); } catch (_) {}
            }
          } finally {
            try { finalizeBtn.disabled = false; } catch (_) {}
          }
        });
      }
    } catch (_) {}
  }

  function dp4RenderFinalPreviewStep(imageBase64, category) {
    // Étape "rendu final" : lecture seule (plus modifiable visuellement)
    if (titleEl) titleEl.textContent = "DP4 — Rendu final";
    dp4SetValidateVisible(false);
    dp4SetValidateEnabled(true);
    const importBtn = document.getElementById("dp4-import-dp2-btn");
    if (importBtn) importBtn.style.display = "none";
    if (!bodyEl) return;

    const catLabel =
      category === "before" ? "Avant travaux" : category === "after" ? "Après travaux" : "—";

    bodyEl.innerHTML = `
      <aside class="dp-map-help" id="dp4-final-panel">
        <h3>Plan finalisé</h3>
        <div class="dp-hint" style="margin-top: 10px;">
          Catégorie : <strong>${catLabel}</strong>
        </div>
        <div class="dp-hint" style="margin-top: 10px;">
          Fond blanc, traits normalisés (gris/noir).
        </div>
      </aside>
      <div class="dp-map-pane">
        <div class="dp-map-canvas" style="position: relative;">
          <div style="position:absolute; inset:0; background:#fff; display:flex; align-items:center; justify-content:center;">
            <img
              alt="DP4 — rendu final"
              src="${imageBase64}"
              style="max-width:100%; max-height:100%; object-fit:contain; background:#fff;"
            />
          </div>
        </div>
      </div>
    `;
  }

  async function dp4CloseModal() {
    // Ne plus auto-sauvegarder à la fermeture : la sauvegarde DP4 est explicite (bouton "Valider le plan" uniquement).

    dp4RestoreMovedDP2Ui();
    modal.setAttribute("aria-hidden", "true");
    dp4SetValidateVisible(false);
    dp4DestroyMap();
    if (document.activeElement) {
      document.activeElement.blur();
    }
    // 🔒 Nettoyage complet runtime
    window.DP4_CAPTURE_IMAGE = null;
  }

  async function dp4CaptureMapContainer() {
    // Capture OpenLayers (canvas des couches), comme DP2 — pas html2canvas.
    if (!window.DP4_OL_MAP) return;

    dp4SetValidateEnabled(false);

    try {
      const map = window.DP4_OL_MAP;
      const view = map.getView();
      const mapEl = map.getTargetElement();
      if (!mapEl) return;

      await new Promise((resolve) => {
        map.once("rendercomplete", resolve);
        map.renderSync();
      });

      const size = map.getSize();
      if (!size) return;

      const canvas = document.createElement("canvas");
      canvas.width = size[0];
      canvas.height = size[1];
      const ctx = canvas.getContext("2d");

      const canvases = mapEl.querySelectorAll(".ol-layer canvas");
      canvases.forEach((c) => {
        if (c.width > 0 && c.height > 0) {
          const opacity = c.parentNode.style.opacity;
          ctx.globalAlpha = opacity === "" ? 1 : Number(opacity);
          const transform = c.style.transform;
          if (transform) {
            const m = transform.match(/^matrix\(([^)]*)\)$/);
            if (m) {
              const matrix = m[1].split(",").map(Number);
              ctx.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
            }
          }
          ctx.drawImage(c, 0, 0);
        }
      });

      const imageBase64 = canvas.toDataURL("image/png");

      const scale_m_per_px = ol.proj.getPointResolution(
        view.getProjection(),
        view.getResolution(),
        view.getCenter(),
        "m"
      );

      window.DP4_STATE = window.DP4_STATE || dp4DefaultState();
      window.DP4_STATE.capture = {
        imageBase64,
        center: view.getCenter(),
        zoom: view.getZoom(),
        rotation: view.getRotation(),
        resolution: view.getResolution(),
        width: size[0],
        height: size[1],
        capturedAt: Date.now(),
        scale_m_per_px
      };

      window.DP4_CAPTURE_IMAGE = imageBase64;
      try { syncDP4MetricMarkerOverlayUI(); } catch (_) {}

      dp4DestroyMap();
      dp4RenderRoofDrawingStep();
    } catch (e) {
      console.error("[DP4] Capture impossible", e);
    } finally {
      dp4SetValidateEnabled(true);
    }
  }

  function dp4OpenModal() {
    modal.setAttribute("aria-hidden", "false");

    // Si le modal a déjà été fermé entre-temps, on stoppe.
    if (modal.getAttribute("aria-hidden") === "true") return;

    // Si un rendu final existe pour la catégorie active => lecture seule (pas d'édition)
    try {
      const cat = window.DP4_STATE?.photoCategory ?? window.DP2_STATE?.photoCategory ?? null;
      if (cat === "before" || cat === "after") {
        const v = dp4GetFinalRenderFor(cat);
        if (v?.imageBase64) {
          dp4RenderFinalPreviewStep(v.imageBase64, cat);
          return;
        }
      }
    } catch (_) {}

    // 🔒 Si aucun plan sauvegardé pour cette catégorie → ignorer toute capture runtime
    try {
      const cat = window.DP4_STATE?.photoCategory ?? null;
      const plan = cat === "before" || cat === "after"
        ? dp4GetStoredPlan(cat)
        : null;

      if (!plan) {
        window.DP4_CAPTURE_IMAGE = null;
      }
    } catch (_) {}

    // Si une capture existe déjà, on ne réutilise JAMAIS Google Maps :
    // l'image devient le fond figé pour l'étape de dessin.
    if (
      window.DP4_CAPTURE_IMAGE &&
      typeof window.DP4_CAPTURE_IMAGE === "string" &&
      window.DP4_CAPTURE_IMAGE.startsWith("data:image")
    ) {
      dp4RenderRoofDrawingStep();
      return;
    }

    // Étape 1 : vue OpenLayers IGN ORTHO (overlay uniquement)
    dp4RenderMapStep();

    if (modal.getAttribute("aria-hidden") === "true") return;

    const host = dp4ResetMapContainer() || document.getElementById("dp4-ign-map");
    if (!host) return;

    // Créer la map uniquement après que le modal soit visible (conteneur avec taille réelle)
    requestAnimationFrame(() => {
      dp4InitIgnOrthoMap(() => {
        if (modal.getAttribute("aria-hidden") === "true") return;
        dp4SetValidateVisible(true);
      });
      if (window.DP4_OL_MAP) {
        window.DP4_OL_MAP.updateSize();
        window.DP4_OL_MAP.renderSync();
      }
    });
  }

  window.dp4OpenModal = dp4OpenModal;

  function dp4OpenForCategory(category) {
    dp4ApplyStoredPlanToActive(category);
    dp4OpenModal();
  }

  if (btnBefore) {
    btnBefore.addEventListener("click", (e) => {
      e.preventDefault();
      dp4OpenForCategory("before");
    });
  }
  if (btnAfter) {
    btnAfter.addEventListener("click", (e) => {
      e.preventDefault();
      dp4OpenForCategory("after");
    });
  }
  document.getElementById("dp4-delete-before")?.addEventListener("click", () => {
    dp4DeletePlan("before");
  });
  document.getElementById("dp4-delete-after")?.addEventListener("click", () => {
    dp4DeletePlan("after");
  });

  const importBtn = document.getElementById("dp4-import-before-into-after");
  if (importBtn && !importBtn.dataset.bound) {
    importBtn.dataset.bound = "1";
    importBtn.addEventListener("click", function () {
      dp4ImportBeforeIntoAfter();
    });
  }
  // Compat : si l'ancien bouton existe encore dans le DOM, il ouvre avec la catégorie courante (ou vide)
  if (legacyBtn && legacyBtn !== btnBefore && legacyBtn !== btnAfter) {
    legacyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      dp4OpenModal();
    });
  }

  // Import DP2 (overlay écran fixe) : bind une seule fois
  document.getElementById("dp4-import-dp2-btn")?.addEventListener("click", () => {
    const hasContour = (Array.isArray(window.DP2_STATE?.buildingContours) && window.DP2_STATE.buildingContours.length > 0) ||
      (window.DP2_STATE?.objects || []).some((o) => o && o.type === "building_outline");
    if (!hasContour) {
      alert("Aucun contour DP2 disponible.");
      return;
    }
    dp4EnsureScreenOverlayCanvas();
    dp4DrawDP2ContourOnScreenOverlay();
    window.DP4_IMPORT_DP2_ACTIVE = true;
  });

  // Capture (validation vue) : ordre STRICT — overlay → transform → capture
  if (validateBtn && validateBtn.dataset.bound !== "1") {
    validateBtn.dataset.bound = "1";
    validateBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (window.DP4_IMPORT_OVERLAY_CANVAS) {
        dp4RemoveScreenOverlayCanvas();
      }
      if (window.DP4_IMPORT_DP2_ACTIVE === true) {
        dp4TransformDP2ToDP4PixelsFromCurrentMapView();
      }
      dp4CaptureMapContainer();
    });
  }

  // Fermeture identique DP1 : X / bouton Annuler
  modal.addEventListener("click", (e) => {
    if (e.target.closest(".dp-modal-close") || e.target.closest("#dp4-map-cancel")) {
      e.preventDefault();
      dp4CloseModal();
    }
  });
}

// ==================================================
// DP6 — INSERTION DU PROJET (INITIALISATION UI)
// ==================================================
function initDP6() {
  const page = document.getElementById("dp6-page");
  if (!page) return;

  const btnBefore = document.getElementById("dp6-create-before");
  const btnAfter = document.getElementById("dp6-create-after");
  const modal = document.getElementById("dp6-photo-modal");
  const streetBtn = document.getElementById("dp6-use-street");
  const uploadBtn = document.getElementById("dp6-use-upload");
  const workspace = document.getElementById("dp6-photo-workspace");
  const zoomInBtn = document.getElementById("dp6-zoom-in");
  const zoomOutBtn = document.getElementById("dp6-zoom-out");
  const zoomResetBtn = document.getElementById("dp6-zoom-reset");
  const zoomLabel = document.getElementById("dp6-zoom-label");
  const validateSelectionBtn = document.getElementById("dp6-validate-selection");
  const editSelectionBtn = document.getElementById("dp6-edit-selection");
  const revalidateSelectionBtn = document.getElementById("dp6-revalidate-selection");
  const validateBtn = document.getElementById("dp6-validate");
  const panelSelect = document.getElementById("dp6-panel-select");
  const orientationPortrait = document.getElementById("dp6-orientation-portrait");
  const orientationPaysage = document.getElementById("dp6-orientation-paysage");
  const categoryLabelEl = document.getElementById("dp6-photo-category-label");

  if (!modal || (!btnBefore && !btnAfter)) return;

  // ==============================
  // DP6 — ZOOM / PAN (VISUEL UNIQUEMENT)
  // - Transform CSS sur un "stage" (photo + overlays synchronisés)
  // - Ne modifie ni les coordonnées stockées, ni l’export PNG/PDF
  // ==============================

  const DP6_VIEW_MIN_SCALE = 1;
  const DP6_VIEW_MAX_SCALE = 4;

  const dp6View = { scale: 1, tx: 0, ty: 0 };

  function dp6GetStageEl() {
    if (!workspace) return null;
    return workspace.querySelector("#dp6-photo-stage");
  }

  function dp6UpdateZoomLabel() {
    if (!zoomLabel) return;
    const pct = Math.round((dp6View.scale || 1) * 100);
    zoomLabel.textContent = `${pct}%`;
  }

  function dp6ClampPanToBounds(next) {
    const s = typeof next?.scale === "number" ? next.scale : dp6View.scale;
    const tx = typeof next?.tx === "number" ? next.tx : dp6View.tx;
    const ty = typeof next?.ty === "number" ? next.ty : dp6View.ty;
    if (!workspace) return { scale: s, tx, ty };

    const r = workspace.getBoundingClientRect();
    const vw = Math.max(1, r.width);
    const vh = Math.max(1, r.height);

    if (s <= 1.000001) return { scale: 1, tx: 0, ty: 0 };

    // Le stage fait vw×vh en base. Après scale, sa taille devient vw*s×vh*s.
    // Clamp pour éviter d’afficher du "vide".
    const minTx = vw - vw * s;
    const minTy = vh - vh * s;
    const maxTx = 0;
    const maxTy = 0;

    return {
      scale: s,
      tx: Math.max(minTx, Math.min(maxTx, tx)),
      ty: Math.max(minTy, Math.min(maxTy, ty)),
    };
  }

  function dp6ApplyViewTransform() {
    const stage = dp6GetStageEl();
    if (!stage) return;
    const { scale, tx, ty } = dp6ClampPanToBounds(dp6View);
    dp6View.scale = scale;
    dp6View.tx = tx;
    dp6View.ty = ty;
    stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    dp6UpdateZoomLabel();
  }

  function dp6ResetView() {
    dp6View.scale = 1;
    dp6View.tx = 0;
    dp6View.ty = 0;
    dp6ApplyViewTransform();
  }

  function dp6SetScaleAtClientPoint(nextScale, clientX, clientY) {
    if (!workspace) return;
    const r = workspace.getBoundingClientRect();
    const cx = clientX - r.left;
    const cy = clientY - r.top;

    const prevScale = dp6View.scale;
    const clampedScale = Math.max(DP6_VIEW_MIN_SCALE, Math.min(DP6_VIEW_MAX_SCALE, nextScale));

    if (Math.abs(clampedScale - prevScale) < 0.0001) return;

    // Garder le point sous le curseur stable (zoom centré sur curseur)
    const x = (cx - dp6View.tx) / prevScale;
    const y = (cy - dp6View.ty) / prevScale;

    dp6View.scale = clampedScale;
    dp6View.tx = cx - x * clampedScale;
    dp6View.ty = cy - y * clampedScale;
    dp6ApplyViewTransform();
  }

  function dp6NudgeScale(delta) {
    // Zoom centré au milieu de la zone de travail
    if (!workspace) return;
    const r = workspace.getBoundingClientRect();
    dp6SetScaleAtClientPoint(dp6View.scale + delta, r.left + r.width / 2, r.top + r.height / 2);
  }

  // ==============================
  // DP6 — PARAMÈTRES (INFORMATIF UNIQUEMENT)
  // - Stockage : window.DP6_STATE.module + window.DP6_STATE.layout.orientation
  // ==============================

  function dp6CategoryToLabel(category) {
    return category === "BEFORE" ? "Avant travaux" : category === "AFTER" ? "Après travaux" : "—";
  }

  function dp6SyncCategoryUI() {
    if (!categoryLabelEl) return;
    const category = window.DP6_STATE?.category;
    categoryLabelEl.textContent = dp6CategoryToLabel(category);
  }

  function dp6SetCategory(category) {
    const next = category === "BEFORE" || category === "AFTER" ? category : null;
    try {
      window.DP6_STATE = window.DP6_STATE || {};
      if (next) window.DP6_STATE.category = next;
    } catch (_) {}
    dp6SyncCategoryUI();
  }

  function dp6CoerceOrientation(v) {
    const s = String(v || "").toUpperCase();
    return s === "PAYSAGE" ? "PAYSAGE" : "PORTRAIT";
  }

  function dp6HasSourceImage() {
    const src = window.DP6_STATE && typeof window.DP6_STATE.sourceImage === "string" ? window.DP6_STATE.sourceImage : "";
    return !!src;
  }

  // ==============================
  // DP6 — MODE UI (édition des sélections validées)
  // - DRAW : l'utilisateur peut dessiner une nouvelle sélection et la valider (=> patch)
  // - EDIT_SELECTION : l'utilisateur peut cliquer sur un patch existant et le modifier (poignées)
  // ==============================
  const DP6_SELECTION_UI_MODE_DRAW = "DRAW";
  const DP6_SELECTION_UI_MODE_EDIT = "EDIT_SELECTION";

  function dp6GetSelectionUIMode() {
    const m = String(window.DP6_STATE?.selectionUIMode || DP6_SELECTION_UI_MODE_DRAW);
    return m === DP6_SELECTION_UI_MODE_EDIT ? DP6_SELECTION_UI_MODE_EDIT : DP6_SELECTION_UI_MODE_DRAW;
  }

  function dp6SetSelectionUIMode(mode) {
    const next = mode === DP6_SELECTION_UI_MODE_EDIT ? DP6_SELECTION_UI_MODE_EDIT : DP6_SELECTION_UI_MODE_DRAW;
    try {
      window.DP6_STATE = window.DP6_STATE || {};
      window.DP6_STATE.selectionUIMode = next;
    } catch (_) {}
  }

  function dp6GetActivePatchIndex() {
    const v = window.DP6_STATE?.activePatchIndex;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function dp6SetActivePatchIndex(idx) {
    const n = typeof idx === "number" ? idx : Number(idx);
    try {
      window.DP6_STATE = window.DP6_STATE || {};
      window.DP6_STATE.activePatchIndex = Number.isFinite(n) && n >= 0 ? n : null;
    } catch (_) {}
  }

  function dp6EnterEditSelectionMode() {
    dp6SetSelectionUIMode(DP6_SELECTION_UI_MODE_EDIT);
    dp6SetActivePatchIndex(null);
    try { dp6CropClearSelection(); } catch (_) {}
    try { dp6SyncValidateButtonUI(); } catch (_) {}
    try { renderDP6Canvas(); } catch (_) {}
    try { dp6EnsureSelectionEditor(); } catch (_) {}
  }

  function dp6ExitEditSelectionMode() {
    dp6SetSelectionUIMode(DP6_SELECTION_UI_MODE_DRAW);
    dp6SetActivePatchIndex(null);
    try { dp6CropClearSelection(); } catch (_) {}
    try { dp6SyncValidateButtonUI(); } catch (_) {}
    try { renderDP6Canvas(); } catch (_) {}
  }

  // ==============================
  // DP6 — RENDU FINAL (UN SEUL CANVAS)
  // - canvas = image source + PATCHES photovoltaïques (dessinés par-dessus)
  // - overlay SVG = sélection quad + poignées (inchangé)
  // - source de vérité (RENDu VISUEL) :
  //   - window.DP6_STATE.patches = [{ points:[{x,y}x4] }, ...]
  //   - window.DP6_STATE.selection.points (sélection active, non validée)
  //   - window.DP6_STATE.sourceImage
  // ==============================

  const DP6_CANVAS_ID = "dp6-canvas";

  let dp6ImageEl = null;
  let dp6ImageSrc = "";
  let dp6ImageLoadPromise = null;

  function dp6EnsureWorkspaceCanvas() {
    if (!workspace) return null;
    const struct = dp6CropEnsureWorkspaceStructure();
    if (!struct?.content) return null;

    let canvas = struct.content.querySelector(`#${DP6_CANVAS_ID}`);
    if (!canvas) {
      // Robustesse : si le canvas a été supprimé du DOM, on le recrée (toujours 1 seul).
      canvas = document.createElement("canvas");
      canvas.id = DP6_CANVAS_ID;
      struct.content.appendChild(canvas);
    }

    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.zIndex = "10";

    return canvas;
  }

  function dp6EnsureLoadedImage(src) {
    const s = String(src || "");
    if (!s) return Promise.resolve(null);

    if (dp6ImageEl && dp6ImageSrc === s && dp6ImageEl.complete && dp6ImageEl.naturalWidth > 0) {
      return Promise.resolve(dp6ImageEl);
    }

    if (dp6ImageLoadPromise && dp6ImageSrc === s) return dp6ImageLoadPromise;

    dp6ImageSrc = s;
    dp6ImageEl = new Image();
    dp6ImageEl.decoding = "async";

    dp6ImageLoadPromise = new Promise((resolve) => {
      dp6ImageEl.onload = () => resolve(dp6ImageEl);
      dp6ImageEl.onerror = () => resolve(null);
      dp6ImageEl.src = s;
    });

    return dp6ImageLoadPromise;
  }

  function dp6BilerpPoint(p00, p10, p11, p01, u, v) {
    const u0 = 1 - u;
    const v0 = 1 - v;
    return {
      x: u0 * v0 * p00.x + u * v0 * p10.x + u * v * p11.x + u0 * v * p01.x,
      y: u0 * v0 * p00.y + u * v0 * p10.y + u * v * p11.y + u0 * v * p01.y,
    };
  }

  function dp6BilerpDerivatives(p00, p10, p11, p01, u, v) {
    const v0 = 1 - v;
    const u0 = 1 - u;
    // dP/du = -(1-v)p00 + (1-v)p10 + v p11 - v p01
    const du = {
      x: -v0 * p00.x + v0 * p10.x + v * p11.x - v * p01.x,
      y: -v0 * p00.y + v0 * p10.y + v * p11.y - v * p01.y,
    };
    // dP/dv = -(1-u)p00 - u p10 + u p11 + (1-u)p01
    const dv = {
      x: -u0 * p00.x - u * p10.x + u * p11.x + u0 * p01.x,
      y: -u0 * p00.y - u * p10.y + u * p11.y + u0 * p01.y,
    };
    return { du, dv };
  }

  function dp6Hypot(x, y) {
    return Math.sqrt(x * x + y * y);
  }

  function dp6Dist(a, b) {
    return dp6Hypot(a.x - b.x, a.y - b.y);
  }

  function dp6DrawQuad(ctx, q) {
    ctx.beginPath();
    ctx.moveTo(q[0].x, q[0].y);
    ctx.lineTo(q[1].x, q[1].y);
    ctx.lineTo(q[2].x, q[2].y);
    ctx.lineTo(q[3].x, q[3].y);
    ctx.closePath();
    ctx.fill();
  }

  function dp6PathQuad(ctx, q) {
    ctx.beginPath();
    ctx.moveTo(q[0].x, q[0].y);
    ctx.lineTo(q[1].x, q[1].y);
    ctx.lineTo(q[2].x, q[2].y);
    ctx.lineTo(q[3].x, q[3].y);
    ctx.closePath();
  }

  function dp6LerpPoint(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  function dp6NormalizeQuadPoints(points) {
    if (!Array.isArray(points) || points.length !== 4) return null;
    const ps = points.map((p) => ({ x: Number(p?.x), y: Number(p?.y) }));
    if (!ps.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return null;

    const cx = (ps[0].x + ps[1].x + ps[2].x + ps[3].x) / 4;
    const cy = (ps[0].y + ps[1].y + ps[2].y + ps[3].y) / 4;

    // Tri angulaire autour du centroïde : évite les auto-intersections si l'utilisateur croise les poignées.
    ps.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));

    // Rotation pour démarrer au point le plus "haut-gauche" (heuristique stable).
    let best = 0;
    let bestScore = Infinity;
    for (let i = 0; i < 4; i++) {
      const s = ps[i].x + ps[i].y;
      if (s < bestScore) {
        bestScore = s;
        best = i;
      }
    }
    return [ps[best], ps[(best + 1) % 4], ps[(best + 2) % 4], ps[(best + 3) % 4]];
  }

  let dp6NoiseCanvas = null;
  function dp6EnsureNoiseCanvas() {
    if (dp6NoiseCanvas) return dp6NoiseCanvas;
    const c = document.createElement("canvas");
    c.width = 96;
    c.height = 96;
    const g = c.getContext("2d");
    if (!g) return null;

    // Noise très léger (stable car canvas caché réutilisé) + micro-diagonales "panneau".
    const img = g.createImageData(c.width, c.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = 12 + Math.random() * 30; // gris sombre
      d[i + 0] = v;
      d[i + 1] = v;
      d[i + 2] = v;
      d[i + 3] = 18 + Math.random() * 22; // alpha faible
    }
    g.putImageData(img, 0, 0);

    g.save();
    g.globalCompositeOperation = "overlay";
    g.lineWidth = 1;
    g.strokeStyle = "rgba(255,255,255,0.05)";
    for (let k = -c.height; k < c.width; k += 12) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k + c.height, c.height);
      g.stroke();
    }
    g.restore();

    dp6NoiseCanvas = c;
    return dp6NoiseCanvas;
  }

  function dp6EnsurePatchState() {
    try {
      window.DP6_STATE = window.DP6_STATE || {};
      if (!Array.isArray(window.DP6_STATE.patches)) window.DP6_STATE.patches = [];
      return window.DP6_STATE.patches;
    } catch (_) {
      return [];
    }
  }

  function dp6GetPatchKey(points) {
    if (!Array.isArray(points) || points.length !== 4) return "";
    return points.map((p) => `${Number(p?.x || 0).toFixed(2)},${Number(p?.y || 0).toFixed(2)}`).join(";");
  }

  function dp6DrawSolarPatch(ctx, q, opts) {
    const alpha = typeof opts?.alpha === "number" ? opts.alpha : 0.945;
    const shadow = opts?.shadow !== false;
    const textureAlpha = typeof opts?.textureAlpha === "number" ? opts.textureAlpha : 0.10;
    const outline = opts?.outline === true;
    // DP6 UX : pas de bleu (même en fallback).
    const outlineColor = String(opts?.outlineColor || "#C39847");
    const outlineWidth = typeof opts?.outlineWidth === "number" ? opts.outlineWidth : 2;
    const dash = Array.isArray(opts?.dash) ? opts.dash : null;

    // Base sombre (0.92–0.96) + ombre douce
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    if (shadow) {
      ctx.shadowColor = "rgba(0, 0, 0, 0.32)";
      ctx.shadowBlur = 14;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 4;
    } else {
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
    ctx.fillStyle = `rgba(12, 12, 12, ${Math.max(0, Math.min(1, alpha))})`;
    dp6PathQuad(ctx, q);
    ctx.fill();
    ctx.restore();

    // Texture subtile (noise/pattern) à l'intérieur du quad
    const noiseCanvas = dp6EnsureNoiseCanvas();
    if (noiseCanvas && textureAlpha > 0) {
      ctx.save();
      dp6PathQuad(ctx, q);
      ctx.clip();
      const pattern = ctx.createPattern(noiseCanvas, "repeat");
      if (pattern) {
        const tr = typeof ctx.getTransform === "function" ? ctx.getTransform() : null;
        const w = tr && tr.a ? ctx.canvas.width / tr.a : ctx.canvas.width;
        const h = tr && tr.d ? ctx.canvas.height / tr.d : ctx.canvas.height;
        ctx.globalCompositeOperation = "overlay";
        ctx.globalAlpha = Math.max(0, Math.min(0.35, textureAlpha));
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.restore();
    }

    if (outline) {
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.shadowColor = "transparent";
      ctx.lineWidth = outlineWidth;
      ctx.strokeStyle = outlineColor;
      if (dash && ctx.setLineDash) ctx.setLineDash(dash);
      dp6PathQuad(ctx, q);
      ctx.stroke();
      if (dash && ctx.setLineDash) ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // Point d’entrée rendu (central)
  async function renderDP6Canvas() {
    const canvas = dp6EnsureWorkspaceCanvas();
    if (!canvas) return;

    // IMPORTANT: dimensions logiques basées sur le workspace (non transformé),
    // sinon le zoom CSS fausserait la taille export PNG/PDF.
    const wRect = workspace ? workspace.getBoundingClientRect() : null;
    const cssW = Math.max(1, Math.round((wRect && wRect.width) || 0));
    const cssH = Math.max(1, Math.round((wRect && wRect.height) || 0));
    if (cssW < 2 || cssH < 2) return;

    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const pxW = Math.max(1, Math.round(cssW * dpr));
    const pxH = Math.max(1, Math.round(cssH * dpr));

    if (canvas.width !== pxW) canvas.width = pxW;
    if (canvas.height !== pxH) canvas.height = pxH;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Espace de dessin en pixels CSS (transform DPR)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // Marquer la source "figée" active (garde-fous de l’éditeur de sélection)
    try {
      const before = window.DP6_STATE && window.DP6_STATE.beforeImage ? String(window.DP6_STATE.beforeImage) : "";
      canvas.dataset.dp6Before = before || "";
    } catch (_) {}

    const src = window.DP6_STATE?.sourceImage || "";
    const img = await dp6EnsureLoadedImage(src);
    if (!img) return;

    // 1) Image source (à taille canvas)
    ctx.save();
    ctx.shadowColor = "transparent";
    ctx.globalAlpha = 1;
    ctx.drawImage(img, 0, 0, cssW, cssH);
    ctx.restore();

    // 2) Tous les patches validés
    const patches = Array.isArray(window.DP6_STATE?.patches) ? window.DP6_STATE.patches : [];
    for (let i = 0; i < patches.length; i++) {
      const p = patches[i];
      const q = dp6NormalizeQuadPoints(p?.points);
      if (!q) continue;
      // UX DP6 : rendu "photomontage" uniquement (aucun contour).
      // La sélection active (or + poignées) est rendue UNIQUEMENT via l'overlay SVG.
      dp6DrawSolarPatch(ctx, q, { alpha: 0.945, shadow: true, textureAlpha: 0.10 });
    }

    // 3) IMPORTANT : ne jamais dessiner la sélection sur le canvas
    // (évite toute "pollution graphique" dans le rendu final).
  }

  function dp6SyncValidateButtonUI() {
    const okImage = dp6HasSourceImage();
    const patches = dp6EnsurePatchState();
    const okPatches = Array.isArray(patches) && patches.length > 0;

    // DP6 UX : suppression totale de la validation/manipulation via boutons de sélection.
    // (Les zones sont créées et modifiées directement par interaction.)
    if (validateSelectionBtn) {
      validateSelectionBtn.style.display = "none";
      validateSelectionBtn.disabled = true;
    }
    if (editSelectionBtn) {
      editSelectionBtn.style.display = "none";
      editSelectionBtn.disabled = true;
    }
    if (revalidateSelectionBtn) {
      revalidateSelectionBtn.style.display = "none";
      revalidateSelectionBtn.disabled = true;
    }

    // Bouton "Valider le photomontage" : valide le rendu final (tous patches), sans exiger une sélection active
    if (validateBtn) {
      validateBtn.disabled = !(okImage && okPatches);
    }

    // UX curseur : dessin (crosshair) + clic pour activer une zone existante.
    try {
      const layer = workspace ? workspace.querySelector("#dp6-selection-layer") : null;
      if (layer) layer.style.cursor = okImage ? "crosshair" : "default";
    } catch (_) {}
  }

  function dp6RenderEntryMiniatures() {
    const beforeCard = document.getElementById("dp6-card-before");
    const afterCard = document.getElementById("dp6-card-after");
    const beforeImg = document.getElementById("dp6-thumb-before");
    const afterImg = document.getElementById("dp6-thumb-after");
    if (!beforeCard || !afterCard || !beforeImg || !afterImg) return;

    const before = String(window.DP6_STATE?.beforeImage || "");
    const after = String(window.DP6_STATE?.afterImage || "");

    if (before && before.startsWith("data:image")) {
      beforeImg.src = before;
      beforeCard.classList.add("has-thumb");
    } else {
      try { beforeImg.removeAttribute("src"); } catch (_) {}
      beforeCard.classList.remove("has-thumb");
    }

    if (after && after.startsWith("data:image")) {
      afterImg.src = after;
      afterCard.classList.add("has-thumb");
    } else {
      try { afterImg.removeAttribute("src"); } catch (_) {}
      afterCard.classList.remove("has-thumb");
    }
  }

  function dp6ValidateActiveSelectionAsPatch() {
    const pts = window.DP6_STATE?.selection?.points;
    if (!dp6NormalizeQuadPoints(pts)) return false;

    const copy = (pts || []).slice(0, 4).map((p) => ({
      x: +Number(p?.x || 0).toFixed(2),
      y: +Number(p?.y || 0).toFixed(2),
    }));

    try {
      window.DP6_STATE = window.DP6_STATE || {};
      window.DP6_STATE.patches = Array.isArray(window.DP6_STATE.patches) ? window.DP6_STATE.patches : [];
      window.DP6_STATE.patches.push({ points: copy });
    } catch (_) {
      return false;
    }

    // Nouvelle zone : considérée comme "validée" immédiatement.
    // IMPORTANT UX : une zone validée devient INACTIVE (aucun contour). Activation = clic sur la zone.
    try { dp6SetActivePatchIndex(null); } catch (_) {}
    try { dp6CropClearSelection(); } catch (_) {}
    try { renderDP6Canvas(); } catch (_) {}
    try { dp6SyncValidateButtonUI(); } catch (_) {}
    return true;
  }

  function dp6CommitActivePatchEditFromSelection() {
    const idx = dp6GetActivePatchIndex();
    if (idx == null) return false;

    const selPts = dp6CropGetSelection();
    const q = dp6NormalizeQuadPoints(selPts);
    if (!q) return false;

    const patches = dp6EnsurePatchState();
    if (!Array.isArray(patches) || idx < 0 || idx >= patches.length) return false;

    const nextPoints = q.slice(0, 4).map((p) => ({
      x: +Number(p?.x || 0).toFixed(2),
      y: +Number(p?.y || 0).toFixed(2),
    }));

    // Mise à jour in-place (sans supprimer, sans reorder)
    const prev = patches[idx] && typeof patches[idx] === "object" ? patches[idx] : {};
    patches[idx] = { ...prev, points: nextPoints };

    try { renderDP6Canvas(); } catch (_) {}
    try { dp6SyncValidateButtonUI(); } catch (_) {}
    return true;
  }

  function dp6SyncPanelMetadataUI() {
    const manufacturerEl = document.getElementById("dp6-panel-manufacturer");
    const referenceEl = document.getElementById("dp6-panel-reference");
    const powerEl = document.getElementById("dp6-panel-power");
    const dimensionsEl = document.getElementById("dp6-panel-dimensions");
    if (!manufacturerEl || !referenceEl || !powerEl || !dimensionsEl) return;

    const model = window.DP6_STATE?.module || null;
    if (!model) {
      manufacturerEl.textContent = "—";
      referenceEl.textContent = "—";
      powerEl.textContent = "—";
      dimensionsEl.textContent = "—";
      return;
    }

    manufacturerEl.textContent = model.fabricant || "—";
    referenceEl.textContent = model.reference || "—";
    powerEl.textContent = typeof model.puissance === "number" ? `${model.puissance} Wc` : "—";

    // ✅ DP6 : dimensions informatives uniquement (source de vérité unique)
    const dims = window.PANEL_DIMENSIONS || null;
    const hmm = typeof dims?.height_mm === "number" && Number.isFinite(dims.height_mm) ? dims.height_mm : null;
    const wmm = typeof dims?.width_mm === "number" && Number.isFinite(dims.width_mm) ? dims.width_mm : null;
    if (hmm == null || wmm == null) {
      dimensionsEl.textContent = "—";
      return;
    }

    const hm = (hmm / 1000).toFixed(2).replace(".", ",");
    const wm = (wmm / 1000).toFixed(2).replace(".", ",");
    // ✅ Affichage utilisateur imposé
    dimensionsEl.textContent = `${hm} m × ${wm} m`;
  }

  function dp6SetModuleFromKey(key) {
    const k = String(key || "");
    const catalog = typeof DP4_PANEL_CATALOG === "object" && DP4_PANEL_CATALOG ? DP4_PANEL_CATALOG : {};
    const entry = k ? catalog[k] : null;

    try {
      window.DP6_STATE = window.DP6_STATE || {};
    } catch (_) {}

    if (!entry) {
      try { window.DP6_STATE.module = null; } catch (_) {}
      dp6SyncPanelMetadataUI();
      return;
    }

    // ✅ DP6 : dimensions figées SolarGlobe (source de vérité unique)
    const dims = window.PANEL_DIMENSIONS || null;
    const width_mm = typeof dims?.width_mm === "number" && Number.isFinite(dims.width_mm) ? dims.width_mm : null;
    const height_mm = typeof dims?.height_mm === "number" && Number.isFinite(dims.height_mm) ? dims.height_mm : null;
    const puissance = typeof entry.power_w === "number" ? entry.power_w : null;

    window.DP6_STATE.module = {
      id: k,
      width_mm,
      height_mm,
      texture: entry.texture || null,
      fabricant: entry.manufacturer || "",
      reference: entry.reference || "",
      puissance,
    };

    dp6SyncPanelMetadataUI();
  }

  function dp6SyncLayoutInputsUI() {
    const orientation = dp6CoerceOrientation(window.DP6_STATE?.layout?.orientation);
    if (orientationPortrait && orientationPaysage) {
      if (orientationPortrait.checked !== (orientation === "PORTRAIT")) orientationPortrait.checked = orientation === "PORTRAIT";
      if (orientationPaysage.checked !== (orientation === "PAYSAGE")) orientationPaysage.checked = orientation === "PAYSAGE";
    }
  }

  try {
    window.DP6_STATE = window.DP6_STATE || {};
    window.DP6_STATE.layout = window.DP6_STATE.layout || { orientation: "PORTRAIT" };
    // Normaliser (robustesse) : force une valeur autorisée uniquement
    window.DP6_STATE.layout.orientation = dp6CoerceOrientation(window.DP6_STATE.layout.orientation);
    // Patches validés (DP6) : zones PV distinctes (quads sombres)
    if (!Array.isArray(window.DP6_STATE.patches)) window.DP6_STATE.patches = [];
    // Image finale du photomontage (canvas export)
    if (typeof window.DP6_STATE.afterImage !== "string") window.DP6_STATE.afterImage = "";
  } catch (_) {}

  // Sync catégorie -> UI (lecture seule)
  dp6SyncCategoryUI();
  dp6RenderEntryMiniatures();

  // Sync état -> UI / UI -> état (module PV)
  if (panelSelect) {
    if (window.DP6_STATE?.module) {
      const currentId = window.DP6_STATE.module.id || "";
      const currentRef = window.DP6_STATE.module.reference || "";
      const catalog = typeof DP4_PANEL_CATALOG === "object" && DP4_PANEL_CATALOG ? DP4_PANEL_CATALOG : {};
      const keyByRef = currentRef
        ? Object.keys(catalog).find((k) => catalog[k]?.reference === currentRef)
        : null;
      const key = currentId || keyByRef || "";
      if (key) panelSelect.value = key;
      dp6SetModuleFromKey(panelSelect.value || "");
    } else {
      dp6SetModuleFromKey(panelSelect.value || "");
    }

    if (panelSelect.dataset.bound !== "1") {
      panelSelect.dataset.bound = "1";
      panelSelect.addEventListener("change", (e) => {
        const value = e.target?.value || "";
        dp6SetModuleFromKey(value);
      });
    }
  } else {
    dp6SyncPanelMetadataUI();
  }

  // Sync état -> UI / UI -> état (implantation)
  dp6SyncLayoutInputsUI();
  dp6SyncValidateButtonUI();

  // Orientation (Portrait / Paysage) — valeur stockée dans DP6_STATE.layout.orientation
  function dp6SetOrientation(next) {
    const orientation = dp6CoerceOrientation(next);
    try {
      window.DP6_STATE = window.DP6_STATE || {};
      window.DP6_STATE.layout = { ...(window.DP6_STATE.layout || {}), orientation };
    } catch (_) {}
    dp6SyncLayoutInputsUI();
    dp6SyncValidateButtonUI();
    try { renderDP6Canvas(); } catch (_) {}
  }

  if (orientationPortrait && orientationPortrait.dataset.bound !== "1") {
    orientationPortrait.dataset.bound = "1";
    orientationPortrait.addEventListener("change", (e) => {
      if (e.target && e.target.checked) dp6SetOrientation("PORTRAIT");
    });
  }
  if (orientationPaysage && orientationPaysage.dataset.bound !== "1") {
    orientationPaysage.dataset.bound = "1";
    orientationPaysage.addEventListener("change", (e) => {
      if (e.target && e.target.checked) dp6SetOrientation("PAYSAGE");
    });
  }

  // Redraw automatique : se régénère quand selection.points / sourceImage / showPanelGrid changent
  function dp6ComputeAutoRedrawKey() {
    const src = String(window.DP6_STATE?.sourceImage || "");
    const pts = window.DP6_STATE?.selection?.points;
    const ptsKey = dp6GetPatchKey(pts);
    const patches = Array.isArray(window.DP6_STATE?.patches) ? window.DP6_STATE.patches : [];
    const patchesKey = patches.map((p) => dp6GetPatchKey(p?.points)).join("|");
    return `${src}|patches:${patchesKey}|sel:${ptsKey}`;
  }

  function dp6StartAutoRedraw() {
    try {
      window.DP6_STATE = window.DP6_STATE || {};
      if (window.DP6_STATE._dp6AutoRedrawBound) return;
      window.DP6_STATE._dp6AutoRedrawBound = true;
    } catch (_) { return; }

    let lastKey = "";
    let lastT = 0;

    const tick = (t) => {
      // Throttle ~4Hz pour rester léger et fiable
      if (typeof t !== "number") t = performance.now();
      if (t - lastT >= 250) {
        lastT = t;
        let key = "";
        try { key = dp6ComputeAutoRedrawKey(); } catch (_) { key = ""; }
        if (key !== lastKey) {
          lastKey = key;
          try { dp6SyncValidateButtonUI(); } catch (_) {}
          try { renderDP6Canvas(); } catch (_) {}
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  dp6StartAutoRedraw();

  // ==============================
  // DP6 — ÉDITEUR DE SÉLECTION (zone panneaux)
  // Sélection QUADRILATÈRE libre (comme un outil de capture écran)
  // - Travail UNIQUEMENT sur l'image figée (beforeImage)
  // - 4 coins INDÉPENDANTS (aucune dépendance géométrique)
  // - Drag d'un coin => bouge uniquement CE point
  // - Drag à l'intérieur => translation (bouge tous les points ensemble)
  // - Aucune métrique / grille / snapping / rotation
  // - Source de vérité : window.DP6_STATE.selection = { points:[{x,y},{x,y},{x,y},{x,y}] }
  // ==============================
  try {
    window.DP6_STATE = window.DP6_STATE || {};
  } catch (_) {}

  const DP6_CROP_CLICK_TOL = 3; // clic sans drag => annule

  function dp6PointInPolygon(pt, poly) {
    if (!pt || !Array.isArray(poly) || poly.length < 3) return false;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      const intersect =
        yi > pt.y !== yj > pt.y &&
        pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 0.0000001) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function dp6DistPointToSegment(pt, a, b) {
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const wx = pt.x - a.x;
    const wy = pt.y - a.y;
    const c1 = vx * wx + vy * wy;
    if (c1 <= 0) return dp6Hypot(pt.x - a.x, pt.y - a.y);
    const c2 = vx * vx + vy * vy;
    if (c2 <= c1) return dp6Hypot(pt.x - b.x, pt.y - b.y);
    const t = c1 / c2;
    const px = a.x + t * vx;
    const py = a.y + t * vy;
    return dp6Hypot(pt.x - px, pt.y - py);
  }

  function dp6HitTestQuad(pt, quad, tolPx) {
    const tol = typeof tolPx === "number" && tolPx >= 0 ? tolPx : 0;
    if (!pt || !Array.isArray(quad) || quad.length !== 4) return false;
    if (dp6PointInPolygon(pt, quad)) return true;
    for (let i = 0; i < 4; i++) {
      const a = quad[i];
      const b = quad[(i + 1) % 4];
      if (dp6DistPointToSegment(pt, a, b) <= tol) return true;
    }
    return false;
  }

  function dp6PickPatchIndexAtPoint(pt, tolPx) {
    const patches = dp6EnsurePatchState();
    for (let i = patches.length - 1; i >= 0; i--) {
      const q = dp6NormalizeQuadPoints(patches[i]?.points);
      if (!q) continue;
      if (dp6HitTestQuad(pt, q, tolPx)) return i;
    }
    return null;
  }

  function dp6CropGetSelection() {
    const s = window.DP6_STATE && window.DP6_STATE.selection ? window.DP6_STATE.selection : null;
    if (!s || typeof s !== "object") return null;
    const pts = Array.isArray(s.points) ? s.points : null;
    if (!pts || pts.length !== 4) return null;
    const out = pts.map((p) => ({ x: Number(p?.x), y: Number(p?.y) }));
    if (!out.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
    return out;
  }

  function dp6CropSetSelection(points) {
    if (!window.DP6_STATE) window.DP6_STATE = {};
    window.DP6_STATE.selection = {
      points: (points || []).slice(0, 4).map((p) => ({
        x: +Number(p.x).toFixed(2),
        y: +Number(p.y).toFixed(2),
      })),
    };
    try { renderDP6Canvas(); } catch (_) {}
  }

  function dp6CropClearSelection() {
    try {
      if (window.DP6_STATE && window.DP6_STATE.selection) delete window.DP6_STATE.selection;
    } catch (_) {}
    try { renderDP6Canvas(); } catch (_) {}
  }

  function dp6CropEnsureWorkspaceStructure() {
    if (!workspace) return null;
    if (workspace.style.position !== "relative") workspace.style.position = "relative";
    if (workspace.style.overflow !== "hidden") workspace.style.overflow = "hidden";

    // Stage (photo + overlays) : c'est LUI qui est zoomé/panné en CSS transform.
    // Le workspace reste non transformé => les dimensions logiques (canvas export) ne changent pas.
    let stage = workspace.querySelector("#dp6-photo-stage");
    if (!stage) {
      stage = document.createElement("div");
      stage.id = "dp6-photo-stage";
      workspace.appendChild(stage);
    }
    stage.style.position = "absolute";
    stage.style.inset = "0";
    stage.style.transformOrigin = "0 0";
    stage.style.willChange = "transform";
    stage.style.userSelect = "none";

    // Contenu (StreetView OU image)
    // (on migre si l'élément existe encore au niveau racine du workspace)
    let content = stage.querySelector("#dp6-photo-content") || workspace.querySelector("#dp6-photo-content");
    if (!content) {
      content = document.createElement("div");
      content.id = "dp6-photo-content";
      stage.appendChild(content);
    } else if (content.parentNode !== stage) {
      try { stage.appendChild(content); } catch (_) {}
    }
    content.style.position = "absolute";
    content.style.inset = "0";

    // Layer sélection (SVG)
    let layer = stage.querySelector("#dp6-selection-layer") || workspace.querySelector("#dp6-selection-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "dp6-selection-layer";
      stage.appendChild(layer);
    } else if (layer.parentNode !== stage) {
      try { stage.appendChild(layer); } catch (_) {}
    }
    layer.style.position = "absolute";
    layer.style.inset = "0";
    layer.style.zIndex = "60";
    layer.style.pointerEvents = "auto";
    layer.style.userSelect = "none";
    layer.style.touchAction = "none";
    layer.style.cursor = "crosshair";

    // Appliquer la vue actuelle (au cas où le DOM vient d'être (re)créé)
    try { dp6ApplyViewTransform(); } catch (_) {}

    return { stage, content, layer };
  }

  function dp6CropGetActiveImage() {
    if (!workspace) return null;
    const canvas = workspace.querySelector(`#${DP6_CANVAS_ID}`);
    if (!canvas) return null;
    // Règle absolue: travailler uniquement sur l'image figée (beforeImage)
    const before = window.DP6_STATE && window.DP6_STATE.beforeImage ? String(window.DP6_STATE.beforeImage) : "";
    if (!before) return null;
    const current = String(canvas.dataset?.dp6Before || "");
    if (current !== before) return null;
    return canvas;
  }

  function dp6CropAlignLayerToImage(layer, img) {
    if (!layer || !img || !workspace) return;
    // Canvas DP6 = 100% de la zone de travail => overlay = 100% également.
    // (important : ne pas dépendre des boundingRect transformés par le zoom)
    layer.style.left = "0px";
    layer.style.top = "0px";
    layer.style.width = "100%";
    layer.style.height = "100%";
  }

  function dp6CropGetLayerPointFromEvent(layer, e) {
    const r = layer.getBoundingClientRect();
    const s = dp6View && typeof dp6View.scale === "number" ? dp6View.scale : 1;
    // Si le stage est zoomé, le rect est agrandi : on ramène dans l'espace "logique" (scale=1).
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
  }

  function dp6Clamp01(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function dp6PointsBounds(points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    (points || []).forEach((p) => {
      if (!p) return;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
    if (![minX, minY, maxX, maxY].every((n) => Number.isFinite(n))) return null;
    return { minX, minY, maxX, maxY };
  }

  function dp6PointsFromDraw(a, b, bounds) {
    const x1 = dp6Clamp01(Math.min(a.x, b.x), 0, bounds.w);
    const y1 = dp6Clamp01(Math.min(a.y, b.y), 0, bounds.h);
    const x2 = dp6Clamp01(Math.max(a.x, b.x), 0, bounds.w);
    const y2 = dp6Clamp01(Math.max(a.y, b.y), 0, bounds.h);
    return [
      { x: x1, y: y1 }, // tl
      { x: x2, y: y1 }, // tr
      { x: x2, y: y2 }, // br
      { x: x1, y: y2 }, // bl
    ];
  }

  function dp6ClampPointToBounds(p, bounds) {
    return {
      x: dp6Clamp01(p.x, 0, bounds.w),
      y: dp6Clamp01(p.y, 0, bounds.h),
    };
  }

  function dp6EnsureSelectionEditor() {
    if (!workspace) return;
    const img = dp6CropGetActiveImage();
    if (!img) return;

    const struct = dp6CropEnsureWorkspaceStructure();
    if (!struct) return;
    const layer = struct.layer;

    // Remplacer un ancien overlay (si présent) sans laisser de DOM legacy
    const legacyLayer = document.getElementById("dp6-crop-layer");
    if (legacyLayer && legacyLayer.parentNode) {
      try { legacyLayer.parentNode.removeChild(legacyLayer); } catch (_) {}
    }

    // SVG (créé/assuré)
    let svg = layer.querySelector("svg#dp6-selection-svg");
    if (!svg) {
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.id = "dp6-selection-svg";
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "100%");
      svg.style.display = "block";
      svg.style.overflow = "visible";
      svg.style.pointerEvents = "auto";
      layer.innerHTML = "";
      layer.appendChild(svg);
    }

    let poly = svg.querySelector("#dp6-selection-poly");
    if (!poly) {
      poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      poly.id = "dp6-selection-poly";
      poly.style.cursor = "move";
      poly.style.pointerEvents = "all";
      svg.appendChild(poly);
    }
    // DP6 UX : contour visible UNIQUEMENT quand zone active, couleur premium.
    // Aucun bleu, aucune bordure hors sélection.
    poly.setAttribute("fill", "rgba(0,0,0,0)");
    poly.setAttribute("stroke", "#C39847");
    poly.setAttribute("stroke-width", "2");
    try { poly.removeAttribute("stroke-dasharray"); } catch (_) {}

    const HANDLE_R = 7;
    const handles = [];
    for (let i = 0; i < 4; i++) {
      let c = svg.querySelector(`circle.dp6-handle[data-idx="${i}"]`);
      if (!c) {
        c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        c.classList.add("dp6-handle");
        c.dataset.idx = String(i);
        c.setAttribute("r", String(HANDLE_R));
        c.style.pointerEvents = "all";
        c.style.cursor = "grab";
        svg.appendChild(c);
      }
      c.setAttribute("r", String(HANDLE_R));
      c.setAttribute("fill", "rgba(255,255,255,0.98)");
      c.setAttribute("stroke", "#C39847");
      c.setAttribute("stroke-width", "2");
      handles.push(c);
    }

    function dp6UpdateActivePatchFromPoints(nextPoints) {
      const idx = dp6GetActivePatchIndex();
      if (idx == null) return false;
      const patches = dp6EnsurePatchState();
      if (!Array.isArray(patches) || idx < 0 || idx >= patches.length) return false;
      const next = (nextPoints || []).slice(0, 4).map((p) => ({
        x: +Number(p?.x || 0).toFixed(2),
        y: +Number(p?.y || 0).toFixed(2),
      }));
      const prev = patches[idx] && typeof patches[idx] === "object" ? patches[idx] : {};
      patches[idx] = { ...prev, points: next };
      return true;
    }

    function getBounds() {
      const br = layer.getBoundingClientRect();
      const s = dp6View && typeof dp6View.scale === "number" ? dp6View.scale : 1;
      return { w: br.width / s, h: br.height / s };
    }

    function render(points) {
      const pts = Array.isArray(points) && points.length === 4 ? points : null;
      if (!pts) {
        poly.style.display = "none";
        handles.forEach((h) => (h.style.display = "none"));
        return;
      }
      poly.style.display = "block";
      const polyStr = pts.map((p) => `${p.x},${p.y}`).join(" ");
      poly.setAttribute("points", polyStr);
      handles.forEach((h, idx) => {
        const p = pts[idx];
        h.style.display = "block";
        h.setAttribute("cx", String(p.x));
        h.setAttribute("cy", String(p.y));
      });
    }

    // Align overlay à l'image + re-render
    const doAlign = () => {
      dp6CropAlignLayerToImage(layer, img);
      const { w, h } = getBounds();
      svg.setAttribute("viewBox", `0 0 ${Math.max(1, w)} ${Math.max(1, h)}`);

      const pts = dp6CropGetSelection();
      if (pts) {
        const clamped = pts.map((p) => dp6ClampPointToBounds(p, { w, h }));
        dp6CropSetSelection(clamped);
        render(clamped);
      } else {
        render(null);
      }
    };

    // Canvas: pas d'évènement "load" fiable -> align immédiat (après layout)
    requestAnimationFrame(doAlign);

    if (!window.DP6_STATE._dp6CropResizeBound) {
      window.DP6_STATE._dp6CropResizeBound = true;
      window.addEventListener("resize", () => {
        const img2 = dp6CropGetActiveImage();
        const struct2 = dp6CropEnsureWorkspaceStructure();
        const layer2 = struct2?.layer;
        const svg2 = layer2 ? layer2.querySelector("svg#dp6-selection-svg") : null;
        if (!img2 || !layer2 || !svg2) return;

        dp6CropAlignLayerToImage(layer2, img2);
        const r2 = layer2.getBoundingClientRect();
        const s2 = dp6View && typeof dp6View.scale === "number" ? dp6View.scale : 1;
        const w2 = r2.width / s2;
        const h2 = r2.height / s2;
        svg2.setAttribute("viewBox", `0 0 ${Math.max(1, w2)} ${Math.max(1, h2)}`);

        const pts2 = dp6CropGetSelection();
        if (pts2) {
          const bounds2 = { w: w2, h: h2 };
          const clamped2 = pts2.map((p) => dp6ClampPointToBounds(p, bounds2));
          dp6CropSetSelection(clamped2);
          render(clamped2);
        } else {
          render(null);
        }
        try { renderDP6Canvas(); } catch (_) {}
      });
    }

    // Bind interactions (sur l'overlay seulement) — une seule fois
    if (layer.dataset.bound === "1") return;
    layer.dataset.bound = "1";

    let active = null;
    let prevUserSelect = "";

    function beginInteraction() {
      prevUserSelect = document.body.style.userSelect || "";
      document.body.style.userSelect = "none";
    }
    function endInteraction() {
      document.body.style.userSelect = prevUserSelect;
      active = null;
    }

    function onDocMove(e) {
      if (!active) return;
      if (active.type === "pan") {
        // PAN visuel : on déplace le stage (ne modifie aucune coordonnée de sélection)
        const dx = e.clientX - active.startClient.x;
        const dy = e.clientY - active.startClient.y;
        dp6View.tx = active.startTx + dx;
        dp6View.ty = active.startTy + dy;
        try { dp6ApplyViewTransform(); } catch (_) {}
        try { e.preventDefault(); } catch (_) {}
        return;
      }
      const p = dp6CropGetLayerPointFromEvent(layer, e);
      const { w, h } = getBounds();
      const bounds = { w, h };

      if (active.type === "draw") {
        const next = dp6PointsFromDraw(active.startMouse, p, bounds);
        dp6CropSetSelection(next); // mise à jour live obligatoire
        render(next);
        return;
      }

      if (active.type === "translate") {
        const startPts = active.startPoints;
        const dx0 = p.x - active.startMouse.x;
        const dy0 = p.y - active.startMouse.y;
        const b = dp6PointsBounds(startPts);
        if (!b) return;

        // Clamp translation (sans déformation): on limite le delta pour garder tous les points dans l'image
        const dx = dp6Clamp01(dx0, -b.minX, bounds.w - b.maxX);
        const dy = dp6Clamp01(dy0, -b.minY, bounds.h - b.maxY);

        const next = startPts.map((pt) => ({ x: pt.x + dx, y: pt.y + dy }));
        // Mise à jour live : panneau bouge en temps réel (patch) + overlay (sélection)
        dp6UpdateActivePatchFromPoints(next);
        dp6CropSetSelection(next);
        render(next);
        return;
      }

      if (active.type === "handle") {
        const startPts = active.startPoints;
        const dx = p.x - active.startMouse.x;
        const dy = p.y - active.startMouse.y;
        const idx = active.idx;
        const next = startPts.map((pt) => ({ x: pt.x, y: pt.y }));
        next[idx] = dp6ClampPointToBounds({ x: startPts[idx].x + dx, y: startPts[idx].y + dy }, bounds);
        // Mise à jour live : panneau bouge en temps réel (patch) + overlay (sélection)
        dp6UpdateActivePatchFromPoints(next);
        dp6CropSetSelection(next);
        render(next);
      }
    }

    function onDocUp(e) {
      if (!active) return;
      if (active.type === "pan") {
        endInteraction();
        document.removeEventListener("mousemove", onDocMove, true);
        document.removeEventListener("mouseup", onDocUp, true);
        return;
      }
      const endP = dp6CropGetLayerPointFromEvent(layer, e);
      const { w, h } = getBounds();

      if (active.type === "draw") {
        const moved = Math.max(Math.abs(endP.x - active.startMouse.x), Math.abs(endP.y - active.startMouse.y));
        if (moved <= DP6_CROP_CLICK_TOL) {
          dp6CropClearSelection();
          render(null);
          try { dp6SetActivePatchIndex(null); } catch (_) {}
        } else {
          // Auto-création + auto-validation : une zone dessinée devient immédiatement un patch.
          // Elle devient inactive à la fin (aucun contour).
          try { dp6ValidateActiveSelectionAsPatch(); } catch (_) {}
          render(null);
        }
      }

      endInteraction();
      document.removeEventListener("mousemove", onDocMove, true);
      document.removeEventListener("mouseup", onDocUp, true);
    }

    layer.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (!dp6CropGetActiveImage()) return; // garde-fou beforeImage

      const t = e.target;
      const p = dp6CropGetLayerPointFromEvent(layer, e);
      const pts = dp6CropGetSelection();

      const isHandle = t && t.classList && t.classList.contains("dp6-handle");
      const isPoly = t && (t.id === "dp6-selection-poly" || t.closest?.("#dp6-selection-poly"));

      // PAN (visuel) — actif uniquement si zoom > 1
      // - Ne doit pas casser l'édition (poignées/polygone) ni la sélection de patch en mode EDIT.
      // - Astuce UX : en mode DRAW, maintenir SHIFT pour forcer le dessin même si zoomé.
      if ((dp6View?.scale || 1) > 1.000001 && !isHandle && !(isPoly && pts)) {
        // PAN (visuel) — actif uniquement si zoom > 1.
        // SHIFT = forcer le dessin même si zoomé.
        if (!e.shiftKey) {
          // Si clic sur un patch existant, on préfère activer la zone plutôt que panner.
          const hitIdx = dp6PickPatchIndexAtPoint(p, 10);
          const patches = dp6EnsurePatchState();
          if (!(hitIdx != null && hitIdx >= 0 && hitIdx < patches.length)) {
            e.preventDefault();
            beginInteraction();
            active = { type: "pan", startClient: { x: e.clientX, y: e.clientY }, startTx: dp6View.tx, startTy: dp6View.ty };
            document.addEventListener("mousemove", onDocMove, true);
            document.addEventListener("mouseup", onDocUp, true);
            return;
          }
          // sinon: laisser le flux normal activer la zone
        }
      }

      // Clic sur une zone existante (activation directe)
      if (!(isHandle && pts) && !(isPoly && pts)) {
        const hitIdx = dp6PickPatchIndexAtPoint(p, 10);
        const patches = dp6EnsurePatchState();
        if (hitIdx != null && hitIdx >= 0 && hitIdx < patches.length) {
          e.preventDefault();
          dp6SetActivePatchIndex(hitIdx);
          const q = dp6NormalizeQuadPoints(patches[hitIdx]?.points);
          if (q) {
            const { w, h } = getBounds();
            const clamped = q.map((pt) => dp6ClampPointToBounds(pt, { w, h }));
            dp6CropSetSelection(clamped);
            render(clamped);
          } else {
            dp6CropClearSelection();
            render(null);
          }
          try { renderDP6Canvas(); } catch (_) {}
          try { dp6SyncValidateButtonUI(); } catch (_) {}
          return;
        }
        // Clic hors zone : on désactive (et un éventuel drag dessinera une nouvelle zone).
        try { dp6SetActivePatchIndex(null); } catch (_) {}
        try { dp6CropClearSelection(); } catch (_) {}
        try { render(null); } catch (_) {}
        try { dp6SyncValidateButtonUI(); } catch (_) {}
      }

      if (isHandle && pts) {
        const idx = Number(t.dataset.idx);
        if (!Number.isFinite(idx) || idx < 0 || idx > 3) return;
        e.preventDefault();
        e.stopPropagation();
        beginInteraction();
        active = { type: "handle", idx, startMouse: p, startPoints: pts };
        document.addEventListener("mousemove", onDocMove, true);
        document.addEventListener("mouseup", onDocUp, true);
        return;
      }

      if (isPoly && pts) {
        e.preventDefault();
        beginInteraction();
        active = { type: "translate", startMouse: p, startPoints: pts };
        document.addEventListener("mousemove", onDocMove, true);
        document.addEventListener("mouseup", onDocUp, true);
        return;
      }

      // Dessin d'une nouvelle sélection (rectangle initial), puis coins indépendants ensuite
      e.preventDefault();
      beginInteraction();
      active = { type: "draw", startMouse: p };
      document.addEventListener("mousemove", onDocMove, true);
      document.addEventListener("mouseup", onDocUp, true);
    });
  }

  // Google Street View (DP6) : instance temporaire (aucune persistance)
  let dp6Panorama = null;
  let dp6StreetHost = null;

  function dp6SetSourceMessage(text) {
    // Message UX (simple, robuste) affiché dans la colonne gauche
    // - Street View = positionnement uniquement
    // - Capture = manuelle (outil OS), puis import
    const aside = modal ? modal.querySelector(".dp-map-help") : null;
    if (!aside) return;
    let box = aside.querySelector("#dp6-source-message");
    if (!box) {
      box = document.createElement("div");
      box.id = "dp6-source-message";
      box.className = "dp-hint";
      box.style.marginTop = "10px";
      // Insertion après les boutons (avant le <hr>)
      const actions = aside.querySelector(".dp-page-actions");
      if (actions && actions.parentNode) actions.parentNode.insertBefore(box, actions.nextSibling);
      else aside.appendChild(box);
    }
    box.textContent = String(text || "");
  }

  function dp6DisplayImportedImage(dataURL, altText) {
    if (!workspace || !dataURL) return;

    // Si une vue Google est active, la détruire avant affichage image
    try { dp6DestroyGoogleView(); } catch (_) {}

    // Stockage attendu : source importée (photo OU capture manuelle)
    // - sourceImage : image d'origine importée (référence)
    // - beforeImage : image figée sur laquelle on travaille (sélection zone panneaux)
    try {
      window.DP6_STATE = window.DP6_STATE || {};
      window.DP6_STATE.sourceImage = String(dataURL);
      window.DP6_STATE.beforeImage = String(dataURL);
      // Changer la photo invalide forcément les patches + le rendu après
      window.DP6_STATE.patches = [];
      window.DP6_STATE.afterImage = "";
      window.DP6_STATE.selectionUIMode = DP6_SELECTION_UI_MODE_DRAW;
      window.DP6_STATE.activePatchIndex = null;
      try { dp6CropClearSelection(); } catch (_) {}
    } catch (_) {}

    const struct = dp6CropEnsureWorkspaceStructure();
    if (!struct) return;
    // Nouvelle image => repartir sur une vue neutre
    try { dp6ResetView(); } catch (_) {}
    // Rendu strict: image + panneaux sur un SEUL canvas
    dp6EnsureWorkspaceCanvas();
    try {
      const canvas = struct.content.querySelector(`#${DP6_CANVAS_ID}`);
      if (canvas) {
        canvas.style.display = "block";
        canvas.dataset.dp6Before = String(window.DP6_STATE?.beforeImage || "");
        canvas.setAttribute("aria-label", altText || "Image source DP6");
        // Nettoyer la zone (StreetView / legacy) sans supprimer le canvas
        Array.from(struct.content.children || []).forEach((ch) => {
          if (ch !== canvas) {
            try { ch.parentNode && ch.parentNode.removeChild(ch); } catch (_) {}
          }
        });
      }
    } catch (_) {}

    try { renderDP6Canvas(); } catch (_) {}
    try { dp6EnsureSelectionEditor(); } catch (_) {}

    // Après import, la source est considérée comme validée -> suite du workflow activée
    dp6SyncValidateButtonUI();
    dp6RenderEntryMiniatures();
  }

  function dp6DestroyGoogleView() {
    // Nettoyage strict : listeners + références + DOM
    const ev = window.google?.maps?.event;
    if (ev?.clearInstanceListeners) {
      try { if (dp6Panorama) ev.clearInstanceListeners(dp6Panorama); } catch (_) {}
    }
    try {
      if (dp6Panorama?.setVisible) dp6Panorama.setVisible(false);
    } catch (_) {}
    dp6Panorama = null;
    try {
      if (dp6StreetHost && dp6StreetHost.parentNode) dp6StreetHost.parentNode.removeChild(dp6StreetHost);
    } catch (_) {}
    dp6StreetHost = null;
    // Restaurer l'affichage du canvas si présent
    try {
      const c = workspace ? workspace.querySelector(`#${DP6_CANVAS_ID}`) : null;
      if (c) c.style.display = "block";
    } catch (_) {}
  }

  async function openDP6StreetView() {
    if (!workspace) return;
    // StreetView : éviter un stage déjà zoomé/panné (sinon UX bizarre)
    try { dp6ResetView(); } catch (_) {}

    const struct = dp6CropEnsureWorkspaceStructure();
    if (!struct) return;
    // StreetView : garder le canvas existant (ne jamais le supprimer du DOM)
    const canvas = dp6EnsureWorkspaceCanvas();
    if (canvas) canvas.style.display = "none";
    try {
      Array.from(struct.content.children || []).forEach((ch) => {
        if (ch !== canvas) {
          try { ch.parentNode && ch.parentNode.removeChild(ch); } catch (_) {}
        }
      });
    } catch (_) {}
    try { struct.layer.style.width = "0px"; struct.layer.style.height = "0px"; } catch (_) {}

    dp6SetSourceMessage(
      "Positionnez-vous correctement, puis faites une capture écran avec l’outil système et importez-la."
    );

    const host = document.createElement("div");
    host.id = "dp6-streetview";
    host.style.width = "100%";
    host.style.height = "100%";
    host.style.flex = "1";
    host.style.position = "relative";
    dp6StreetHost = host;
    struct.content.appendChild(host);

    await dpLoadGoogleMapsJsOnce();

    const { center } = dpGetProjectCenterForGoogleMaps();

    requestAnimationFrame(() => {
      const panorama = new google.maps.StreetViewPanorama(host, {
        position: center,
        pov: { heading: 0, pitch: 0 },
        zoom: 1,
        addressControl: false,
        linksControl: true,
        panControl: true,
        enableCloseButton: false,
        fullscreenControl: false,
      });
      dp6Panorama = panorama;
      try { google.maps.event.trigger(panorama, "resize"); } catch (_) {}
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try { google.maps.event.trigger(panorama, "resize"); } catch (_) {}
        });
      });
    });
  }

  // Input file créé une seule fois (invisible)
  let fileInput = document.getElementById("dp6-file-input");
  if (!fileInput) {
    fileInput = document.createElement("input");
    fileInput.id = "dp6-file-input";
    fileInput.type = "file";
    fileInput.accept = "image/jpeg,image/png";
    fileInput.style.display = "none";
    document.body.appendChild(fileInput);
  }

  // Binding bouton "Importer une photo"
  if (uploadBtn) {
    uploadBtn.addEventListener("click", () => {
      // Permet de re-sélectionner le même fichier
      fileInput.value = "";
      fileInput.click();
    });
  }

  // Binding bouton "Utiliser Google Street View"
  if (streetBtn) {
    streetBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      await openDP6StreetView();
    });
  }

  // Zoom UI
  if (zoomInBtn && zoomInBtn.dataset.bound !== "1") {
    zoomInBtn.dataset.bound = "1";
    zoomInBtn.addEventListener("click", (e) => {
      e.preventDefault();
      dp6NudgeScale(+0.2);
    });
  }
  if (zoomOutBtn && zoomOutBtn.dataset.bound !== "1") {
    zoomOutBtn.dataset.bound = "1";
    zoomOutBtn.addEventListener("click", (e) => {
      e.preventDefault();
      dp6NudgeScale(-0.2);
    });
  }
  if (zoomResetBtn && zoomResetBtn.dataset.bound !== "1") {
    zoomResetBtn.dataset.bound = "1";
    zoomResetBtn.addEventListener("click", (e) => {
      e.preventDefault();
      dp6ResetView();
    });
  }
  try { dp6UpdateZoomLabel(); } catch (_) {}

  // Zoom molette (sur la zone de travail) — visuel uniquement
  if (workspace && workspace.dataset.dp6WheelBound !== "1") {
    workspace.dataset.dp6WheelBound = "1";
    workspace.addEventListener(
      "wheel",
      (e) => {
        // Actif uniquement lorsque le modal est ouvert + une image est présente
        if (!modal || modal.getAttribute("aria-hidden") === "true") return;
        if (!dp6HasSourceImage()) return;
        try { e.preventDefault(); } catch (_) {}

        const dy = typeof e.deltaY === "number" ? e.deltaY : 0;
        // Zoom fluide : multiplicatif
        const factor = dy < 0 ? 1.12 : 1 / 1.12;
        dp6SetScaleAtClientPoint(dp6View.scale * factor, e.clientX, e.clientY);
      },
      { passive: false }
    );
  }

  // Gestion sélection fichier
  if (fileInput.dataset.bound !== "1") {
    fileInput.dataset.bound = "1";
    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;

      // Sécurité: ne traiter que jpeg/png
      if (file.type !== "image/jpeg" && file.type !== "image/png") return;

      const reader = new FileReader();
      reader.onload = () => {
        if (!workspace) return;

        dp6DisplayImportedImage(reader.result, "Photo source DP6");
      };

      reader.readAsDataURL(file);
    });
  }

  const bindHost = btnBefore || btnAfter;
  if (bindHost.dataset.bound === "1") return;
  bindHost.dataset.bound = "1";

  function openDP6Modal() {
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("dp-lock-scroll");
    // Par défaut, ré-ouvrir au zoom 100% (évite des surprises)
    try { dp6ResetView(); } catch (_) {}
    // UX : ne jamais ré-ouvrir un modal directement en mode édition
    try {
      const wasEdit = dp6GetSelectionUIMode() === DP6_SELECTION_UI_MODE_EDIT;
      dp6SetSelectionUIMode(DP6_SELECTION_UI_MODE_DRAW);
      dp6SetActivePatchIndex(null);
      if (wasEdit) {
        // Empêche une validation accidentelle (double patch) si l'utilisateur quitte l'édition sans re-valider
        try { dp6CropClearSelection(); } catch (_) {}
      }
    } catch (_) {}
    // Si une image est déjà présente (ré-ouverture), ré-assurer l'overlay.
    try {
      requestAnimationFrame(() => {
        try { renderDP6Canvas(); } catch (_) {}
        try { dp6EnsureSelectionEditor(); } catch (_) {}
      });
    } catch (_) {}
    try { dp6SyncValidateButtonUI(); } catch (_) {}
  }

  function closeDP6Modal() {
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("dp-lock-scroll");
    // Nettoyage strict si Street View était ouvert
    try { dp6DestroyGoogleView(); } catch (_) {}
  }

  // Bouton "Valider la sélection" (fige un patch, ne valide pas le projet)
  if (validateSelectionBtn && validateSelectionBtn.dataset.bound !== "1") {
    validateSelectionBtn.dataset.bound = "1";
    validateSelectionBtn.addEventListener("click", (e) => {
      e.preventDefault();
      dp6ValidateActiveSelectionAsPatch();
    });
  }

  // Bouton "Modifier la sélection" (entre en mode édition des patches existants)
  if (editSelectionBtn && editSelectionBtn.dataset.bound !== "1") {
    editSelectionBtn.dataset.bound = "1";
    editSelectionBtn.addEventListener("click", (e) => {
      e.preventDefault();
      dp6EnterEditSelectionMode();
    });
  }

  // Bouton "Re-valider la sélection" (commit l'édition sur le patch actif, puis sortie du mode édition)
  if (revalidateSelectionBtn && revalidateSelectionBtn.dataset.bound !== "1") {
    revalidateSelectionBtn.dataset.bound = "1";
    revalidateSelectionBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const ok = dp6CommitActivePatchEditFromSelection();
      if (!ok) return;
      dp6ExitEditSelectionMode();
    });
  }

  // Bouton "Valider le photomontage" (export du canvas avec TOUS les patches)
  if (validateBtn && validateBtn.dataset.bound !== "1") {
    validateBtn.dataset.bound = "1";
    validateBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      if (!dp6HasSourceImage()) return;
      const patches = Array.isArray(window.DP6_STATE?.patches) ? window.DP6_STATE.patches : [];
      if (!patches.length) return;

      // Garantir un export "final" : ne pas inclure la sélection active
      try { dp6CropClearSelection(); } catch (_) {}
      try { await renderDP6Canvas(); } catch (_) {}

      const canvas = dp6EnsureWorkspaceCanvas();
      if (!canvas) return;
      let out = "";
      try { out = canvas.toDataURL("image/png"); } catch (_) { out = ""; }
      if (!out || !out.startsWith("data:image")) return;

      try {
        window.DP6_STATE = window.DP6_STATE || {};
        window.DP6_STATE.afterImage = out;
      } catch (_) {}

      dp6RenderEntryMiniatures();
      dp6SyncValidateButtonUI();
      closeDP6Modal();
    });
  }

  if (btnBefore) {
    btnBefore.addEventListener("click", (e) => {
      e.preventDefault();
      dp6SetCategory("BEFORE");
      openDP6Modal();
    });
  }

  if (btnAfter) {
    btnAfter.addEventListener("click", (e) => {
      e.preventDefault();
      dp6SetCategory("AFTER");
      openDP6Modal();
    });
  }

  modal.addEventListener("click", (e) => {
    if (
      e.target.closest(".dp-modal-close") ||
      e.target.closest("#dp6-cancel") ||
      e.target.closest(".dp-modal-backdrop")
    ) {
      e.preventDefault();
      closeDP6Modal();
    }
  });

  // Brancher le bouton d’export PDF (présent dans pages/dp6.html)
  try { if (typeof window.bindDP6ExportPdfButton === "function") window.bindDP6ExportPdfButton(); } catch (_) {}

  console.log("[DP6] init ok");
}

// ===============================
// DP6 — EXPORT PDF
// ===============================
window.bindDP6ExportPdfButton = window.bindDP6ExportPdfButton || function bindDP6ExportPdfButton() {
  const btn = document.getElementById("dp6-export-pdf");
  if (!btn) return;
  if (btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";

  // Routeur PDF (aligné DP2 / DP4) : un switch/case, pas de logique métier.
  window.generateDPDocumentPDF =
    window.generateDPDocumentPDF ||
    (async function generateDPDocumentPDF({ type, state }) {
      const t = String(type || "");
      if (t === "DP2") return generateDP2PDF();
      if (t === "DP4") return generateDP4PDF();
      if (t === "DP6") return generateDP6PDF(state);
      throw new Error(`Type PDF non supporté: ${t}`);
    });

  async function generateDP6PDF(dp6State) {
    // Enrichir le payload DP6 avec les contextes DP1 + SmartPitch (nécessaires au renderer PDF DP6)
    const st = window.DP6_STATE || {};
    const dp1 = window.DP1_CONTEXT || null;
    const sp = window.SMARTPITCH_CTX || null;
    const cad = window.DP1_STATE?.selectedParcel || null;

    const ref = cad ? [cad.section, cad.numero].filter(Boolean).join(" ").trim() : "";
    const enrichedDP1 = {
      ...(dp1 || {}),
      ref_cadastrale: ref || (dp1?.ref_cadastrale || ""),
      parcelle: cad
        ? { section: cad.section, numero: cad.numero, surface_m2: cad.surface_m2 ?? null }
        : (dp1?.parcelle || null),
    };

    const dp6Data = {
      ...st,
      DP1_CONTEXT: enrichedDP1,
      SMARTPITCH_CTX: sp,
    };

    const res = await fetch("http://localhost:3000/pdf/render/dp6/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dp6Data }),
    });

    if (!res.ok) {
      alert("Erreur PDF DP6");
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");

    const a = document.createElement("a");
    a.href = url;
    a.download = "dp6-insertion-projet.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  btn.addEventListener("click", async (e) => {
    e.preventDefault();

    const st = window.DP6_STATE || null;
    const hasBefore = !!(st && typeof st.beforeImage === "string" && st.beforeImage.startsWith("data:image"));
    const hasAfter = !!(st && typeof st.afterImage === "string" && st.afterImage.startsWith("data:image"));
    if (!hasBefore || !hasAfter) {
      alert("DP6 : images AVANT et APRÈS requises pour l’export PDF");
      return;
    }

    try {
      await window.generateDPDocumentPDF({
        type: "DP6",
        state: st,
      });
    } catch (err) {
      alert("Erreur lors de la génération du PDF DP6 (backend indisponible ou données invalides).");
    }
  });
};

// ===============================
// DP7 — EXPORT PDF (ALIGNÉ DP2/DP4/DP6)
// ===============================
window.bindDP7ExportPdfButton = window.bindDP7ExportPdfButton || function bindDP7ExportPdfButton() {
  const btn = document.getElementById("dp7-export-pdf");
  if (!btn) return;
  if (btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";

  async function generateDP7PDF() {
    const st = window.DP7_STATE || {};
    const cad = window.DP1_STATE?.selectedParcel;

    const finalImg = st.finalImage;
    if (!(typeof finalImg === "string" && finalImg.startsWith("data:image"))) {
      alert("DP7 : validez d’abord l’implantation (image finale requise) avant l’export PDF.");
      return;
    }

    const dp7Data = {
      client: buildPdfClientFromDP1Context(),
      parcelle: {
        numero: cad ? [cad.section, cad.numero].filter(Boolean).join(" ") : "—",
        surface_m2: cad?.surface_m2 ?? null,
      },
      images: {
        final: finalImg,
      },
    };

    const res = await fetch("http://localhost:3000/pdf/render/dp7/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dp7Data }),
    });

    if (!res.ok) {
      alert("Erreur PDF DP7");
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");

    const a = document.createElement("a");
    a.href = url;
    a.download = "DP7 - Environnement proche.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await generateDP7PDF();
    } catch (err) {
      alert("Erreur lors de la génération du PDF DP7 (backend indisponible ou données invalides).");
    }
  });
};

// ===============================
// DP8 — EXPORT PDF (ALIAS STRICT DP7 : même payload / même moteur)
// ===============================
window.bindDP8ExportPdfButton = window.bindDP8ExportPdfButton || function bindDP8ExportPdfButton() {
  const btn = document.getElementById("dp8-export-pdf");
  if (!btn) return;
  if (btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";

  async function generateDP8PDF() {
    const st = window.DP8_STATE || {};
    const cad = window.DP1_STATE?.selectedParcel;

    const finalImg = st.finalImage;
    if (!(typeof finalImg === "string" && finalImg.startsWith("data:image"))) {
      alert("DP8 : validez d’abord l’implantation (image finale requise) avant l’export PDF.");
      return;
    }

    // Payload STRICTEMENT identique à DP7 (seule la route change)
    const dp8Data = {
      client: buildPdfClientFromDP1Context(),
      parcelle: {
        numero: cad ? [cad.section, cad.numero].filter(Boolean).join(" ") : "—",
        surface_m2: cad?.surface_m2 ?? null,
      },
      images: {
        final: finalImg,
      },
    };

    const res = await fetch("http://localhost:3000/pdf/render/dp8/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dp8Data }),
    });

    if (!res.ok) {
      alert("Erreur PDF DP8");
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");

    const a = document.createElement("a");
    a.href = url;
    a.download = window.DP8_EXPORT_FILENAME || "DP8 - Environnement lointain.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await generateDP8PDF();
    } catch (err) {
      alert("Erreur lors de la génération du PDF DP8 (backend indisponible ou données invalides).");
    }
  });
};
