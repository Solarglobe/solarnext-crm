/**
 * Signature mandat DP — même logique canvas que QuoteSignaturePadModal (720×320 logique, pointer events).
 * État persistant : window.__MANDAT_SIGNATURE__ + lead_dp.state_json mandat.mandatSignature
 */
(function (global) {
  var PAD_W = 720;
  var PAD_H = 320;
  /** Aligné CRM devis / backend mandat PDF */
  var MANDAT_READ_ACCEPT_LABEL = "Je reconnais avoir lu et accepté ce document";

  function defaultSig() {
    return {
      signed: false,
      name: "",
      signatureDataUrl: "",
      signedAt: "",
      signedAtServer: "",
      accepted: false,
      acceptedLabel: "",
    };
  }

  if (!global.__MANDAT_SIGNATURE__) {
    global.__MANDAT_SIGNATURE__ = defaultSig();
  }

  function logicalPoint(canvas, clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    var x = ((clientX - rect.left) / rect.width) * PAD_W;
    var y = ((clientY - rect.top) / rect.height) * PAD_H;
    return { x: x, y: y };
  }

  function layoutCanvas(canvas) {
    if (!canvas) return;
    var dpr = Math.min(2.5, typeof global.devicePixelRatio === "number" ? global.devicePixelRatio : 1);
    canvas.width = Math.max(1, Math.floor(PAD_W * dpr));
    canvas.height = Math.max(1, Math.floor(PAD_H * dpr));
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, PAD_W, PAD_H);
    ctx.strokeStyle = "#16131c";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }

  var drawing = false;
  var hasInk = false;
  var modalEl = null;

  function getModalEls() {
    return {
      modal: global.document.getElementById("mandat-sign-modal"),
      prenom: global.document.getElementById("mandat-sign-prenom"),
      nom: global.document.getElementById("mandat-sign-nom"),
      canvas: global.document.getElementById("mandat-signature-canvas"),
      readApprove: global.document.getElementById("mandat-sign-read-approve"),
      btnClear: global.document.getElementById("mandat-sign-clear"),
      btnCancel: global.document.getElementById("mandat-sign-cancel"),
      btnOk: global.document.getElementById("mandat-sign-confirm"),
    };
  }

  function syncMandatConfirmButton() {
    var els = getModalEls();
    var checked = !!(els.readApprove && els.readApprove.checked);
    if (els.btnOk) els.btnOk.disabled = !hasInk || !checked;
  }

  function setHasInk(v) {
    hasInk = v;
    syncMandatConfirmButton();
  }

  function bindCanvas(canvas) {
    if (!canvas || canvas.dataset.mandatPadBound === "1") return;
    canvas.dataset.mandatPadBound = "1";

    function startDraw(e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (_) {}
      drawing = true;
      var ctx = canvas.getContext("2d");
      if (!ctx) return;
      var p = logicalPoint(canvas, e.clientX, e.clientY);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }

    function moveDraw(e) {
      if (!drawing) return;
      e.preventDefault();
      var ctx = canvas.getContext("2d");
      if (!ctx) return;
      var p = logicalPoint(canvas, e.clientX, e.clientY);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      setHasInk(true);
    }

    function endDraw(e) {
      if (!drawing) return;
      e.preventDefault();
      drawing = false;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (_) {}
    }

    canvas.addEventListener("pointerdown", startDraw);
    canvas.addEventListener("pointermove", moveDraw);
    canvas.addEventListener("pointerup", endDraw);
    canvas.addEventListener("pointercancel", endDraw);
  }

  function openSignatureModal() {
    var els = getModalEls();
    if (!els.modal || !els.canvas) return;
    els.modal.hidden = false;
    global.document.body.style.overflow = "hidden";
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (els.readApprove) els.readApprove.checked = false;
        layoutCanvas(els.canvas);
        setHasInk(false);
        bindCanvas(els.canvas);
        syncMandatConfirmButton();
        if (els.prenom) els.prenom.focus();
      });
    });
  }

  function closeSignatureModal() {
    var els = getModalEls();
    if (els.modal) els.modal.hidden = true;
    global.document.body.style.overflow = "";
  }

  function persistSignature(obj) {
    global.__MANDAT_SIGNATURE__ = Object.assign(defaultSig(), global.__MANDAT_SIGNATURE__ || {}, obj);
    try {
      if (global.DpDraftStore && typeof global.DpDraftStore.getDraft === "function" && typeof global.DpDraftStore.updateDraft === "function") {
        var d = global.DpDraftStore.getDraft();
        var m = Object.assign({}, (d && d.mandat) || {});
        m.mandatSignature = global.__MANDAT_SIGNATURE__;
        global.DpDraftStore.updateDraft({ mandat: m });
      }
    } catch (e) {
      console.warn("[mandat-signature] persist", e);
    }
    try {
      if (typeof global.__snDpPersistDebounced === "function") {
        global.__snDpPersistDebounced(false);
      }
    } catch (_) {}
  }

  function getMandatStampUrl() {
    if (typeof global.__solarnextMandatSignatureStampUrl === "function") {
      return global.__solarnextMandatSignatureStampUrl();
    }
    return "/pdf/render/mandat/signature-stamp";
  }

  function confirmSignature() {
    var els = getModalEls();
    var canvas = els.canvas;
    var prenom = (els.prenom && els.prenom.value && els.prenom.value.trim()) || "";
    var nom = (els.nom && els.nom.value && els.nom.value.trim()) || "";
    if (!prenom || !nom) {
      global.alert("Veuillez renseigner le prénom et le nom du signataire.");
      return;
    }
    if (!hasInk || !canvas) return;
    var readCb = els.readApprove;
    if (!readCb || !readCb.checked) return;
    var dataUrl;
    try {
      dataUrl = canvas.toDataURL("image/png");
    } catch (e) {
      global.alert("Impossible d’enregistrer la signature.");
      return;
    }
    var fullName = (prenom + " " + nom).trim();
    var clientSignedAt = new Date().toISOString();
    if (els.btnOk) els.btnOk.disabled = true;

    var stampUrl = getMandatStampUrl();
    var stampHeaders = { "Content-Type": "application/json" };
    try {
      var stampTok =
        typeof global.localStorage !== "undefined" && global.localStorage.getItem("solarnext_token");
      if (stampTok) stampHeaders.Authorization = "Bearer " + stampTok;
    } catch (_authE) {}
    if (typeof global.__solarnextDpApplySuperAdminContextHeaders === "function") {
      global.__solarnextDpApplySuperAdminContextHeaders(stampHeaders);
    }
    global
      .fetch(stampUrl, {
        method: "POST",
        headers: stampHeaders,
        body: JSON.stringify({
          mandatSignature: { signed: true, signatureDataUrl: dataUrl },
        }),
      })
      .then(function (res) {
        return res.json().then(function (j) {
          return { ok: res.ok, j: j };
        });
      })
      .then(function (out) {
        if (!out.ok || !out.j || typeof out.j.signedAtServer !== "string" || !out.j.signedAtServer) {
          throw new Error("stamp");
        }
        persistSignature({
          signed: true,
          name: fullName,
          signatureDataUrl: dataUrl,
          signedAt: clientSignedAt,
          signedAtServer: out.j.signedAtServer,
          accepted: true,
          acceptedLabel: MANDAT_READ_ACCEPT_LABEL,
        });
        closeSignatureModal();
        if (typeof global.refreshMandatActionButtons === "function") {
          global.refreshMandatActionButtons();
        }
      })
      .catch(function () {
        global.alert(
          "Impossible d’obtenir l’horodatage serveur. Vérifiez la connexion et réessayez. La signature n’a pas été enregistrée."
        );
        syncMandatConfirmButton();
      });
  }

  function wireModal() {
    var els = getModalEls();
    if (!els.modal) return;
    if (els.modal.dataset.wired === "1") return;
    els.modal.dataset.wired = "1";

    if (els.btnClear) {
      els.btnClear.addEventListener("click", function () {
        layoutCanvas(els.canvas);
        setHasInk(false);
      });
    }
    if (els.btnCancel) {
      els.btnCancel.addEventListener("click", closeSignatureModal);
    }
    if (els.btnOk) {
      els.btnOk.addEventListener("click", confirmSignature);
    }
    if (els.readApprove) {
      els.readApprove.addEventListener("change", syncMandatConfirmButton);
    }
    var closeX = global.document.getElementById("mandat-sign-close-x");
    if (closeX) {
      closeX.addEventListener("click", closeSignatureModal);
    }
    els.modal.addEventListener("click", function (e) {
      var t = e.target;
      if (t === els.modal || (t && t.classList && t.classList.contains("mandat-sign-modal__backdrop"))) {
        closeSignatureModal();
      }
    });
  }

  function refreshMandatActionButtons() {
    var sig = global.__MANDAT_SIGNATURE__ || defaultSig();
    var btnSign = global.document.getElementById("mandat-btn-sign");
    var btnPdf = global.document.getElementById("mandat-btn-pdf");
    if (btnSign) {
      btnSign.style.display = sig.signed ? "none" : "inline-flex";
    }
    if (btnPdf) {
      btnPdf.style.display = sig.signed ? "inline-flex" : "none";
    }
  }

  function prefillNames() {
    var els = getModalEls();
    var ctx = global.SMARTPITCH_CTX && global.SMARTPITCH_CTX.client;
    if (!ctx || !els.prenom || !els.nom) return;
    var full = (ctx.nom || ctx.name || "").trim();
    if (!full) return;
    var parts = full.split(/\s+/);
    if (parts.length >= 2) {
      els.nom.value = parts[parts.length - 1];
      els.prenom.value = parts.slice(0, -1).join(" ");
    } else {
      els.nom.value = full;
    }
  }

  global.openMandatSignatureModal = function () {
    wireModal();
    prefillNames();
    openSignatureModal();
  };

  global.refreshMandatActionButtons = refreshMandatActionButtons;

  global.initMandatPage = function () {
    wireModal();
    var sig = global.__MANDAT_SIGNATURE__;
    if (!sig || !sig.signatureDataUrl) {
      try {
        var d = global.DpDraftStore && global.DpDraftStore.getDraft && global.DpDraftStore.getDraft();
        if (d && d.mandat && d.mandat.mandatSignature) {
          global.__MANDAT_SIGNATURE__ = Object.assign(defaultSig(), d.mandat.mandatSignature);
        }
      } catch (_) {}
    }
    var btnSign = global.document.getElementById("mandat-btn-sign");
    var btnPdf = global.document.getElementById("mandat-btn-pdf");
    if (btnSign) {
      btnSign.addEventListener("click", function (e) {
        e.preventDefault();
        global.openMandatSignatureModal();
      });
    }
    if (btnPdf) {
      btnPdf.addEventListener("click", function (e) {
        e.preventDefault();
        if (typeof global.generateMandatPDF === "function") {
          global.generateMandatPDF();
        }
      });
    }
    refreshMandatActionButtons();
  };
})(typeof window !== "undefined" ? window : globalThis);
