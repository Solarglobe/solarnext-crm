/**
 * Construction du snapshot complet figé au clic "Choisir ce scénario".
 * Agrège : lead/site_address (client, site), quote-prep (installation, equipment),
 * scenarios_v2 (shading, energy, finance, production, cashflows, assumptions).
 * Garantit que PDF / comparatif / devis final peuvent être générés sans relancer le moteur calcul.
 */

import { pool } from "../config/db.js";
import * as quotePrepService from "./quotePrep/quotePrep.service.js";

/**
 * Construit le snapshot complet pour selected_scenario_snapshot.
 * @param {{ studyId: string, versionId: string, scenarioId: string, organizationId: string, dataJson: object }}
 * @returns {Promise<object>} Snapshot au format documenté (client, site, installation, equipment, shading, energy, finance, production, cashflows, assumptions)
 */
export async function buildSelectedScenarioSnapshot({
  studyId,
  versionId,
  scenarioId,
  organizationId,
  dataJson,
}) {
  const scenario = (dataJson?.scenarios_v2 || []).find(
    (s) => (s.id || s.name) === scenarioId
  );
  if (!scenario) {
    throw new Error(`Scénario ${scenarioId} introuvable dans scenarios_v2`);
  }

  console.log("STEP 1b BEFORE: load study row from studies table");
  const studyRes = await pool.query(
    `SELECT s.lead_id, s.client_id
     FROM studies s
     WHERE s.id = $1 AND s.organization_id = $2 AND (s.archived_at IS NULL) AND (s.deleted_at IS NULL)`,
    [studyId, organizationId]
  );
  if (studyRes.rows.length === 0) {
    throw new Error("Étude non trouvée");
  }
  console.log("STEP 1b OK: study row loaded");
  const study = studyRes.rows[0];
  const leadId = study.lead_id;
  const clientId = study.client_id;

  let client = { nom: null, prenom: null, adresse: null, cp: null, ville: null };
  let site = {
    lat: null,
    lon: null,
    orientation_deg: null,
    tilt_deg: null,
    puissance_compteur_kva: null,
    type_reseau: null,
  };

  if (leadId) {
    const leadRes = await pool.query(
      `SELECT l.first_name, l.last_name, l.company_name, l.contact_first_name, l.contact_last_name,
              l.customer_type, l.site_address_id, l.meter_power_kva, l.grid_type
       FROM leads l
       WHERE l.id = $1 AND l.organization_id = $2 AND (l.archived_at IS NULL)`,
      [leadId, organizationId]
    );
    const lead = leadRes.rows[0] || null;
    if (lead) {
      const isProLead = (lead.customer_type ?? "PERSON") === "PRO";
      if (isProLead) {
        // PRO : nom principal = entreprise, prenom = contact
        client.nom = lead.company_name ?? null;
        client.prenom = [lead.contact_first_name, lead.contact_last_name].filter(Boolean).join(" ") || null;
      } else {
        client.nom = lead.last_name ?? null;
        client.prenom = lead.first_name ?? null;
      }
      site.puissance_compteur_kva =
        lead.meter_power_kva != null ? Number(lead.meter_power_kva) : null;
      site.type_reseau = lead.grid_type ?? null;

      if (lead.site_address_id) {
        const addrRes = await pool.query(
          `SELECT address_line1, address_line2, postal_code, city, lat, lon, formatted_address
           FROM addresses WHERE id = $1 AND organization_id = $2`,
          [lead.site_address_id, organizationId]
        );
        const addr = addrRes.rows[0] || null;
        if (addr) {
          client.adresse =
            addr.formatted_address ||
            [addr.address_line1, addr.address_line2]
              .filter(Boolean)
              .join(", ") ||
            null;
          client.cp = addr.postal_code ?? null;
          client.ville = addr.city ?? null;
          site.lat =
            addr.lat != null && !Number.isNaN(Number(addr.lat))
              ? Number(addr.lat)
              : null;
          site.lon =
            addr.lon != null && !Number.isNaN(Number(addr.lon))
              ? Number(addr.lon)
              : null;
        }
      }
    }

    if (clientId) {
      const clientRes = await pool.query(
        `SELECT first_name, last_name, company_name
         FROM clients WHERE id = $1 AND organization_id = $2`,
        [clientId, organizationId]
      );
      const c = clientRes.rows[0] || null;
      if (c) {
        if (c.company_name != null) {
          // PRO converti : company_name = nom principal, first_name + last_name = contact
          client.nom = c.company_name;
          const contactName = [c.first_name, c.last_name].filter(Boolean).join(" ") || null;
          if (contactName) client.prenom = contactName;
        } else {
          // PERSON : comportement inchangé
          if (c.last_name != null) client.nom = c.last_name;
          if (c.first_name != null) client.prenom = c.first_name;
        }
      }
    }
  }

  let technical = null;
  console.log("STEP 2b BEFORE: getQuotePrep (technical snapshot / quote-prep)");
  try {
    const quotePrep = await quotePrepService.getQuotePrep({
      studyId,
      versionId,
      organizationId,
    });
    technical = quotePrep.technical_snapshot_summary || null;
  } catch (_) {
    // Pas de calpinage / quote-prep : installation et equipment restent vides
  }
  console.log("STEP 2b OK: getQuotePrep step finished");

  if (technical) {
    site.orientation_deg = technical.orientation_deg ?? site.orientation_deg;
    site.tilt_deg = technical.tilt_deg ?? site.tilt_deg;
    if (technical.gps && (technical.gps.lat != null || technical.gps.lon != null)) {
      if (site.lat == null) site.lat = Number(technical.gps.lat) || null;
      if (site.lon == null) site.lon = Number(technical.gps.lon) || null;
    }
  }

  /** Dernier calcul : cohérence PDF / site avec le compteur réellement utilisé (pas seulement leads à plat). */
  const meterSnap =
    dataJson.meter_snapshot && typeof dataJson.meter_snapshot === "object"
      ? dataJson.meter_snapshot
      : null;
  if (meterSnap) {
    if (meterSnap.meter_power_kva != null) {
      site.puissance_compteur_kva = Number(meterSnap.meter_power_kva);
    }
    if (meterSnap.grid_type != null) {
      site.type_reseau = meterSnap.grid_type;
    }
  }

  const installation = {
    panneaux_nombre: technical?.nb_panels ?? technical?.total_panels ?? null,
    puissance_kwc: technical?.power_kwc ?? technical?.total_power_kwc ?? null,
    production_annuelle_kwh: technical?.production_annual_kwh ?? null,
    surface_panneaux_m2: null,
  };

  const equipment = {
    panneau:
      technical?.panel && typeof technical.panel === "object"
        ? {
            id: technical.panel.id ?? technical.panel.panel_id ?? null,
            panel_id: technical.panel.panel_id ?? technical.panel.id ?? null,
            marque: technical.panel.brand ?? null,
            modele: technical.panel.model ?? null,
            puissance_wc: technical.panel.power_wc ?? null,
            largeur_mm: technical.panel.width_mm ?? null,
            hauteur_mm: technical.panel.height_mm ?? null,
          }
        : {
            id: null,
            panel_id: null,
            marque: null,
            modele: null,
            puissance_wc: null,
            largeur_mm: null,
            hauteur_mm: null,
          },
    onduleur:
      technical?.inverter && typeof technical.inverter === "object"
        ? {
            id: technical.inverter.id ?? technical.inverter.inverter_id ?? null,
            inverter_id: technical.inverter.inverter_id ?? technical.inverter.id ?? null,
            marque: technical.inverter.brand ?? null,
            modele: technical.inverter.name ?? technical.inverter.model_ref ?? null,
            quantite: technical.inverter_totals?.units_required ?? null,
            puissance_nominale_kw: technical.inverter.nominal_power_kw ?? null,
            nominal_va: technical.inverter.nominal_va ?? null,
            rendement_euro_pct: technical.inverter.euro_efficiency_pct ?? null,
            modules_par_onduleur: technical.inverter.modules_per_inverter ?? null,
          }
        : {
            id: null,
            inverter_id: null,
            marque: null,
            modele: null,
            quantite: null,
            puissance_nominale_kw: null,
            nominal_va: null,
            rendement_euro_pct: null,
            modules_par_onduleur: null,
          },
    batterie: {
      id: scenario.hardware?.battery_id ?? null,
      capacite_kwh:
        scenario.hardware?.battery_usable_kwh ??
        scenario.hardware?.battery_capacity_kwh ??
        null,
      type:
        scenarioId === "BATTERY_PHYSICAL"
          ? "physique"
          : scenarioId === "BATTERY_VIRTUAL"
            ? "virtuelle"
            : scenarioId === "BATTERY_HYBRID"
              ? "hybride"
              : null,
    },
  };

  const shading = {
    near_loss_pct: scenario.shading?.near_loss_pct ?? null,
    far_loss_pct: scenario.shading?.far_loss_pct ?? null,
    total_loss_pct: scenario.shading?.total_loss_pct ?? null,
  };

  const energy = {
    production_kwh: scenario.energy?.production_kwh ?? null,
    consumption_kwh: scenario.energy?.consumption_kwh ?? null,
    autoconsumption_kwh: scenario.energy?.autoconsumption_kwh ?? null,
    surplus_kwh: scenario.energy?.surplus_kwh ?? null,
    import_kwh: scenario.energy?.import_kwh ?? null,
    billable_import_kwh: scenario.energy?.billable_import_kwh ?? null,
    independence_pct: scenario.energy?.energy_independence_pct ?? null,
    direct_self_consumption_kwh: scenario.energy?.direct_self_consumption_kwh ?? null,
    battery_discharge_kwh: scenario.energy?.battery_discharge_kwh ?? null,
    total_pv_used_on_site_kwh: scenario.energy?.total_pv_used_on_site_kwh ?? null,
    exported_kwh: scenario.energy?.exported_kwh ?? null,
    pv_self_consumption_pct: scenario.energy?.pv_self_consumption_pct ?? null,
    site_autonomy_pct: scenario.energy?.site_autonomy_pct ?? null,
    energy_solar_used_kwh: scenario.energy?.energy_solar_used_kwh ?? null,
    energy_grid_import_kwh:
      scenario.energy?.energy_grid_import_kwh ??
      scenario.energy?.billable_import_kwh ??
      scenario.energy?.grid_import_kwh ??
      scenario.energy?.import_kwh ??
      null,
  };

  const vf = scenario.virtual_battery_finance && typeof scenario.virtual_battery_finance === "object"
    ? scenario.virtual_battery_finance
    : null;
  const impKwh = Number(energy.import_kwh);
  const residualBill = scenario.finance?.residual_bill_eur ?? scenario.residual_bill_eur;
  const priceImplied =
    impKwh > 0 && residualBill != null && Number.isFinite(Number(residualBill))
      ? Number(residualBill) / impKwh
      : null;
  const residualBillVirtualBreakdown =
    scenarioId === "BATTERY_VIRTUAL" && vf
      ? {
          grid_import_kwh: Number.isFinite(impKwh) ? impKwh : null,
          energy_purchase_from_grid_eur:
            impKwh > 0 && priceImplied != null ? Math.round(impKwh * priceImplied * 100) / 100 : null,
          virtual_battery_subscription_ttc: vf.annual_subscription_ttc ?? null,
          virtual_battery_autoproducer_contribution_ttc: vf.annual_autoproducer_contribution_ttc ?? null,
          virtual_battery_discharge_fees_ttc: vf.annual_virtual_discharge_cost_ttc ?? null,
          virtual_battery_activation_ttc: vf.annual_activation_fee_ttc ?? null,
          activation_applies_note:
            (vf.annual_activation_fee_ttc ?? 0) > 0
              ? "Frais d'activation : première année contractuelle (TTC), si applicable."
              : null,
          supplier_subscription_eur: null,
          supplier_subscription_note:
            "Abonnement fournisseur (accès réseau, puissance souscrite) : non ventilé dans le moteur (hors hypothèse kWh projet).",
          discharge_fees_note:
            "Ligne « restitution stockage virtuel » : coûts associés aux kWh restitués (composantes fournisseur agrégées TTC).",
        }
      : null;

  const finance = {
    capex_ttc: scenario.finance?.capex_ttc ?? null,
    economie_year_1: scenario.finance?.economie_year_1 ?? null,
    economie_total: scenario.finance?.economie_total ?? null,
    roi_years: scenario.finance?.roi_years ?? null,
    irr_pct: scenario.finance?.irr_pct ?? null,
    facture_restante: scenario.finance?.residual_bill_eur ?? null,
    revenu_surplus: scenario.finance?.surplus_revenue_eur ?? null,
    estimated_annual_bill_eur:
      scenario.finance?.estimated_annual_bill_eur ??
      scenario.finance?.residual_bill_eur ??
      null,
    residual_bill_virtual_breakdown: residualBillVirtualBreakdown,
  };

  const production = {
    annual_kwh: scenario.production?.annual_kwh ?? null,
    monthly_kwh: scenario.production?.monthly_kwh ?? null,
  };

  const flows = Array.isArray(scenario.finance?.annual_cashflows)
    ? scenario.finance.annual_cashflows.map((f) => ({
        year: f.year ?? null,
        gain: f.total_eur ?? f.gain_auto ?? f.gain_oa ?? null,
        cumul: f.cumul_eur ?? null,
        cumul_gains: f.cumul_gains_eur ?? null
      }))
    : [];

  const assumptions = {
    model_version: scenario.assumptions?.model_version ?? null,
    shading_source: scenario.assumptions?.shading_source ?? null,
    battery_enabled: scenario.assumptions?.battery_enabled ?? false,
    virtual_enabled: scenario.assumptions?.virtual_enabled ?? false,
  };

  const created_at = new Date().toISOString();

  return {
    scenario_type: scenarioId,
    created_at,

    client,
    site,
    installation,
    equipment,
    shading,

    energy,
    finance,
    production,
    cashflows: flows,
    assumptions,
    ...(meterSnap
      ? {
          study_meter: {
            selected_meter_id: dataJson.selected_meter_id ?? meterSnap.selected_meter_id ?? null,
            snapshot_captured_at: dataJson.meter_snapshot_captured_at ?? null,
            snapshot: meterSnap,
          },
        }
      : {}),
  };
}
