// ======================================================================
// ENGINE-P12 — Impact environnemental
// Solarglobe 2025 — Version OFFICIELLE (donut identique HTML)
// ======================================================================

(function(){

  // -------------------------------
  // Helpers
  // -------------------------------
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };

  const safeNum = (v, def = 0) => Number.isFinite(+v) ? +v : def;

  // -------------------------------
  // Donut
  // -------------------------------
  function setDash(id, on, total, offset){
    const el = document.getElementById(id);
    if(!el) return;
    el.setAttribute("stroke-dasharray", `${on} ${total}`);
    if(offset !== undefined){
      el.setAttribute("stroke-dashoffset", `${offset}`);
    }
  }

  // -------------------------------
  // RENDER
  // -------------------------------
  function renderP12(payload){
    if(!payload) return;

    const meta = payload.meta || {};
    const env  = payload.env  || {};

    // -------------------------
    // META (client / ref / date)
    // -------------------------
    set("p12_client", meta.client || "—");
    set("p12_ref",    meta.ref    || "—");
    set("p12_date",   meta.date   || "—");

    // -------------------------
    // KPI (déjà calculés par le backend)
    // -------------------------
    set("v_co2",      payload.v_co2      || "—");
    set("v_trees",    payload.v_trees    || "—");
    set("v_cars",     payload.v_cars     || "—");

    set("v_co2_25",   payload.v_co2_25   || "—");
    set("v_trees_25", payload.v_trees_25 || "—");
    set("v_cars_25",  payload.v_cars_25  || "—");

    // -------------------------
    // DONUT (autoconsommation vs injection)
    // -------------------------
    const autoPct = safeNum(env.autocons_pct, 0);
    const CIRC = 2 * Math.PI * 42;  // identique HTML

    const autoLen = (autoPct / 100) * CIRC;
    const injLen  = CIRC - autoLen;

    setDash("donut_auto", autoLen.toFixed(2), CIRC.toFixed(2));
    setDash("donut_inj",  injLen.toFixed(2),  CIRC.toFixed(2), -autoLen.toFixed(2));

    set("donut_center", `${Math.round(autoPct)} %`);
  }

  // -------------------------------
  // ENGINE BIND
  // -------------------------------
  const API = (window.SmartPitch = window.SmartPitch || {});
  API.renderP12 = renderP12;

  API.bindEngineP12 = function(engine){
    if(!engine) return;

    engine.on("p12:update", data => {
      renderP12(data);
    });

    if(typeof engine.getP12 === "function"){
      const first = engine.getP12();
      if(first) renderP12(first);
    }
  };

  if(window.Engine){
    API.bindEngineP12(window.Engine);
  }

})();
