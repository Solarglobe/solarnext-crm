/**
 * PDF Engine Bridge — Remplace engine-main pour le flux viewModel unifié.
 * Crée window.Engine avec on/emit, permet d'injecter le viewModel et d'émettre p3:update, p4:update, etc.
 * Les engines legacy (p3, p3b, p4, p5) s'attachent à Engine et reçoivent les données.
 *
 * CP-PDF-P1-FIX : window.API créé ICI, avant tout engine-p*.js, pour éviter
 * que engine-p1.js (qui ne crée pas window.API) échoue au chargement.
 */
(function () {
  "use strict";

  // Garantir window.API existe AVANT tout bind engine (engine-p1 n'en crée pas)
  window.API = window.API || {};

  const listeners = {};

  let _data = {};

  const Engine = {
    on: function (event, handler) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    },
    _emit: function (event, payload) {
      const fns = listeners[event];
      if (!fns) return;
      fns.forEach(function (fn) {
        try {
          fn(payload);
        } catch (e) {
          console.error("Engine emit error", event, e);
        }
      });
    },
    getP1: function () {
      return _data.p1 || {};
    },
    getP2: function () {
      return _data.p2 || {};
    },
    getP11: function () {
      return _data.p11 || {};
    },
  };

  window.Engine = Engine;

  /**
   * Émet les données du viewModel vers tous les engines P1-P14.
   * @param {object} viewModel - viewModel complet (fullReport.p1, .p2, ...)
   */
  window.emitPdfViewData = function (viewModel) {
    if (!viewModel || !viewModel.fullReport) return;
    const fr = viewModel.fullReport;
    _data.p1 = fr.p1 || {};
    _data.p2 = fr.p2 || {};
    _data.p11 = fr.p11 || {};
    if (fr.p1) Engine._emit("p1:update", fr.p1);
    if (fr.p2) Engine._emit("p2:update", fr.p2);
    if (fr.p3) Engine._emit("p3:update", fr.p3);
    if (fr.p3b) Engine._emit("p3b:update", fr.p3b);
    if (fr.p4) Engine._emit("p4:update", fr.p4);
    if (fr.p5) Engine._emit("p5:update", fr.p5);
    if (fr.p6) Engine._emit("p6:update", fr.p6);
    if (fr.p7) Engine._emit("p7:update", fr.p7);
    if (fr.p8) Engine._emit("p8:update", fr.p8);
    if (fr.p9) Engine._emit("p9:update", fr.p9);
    if (fr.p10) Engine._emit("p10:update", fr.p10);
    if (fr.p11) Engine._emit("p11:update", fr.p11);
    if (fr.p12) Engine._emit("p12:update", fr.p12);
  };
})();
