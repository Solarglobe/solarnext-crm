/**
 * Pilotage de charge — équipements actuels / à venir
 * Structure alignée sur backend/services/consumptionService.js applyEquipmentShape
 */

export type VeModeCharge = "jour" | "nuit";
export type PacFonctionnement = "leger" | "moyen" | "intensif";
export type BallonModeCharge = "hc" | "pilote";
export type PacType = "air_air" | "air_eau";
export type EquipmentRole = "principal" | "appoint";

export interface VeParamsActuel {
  mode_charge?: VeModeCharge;
  charges_semaine?: number;
  batterie_kwh?: number;
}

export interface PacParamsActuel {
  puissance_kw?: number;
  pac_type?: PacType;
  role?: EquipmentRole;
  fonctionnement?: PacFonctionnement;
}

export interface BallonParamsActuel {
  volume_litres?: number;
  mode_charge?: BallonModeCharge;
}

/** Params équipements actuels (clés uniquement pour types cochés) */
export interface EquipementActuelParams {
  ve?: VeParamsActuel;
  pac?: PacParamsActuel;
  ballon?: BallonParamsActuel;
}

/** Entrée « à venir » : enabled + même paramètres que le moteur (_calc*) */
export interface EquipementAvenirVe extends VeParamsActuel {
  enabled?: boolean;
}

export interface EquipementAvenirPac extends PacParamsActuel {
  enabled?: boolean;
}

export interface EquipementAvenirBallon extends BallonParamsActuel {
  enabled?: boolean;
}

export interface EquipementsAVenir {
  ve?: EquipementAvenirVe;
  pac?: EquipementAvenirPac;
  ballon?: EquipementAvenirBallon;
}

export const DEFAULT_VE_ACTUEL: VeParamsActuel = {
  mode_charge: "nuit",
  charges_semaine: 3,
  batterie_kwh: 50,
};

export const DEFAULT_PAC_ACTUEL: PacParamsActuel = {
  puissance_kw: 9,
  pac_type: "air_eau",
  role: "principal",
  fonctionnement: "moyen",
};

export const DEFAULT_BALLON_ACTUEL: BallonParamsActuel = {
  volume_litres: 200,
  mode_charge: "hc",
};

export function parseEquipementActuelFlags(s: string | null | undefined): {
  ve: boolean;
  pac: boolean;
  ballon: boolean;
} {
  const t = (s || "").toLowerCase();
  return {
    ve: t.includes("ve"),
    pac: t.includes("pac"),
    ballon: t.includes("ballon"),
  };
}

export function buildEquipementActuelString(flags: {
  ve: boolean;
  pac: boolean;
  ballon: boolean;
}): string | undefined {
  const parts: string[] = [];
  if (flags.ve) parts.push("ve");
  if (flags.pac) parts.push("pac");
  if (flags.ballon) parts.push("ballon");
  return parts.length ? parts.join(" ") : undefined;
}

function mergeActuelParams(
  flags: { ve: boolean; pac: boolean; ballon: boolean },
  prev: EquipementActuelParams | null | undefined
): EquipementActuelParams | null {
  const out: EquipementActuelParams = {};
  if (flags.ve) {
    out.ve = { ...DEFAULT_VE_ACTUEL, ...(prev?.ve || {}) };
  }
  if (flags.pac) {
    out.pac = { ...DEFAULT_PAC_ACTUEL, ...(prev?.pac || {}) };
  }
  if (flags.ballon) {
    out.ballon = { ...DEFAULT_BALLON_ACTUEL, ...(prev?.ballon || {}) };
  }
  return Object.keys(out).length ? out : null;
}

export function toggleActuelType(
  prev: Partial<{
    equipement_actuel?: string | null;
    equipement_actuel_params?: EquipementActuelParams | null;
  }>,
  type: "ve" | "pac" | "ballon",
  checked: boolean
): {
  equipement_actuel: string | undefined;
  equipement_actuel_params: EquipementActuelParams | null;
} {
  const flags = parseEquipementActuelFlags(prev.equipement_actuel ?? undefined);
  flags[type] = checked;
  const str = buildEquipementActuelString(flags);
  const params = mergeActuelParams(flags, prev.equipement_actuel_params ?? undefined);
  return {
    equipement_actuel: str,
    equipement_actuel_params: params,
  };
}

export function updateActuelParams(
  prev: EquipementActuelParams | null | undefined,
  patch: Partial<EquipementActuelParams>
): EquipementActuelParams | null {
  if (!prev) return null;
  const out: EquipementActuelParams = {};
  if (prev.ve) out.ve = { ...prev.ve, ...patch.ve };
  if (prev.pac) out.pac = { ...prev.pac, ...patch.pac };
  if (prev.ballon) out.ballon = { ...prev.ballon, ...patch.ballon };
  return Object.keys(out).length ? out : null;
}

export function parseAvenirFlags(av: EquipementsAVenir | null | undefined): {
  ve: boolean;
  pac: boolean;
  ballon: boolean;
} {
  return {
    ve: Boolean(av?.ve && av.ve.enabled !== false),
    pac: Boolean(av?.pac && av.pac.enabled !== false),
    ballon: Boolean(av?.ballon && av.ballon.enabled !== false),
  };
}

export function toggleAvenirType(
  prev: EquipementsAVenir | null | undefined,
  type: "ve" | "pac" | "ballon",
  checked: boolean
): EquipementsAVenir | null {
  const next: EquipementsAVenir = { ...(prev || {}) };
  if (checked) {
    if (type === "ve") {
      next.ve = { enabled: true, ...DEFAULT_VE_ACTUEL, ...(prev?.ve || {}) };
    } else if (type === "pac") {
      next.pac = { enabled: true, ...DEFAULT_PAC_ACTUEL, ...(prev?.pac || {}) };
    } else {
      next.ballon = { enabled: true, ...DEFAULT_BALLON_ACTUEL, ...(prev?.ballon || {}) };
    }
  } else {
    delete next[type];
  }
  return Object.keys(next).length ? next : null;
}

export function updateAvenirParams(
  prev: EquipementsAVenir | null | undefined,
  type: "ve" | "pac" | "ballon",
  patch: Record<string, unknown>
): EquipementsAVenir | null {
  const cur = prev?.[type];
  if (!cur) return prev ?? null;
  return {
    ...prev,
    [type]: { ...cur, enabled: true, ...patch },
  };
}

export function buildEquipmentSectionSummary(
  actuelStr: string | null | undefined,
  avenir: EquipementsAVenir | null | undefined
): string | null {
  const a = parseEquipementActuelFlags(actuelStr);
  const av = parseAvenirFlags(avenir);
  const parts: string[] = [];
  const act: string[] = [];
  if (a.ve) act.push("VE");
  if (a.pac) act.push("PAC");
  if (a.ballon) act.push("Ballon");
  if (act.length) parts.push(`Actuels : ${act.join(", ")}`);
  const fut: string[] = [];
  if (av.ve) fut.push("VE");
  if (av.pac) fut.push("PAC");
  if (av.ballon) fut.push("Ballon");
  if (fut.length) parts.push(`À venir : ${fut.join(", ")}`);
  return parts.length ? parts.join(" • ") : null;
}
