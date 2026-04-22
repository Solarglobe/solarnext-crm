/**
 * Cartographie parseur / AnnexFamily → taxonomie officielle Prompt 8.
 */

import type { AnnexDiscriminated, AnnexFamily, RoofAnnexOfficialFamily } from "../model/canonicalHouse3DModel";

export function mapAnnexFamilyToOfficial(
  family: AnnexFamily,
  annex: AnnexDiscriminated,
): { annexFamily: RoofAnnexOfficialFamily; sourceEntityKind: string } {
  if (annex.annexId.includes("skylight") || annex.annexId.includes("velux")) {
    return { annexFamily: "roof_opening", sourceEntityKind: "runtime_obstacle_skylight_hint" };
  }
  switch (family) {
    case "layout_keepout":
      return { annexFamily: "roof_keepout_zone", sourceEntityKind: "layout_keepout" };
    case "physical_roof_obstacle":
      return { annexFamily: "roof_obstacle_solid", sourceEntityKind: "runtime_obstacle" };
    case "shading_volume":
      return { annexFamily: "roof_shadow_volume", sourceEntityKind: "shadow_volume" };
    case "roof_extension":
      return { annexFamily: "roof_extension_volume", sourceEntityKind: "roof_extension" };
    case "future_opening":
      return { annexFamily: "roof_opening", sourceEntityKind: "future_opening" };
    case "future_parapet_acrotere":
      return { annexFamily: "roof_edge_uplift", sourceEntityKind: "parapet_acrotere" };
    default:
      return { annexFamily: "roof_unknown_annex", sourceEntityKind: "unknown" };
  }
}
