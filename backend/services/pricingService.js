// ======================================================================
// SMARTPITCH V-LIGHT — PRICING SERVICE (VERSION OFFICIELLE SOLARGLOBE)
// ======================================================================
// 🔥 TOUT vient du front : settings.pricing.*
// 🔥 KIT = prix unitaire “panneau + micro-onduleur”
//    - kit_price_lt_4_5  = prix unitaire HT si ≤ 4.5 kWc
//    - kit_price_gt_4_5  = prix unitaire HT si > 4.5 kWc
// 🔥 Coffret mono/tri fournis par le front
// 🔥 Pose = install_tiers[] dynamique du front
// 🔥 Batterie = battery_unit_price_ht (CRM) > battery_atmoce_unit_price_ht (legacy) > 450
// 🔥 TVA = 10% si ≤ 3 kWc, sinon 20%
// ======================================================================

export function computeTotal(ctx, options) {
  const { kwc, batterie } = options;

  const pricing = ctx.pricing || ctx.settings.pricing;

  // ------------------------------------------------------------
  // 1) Puissance panneau
  // ------------------------------------------------------------
  const panel_power_w = Number(pricing.kit_panel_power_w || 485);

  // ------------------------------------------------------------
  // 2) Prix unitaire panneau + micro (HT)
  // ------------------------------------------------------------
  let unit_price_ht = 0;

  if (kwc <= 4.5) {
    unit_price_ht = Number(pricing.kit_price_lt_4_5);
  } else {
    unit_price_ht = Number(pricing.kit_price_gt_4_5);
  }

  // ------------------------------------------------------------
  // 3) Nombre de panneaux
  // ------------------------------------------------------------
  const nb_panneaux = Math.max(
    1,
    Math.round((kwc * 1000) / panel_power_w)
  );

  const kit_ht = nb_panneaux * unit_price_ht;

  // ------------------------------------------------------------
  // 4) Coffret (mono ou tri)
  // ------------------------------------------------------------
const reseau = (ctx.site.reseau_type || "").toLowerCase();

const coffret_ht =
  reseau === "tri"
    ? Number(pricing.coffret_tri_ht)
    : Number(pricing.coffret_mono_ht);

 // ------------------------------------------------------------
// 5) Pose (tiers dynamique du front)
// ------------------------------------------------------------
let pose_ht = 0;

if (pricing.install_tiers) {
  const tiers = [...pricing.install_tiers].sort((a, b) => a.kwc - b.kwc);

  // 1) Cherche un palier correspondant
  for (let t of tiers) {
    if (kwc <= t.kwc) {
      pose_ht = Number(t.price_ht);
      break;
    }
  }

  // 2) Si installation > plus grand palier → appliquer +200 €/kWc
  if (pose_ht === 0 && tiers.length > 0) {
    const last = tiers[tiers.length - 1];
    const kwc_over = kwc - last.kwc;       // dépassement kWc
    const extra = Math.ceil(kwc_over) * 200; // +200€/kW par kW ou fraction
    pose_ht = Number(last.price_ht) + extra;
  }
}


  // ------------------------------------------------------------
  // 6) Batterie (HT) — mapping rétrocompatible CRM
  // battery_unit_price_ht (CRM) > battery_atmoce_unit_price_ht (legacy) > 450
  // ------------------------------------------------------------
  const batteryPrice =
    pricing.battery_unit_price_ht ??
    pricing.battery_atmoce_unit_price_ht ??
    450;
  const battery_ht = batterie ? Number(batteryPrice) : 0;

  // ------------------------------------------------------------
  // 7) TVA
  // ------------------------------------------------------------
  const tva_rate = kwc <= 3 ? 0.10 : 0.20;

  // ------------------------------------------------------------
  // 8) Totaux
  // ------------------------------------------------------------
  const total_ht = kit_ht + coffret_ht + pose_ht + battery_ht;
  const total_ttc = total_ht * (1 + tva_rate);
// ------------------------------------------------------------
// PATCH — FORCAGE PRIX SÉPARÉ (SANS / AVEC BATTERIE)
// ------------------------------------------------------------
if (ctx?.force?.active) {
  // Scénario SANS batterie
  if (!batterie && ctx.force.prix_sans > 0) {
    return {
      kwc,
      nb_panneaux,
      panel_power_w,
      unit_price_ht,
      kit_ht,
      coffret_ht,
      pose_ht,
      battery_ht,
      tva_rate,
      total_ht,
      total_ttc: ctx.force.prix_sans
    };
  }

  // Scénario AVEC batterie
  if (batterie && ctx.force.prix_avec > 0) {
    return {
      kwc,
      nb_panneaux,
      panel_power_w,
      unit_price_ht,
      kit_ht,
      coffret_ht,
      pose_ht,
      battery_ht,
      tva_rate,
      total_ht,
      total_ttc: ctx.force.prix_avec
    };
  }
}

  return {
    kwc,
    nb_panneaux,

    panel_power_w,
    unit_price_ht,

    kit_ht,
    coffret_ht,
    pose_ht,
    battery_ht,

    tva_rate,
    total_ht,
    total_ttc
  };
}
