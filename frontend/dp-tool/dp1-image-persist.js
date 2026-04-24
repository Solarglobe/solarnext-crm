/**
 * DP1 — normalisation des images avant persistance lead_dp.state_json.
 * - blob: → JPEG data URL (canvas), jamais laissé tel quel pour le serveur.
 * - data:image trop lourde → compression / réduction jusqu’à MAX_DP1_DATA_URL_CHARS.
 * Exposé sur window.__solarnextDp1ImagePersist pour dp-draft-store.js (sans bundler).
 */
(function (g) {
  var MAX_CHARS = 900000;

  var SLOTS = [
    { key: "view_20000", sel: '[data-slot="dp1-view-1"] img' },
    { key: "view_5000", sel: '[data-slot="dp1-view-2"] img' },
    { key: "view_650", sel: '[data-slot="dp1-view-3"] img' },
  ];

  function canvasToJpegDataUrl(img, maxEdge, quality) {
    if (!img || !img.naturalWidth || !img.naturalHeight) return null;
    var w = img.naturalWidth;
    var h = img.naturalHeight;
    var scale = maxEdge / Math.max(w, h);
    if (scale > 1) scale = 1;
    var cw = Math.max(1, Math.round(w * scale));
    var ch = Math.max(1, Math.round(h * scale));
    var c = g.document && g.document.createElement("canvas");
    if (!c) return null;
    c.width = cw;
    c.height = ch;
    var ctx = c.getContext("2d");
    if (!ctx) return null;
    try {
      ctx.drawImage(img, 0, 0, cw, ch);
      return c.toDataURL("image/jpeg", quality);
    } catch (e) {
      return null;
    }
  }

  /** Essaie plusieurs tailles max + qualités jusqu’à tenir sous maxChars. */
  function compressBitmapToJpegUnder(img, maxChars) {
    var edges = [2400, 2048, 1920, 1600, 1400, 1280, 1024, 900, 800, 640, 512, 400, 320];
    var qualities = [0.9, 0.85, 0.8, 0.75, 0.68, 0.62, 0.55, 0.48, 0.42, 0.36];
    for (var ei = 0; ei < edges.length; ei++) {
      for (var qi = 0; qi < qualities.length; qi++) {
        var u = canvasToJpegDataUrl(img, edges[ei], qualities[qi]);
        if (u && u.length <= maxChars) return u;
      }
    }
    return null;
  }

  function loadImageAsync(src) {
    return new Promise(function (resolve, reject) {
      var Im = g.Image || function () {};
      var im = new Im();
      im.onload = function () {
        resolve(im);
      };
      im.onerror = function () {
        reject(new Error("load_image_failed"));
      };
      im.src = src;
    });
  }

  function getDomImgForSlot(sel) {
    try {
      if (!g.document || !g.document.querySelector) return null;
      var el = g.document.querySelector(sel);
      if (!el || el.tagName !== "IMG") return null;
      return el;
    } catch (_) {
      return null;
    }
  }

  function domImgMatchesSrc(domImg, rawStr) {
    if (!domImg || !rawStr) return false;
    try {
      return domImg.src === rawStr || String(domImg.getAttribute("src") || "") === rawStr;
    } catch (_) {
      return false;
    }
  }

  /**
   * @param {string} rawStr
   * @param {string} sel
   * @returns {HTMLImageElement|null}
   */
  function pickImgForEncode(rawStr, sel) {
    var dom = getDomImgForSlot(sel);
    if (!dom || !dom.complete || dom.naturalWidth < 1) return null;
    if (rawStr.indexOf("blob:") === 0) return dom;
    if (rawStr.indexOf("data:image") === 0 && rawStr.length > MAX_CHARS) return dom;
    if (domImgMatchesSrc(dom, rawStr)) return dom;
    return null;
  }

  /**
   * @param {object} draft
   * @param {string} slotKey
   * @param {string} sel
   * @param {string} rawStr
   * @returns {Promise<{ok:boolean, error?:string}>}
   */
  function normalizeOneSlotAsync(draft, slotKey, sel, rawStr) {
    if (!rawStr || typeof rawStr !== "string") return Promise.resolve({ ok: true });
    var s = rawStr.trim();
    if (!s) return Promise.resolve({ ok: true });
    if (/^https?:\/\//i.test(s)) return Promise.resolve({ ok: true });
    if (!draft.dp1 || typeof draft.dp1 !== "object") return Promise.resolve({ ok: true });
    if (!draft.dp1.images || typeof draft.dp1.images !== "object") draft.dp1.images = {};

    if (s.indexOf("blob:") === 0) {
      var domBlob = pickImgForEncode(s, sel);
      if (domBlob) {
        var cBlob = compressBitmapToJpegUnder(domBlob, MAX_CHARS);
        if (!cBlob) {
          return Promise.resolve({
            ok: false,
            error:
              "Impossible de préparer l’image DP1 pour la sauvegarde (compression). Réessayez depuis l’étape DP1.",
          });
        }
        draft.dp1.images[slotKey] = cBlob;
        return Promise.resolve({ ok: true });
      }
      return fetch(s)
        .then(function (r) {
          if (!r.ok) throw new Error("blob_fetch");
          return r.blob();
        })
        .then(function (blob) {
          var ou = URL.createObjectURL(blob);
          return loadImageAsync(ou).then(
            function (im) {
              try {
                URL.revokeObjectURL(ou);
              } catch (_) {}
              var out = compressBitmapToJpegUnder(im, MAX_CHARS);
              if (!out) {
                return { ok: false, error: "Image DP1 trop lourde même après compression (" + slotKey + ")." };
              }
              draft.dp1.images[slotKey] = out;
              return { ok: true };
            },
            function (err) {
              try {
                URL.revokeObjectURL(ou);
              } catch (_) {}
              throw err;
            }
          );
        })
        .catch(function () {
          return {
            ok: false,
            error:
              "Image DP1 temporaire (blob) non exportable. Ouvrez l’étape DP1 puis enregistrez à nouveau, ou réimportez les vues.",
          };
        });
    }

    if (s.indexOf("data:image") === 0) {
      if (s.length <= MAX_CHARS) return Promise.resolve({ ok: true });
      var domData = pickImgForEncode(s, sel);
      if (domData) {
        var cDom = compressBitmapToJpegUnder(domData, MAX_CHARS);
        if (cDom) {
          draft.dp1.images[slotKey] = cDom;
          return Promise.resolve({ ok: true });
        }
      }
      return loadImageAsync(s)
        .then(function (im) {
          var out = compressBitmapToJpegUnder(im, MAX_CHARS);
          if (!out) {
            return {
              ok: false,
              error:
                "Image DP1 trop volumineuse même après compression (" +
                slotKey +
                "). Utilisez une image plus petite ou une capture moins détaillée.",
            };
          }
          draft.dp1.images[slotKey] = out;
          return { ok: true };
        })
        .catch(function () {
          return {
            ok: false,
            error: "Impossible de traiter une image DP1 (" + slotKey + ") pour la sauvegarde.",
          };
        });
    }

    return Promise.resolve({ ok: true });
  }

  /**
   * Normalisation async (autosave / PUT) — mutates draft.dp1.images in place.
   * @param {object} draft
   * @returns {Promise<{ok:boolean, error?:string}>}
   */
  function normalizeDraftImagesAsync(draft) {
    if (!draft || typeof draft !== "object") return Promise.resolve({ ok: true });
    var d1 = draft.dp1;
    if (!d1 || typeof d1 !== "object" || !d1.images || typeof d1.images !== "object") {
      return Promise.resolve({ ok: true });
    }
    var chain = Promise.resolve({ ok: true });
    SLOTS.forEach(function (slot) {
      chain = chain.then(function (prev) {
        if (!prev.ok) return prev;
        var raw = d1.images[slot.key];
        return normalizeOneSlotAsync(draft, slot.key, slot.sel, raw);
      });
    });
    return chain;
  }

  /**
   * Chemin synchrone (beforeunload) : uniquement compression depuis <img> déjà dans le DOM.
   * @param {object} draft
   * @returns {{ok:boolean, error?:string}}
   */
  function syncNormalizeFromDom(draft) {
    if (!draft || typeof draft !== "object") return { ok: true };
    var d1 = draft.dp1;
    if (!d1 || typeof d1 !== "object" || !d1.images || typeof d1.images !== "object") return { ok: true };
    for (var i = 0; i < SLOTS.length; i++) {
      var slot = SLOTS[i];
      var raw = d1.images[slot.key];
      if (!raw || typeof raw !== "string") continue;
      var s = raw.trim();
      if (!s || /^https?:\/\//i.test(s)) continue;
      if (s.indexOf("blob:") === 0 || (s.indexOf("data:image") === 0 && s.length > MAX_CHARS)) {
        var dom = pickImgForEncode(s, slot.sel);
        if (!dom || !dom.complete || dom.naturalWidth < 1) {
          return {
            ok: false,
            error:
              "Sauvegarde de secours impossible : ouvrez l’étape DP1 avant de fermer pour finaliser les images.",
          };
        }
        var out = compressBitmapToJpegUnder(dom, MAX_CHARS);
        if (!out) {
          return {
            ok: false,
            error: "Image DP1 trop lourde pour une sauvegarde de secours — ouvrez DP1 puis réessayez.",
          };
        }
        d1.images[slot.key] = out;
      }
    }
    for (var j = 0; j < SLOTS.length; j++) {
      var k = SLOTS[j].key;
      var v = d1.images[k];
      if (typeof v === "string" && v.indexOf("blob:") === 0) {
        return { ok: false, error: "Référence blob: non résolue — ouvrez DP1 avant de fermer l’onglet." };
      }
    }
    return { ok: true };
  }

  g.__solarnextDp1ImagePersist = {
    MAX_CHARS: MAX_CHARS,
    normalizeDraftImagesAsync: normalizeDraftImagesAsync,
    syncNormalizeFromDom: syncNormalizeFromDom,
  };
})(typeof window !== "undefined" ? window : globalThis);
