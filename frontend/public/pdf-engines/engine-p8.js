// ======================================================================
// ENGINE-P8 — Impact batterie : en-tête + schéma (HTML) + comparaison + bloc batterie
// Comparaison « Achat réseau annuel » : lire fullReport.p8.A|B.grid_import_kwh (viewModel).
// Origine mapper PDF : BASE = somme mensuelle import si dispo, sinon agrégé ; scénario batterie
// idem ; BATTERY_VIRTUAL = billable_import_kwh prioritaire (import facturable), jamais confondu
// avec le flux d’un autre scénario.
// ======================================================================

(function () {

  const $ = s => document.querySelector(s);
  const rRound = v => Math.round(Number(v) || 0);
  const rLoc = v => rRound(v).toLocaleString("fr-FR");

  function setText(sel, v) {
    const el = $(sel);
    if (!el) return;
    el.textContent = v === null || v === undefined ? "—" : String(v);
  }

  function autoconsPct(sc) {
    const prod = Number(sc?.production_kwh) || 0;
    const auto = Number(sc?.autocons_kwh) || 0;
    if (prod <= 0) return 0;
    return Math.round((auto / prod) * 100);
  }

  function fmtKwh(val) {
    if (val == null || !Number.isFinite(Number(val))) return "—";
    return `${rLoc(val)} kWh`;
  }

  function renderP8(d) {
    if (!d) return;

    setText("#p8_client", d.meta?.client || "—");
    setText("#p8_ref", d.meta?.ref || "—");
    setText("#p8_date", d.meta?.date || "—");

    const A = d.A || {};
    const B = d.B || {};
    const db = d.detailsBatterie || {};
    const hyp = d.hypotheses || {};
    const isVirt = d.batteryType === "VIRTUAL";

    const gainPts = db.gain_autonomie_pts != null ? rRound(db.gain_autonomie_pts) : 0;
    const reducGrid = db.reduction_achat_kwh != null ? rRound(db.reduction_achat_kwh) : 0;

    setText("#p8_hdr_line1", `+${gainPts} % d'autonomie énergétique`);
    setText("#p8_hdr_line2", `soit ~${rLoc(reducGrid)} kWh achetés en moins`);

    setText("#p8_cmp_a_auto", `${autoconsPct(A)} %`);
    setText("#p8_cmp_a_loss", fmtKwh(A.surplus_kwh));
    setText("#p8_cmp_a_grid", fmtKwh(A.grid_import_kwh));

    setText("#p8_cmp_b_auto", `${autoconsPct(B)} %`);
    setText("#p8_cmp_b_recv", fmtKwh(db.gain_autoconsommation_kwh));
    setText("#p8_cmp_b_grid", fmtKwh(B.grid_import_kwh));

    const physEl = $("#p8_kpi_physical");
    const virtEl = $("#p8_kpi_virtual");
    if (physEl && virtEl) {
      physEl.style.display = isVirt ? "none" : "";
      virtEl.style.display = isVirt ? "" : "none";
    }

    if (!isVirt) {
      const capRaw = d.snapshotBatteryCapacityKwh ?? hyp.capacite_utile_kwh;
      setText(
        "#p8_kpi_phys_cap",
        capRaw != null && Number.isFinite(Number(capRaw)) ? `${rLoc(capRaw)} kWh` : "—"
      );
      const cycY = hyp.cycles_an;
      const cycD = hyp.cycles_jour;
      const fmtCycY =
        cycY != null && Number.isFinite(Number(cycY))
          ? Number(cycY).toFixed(1).replace(".", ",")
          : "—";
      const fmtCycD =
        cycD != null && Number.isFinite(Number(cycD))
          ? Number(cycD).toFixed(2).replace(".", ",")
          : "—";
      setText("#p8_kpi_phys_cyc_y", fmtCycY);
      setText("#p8_kpi_phys_cyc_d", fmtCycD);
      const th = B.battery_throughput_kwh;
      setText(
        "#p8_kpi_phys_throughput",
        th != null && Number.isFinite(Number(th)) ? `${rLoc(th)} kWh` : "—"
      );
    } else {
      setText("#p8_kpi_virt_cred", fmtKwh(db.credited_kwh));
      setText("#p8_kpi_virt_use", fmtKwh(db.restored_kwh));
      setText("#p8_kpi_virt_loss", fmtKwh(db.overflow_export_kwh));
      const capV = hyp.capacite_utile_kwh;
      setText(
        "#p8_kpi_virt_cap",
        capV != null && Number.isFinite(Number(capV)) ? `${rLoc(capV)} kWh` : "—"
      );
      const cycV = hyp.cycles_an;
      setText(
        "#p8_kpi_virt_cyc",
        cycV != null && Number.isFinite(Number(cycV))
          ? Number(cycV).toFixed(1).replace(".", ",")
          : "—"
      );
    }

    const bvBlock = $("#p8_bv_block");
    if (bvBlock) {
      bvBlock.style.display = "none";
      setText("#p8_bv_credited", rLoc(db.credited_kwh));
      setText("#p8_bv_restored", rLoc(db.restored_kwh));
      setText("#p8_bv_import", rLoc(db.billable_import_kwh));
      setText("#p8_bv_overflow", rLoc(db.overflow_export_kwh));
    }

    const commercialHook = $("#p8_commercial_hook");
    const lineGain = $("#p8_line_gain_25y");
    const lineOpt = $("#p8_line_gain_option");
    if (commercialHook && lineGain) {
      const gainEur = d.gain_batterie_25_ans_eur;
      const okGain =
        gainEur != null && Number.isFinite(Number(gainEur)) && Number(gainEur) > 0;
      if (okGain) {
        commercialHook.style.display = "";
        commercialHook.removeAttribute("aria-hidden");
        lineGain.textContent = `+ ${rLoc(gainEur)} € d'économies supplémentaires sur 25 ans grâce à la batterie`;
        if (lineOpt) {
          const kwhOpt = d.option_supplement_kwh_25y;
          const autOpt = d.option_supplement_autonomie_pts;
          if (kwhOpt != null && Number.isFinite(Number(kwhOpt)) && Number(kwhOpt) > 0) {
            lineOpt.style.display = "";
            lineOpt.textContent = `+ ${rLoc(kwhOpt)} kWh valorisés en plus sur 25 ans`;
          } else if (autOpt != null && Number.isFinite(Number(autOpt)) && Number(autOpt) > 0) {
            lineOpt.style.display = "";
            lineOpt.textContent = `+ ${rLoc(autOpt)} % d'autonomie moyenne sur 25 ans`;
          } else {
            lineOpt.style.display = "none";
            lineOpt.textContent = "";
          }
        }
      } else {
        commercialHook.style.display = "none";
        commercialHook.setAttribute("aria-hidden", "true");
        lineGain.textContent = "";
        if (lineOpt) {
          lineOpt.style.display = "none";
          lineOpt.textContent = "";
        }
      }
    }
  }

  window.API = window.API || {};
  window.API.bindEngineP8 = function (Engine) {
    if (!Engine) return;

    if (typeof Engine.on === "function") {
      Engine.on("p8:update", payload => {
        $("#p8_results") && ($("#p8_results").style.display = "");
        renderP8(payload);
      });
    }

    if (typeof Engine.getP8 === "function") {
      const first = Engine.getP8();
      if (first) {
        $("#p8_results") && ($("#p8_results").style.display = "");
        renderP8(first);
      }
    }
  };

})();
