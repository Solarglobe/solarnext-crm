// Extracted from dp-app.js. Loaded after dp-app.js in legacy script order.
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
  energyManagement: "",
  /**
   * Cases urbanisme CERFA (triplets oui / non / non concerné). Valeurs : 'oui' | 'non' | 'nc'.
   * null / undefined = ne cocher aucune case de la ligne (pas de supposition métier).
   */
  urbanismeCU: null,
  urbanismeLot: null,
  urbanismeZAC: null,
  urbanismeAFU: null,
  urbanismePUP: null,
  /** '' | 'new' | 'existing' — C2ZA1_nouvelle vs C2ZB1_existante (exclusifs). */
  constructionType: "",
  /** '' | 'personnel' | 'vente' | 'location' — occupation du déclarant. */
  occupationMode: "",
  /** '' | 'principale' | 'secondaire' — résidence concernée. */
  residenceType: "",
  /** true = case D5A (contact email) cochée ; ne pas activer sans consentement explicite. */
  declarantAcceptEmailContact: false,
  /** Surcharge explicite pour case « toiture » (X1V) ; sinon dérivé de roofOrientation. */
  installationOnRoof: null
};

/** Sections général / DP5 — persistance unifiée (state_json) ; pas d’UI dédiée pour l’instant. */
window.DP_GENERAL_STATE = window.DP_GENERAL_STATE || {};
window.DP5_STATE = window.DP5_STATE || {};

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

function cerfaIsDebugMode() {
  try {
    if (typeof window !== "undefined" && window.localStorage && window.localStorage.getItem("SOLARNEXT_CERFA_DEBUG") === "1") {
      return true;
    }
    if (typeof window !== "undefined" && /\bcerfaDebug=1\b/.test(String(window.location && window.location.search))) {
      return true;
    }
  } catch (_) {}
  return false;
}

/**
 * Date de signature CERFA : format JJ/MM/AAAA (lisible, attendu sur formulaires français).
 * @param {Date} [d]
 * @returns {string}
 */
function formatDateCerfa(d) {
  const x = d instanceof Date && !isNaN(d.getTime()) ? d : new Date();
  const dd = String(x.getDate()).padStart(2, "0");
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const yyyy = String(x.getFullYear());
  return dd + "/" + mm + "/" + yyyy;
}

/**
 * Puissance kWc : virgule décimale, sans zéros superflus (ex. 3, 3,5 et non 3.00).
 * @param {number} kwc
 * @returns {string}
 */
function formatPowerCerfa(kwc) {
  const n = Number(kwc);
  if (!Number.isFinite(n) || n < 0) return "";
  const rounded = Math.round(n * 1000) / 1000;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return String(Math.round(rounded));
  const s = rounded.toFixed(3).replace(/\.?0+$/, "");
  return s.replace(".", ",");
}

/**
 * Téléphone affichage CERFA : national FR 0X XX XX XX XX si possible ; indicatif séparé.
 * @param {string} raw
 * @returns {{ national: string, indicatif: string, hadInput: boolean }}
 */
function formatPhoneCerfa(raw) {
  const hadInput = raw != null && String(raw).trim() !== "";
  let digits = String(raw || "").replace(/[^\d+]/g, "");
  let indicatif = "33";
  if (digits.startsWith("+33")) {
    digits = "0" + digits.slice(3);
  } else if (digits.startsWith("0033")) {
    digits = "0" + digits.slice(4);
  }
  digits = digits.replace(/\D/g, "");
  if (digits.startsWith("33") && digits.length >= 10) {
    digits = "0" + digits.slice(2);
  }
  if (digits.length === 9 && !digits.startsWith("0")) {
    digits = "0" + digits;
  }
  let national = "";
  if (digits.length >= 10 && digits.startsWith("0")) {
    national = digits.slice(0, 10);
  } else if (digits.length > 0) {
    national = digits;
  }
  return { national, indicatif, hadInput };
}

/**
 * Découpage adresse française : première unité si elle ressemble à un numéro de voirie, sinon tout en voie.
 * Gère les adresses sans numéro en tête (ex. « Rue de la Paix » → voie complète, numéro vide).
 * @param {string} line
 * @returns {{ numeroVoie: string, voie: string }}
 */
