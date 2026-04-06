/**
 * Modèle équipements V2 (aligné backend schemaVersion + items[])
 */

export type EquipmentKind = "ve" | "pac" | "ballon";

export type UsageLevel = "faible" | "moyen" | "fort";
export type PacType = "air_air" | "air_eau";
export type EquipmentRole = "principal" | "appoint";

export type EquipmentItem = {
  id: string;
  kind: EquipmentKind;
  enabled?: boolean;
  /** VE : jour | nuit — Ballon : hc | pilote */
  mode_charge?: "jour" | "nuit" | "hc" | "pilote";
  charges_semaine?: number;
  batterie_kwh?: number;
  puissance_kw?: number;
  pac_type?: PacType;
  role?: EquipmentRole;
  fonctionnement?: "leger" | "moyen" | "intensif";
  volume_litres?: number;
  /** Legacy lecture seule (migré vers role) — ne plus saisir en UI */
  chauffage_principal?: boolean;
  /** PAC air/air : intensité chauffage / clim */
  usage_hiver?: UsageLevel;
  usage_ete?: UsageLevel;
  /** Interne migration clim → PAC (retiré avant sauvegarde) */
  _migratedFromClim?: boolean;
};

export type EquipmentV2 = {
  schemaVersion: 2;
  items: EquipmentItem[];
};
