/**
 * CP-006 Phase 3 Premium — Validation électrique dimensionnement onduleur.
 * Module ESM compatible navigateur et Node.
 * Même logique que calpinage.module.js validateInverterSizing().
 */
import { normalizeInverterFamily } from "./utils/normalizeInverterFamily";

/**
 * @param {Object} opts
 * @param {number} opts.totalPanels
 * @param {number} opts.totalPowerKwc
 * @param {Object|null} opts.inverter
 * @param {Object|null} opts.panelSpec - { power_wc, isc_a, vmp_v, strings }
 * @returns {{ requiredUnits: number, isDcPowerOk: boolean, isCurrentOk: boolean, isMpptOk: boolean, isVoltageOk: boolean, warnings: string[] }}
 */
export function validateInverterSizing(opts) {
  var totalPanels = opts.totalPanels || 0;
  var totalPowerKwc = opts.totalPowerKwc || 0;
  var inverter = opts.inverter || null;
  var panelSpec = opts.panelSpec || null;
  var requiredUnits = 0;
  var isDcPowerOk = true;
  var isCurrentOk = true;
  var isMpptOk = true;
  var isVoltageOk = true;
  var warnings = [];

  if (!inverter) {
    return { requiredUnits: 0, isDcPowerOk: true, isCurrentOk: true, isMpptOk: true, isVoltageOk: true, warnings: [] };
  }

  var family = normalizeInverterFamily(inverter) || "CENTRAL";
  var type = (inverter.inverter_type || inverter.type || "").toLowerCase();
  var maxDcKw = inverter.max_dc_power_kw != null && Number.isFinite(Number(inverter.max_dc_power_kw))
    ? Number(inverter.max_dc_power_kw) : null;
  var maxInputCurrentA = inverter.max_input_current_a != null && Number.isFinite(Number(inverter.max_input_current_a))
    ? Number(inverter.max_input_current_a) : null;
  var mpptCount = inverter.mppt_count != null && Number.isFinite(Number(inverter.mppt_count))
    ? Number(inverter.mppt_count) : null;
  var mpptMinV = inverter.mppt_min_v != null && Number.isFinite(Number(inverter.mppt_min_v))
    ? Number(inverter.mppt_min_v) : null;
  var mpptMaxV = inverter.mppt_max_v != null && Number.isFinite(Number(inverter.mppt_max_v))
    ? Number(inverter.mppt_max_v) : null;

  if (family === "MICRO" || type === "micro") {
    // MICRO : modules_per_inverter manquant → défaut 1 (warning, pas Incompatible)
    var mpi = inverter.modules_per_inverter;
    var modulesPerInverter = (mpi != null && Number.isFinite(Number(mpi)) && Number(mpi) > 0) ? Number(mpi) : 0;
    if (modulesPerInverter <= 0) {
      modulesPerInverter = 1;
      warnings.push("Catalogue incomplet (micro) — modules_per_inverter manquant, défaut=1");
    }
    requiredUnits = Math.ceil(totalPanels / modulesPerInverter);

    // Courant par entrée : entryModules = inputs_per_mppt si > 0, sinon modules_per_inverter
    var inputsPerMppt = inverter.inputs_per_mppt != null && Number.isFinite(Number(inverter.inputs_per_mppt)) && Number(inverter.inputs_per_mppt) > 0
      ? Number(inverter.inputs_per_mppt) : 0;
    var entryModules = inputsPerMppt > 0 ? inputsPerMppt : modulesPerInverter;

    // isc_a manquant pour MICRO : warning seulement, isCurrentOk = true (courant non bloquant UX vente)
    var iscA = panelSpec && panelSpec.isc_a != null && Number.isFinite(Number(panelSpec.isc_a)) ? Number(panelSpec.isc_a) : null;
    if (panelSpec != null && (iscA == null || iscA <= 0)) {
      warnings.push("Catalogue panneau incomplet — isc_a manquant (courant non vérifié)");
      isCurrentOk = true;
    } else if (iscA != null && iscA > 0 && maxInputCurrentA != null) {
      var inputCurrentA = iscA * entryModules;
      if (inputCurrentA > maxInputCurrentA) {
        isCurrentOk = false;
        warnings.push("Courant d'entrée micro-onduleur dépassé (" + inputCurrentA.toFixed(2) + " A > " + maxInputCurrentA.toFixed(2) + " A)");
      }
    }

    // Puissance DC
    if (maxDcKw != null && requiredUnits > 0) {
      var maxTotalDcKw = requiredUnits * maxDcKw;
      if (totalPowerKwc > maxTotalDcKw) {
        isDcPowerOk = false;
        warnings.push("Puissance DC dépasse capacité micro-onduleur (" + totalPowerKwc.toFixed(2) + " kWc > " + maxTotalDcKw.toFixed(2) + " kWc)");
      }
    }
  } else if (family === "CENTRAL" || type === "string") {
    // C) Verrou défensif string : tous les champs critiques obligatoires
    var nominalPowerKw = inverter.nominal_power_kw;
    var hasNominalPower = nominalPowerKw != null && Number.isFinite(Number(nominalPowerKw)) && Number(nominalPowerKw) > 0;
    var hasMpptCount = mpptCount != null && mpptCount > 0;
    var hasMpptMinV = mpptMinV != null && Number.isFinite(Number(mpptMinV)) && Number(mpptMinV) > 0;
    var hasMpptMaxV = mpptMaxV != null && Number.isFinite(Number(mpptMaxV)) && Number(mpptMaxV) > 0;
    var hasMaxInputCurrent = maxInputCurrentA != null && Number.isFinite(Number(maxInputCurrentA)) && Number(maxInputCurrentA) > 0;
    var hasMaxDcPower = maxDcKw != null && Number.isFinite(Number(maxDcKw)) && Number(maxDcKw) > 0;
    var mpptRangeOk = hasMpptMinV && hasMpptMaxV && mpptMaxV > mpptMinV;
    var catalogueComplete = hasNominalPower && hasMpptCount && mpptRangeOk && hasMaxInputCurrent && hasMaxDcPower;
    if (!catalogueComplete) {
      return {
        requiredUnits: 0,
        isDcPowerOk: false,
        isCurrentOk: false,
        isMpptOk: false,
        isVoltageOk: false,
        warnings: ["Catalogue incomplet (string) — impossible dimensionnement"]
      };
    }

    var invPower = Number(inverter.nominal_power_kw);
    requiredUnits = (invPower > 0 && totalPowerKwc > 0) ? Math.ceil(totalPowerKwc / invPower) : 0;

    // Répartition équitable sur mppt_count
    if (mpptCount != null && mpptCount > 0 && totalPanels > 0) {
      var panelsPerMppt = Math.ceil(totalPanels / mpptCount);
      // strings = Array(mppt_count).fill(panelsPerMppt) — structure interne

      // Tension MPPT
      if (panelSpec && panelSpec.vmp_v != null && Number.isFinite(Number(panelSpec.vmp_v)) && mpptMinV != null && mpptMaxV != null) {
        var stringVoltage = panelsPerMppt * Number(panelSpec.vmp_v);
        if (stringVoltage < mpptMinV || stringVoltage > mpptMaxV) {
          isMpptOk = false;
          isVoltageOk = false;
          warnings.push("Tension MPPT hors plage (" + stringVoltage.toFixed(0) + " V, plage " + mpptMinV + "-" + mpptMaxV + " V)");
        }
      }

      // Courant string (courant entrée = panelSpec.isc_a)
      if (panelSpec && panelSpec.isc_a != null && Number.isFinite(Number(panelSpec.isc_a)) && maxInputCurrentA != null) {
        var panelIsc = Number(panelSpec.isc_a);
        if (panelIsc > maxInputCurrentA) {
          isCurrentOk = false;
          warnings.push("Courant entrée string dépassé (" + panelIsc.toFixed(2) + " A > " + maxInputCurrentA.toFixed(2) + " A)");
        }
      }
    }

    // Puissance DC
    if (maxDcKw != null && requiredUnits > 0) {
      var maxTotalDcKwStr = requiredUnits * maxDcKw;
      if (totalPowerKwc > maxTotalDcKwStr) {
        isDcPowerOk = false;
        warnings.push("Puissance DC dépasse capacité onduleur (" + totalPowerKwc.toFixed(2) + " kWc > " + maxTotalDcKwStr.toFixed(2) + " kWc)");
      }
    }

    // Fallback: MPPT count si panelSpec.strings fourni (legacy)
    if (mpptCount != null && mpptCount > 0 && panelSpec && Array.isArray(panelSpec.strings) && panelSpec.strings.length > mpptCount) {
      isMpptOk = false;
      warnings.push("Nombre de strings (" + panelSpec.strings.length + ") > MPPT (" + mpptCount + ")");
    }
  }

  return { requiredUnits: requiredUnits, isDcPowerOk: isDcPowerOk, isCurrentOk: isCurrentOk, isMpptOk: isMpptOk, isVoltageOk: isVoltageOk, warnings: warnings };
}