function parseFrenchAddressLine(line) {
  const full = String(line || "").trim().replace(/\s+/g, " ");
  if (!full) return { numeroVoie: "", voie: "" };
  const m = full.match(
    /^(\d{1,4}(?:\s*[A-Za-z])?(?:\s*(?:bis|ter|quater))?)\s+(.+)$/i
  );
  if (m) {
    return { numeroVoie: m[1].replace(/\s+/g, " ").trim(), voie: m[2].trim() };
  }
  return { numeroVoie: "", voie: full };
}

function truncateForField(str, max) {
  const s = String(str || "");
  if (!max || s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

function normalizeScalarForPdf(value, opts) {
  const allowZero = opts && opts.allowZero;
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    if (allowZero && value === 0) return "0";
    if (!allowZero && value === 0) return "";
    return String(value);
  }
  let s = String(value).trim();
  if (!s || /^undefined$/i.test(s) || /^null$/i.test(s) || s === "[object Object]") return "";
  return s.replace(/\s+/g, " ").trim();
}

function createCerfaFillReport() {
  return {
    filled: [],
    skippedOptional: [],
    missingRequired: [],
    fieldErrors: [],
    warnings: [],
    checkboxesApplied: [],
    checkboxesSkipped: []
  };
}

var CERFA_TEXT_FONT = {
  short: 10,
  medium: 9,
  street: 8.5,
  multiline: 7,
  tiny: 8
};

/**
 * Description CERFA : uniquement à partir de l’objet d’état (aucune lecture DOM).
 * @param {object} cerfaState
 * @returns {string}
 */
function buildCerfaDescriptionText(cerfaState) {
  const S = cerfaState && typeof cerfaState === "object" ? cerfaState : {};
  const safe = (v) => {
    if (v === undefined || v === null) return "";
    const t = String(v).trim();
    if (!t || /^undefined$/i.test(t) || /^null$/i.test(t)) return "";
    return t;
  };

  const panelCount = safe(S.panelCount);
  const panelPower = safe(S.panelPower);
  const panelWidth = safe(S.panelWidth);
  const panelHeight = safe(S.panelHeight);
  const panelThickness = safe(S.panelDepth);
  const columnsCount = safe(S.columnsCount);
  const panelsPerRow = safe(S.panelsPerRow);
  const roofOrientation = safe(S.roofOrientation);
  const panelBrand = safe(S.brand);
  const panelColor = safe(S.color);

  const orientationFr =
    S.panelOrientation === "landscape" || S.panelOrientation === "paysage" || normOrientation(S.panelOrientation) === "paysage"
      ? "paysage"
      : S.panelOrientation || normOrientation(S.panelOrientation)
        ? "portrait"
        : "";

  const phrases = [];

  if (panelCount && panelPower) {
    let p =
      "Pose de " +
      panelCount +
      " panneau(x) solaire(s) photovoltaïque(s) d’une puissance unitaire de " +
      panelPower +
      " Wc";
    if (panelWidth && panelHeight && panelThickness) {
      p += ", de dimensions " + panelWidth + " × " + panelHeight + " × " + panelThickness + " mm";
    }
    phrases.push(p + ".");
  } else if (panelCount || panelPower) {
    phrases.push(
      "Installation photovoltaïque : compléter le nombre de modules et/ou la puissance unitaire (Wc) pour une description conforme."
    );
  }

  if (columnsCount && panelsPerRow) {
    let d =
      "Disposition : " +
      columnsCount +
      " colonne(s), " +
      panelsPerRow +
      " panneau(x) par ligne";
    if (orientationFr) d += ", modules en " + orientationFr;
    phrases.push(d + ".");
  }

  if (roofOrientation) {
    phrases.push("Orientation du pan de toit : " + roofOrientation + ".");
  }

  if (panelBrand || panelColor) {
    const bits = [];
    if (panelBrand) bits.push("marque " + panelBrand);
    if (panelColor) bits.push("couleur " + panelColor);
    phrases.push("Modules : " + bits.join(", ") + ", traitement anti-reflet.");
  }

  return phrases.join("\n").trim();
}

function generateCerfaDescription() {
  const text = buildCerfaDescriptionText(window.CERFA_STATE || {});
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

  if (S.constructionType === undefined || S.constructionType === null) S.constructionType = "";
  if (S.occupationMode === undefined || S.occupationMode === null) S.occupationMode = "";
  if (S.residenceType === undefined || S.residenceType === null) S.residenceType = "";
  if (S.declarantAcceptEmailContact === undefined) S.declarantAcceptEmailContact = false;

  bindToggleGroup(
    ["cerfa-construction-unset", "cerfa-construction-existing", "cerfa-construction-new"],
    "constructionType"
  );
  bindToggleGroup(
    ["cerfa-occupation-unset", "cerfa-occupation-personnel", "cerfa-occupation-vente", "cerfa-occupation-location"],
    "occupationMode"
  );
  bindToggleGroup(
    ["cerfa-residence-unset", "cerfa-residence-main", "cerfa-residence-sec"],
    "residenceType"
  );

  const consentEl = document.getElementById("cerfa-email-consent");
  if (consentEl) {
    consentEl.checked = S.declarantAcceptEmailContact === true;
    consentEl.addEventListener("change", function () {
      S.declarantAcceptEmailContact = !!consentEl.checked;
      cerfaLogState();
    });
  }

  const btnGenerate = document.getElementById("cerfa-btn-generate-description");
  if (btnGenerate) btnGenerate.addEventListener("click", generateCerfaDescription);

  const btnCreatePdf = document.getElementById("cerfa-btn-create-pdf");
  if (btnCreatePdf) btnCreatePdf.addEventListener("click", createCerfaPdf);
}

// ======================================================
// CERFA — Création PDF prérempli (frontend uniquement, pdf-lib)
// ======================================================
async function loadPdf() {
  const res = await fetch(__solarnextDpResolveAssetUrl("photos/cerfa_16702-02.pdf"), { cache: "no-store" });
  if (!res.ok) throw new Error("Impossible de charger le PDF CERFA");
  return res.arrayBuffer();
}

/**
 * Normalise une réponse urbanisme CERFA (oui | non | nc).
 * @param {unknown} val
 * @returns {'oui'|'non'|'nc'|''}
 */
function normOuiNonNc(val) {
  const v = val != null ? String(val).trim().toLowerCase() : "";
  if (v === "oui" || v === "o" || v === "yes" || v === "true") return "oui";
  if (v === "non" || v === "n" || v === "no" || v === "false") return "non";
  if (v === "nc" || v === "n/c" || v === "na" || v === "n.a." || v === "non concerné" || v === "non concerne") {
    return "nc";
  }
  return "";
}

/**
 * Remplissage CERFA + rapport structuré (champs remplis, manquants, cases, erreurs PDF).
 * @returns {ReturnType<typeof createCerfaFillReport>}
 */
function fillCerfaFields(pdfDoc, state, descriptionText, options) {
  if (!pdfDoc.getForm) return createCerfaFillReport();
  const form = options?.form ?? pdfDoc.getForm();
  const helveticaFont = options?.helveticaFont;
  const report = options?.report || createCerfaFillReport();
  const cerfaState = options?.cerfaState && typeof options.cerfaState === "object" ? options.cerfaState : {};
  void helveticaFont;

  function applyFontSize(field, category, fieldName) {
    const sz = CERFA_TEXT_FONT[category] || CERFA_TEXT_FONT.medium;
    try {
      field.setFontSize(sz);
    } catch (e) {
      report.warnings.push({ code: "FONT_SIZE_SKIP", field: fieldName, detail: String(e.message || e) });
    }
  }

  function setTextField(name, raw, opts) {
    const required = !!(opts && opts.required);
    const category = (opts && opts.category) || "medium";
    const maxLen = opts && opts.maxLen;
    const allowZero = !!(opts && opts.allowZero);
    let text = normalizeScalarForPdf(raw, { allowZero });
    if (!text && (raw === 0 || raw === "0") && allowZero) text = "0";
    if (!text) {
      if (required) report.missingRequired.push({ name, detail: "valeur vide" });
      else report.skippedOptional.push({ name });
      return;
    }
    if (maxLen) text = truncateForField(text, maxLen);
    try {
      const field = form.getTextField(name);
      applyFontSize(field, category, name);
      field.setText(text);
      report.filled.push({ name });
    } catch (err) {
      report.fieldErrors.push({ name, message: err.message || String(err) });
    }
  }

  function setDescriptionMultiline(text) {
    const body = normalizeScalarForPdf(text, {});
    if (!body) {
      report.missingRequired.push({ name: "C2ZD1_description", detail: "description vide" });
      return;
    }
    try {
      const descField = form.getTextField("C2ZD1_description");
      descField.enableMultiline();
      applyFontSize(descField, "multiline", "C2ZD1_description");
      descField.setText(truncateForField(body, 8000));
      report.filled.push({ name: "C2ZD1_description" });
    } catch (err) {
      report.fieldErrors.push({ name: "C2ZD1_description", message: err.message || String(err) });
    }
  }

  function checkTripletOUINONNC(map, rawValue, label) {
    const v = normOuiNonNc(rawValue);
    if (!v || !map[v]) {
      report.checkboxesSkipped.push({ group: label, reason: "aucune valeur métier (oui|non|nc)" });
      return;
    }
    const fieldName = map[v];
    try {
      form.getCheckBox(fieldName).check();
      report.checkboxesApplied.push(fieldName);
    } catch (err) {
      report.fieldErrors.push({ name: fieldName, message: err.message || String(err) });
    }
  }

  function checkWhen(name, condition, reason) {
    if (!condition) {
      report.checkboxesSkipped.push({ name, reason: reason || "condition non remplie" });
      return;
    }
    try {
      form.getCheckBox(name).check();
      report.checkboxesApplied.push(name);
    } catch (err) {
      report.fieldErrors.push({ name, message: err.message || String(err) });
    }
  }

  setTextField("N1FCA_formulaire", "DPC", { required: true, category: "short" });

  setTextField("D1N_nom", state.nom, { required: true, category: "short" });
  setTextField("D1P_prenom", state.prenom, { category: "short" });
  setTextField("D1E_pays", state.pays || "FRANCE", { required: true, category: "short" });

  setTextField("D3N_numero", state.numeroVoie, { category: "tiny" });
  setTextField("D3V_voie", state.voie, { category: "street", maxLen: 120 });
  setTextField("D3L_localite", state.ville, { required: true, category: "medium" });
  setTextField("D3C_code", state.cp, { required: true, category: "short" });
  setTextField("D3T_telephone", state.telephone, { category: "medium" });
  setTextField("D3K_indicatif", state.indicatif || "33", { category: "tiny" });

  setTextField("D5GE1_email", state.emailLocal, { category: "medium" });
  setTextField("D5GE2_email", state.emailDomain, { category: "medium" });

  if (state.declarantAcceptEmailContact === true) {
    checkWhen("D5A_acceptation", true, null);
  } else {
    report.checkboxesSkipped.push({ name: "D5A_acceptation", reason: "consentement contact email non attesté (CERFA_STATE.declarantAcceptEmailContact)" });
  }

  setTextField("T2Q_numero", state.numeroVoie, { category: "tiny" });
  setTextField("T2V_voie", state.voie, { category: "street", maxLen: 120 });
  setTextField("T2L_localite", state.ville, { category: "medium" });
  setTextField("T2C_code", state.cp, { category: "short" });
  setTextField("T2S_section", state.parcelleSection, { category: "short" });
  setTextField("T2N_numero", state.parcelleNumero, { category: "short" });
  setTextField("T2T_superficie", state.parcelleSurfaceM2, { category: "tiny" });
  setTextField("D5T_total", state.superficieTotale, { category: "tiny", allowZero: true });

  checkTripletOUINONNC({ oui: "T3A_CUoui", non: "T3H_CUnon", nc: "T3B_CUnc" }, cerfaState.urbanismeCU, "urbanismeCU");
  checkTripletOUINONNC({ oui: "T3I_lotoui", non: "T3L_lotnon", nc: "T3S_lotnc" }, cerfaState.urbanismeLot, "urbanismeLot");
  checkTripletOUINONNC({ oui: "T3J_ZACoui", non: "T3Q_ZACnon", nc: "T3T_ZACnc" }, cerfaState.urbanismeZAC, "urbanismeZAC");
  checkTripletOUINONNC({ oui: "T3G_AFUoui", non: "T3R_AFUnon", nc: "T3E_AFUnc" }, cerfaState.urbanismeAFU, "urbanismeAFU");
  checkTripletOUINONNC({ oui: "T3P_PUPoui", non: "T3C_PUPnon", nc: "T3F_PUPnc" }, cerfaState.urbanismePUP, "urbanismePUP");

  const ctype = cerfaState.constructionType != null ? String(cerfaState.constructionType).trim().toLowerCase() : "";
  if (ctype === "new" || ctype === "nouvelle") {
    checkWhen("C2ZA1_nouvelle", true, null);
  } else if (ctype === "existing" || ctype === "existante" || ctype === "existant") {
    checkWhen("C2ZB1_existante", true, null);
  } else {
    report.checkboxesSkipped.push({
      name: "C2ZA1|C2ZB1",
      reason: "constructionType non renseigné (new|existing) — cases travaux neuf / existant non cochées"
    });
  }

  setTextField(
    "C2ZA7_autres",
    state.c2za7AutresLabel || "Pose de panneaux solaires photovoltaïques",
    { category: "street", maxLen: 200 }
  );

  setDescriptionMultiline(descriptionText);

  setTextField("C2ZP1_crete", state.puissanceKwc, { required: true, category: "medium" });
  if (state.forcePuissanceElecZero === true) {
    setTextField("C2ZE1_puissance", "0", { category: "tiny", allowZero: true });
  }
  setTextField("C2ZR1_destination", state.destinationEnergie, { category: "street", maxLen: 120 });

  const occ = cerfaState.occupationMode != null ? String(cerfaState.occupationMode).trim().toLowerCase() : "";
  if (occ === "personnel") checkWhen("C5ZD1_personnel", true, null);
  else if (occ === "vente") checkWhen("C5ZD2_vente", true, null);
  else if (occ === "location") checkWhen("C5ZD3_location", true, null);
  else {
    report.checkboxesSkipped.push({ name: "C5ZD*", reason: "occupationMode non renseigné (personnel|vente|location)" });
  }

  const res = cerfaState.residenceType != null ? String(cerfaState.residenceType).trim().toLowerCase() : "";
  if (res === "principale" || res === "princip") {
    checkWhen("C2ZF1_principale", true, null);
  } else if (res === "secondaire" || res === "second") {
    checkWhen("C2ZF2_secondaire", true, null);
  } else {
    report.checkboxesSkipped.push({ name: "C2ZF*", reason: "residenceType non renseigné (principale|secondaire)" });
  }

  setTextField("W3ES2_creee", normalizeScalarForPdf(state.surfaceCreee, { allowZero: true }) || "0", {
    category: "tiny",
    allowZero: true
  });
  setTextField("W3ES3_supprimee", normalizeScalarForPdf(state.surfaceSupprimee, { allowZero: true }) || "0", {
    category: "tiny",
    allowZero: true
  });

  setTextField("E1L_lieu", state.signatureLieu, { category: "medium" });
  setTextField("E1D_date", state.signatureDateFormatted, { required: true, category: "short" });

  try {
    const sigField = form.getTextField("E1S_signature");
    applyFontSize(sigField, "multiline", "E1S_signature");
    sigField.setText("");
    report.filled.push({ name: "E1S_signature", detail: "laissé vierge (signature manuscrite)" });
  } catch (err) {
    report.fieldErrors.push({ name: "E1S_signature", message: err.message || String(err) });
  }

  let onRoof = null;
  if (cerfaState.installationOnRoof === true) onRoof = true;
  else if (cerfaState.installationOnRoof === false) onRoof = false;
  else {
    const ro = normalizeScalarForPdf(cerfaState.roofOrientation, {});
    onRoof = ro.length > 0 ? true : null;
  }
  if (onRoof === true) checkWhen("X1V_toiture", true, null);
  else if (onRoof === false) checkWhen("X1V0_toiture", true, null);
  else {
    report.checkboxesSkipped.push({
      name: "X1V_toiture",
      reason: "emplacement non déduit — renseigner roofOrientation ou CERFA_STATE.installationOnRoof"
    });
  }

  return report;
}

/**
 * Validations pré-export (bloque la génération si erreurs bloquantes).
 */
function validateCerfaPreExport(payload) {
  const errors = [];
  const warnings = [];
  const nom = normalizeScalarForPdf(payload.nom, {});
  const cp = normalizeScalarForPdf(payload.cp, {});
  const ville = normalizeScalarForPdf(payload.ville, {});
  const descriptionText = String(payload.descriptionText || "").trim();
  const puissanceKwc = normalizeScalarForPdf(payload.puissanceKwc, {});
  const destinationEnergie = normalizeScalarForPdf(payload.destinationEnergie, {});

  if (!nom) {
    errors.push({
      code: "DECLARANT_NOM_MANQUANT",
      message: "Nom du déclarant introuvable (DP1_CONTEXT.nom ou client.nom)."
    });
  }
  if (!cp || !ville) {
    errors.push({
      code: "ADRESSE_POSTALE_INCOMPLETE",
      message: "Code postal et commune obligatoires (DP1_CONTEXT ou client : cp, ville)."
    });
  }
  if (!descriptionText) {
    errors.push({
      code: "DESCRIPTION_VIDE",
      message: "Description projet vide : saisir les données CERFA puis « Générer la description du projet »."
    });
  }

  const count = payload.panelCount;
  const power = payload.panelPower;
  const hasPanels = count !== "" && count != null && Number.isFinite(Number(count)) && Number(count) > 0;
  const hasPower = power !== "" && power != null && Number.isFinite(Number(power)) && Number(power) > 0;
  if (!hasPanels || !hasPower) {
    errors.push({
      code: "PUISSANCE_CRETE_INCOMPLETE",
      message: "Nombre de panneaux et puissance unitaire (Wc) obligatoires pour la puissance crête."
    });
  }
  if (!puissanceKwc) {
    errors.push({ code: "PUISSANCE_KWC_VIDE", message: "Puissance crête (kWc) non calculée." });
  }

  const phone = payload.phoneFormat || { national: "" };
  if (!phone.national) {
    warnings.push({ code: "TELEPHONE_ABSENT", message: "Téléphone absent : champ D3T laissé vide dans le PDF." });
  }

  const dp1 = payload.dp1State;
  const parcel = dp1 && dp1.selectedParcel;
  const hasParcelId =
    parcel &&
    (normalizeScalarForPdf(parcel.section, {}) ||
      normalizeScalarForPdf(parcel.numero, {}) ||
      (parcel.parcel != null && String(parcel.parcel).trim()));
  if (!hasParcelId) {
    warnings.push({
      code: "PARCELLE_MANQUANTE",
      message: "Parcelle cadastrale absente dans DP1 : section/numéro vides — compléter DP1 ou le PDF à la main."
    });
  }
  if (dp1 && dp1.isValidated === false && hasParcelId) {
    warnings.push({
      code: "DP1_NON_VALIDE",
      message: "DP1 non validé (isValidated=false) : vérifier la parcelle avant dépôt."
    });
  }

  if (!destinationEnergie) {
    warnings.push({
      code: "GESTION_ENERGIE_NON_RENSEIGNEE",
      message: "Mode de gestion de l’énergie non choisi : le champ « destination » (C2ZR1) sera vide dans le PDF."
    });
  }

  return { errors, warnings };
}

function openPdfInNewTab(pdfBytes) {
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
}

async function createCerfaPdf() {
  const PDFLib = window.PDFLib;
  if (!PDFLib || !PDFLib.PDFDocument) {
    console.warn("[CERFA PDF] pdf-lib non chargé");
    return;
  }
  const debug = cerfaIsDebugMode();
  try {
    const arrayBuffer = await loadPdf();
    const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);

    const { StandardFonts } = PDFLib;
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const form = pdfDoc.getForm();

    const ctx = window.DP1_CONTEXT || {};
    const client = window.SMARTPITCH_CTX?.client || {};
    const cad = window.DP1_STATE?.selectedParcel || null;
    const dp1State = window.DP1_STATE || {};
    const cerfaState = window.CERFA_STATE || {};

    const nomComplet = normalizeScalarForPdf(ctx.nom || client.nom, {});
    const parts = nomComplet ? nomComplet.split(/\s+/) : [];
    let nom = "";
    let prenom = "";
    if (parts.length > 1) {
      nom = parts[parts.length - 1].toUpperCase();
      prenom = parts.slice(0, -1).join(" ");
    } else {
      nom = nomComplet ? nomComplet.toUpperCase() : "";
      prenom = "";
    }

    const adresse = normalizeScalarForPdf(ctx.adresse || client.adresse, {});
    const cp = normalizeScalarForPdf(ctx.cp || client.cp, {});
    const ville = normalizeScalarForPdf(ctx.ville || client.ville, {});
    const parsedAddr = parseFrenchAddressLine(adresse);
    const numeroVoie = parsedAddr.numeroVoie;
    const voie = parsedAddr.voie;

    const phoneFmt = formatPhoneCerfa(client.telephone || ctx.telephone || "");
    const telNational = phoneFmt.national;
    const indicatif = phoneFmt.indicatif;

    const email = normalizeScalarForPdf(client.email || client.mail || ctx.email, {});
    const split = email.split("@");
    const emailLocal = normalizeScalarForPdf(split[0], {});
    const emailDomain = normalizeScalarForPdf(split[1], {});

    const count = cerfaState.panelCount;
    const power = cerfaState.panelPower;
    const hasPanels = count !== "" && count != null && Number.isFinite(Number(count)) && Number(count) > 0;
    const hasPower = power !== "" && power != null && Number.isFinite(Number(power)) && Number(power) > 0;
    let puissanceKwcRaw = "";
    if (hasPanels && hasPower) {
      puissanceKwcRaw = formatPowerCerfa((Number(count) * Number(power)) / 1000);
    }

    let destinationEnergie = "";
    if (cerfaState.energyManagement === "Autoconsommation") destinationEnergie = "Autoconsommation";
    else if (cerfaState.energyManagement === "Autoconsommation + Vente de surplus") {
      destinationEnergie = "Autoconsommation avec vente du surplus";
    } else if (cerfaState.energyManagement === "Vente totale") destinationEnergie = "Vente totale";
    else if (cerfaState.energyManagement) destinationEnergie = normalizeScalarForPdf(cerfaState.energyManagement, {});

    const parcelleSection = normalizeScalarForPdf(cad && cad.section, {});
    let parcelleNumero = normalizeScalarForPdf(cad && cad.numero, {});
    if (!parcelleNumero && cad && cad.parcel != null) {
      parcelleNumero = normalizeScalarForPdf(String(cad.parcel), {});
    }
    const surfRaw = cad && (cad.surface_m2 != null ? cad.surface_m2 : cad.surface);
    const parcelleSurfaceM2 = surfRaw != null && String(surfRaw).trim() !== "" ? normalizeScalarForPdf(String(surfRaw), {}) : "";

    const s1 = Number(parcelleSurfaceM2 || 0);
    const superficieTotale = s1 > 0 ? String(Math.round(s1)) : "";

    const signatureLieu = ville || "";
    const signatureDateFormatted = formatDateCerfa(new Date());

    const descriptionText = buildCerfaDescriptionText(cerfaState);

    const pre = validateCerfaPreExport({
      nom,
      cp,
      ville,
      descriptionText,
      puissanceKwc: puissanceKwcRaw,
      destinationEnergie,
      panelCount: count,
      panelPower: power,
      dp1State,
      phoneFormat: phoneFmt
    });

    if (pre.errors.length > 0) {
      const msg = pre.errors.map((e) => e.message).join("\n");
      console.error("[CERFA] Export bloqué", pre.errors, pre.warnings);
      window.__snDpAlert("Impossible de générer le CERFA :\n\n" + msg);
      return;
    }
    for (const w of pre.warnings) {
      console.warn("[CERFA]", w.code, w.message);
    }
    if (pre.warnings.length > 0) {
      const wtxt = pre.warnings.map((w) => "• " + w.message).join("\n");
      if (
        !(await window.__snDpConfirm("Des avertissements ont été détectés avant la génération du CERFA. Continuer ?", {
          title: "Vérification CERFA",
          confirmLabel: "Continuer",
          cancelLabel: "Revenir",
          details: wtxt,
        }))
      ) {
        return;
      }
    }

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
      declarantAcceptEmailContact: cerfaState.declarantAcceptEmailContact === true,
      parcelleSection,
      parcelleNumero,
      parcelleSurfaceM2,
      superficieTotale,
      puissanceKwc: puissanceKwcRaw,
      destinationEnergie,
      signatureLieu,
      signatureDateFormatted,
      forcePuissanceElecZero: cerfaState.forcePuissanceElecZero === true,
      surfaceCreee: cerfaState.surfaceCreee,
      surfaceSupprimee: cerfaState.surfaceSupprimee,
      c2za7AutresLabel: cerfaState.c2za7AutresLabel
    };

    const report = createCerfaFillReport();
    fillCerfaFields(pdfDoc, state, descriptionText, {
      helveticaFont,
      form,
      report,
      cerfaState
    });

    for (const w of pre.warnings) {
      report.warnings.push({ code: w.code, detail: w.message });
    }

    if (debug) {
      console.info("[CERFA DEBUG] Rapport remplissage", report);
    }
    try {
      window.__SOLARNEXT_CERFA_LAST_REPORT = report;
    } catch (_) {}

    if (report.missingRequired.length > 0 || report.fieldErrors.length > 0) {
      console.error("[CERFA] Échec remplissage PDF", report.missingRequired, report.fieldErrors);
      window.__snDpAlert(
        "Le CERFA n’a pas pu être rempli correctement (champs obligatoires manquants ou noms de champs PDF inattendus). " +
          "Voir la console et __SOLARNEXT_CERFA_LAST_REPORT.\n\n" +
          "missingRequired: " +
          report.missingRequired.map((x) => x.name).join(", ") +
          "\nfieldErrors: " +
          report.fieldErrors.map((x) => x.name).join(", ")
      );
      return;
    }

    form.updateFieldAppearances(helveticaFont);

    if (!debug) {
      try {
        form.flatten({ updateFieldAppearances: false });
      } catch (fe) {
        console.error("[CERFA] flatten", fe);
        report.warnings.push({ code: "FLATTEN_FAILED", detail: String(fe.message || fe) });
        window.__snDpAlert(
          "Le PDF CERFA n’a pas pu être aplati (apparences figées). Le fichier reste éditable. Détail : " +
            (fe.message || fe) +
            "\n\nAstuce : mode debug (?cerfaDebug=1 ou localStorage SOLARNEXT_CERFA_DEBUG=1) pour conserver les champs formulaire."
        );
      }
    } else {
      console.info("[CERFA DEBUG] flatten ignoré (aperçu / champs encore éditables)");
    }

    const pdfBytes = await pdfDoc.save();
    openPdfInNewTab(pdfBytes);
    void __solarnextDpPersistCerfaPdfBytes(pdfBytes);
  } catch (err) {
    console.error("[CERFA PDF]", err);
    window.__snDpAlert("Erreur génération CERFA : " + (err.message || err));
  }
}

