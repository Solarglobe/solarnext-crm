// ======================================================================
// ENGINE-MAIN â€” SmartPitch V3 (Version officielle Solarglobe - FINAL)
// ======================================================================
// - RÃ©cupÃ¨re le scÃ©nario choisi via ?scenario=A1
// - Charge automatiquement P1 â†’ P6
// - Stocke les donnÃ©es (cache interne)
// - Ã‰met "pX:update" pour chaque page
// ======================================================================

(function () {

  class Engine {
    constructor() {
      this._data = {};
      this._listeners = {};
      this._readyP1 = false;
    }

    // ================================================================
    // EVENTS
    // ================================================================
    on(event, handler) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(handler);

      // Rejoue P1 si dÃ©jÃ  chargÃ©e
      if (event === "p1:update" && this._readyP1 && this._data.p1) {
        try {
          handler(this._data.p1);
        } catch (e) {
          console.error("âŒ Erreur handler p1:update (replay) :", e);
        }
      }
    }

    _emit(event, payload) {
      if (!this._listeners[event]) return;
      this._listeners[event].forEach(fn => {
        try {
          fn(payload);
        } catch (e) {
          console.error("âŒ Erreur handler", event, ":", e);
        }
      });
    }

    // ================================================================
    // LOAD
    // ================================================================
    async load() {
      const scenario = this._getScenarioFromURL();
      if (!scenario) {
        console.warn("âš  Aucun scÃ©nario trouvÃ© dans lâ€™URL (ex: ?scenario=A1)");
        return;
      }

// ------------------------------------------------------------
// 1) Charger P1
// ------------------------------------------------------------
const p1URL = `/api/view/p1?scenario=${encodeURIComponent(scenario)}`;
const p1 = await this._fetchView(p1URL);

this._data.p1 = p1;
this._readyP1 = true;

if (!p1 || !p1.p1_auto) {
  console.warn("? P1 ignorée : payload vide");
  return;
}

console.log("\u2014 P1 re\u00E7ue (engine-main) :", p1);

// \u2014 \u00C9mission \u00E9v\u00E9nement (POINT FINAL ici)
this._emit("p1:update", p1);


      // ------------------------------------------------------------
      // 2) Charger P2
      // ------------------------------------------------------------
      try {
        const p2 = await this._fetchView(`/api/view/p2?scenario=${scenario}`);
        this._data.p2 = p2;
        console.log("ðŸ“„ P2 reÃ§ue :", p2);
        this._emit("p2:update", p2);
      } catch (err) {
        console.error("âŒ Erreur chargement P2 :", err);
      }

      // ------------------------------------------------------------
      // 3) Charger P3
      // ------------------------------------------------------------
      try {
        const p3 = await this._fetchView(`/api/view/p3?scenario=${scenario}`);
        this._data.p3 = p3;
        console.log("ðŸ“„ P3 reÃ§ue :", p3);
        this._emit("p3:update", p3);
      } catch (err) {
        console.error("âŒ Erreur chargement P3 :", err);
      }

      // ------------------------------------------------------------
// 3bis) Charger P3B (Calepinage)
// ------------------------------------------------------------
try {
  const p3b = await this._fetchView(`/api/view/p3b?scenario=${scenario}`);
  this._data.p3b = p3b;
  console.log("ðŸ“„ P3B reÃ§ue :", p3b);
  this._emit("p3b:update", p3b);
} catch (err) {
  console.error("âŒ Erreur chargement P3B :", err);
}


      // ------------------------------------------------------------
      // 4) Charger P4
      // ------------------------------------------------------------
      try {
        const p4 = await this._fetchView(`/api/view/p4?scenario=${scenario}`);
        this._data.p4 = p4;
        console.log("ðŸ“„ P4 reÃ§ue :", p4);
        this._emit("p4:update", p4);
      } catch (err) {
        console.error("âŒ Erreur chargement P4 :", err);
      }

      // ------------------------------------------------------------
      // 5) Charger P5
      // ------------------------------------------------------------
      try {
        const p5 = await this._fetchView(`/api/view/p5?scenario=${scenario}`);
        this._data.p5 = p5;
        console.log("ðŸ“„ P5 reÃ§ue :", p5);
        this._emit("p5:update", p5);
      } catch (err) {
        console.error("âŒ Erreur chargement P5 :", err);
      }

      // ------------------------------------------------------------
      // 6) Charger P6
      // ------------------------------------------------------------
      try {
        const p6 = await this._fetchView(`/api/view/p6?scenario=${scenario}`);
        this._data.p6 = p6;
        console.log("ðŸ“„ P6 reÃ§ue :", p6);
        this._emit("p6:update", p6);
      } catch (err) {
        console.error("âŒ Erreur chargement P6 :", err);
      }

      // ------------------------------------------------------------
      // 7) Charger P7
      // ------------------------------------------------------------
      try {
        const p7 = await this._fetchView(`/api/view/p7?scenario=${scenario}`);
        this._data.p7 = p7;
        console.log("ðŸ“„ P7 reÃ§ue :", p7);
        this._emit("p7:update", p7);
      } catch (err) {
        console.error("âŒ Erreur chargement P7 :", err);
   }

         // ------------------------------------------------------------
      // 8) Charger P8
      // ------------------------------------------------------------
      try {
        const p8 = await this._fetchView(`/api/view/p8?scenario=${scenario}`);
        this._data.p8 = p8;
        console.log("ðŸ“„ P8 reÃ§ue :", p8);
        this._emit("p8:update", p8);
      } catch (err) {
        console.error("âŒ Erreur chargement P8 :", err);
      }

            // ------------------------------------------------------------
      // 9) Charger P9
      // ------------------------------------------------------------
      try {
        const p9 = await this._fetchView(`/api/view/p9?scenario=${scenario}`);
        this._data.p9 = p9;
        console.log("ðŸ“„ P9 reÃ§ue :", p9);
        this._emit("p9:update", p9);
      } catch (err) {
        console.error("âŒ Erreur chargement P9 :", err);
      }

// ------------------------------------------------------------
// 10) Charger P10
// ------------------------------------------------------------
try {
  const raw = await this._fetchView(`/api/view/p10?scenario=${scenario}`);
  const p10 = raw.p10 || raw;

  this._data.p10 = p10;

  console.log("ðŸ“„ P10 reÃ§ue (fix):", p10);

  this._emit("p10:update", p10);
} catch (err) {
  console.error("âŒ Erreur chargement P10 :", err);
}

// ------------------------------------------------------------
// 11) Charger P11
// ------------------------------------------------------------
try {
  const p11 = await this._fetchView(`/api/view/p11?scenario=${scenario}`);
  this._data.p11 = p11;
  console.log("ðŸ“„ P11 reÃ§ue :", p11);

  // âš ï¸ AUTOMATISME â†’ envoyer vers l'engine
  this._emit("p11:auto", p11);

} catch (err) {
  console.error("âŒ Erreur chargement P11 :", err);
}


// ------------------------------------------------------------
// 12) Charger P12
// ------------------------------------------------------------
try {
  const p12 = await this._fetchView(`/api/view/p12?scenario=${scenario}`);
  this._data.p12 = p12;
  console.log("ðŸ“„ P12 reÃ§ue :", p12);
  this._emit("p12:update", p12);
} catch (err) {
  console.error("âŒ Erreur chargement P12 :", err);
}

// ------------------------------------------------------------
// 13) Charger P13
// ------------------------------------------------------------
try {
  const p13 = await this._fetchView(`/api/view/p13?scenario=${scenario}`);
  this._data.p13 = p13;
  console.log("ðŸ“„ P13 reÃ§ue :", p13);
  this._emit("p13:update", p13);
} catch (err) {
  console.error("âŒ Erreur chargement P13 :", err);
}

// ------------------------------------------------------------
// 14) Charger P14
// ------------------------------------------------------------
try {
  const p14 = await this._fetchView(`/api/view/p14?scenario=${scenario}`);
  this._data.p14 = p14;
  console.log("ðŸ“„ P14 reÃ§ue :", p14);
  this._emit("p14:update", p14);
} catch (err) {
  console.error("âŒ Erreur chargement P14 :", err);
}


      // ------------------------------------------------------------
      // SIGNAL FINAL
      // ------------------------------------------------------------
      setTimeout(() => {
        if (!window.__smartpitch_render_done) {
          window.__smartpitch_render_done = true;
        }
        this._emit("all:loaded", this._data);
      }, 600);
    }

    // ================================================================
    // FETCH
    // ================================================================
    async _fetchView(url) {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          console.error("âŒ Erreur HTTP view :", res.status, res.statusText);
          return {};
        }

        const txt = await res.text();

        if (txt.trim().startsWith("<")) {
          console.error("âŒ Backend a renvoyÃ© du HTML au lieu de JSON :", txt.slice(0, 200));
          return {};
        }

        return JSON.parse(txt);

      } catch (err) {
        console.error("âŒ Erreur fetch view :", err);
        return {};
      }
    }

    // ================================================================
    // ACCESSORS
    // ================================================================
    getP1() {
      return this._data.p1 || {};
    }

    getP5() {
      return this._data.p5 || {};
    }

    getP6() {
      return this._data.p6 || {};
    }

    getP7() {
      return this._data.p7 || {};
    }

        getP8() {
      return this._data.p8 || {};
    }

        getP9() {
      return this._data.p9 || {};
    }

    getP10() {
      return this._data.p10 || {};
    }

    getP11() {
      return this._data.p11 || {};
    }

    getP12() {
      return this._data.p12 || {};
   }

    getP13() {
      return this._data.p13 || {};
    }

    getP14() {
      return this._data.p14 || {};
    }


    // ================================================================
    // INTERNAL
    // ================================================================
    _getScenarioFromURL() {
      try {
        const url = new URL(window.location.href);
        return url.searchParams.get("scenario");
      } catch {
        return null;
      }
    }
  }

  // ------------------------------------------------------------------
  // BOOT
  // ------------------------------------------------------------------
  window.Engine = new Engine();
  window.Engine.load();

})();
