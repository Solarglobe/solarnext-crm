/**
 * Signature mandat DP — flux sécurisé : lecture de l'aperçu PDF + OTP (email|SMS) + signature.
 * - Aperçu : POST /pdf/render/mandat/preview (mandat non signé) affiché en iframe.
 * - OTP : POST /api/leads/:id/mandat/signature-otp/request + /verify (code envoyé au client).
 * - Tampon : POST /pdf/render/mandat/signature-stamp (exige leadId + OTP vérifié côté serveur).
 * État persistant : window.__MANDAT_SIGNATURE__ + lead_dp.state_json mandat.mandatSignature
 */
(function (global) {
  var PAD_W = 720;
  var PAD_H = 320;
  var MANDAT_READ_ACCEPT_LABEL = "Je reconnais avoir lu et accepté ce document";

  var drawing = false;
  var hasInk = false;
  var otpVerified = false;
  var previewObjectUrl = null;

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
  if (!global.__MANDAT_SIGNATURE__) global.__MANDAT_SIGNATURE__ = defaultSig();

  // -------- URLs / auth --------
  function getLeadId() {
    var c = global.__SOLARNEXT_DP_CONTEXT__;
    return c && c.leadId ? String(c.leadId) : null;
  }
  function dpApiOrigin() {
    var b = global.__SOLARNEXT_API_BASE__;
    if (b != null && String(b).trim()) return String(b).replace(/\/$/, "");
    if (global.location && global.location.origin) {
      var isViteDev = global.location.hostname === "localhost" && String(global.location.port) === "5173";
      return isViteDev ? global.location.origin + "/api" : global.location.origin;
    }
    return "";
  }
  function dpAbsApiUrl(tail) {
    var t = String(tail || "").replace(/^\//, "");
    var o = dpApiOrigin();
    if (!o) return "/api/" + t;
    var base = /\/api$/i.test(o) ? o : o.replace(/\/$/, "") + "/api";
    return base + "/" + t;
  }
  function getMandatStampUrl() {
    if (typeof global.__solarnextMandatSignatureStampUrl === "function") {
      return global.__solarnextMandatSignatureStampUrl();
    }
    return "/pdf/render/mandat/signature-stamp";
  }
  function getMandatPreviewUrl() {
    return getMandatStampUrl().replace(/signature-stamp$/, "preview");
  }
  function buildAuthHeaders() {
    var h = { "Content-Type": "application/json" };
    try {
      var tok = typeof global.__solarnextDpAuthToken === "function" ? global.__solarnextDpAuthToken() : null;
      if (tok) h.Authorization = "Bearer " + tok;
    } catch (_) {}
    if (typeof global.__solarnextDpApplySuperAdminContextHeaders === "function") {
      global.__solarnextDpApplySuperAdminContextHeaders(h);
    }
    return h;
  }
  function httpErrorMessage(status, fallback) {
    if (status === 401) return "Session expirée. Reconnectez-vous puis réessayez.";
    if (status === 403) return "Action refusée (droits insuffisants ou e-mail non vérifié).";
    if (status === 429) return "Trop de tentatives, patientez quelques instants.";
    if (status >= 500) return "Erreur serveur, réessayez dans un instant.";
    return fallback || "Une erreur est survenue.";
  }

  // -------- Canvas --------
  function logicalPoint(canvas, clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    return { x: ((clientX - rect.left) / rect.width) * PAD_W, y: ((clientY - rect.top) / rect.height) * PAD_H };
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
  function bindCanvas(canvas) {
    if (!canvas || canvas.dataset.mandatPadBound === "1") return;
    canvas.dataset.mandatPadBound = "1";
    function startDraw(e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
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
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    }
    canvas.addEventListener("pointerdown", startDraw);
    canvas.addEventListener("pointermove", moveDraw);
    canvas.addEventListener("pointerup", endDraw);
    canvas.addEventListener("pointercancel", endDraw);
  }

  // -------- Modal elements --------
  function getModalEls() {
    var d = global.document;
    return {
      modal: d.getElementById("mandat-sign-modal"),
      prenom: d.getElementById("mandat-sign-prenom"),
      nom: d.getElementById("mandat-sign-nom"),
      canvas: d.getElementById("mandat-signature-canvas"),
      readApprove: d.getElementById("mandat-sign-read-approve"),
      btnClear: d.getElementById("mandat-sign-clear"),
      btnCancel: d.getElementById("mandat-sign-cancel"),
      btnOk: d.getElementById("mandat-sign-confirm"),
      previewFrame: d.getElementById("mandat-preview-frame"),
      previewStatus: d.getElementById("mandat-preview-status"),
      otpChannel: d.getElementById("mandat-otp-channel"),
      otpSend: d.getElementById("mandat-otp-send"),
      otpStatus: d.getElementById("mandat-otp-status"),
      otpCode: d.getElementById("mandat-otp-code"),
      otpVerify: d.getElementById("mandat-otp-verify"),
      otpVerifiedBadge: d.getElementById("mandat-otp-verified"),
      step3: d.getElementById("mandat-sign-step3"),
    };
  }

  function readAccepted() {
    var els = getModalEls();
    return !!(els.readApprove && els.readApprove.checked);
  }

  function syncStep3Lock() {
    var els = getModalEls();
    var unlocked = readAccepted() && otpVerified;
    if (els.step3) {
      els.step3.style.opacity = unlocked ? "1" : "0.5";
      els.step3.style.pointerEvents = unlocked ? "auto" : "none";
    }
    syncMandatConfirmButton();
  }

  function syncMandatConfirmButton() {
    var els = getModalEls();
    if (els.btnOk) els.btnOk.disabled = !(hasInk && readAccepted() && otpVerified);
  }

  function setHasInk(v) {
    hasInk = v;
    syncMandatConfirmButton();
  }

  // -------- Aperçu PDF (non signé) --------
  function loadPreview() {
    var els = getModalEls();
    if (!els.previewFrame || !els.previewStatus) return;
    if (!global.SMARTPITCH_CTX) {
      els.previewStatus.textContent = "Données du projet indisponibles : impossible d’afficher l’aperçu.";
      return;
    }
    els.previewStatus.style.display = "";
    els.previewStatus.textContent = "Chargement de l’aperçu du mandat…";
    els.previewFrame.style.display = "none";
    global
      .fetch(getMandatPreviewUrl(), {
        method: "POST",
        headers: buildAuthHeaders(),
        body: JSON.stringify({
          mandatData: Object.assign({}, global.SMARTPITCH_CTX, { mandatSignature: null }),
        }),
      })
      .then(function (res) {
        if (!res.ok) throw new Error(String(res.status));
        return res.blob();
      })
      .then(function (blob) {
        if (previewObjectUrl) {
          try { URL.revokeObjectURL(previewObjectUrl); } catch (_) {}
        }
        previewObjectUrl = URL.createObjectURL(blob);
        els.previewFrame.src = previewObjectUrl + "#zoom=page-width&toolbar=0&navpanes=0";
        els.previewFrame.style.display = "block";
        els.previewStatus.style.display = "none";
      })
      .catch(function (e) {
        var st = parseInt(String(e && e.message), 10);
        els.previewStatus.textContent =
          "Aperçu indisponible : " + httpErrorMessage(isNaN(st) ? 0 : st, "vérifiez la connexion.");
      });
  }

  // -------- OTP --------
  function sendOtp() {
    var els = getModalEls();
    var leadId = getLeadId();
    if (!leadId) {
      if (els.otpStatus) els.otpStatus.textContent = "Lead introuvable.";
      return;
    }
    var channel = els.otpChannel && els.otpChannel.value === "sms" ? "sms" : "email";
    if (els.otpSend) els.otpSend.disabled = true;
    if (els.otpStatus) {
      els.otpStatus.style.color = "#6b7280";
      els.otpStatus.textContent = "Envoi du code…";
    }
    global
      .fetch(dpAbsApiUrl("leads/" + encodeURIComponent(leadId) + "/mandat/signature-otp/request"), {
        method: "POST",
        headers: buildAuthHeaders(),
        body: JSON.stringify({ channel: channel }),
      })
      .then(function (res) {
        return res.json().then(function (j) { return { ok: res.ok, status: res.status, j: j }; });
      })
      .then(function (out) {
        if (els.otpSend) els.otpSend.disabled = false;
        if (!out.ok) {
          if (els.otpStatus) {
            els.otpStatus.style.color = "#b91c1c";
            els.otpStatus.textContent = (out.j && out.j.error) || httpErrorMessage(out.status);
          }
          return;
        }
        if (els.otpStatus) {
          els.otpStatus.style.color = "#0a6b3b";
          els.otpStatus.textContent =
            "Code envoyé à " + (out.j.destinationMasked || "destinataire") + " (valide " + (out.j.ttlMinutes || 10) + " min).";
        }
        if (els.otpCode) els.otpCode.focus();
      })
      .catch(function () {
        if (els.otpSend) els.otpSend.disabled = false;
        if (els.otpStatus) {
          els.otpStatus.style.color = "#b91c1c";
          els.otpStatus.textContent = "Échec de l’envoi du code. Vérifiez la connexion.";
        }
      });
  }

  function verifyOtp() {
    var els = getModalEls();
    var leadId = getLeadId();
    var code = (els.otpCode && els.otpCode.value ? els.otpCode.value : "").replace(/\D/g, "");
    if (!leadId) return;
    if (code.length !== 6) {
      if (els.otpStatus) {
        els.otpStatus.style.color = "#b91c1c";
        els.otpStatus.textContent = "Saisissez le code à 6 chiffres.";
      }
      return;
    }
    if (els.otpVerify) els.otpVerify.disabled = true;
    global
      .fetch(dpAbsApiUrl("leads/" + encodeURIComponent(leadId) + "/mandat/signature-otp/verify"), {
        method: "POST",
        headers: buildAuthHeaders(),
        body: JSON.stringify({ code: code }),
      })
      .then(function (res) {
        return res.json().then(function (j) { return { ok: res.ok, status: res.status, j: j }; });
      })
      .then(function (out) {
        if (els.otpVerify) els.otpVerify.disabled = false;
        if (!out.ok || !out.j || out.j.verified !== true) {
          if (els.otpStatus) {
            els.otpStatus.style.color = "#b91c1c";
            els.otpStatus.textContent = (out.j && out.j.error) || httpErrorMessage(out.status, "Code incorrect.");
          }
          return;
        }
        otpVerified = true;
        if (els.otpVerifiedBadge) els.otpVerifiedBadge.style.display = "inline";
        if (els.otpStatus) els.otpStatus.textContent = "";
        if (els.otpCode) els.otpCode.disabled = true;
        if (els.otpVerify) els.otpVerify.disabled = true;
        if (els.otpSend) els.otpSend.disabled = true;
        syncStep3Lock();
      })
      .catch(function () {
        if (els.otpVerify) els.otpVerify.disabled = false;
        if (els.otpStatus) {
          els.otpStatus.style.color = "#b91c1c";
          els.otpStatus.textContent = "Échec de la vérification. Vérifiez la connexion.";
        }
      });
  }

  // -------- Modal lifecycle --------
  function openSignatureModal() {
    var els = getModalEls();
    if (!els.modal || !els.canvas) return;
    els.modal.hidden = false;
    global.document.body.style.overflow = "hidden";
    // reset état
    otpVerified = false;
    hasInk = false;
    if (els.readApprove) els.readApprove.checked = false;
    if (els.otpVerifiedBadge) els.otpVerifiedBadge.style.display = "none";
    if (els.otpStatus) els.otpStatus.textContent = "";
    if (els.otpCode) { els.otpCode.value = ""; els.otpCode.disabled = false; }
    if (els.otpSend) els.otpSend.disabled = false;
    if (els.otpVerify) els.otpVerify.disabled = false;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        layoutCanvas(els.canvas);
        bindCanvas(els.canvas);
        syncStep3Lock();
        loadPreview();
      });
    });
  }

  function closeSignatureModal() {
    var els = getModalEls();
    if (els.modal) els.modal.hidden = true;
    global.document.body.style.overflow = "";
    if (previewObjectUrl) {
      try { URL.revokeObjectURL(previewObjectUrl); } catch (_) {}
      previewObjectUrl = null;
    }
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
      if (typeof global.__snDpPersistDebounced === "function") global.__snDpPersistDebounced(false);
    } catch (_) {}
  }

  function confirmSignature() {
    var els = getModalEls();
    var canvas = els.canvas;
    var prenom = (els.prenom && els.prenom.value && els.prenom.value.trim()) || "";
    var nom = (els.nom && els.nom.value && els.nom.value.trim()) || "";
    if (!readAccepted()) {
      global.alert("Veuillez confirmer la lecture du mandat.");
      return;
    }
    if (!otpVerified) {
      global.alert("Veuillez d’abord vérifier le code envoyé au client.");
      return;
    }
    if (!prenom || !nom) {
      global.alert("Veuillez renseigner le prénom et le nom du signataire.");
      return;
    }
    if (!hasInk || !canvas) {
      global.alert("Veuillez signer dans le cadre.");
      return;
    }
    var leadId = getLeadId();
    if (!leadId) {
      global.alert("Lead introuvable : impossible de signer.");
      return;
    }
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

    global
      .fetch(getMandatStampUrl(), {
        method: "POST",
        headers: buildAuthHeaders(),
        body: JSON.stringify({
          leadId: leadId,
          mandatSignature: { signed: true, signatureDataUrl: dataUrl },
        }),
      })
      .then(function (res) {
        return res.json().then(function (j) { return { ok: res.ok, status: res.status, j: j }; }).catch(function () {
          return { ok: res.ok, status: res.status, j: null };
        });
      })
      .then(function (out) {
        if (!out.ok || !out.j || typeof out.j.signedAtServer !== "string" || !out.j.signedAtServer) {
          var msg = (out.j && out.j.error) || httpErrorMessage(out.status, "Horodatage refusé.");
          throw new Error(msg);
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
        if (typeof global.refreshMandatActionButtons === "function") global.refreshMandatActionButtons();
        if (typeof global.generateMandatPDF === "function") {
          setTimeout(function () { global.generateMandatPDF(); }, 0);
        }
      })
      .catch(function (err) {
        global.alert((err && err.message) || "La signature n’a pas pu être enregistrée.");
        syncMandatConfirmButton();
      });
  }

  function wireModal() {
    var els = getModalEls();
    if (!els.modal || els.modal.dataset.wired === "1") return;
    els.modal.dataset.wired = "1";

    if (els.btnClear) els.btnClear.addEventListener("click", function () { layoutCanvas(els.canvas); setHasInk(false); });
    if (els.btnCancel) els.btnCancel.addEventListener("click", closeSignatureModal);
    if (els.btnOk) els.btnOk.addEventListener("click", confirmSignature);
    if (els.readApprove) els.readApprove.addEventListener("change", syncStep3Lock);
    if (els.otpSend) els.otpSend.addEventListener("click", sendOtp);
    if (els.otpVerify) els.otpVerify.addEventListener("click", verifyOtp);
    if (els.otpCode) {
      els.otpCode.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); verifyOtp(); }
      });
    }
    var closeX = global.document.getElementById("mandat-sign-close-x");
    if (closeX) closeX.addEventListener("click", closeSignatureModal);
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
    if (btnSign) btnSign.style.display = sig.signed ? "none" : "inline-flex";
    if (btnPdf) btnPdf.style.display = sig.signed ? "inline-flex" : "none";
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
        if (typeof global.generateMandatPDF === "function") global.generateMandatPDF();
      });
    }
    refreshMandatActionButtons();
  };
})(typeof window !== "undefined" ? window : globalThis);