try {
  window.__solarnextCerfaApi = {
    buildCerfaDescriptionText,
    parseFrenchAddressLine,
    formatPowerCerfa,
    formatPhoneCerfa,
    formatDateCerfa,
    validateCerfaPreExport,
    normOuiNonNc,
    cerfaIsDebugMode,
    createCerfaFillReport
  };
} catch (_) {}

// ======================================================
// GÉNÉRATION PDF MANDAT — FRONT (inchangé)
// ======================================================
async function generateMandatPDF() {
  if (!window.SMARTPITCH_CTX) {
    window.__snDpAlert("Les données du projet ne sont pas disponibles.");
    return;
  }

  var sig = window.__MANDAT_SIGNATURE__;
  if (!sig || !sig.signed || !sig.signatureDataUrl) {
    window.__snDpAlert("Veuillez signer le mandat avant génération");
    return;
  }

  try {
    await __solarnextDpFetchPdfWithReplace(
      "/pdf/render/mandat/pdf",
      function () {
        return {
          mandatData: Object.assign({}, window.SMARTPITCH_CTX, { mandatSignature: sig }),
        };
      },
      "mandat"
    );
  } catch (err) {
    console.error(err);
    window.__snDpAlert("Erreur lors de la génération du PDF.");
  }
}

window.generateMandatPDF = generateMandatPDF;
