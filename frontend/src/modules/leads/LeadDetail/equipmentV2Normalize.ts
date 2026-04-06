/**
 * Normalisation V1 → V2 en mémoire, résumés, chaîne équipement_actuel legacy.
 */
import type { EquipmentItem, EquipmentKind, EquipmentV2, EquipmentRole, PacType, UsageLevel } from "./equipmentTypes";
import { buildOrderedEquipmentGroups } from "./equipmentGrouping";
import {
  DEFAULT_BALLON_ACTUEL,
  DEFAULT_PAC_ACTUEL,
  DEFAULT_VE_ACTUEL,
  buildEquipementActuelString,
  parseEquipementActuelFlags,
  type EquipementActuelParams,
  type EquipementsAVenir,
} from "./equipmentPilotageHelpers";

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function isEquipmentV2(x: unknown): x is EquipmentV2 {
  return (
    typeof x === "object" &&
    x !== null &&
    (x as EquipmentV2).schemaVersion === 2 &&
    Array.isArray((x as EquipmentV2).items)
  );
}

function migrateClimToPacItem(o: Record<string, unknown>, id: string): EquipmentItem {
  const chauffage = o.chauffage_principal === true;
  const role: EquipmentRole =
    o.role === "appoint" || o.role === "principal"
      ? (o.role as EquipmentRole)
      : chauffage
        ? "principal"
        : "appoint";
  return {
    id,
    kind: "pac",
    pac_type: "air_air",
    role,
    puissance_kw: typeof o.puissance_kw === "number" ? o.puissance_kw : undefined,
    usage_hiver: (o.usage_hiver as UsageLevel | undefined) ?? "moyen",
    usage_ete: (o.usage_ete as UsageLevel | undefined) ?? "moyen",
    chauffage_principal: o.chauffage_principal === true ? true : undefined,
    _migratedFromClim: true,
  };
}

function dedupePacAirAirMigrated(items: EquipmentItem[]): EquipmentItem[] {
  const hasUserPacAirAir = items.some(
    (i) =>
      i.kind === "pac" &&
      (i.pac_type ?? "air_eau") === "air_air" &&
      !i._migratedFromClim
  );
  if (!hasUserPacAirAir) return items;
  return items.filter(
    (i) =>
      !(
        i.kind === "pac" &&
        (i.pac_type ?? "air_eau") === "air_air" &&
        i._migratedFromClim
      )
  );
}

function stripMigratedFlag(item: EquipmentItem): EquipmentItem {
  const { _migratedFromClim: _m, ...rest } = item;
  return rest as EquipmentItem;
}

function normalizeItemKind(k: string): EquipmentKind | null {
  const t = String(k || "").toLowerCase();
  if (t === "ve") return "ve";
  if (t === "pac") return "pac";
  if (t === "ballon") return "ballon";
  if (t === "clim_reversible") return null; // traité dans sanitize
  return null;
}

/** Assure id + kind sur chaque entrée V2 */
function sanitizeV2Items(items: unknown[]): EquipmentItem[] {
  const out: EquipmentItem[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const rawKind = String(o.kind ?? "").toLowerCase();
    const id = typeof o.id === "string" && o.id.trim() ? o.id : newId("item");

    if (rawKind === "clim_reversible") {
      out.push(migrateClimToPacItem(o, id));
      continue;
    }
    const kind = normalizeItemKind(String(o.kind ?? ""));
    if (!kind) continue;
    out.push({
      ...(o as unknown as EquipmentItem),
      id,
      kind,
    });
  }
  return dedupePacAirAirMigrated(out).map(stripMigratedFlag);
}

function v1ActuelToV2(
  params: EquipementActuelParams | null | undefined,
  actuelStr: string
): EquipmentV2 {
  const flags = parseEquipementActuelFlags(actuelStr);
  const items: EquipmentItem[] = [];
  if (flags.ve) {
    items.push({
      id: newId("ac"),
      kind: "ve",
      ...DEFAULT_VE_ACTUEL,
      ...(params?.ve || {}),
    });
  }
  if (flags.pac) {
    items.push({
      id: newId("ac"),
      kind: "pac",
      ...DEFAULT_PAC_ACTUEL,
      ...(params?.pac || {}),
    });
  }
  if (flags.ballon) {
    items.push({
      id: newId("ac"),
      kind: "ballon",
      ...DEFAULT_BALLON_ACTUEL,
      ...(params?.ballon || {}),
    });
  }
  return { schemaVersion: 2, items };
}

function v1AvenirToV2(av: EquipementsAVenir | null | undefined): EquipmentV2 {
  if (!av) return { schemaVersion: 2, items: [] };
  const items: EquipmentItem[] = [];
  if (av.ve && av.ve.enabled !== false) {
    const { enabled: _e, ...rest } = av.ve;
    items.push({ id: newId("av"), kind: "ve", ...DEFAULT_VE_ACTUEL, ...rest });
  }
  if (av.pac && av.pac.enabled !== false) {
    const { enabled: _e, ...rest } = av.pac;
    items.push({ id: newId("av"), kind: "pac", ...DEFAULT_PAC_ACTUEL, ...rest });
  }
  if (av.ballon && av.ballon.enabled !== false) {
    const { enabled: _e, ...rest } = av.ballon;
    items.push({ id: newId("av"), kind: "ballon", ...DEFAULT_BALLON_ACTUEL, ...rest });
  }
  return { schemaVersion: 2, items };
}

export function ensureActuelV2FromApi(
  params: unknown,
  equipement_actuel: string | null | undefined
): EquipmentV2 {
  if (isEquipmentV2(params)) {
    return { schemaVersion: 2, items: sanitizeV2Items(params.items) };
  }
  return v1ActuelToV2(
    params && typeof params === "object" ? (params as EquipementActuelParams) : null,
    equipement_actuel ?? ""
  );
}

export function ensureAvenirV2FromApi(params: unknown): EquipmentV2 {
  if (isEquipmentV2(params)) {
    return { schemaVersion: 2, items: sanitizeV2Items(params.items) };
  }
  return v1AvenirToV2(
    params && typeof params === "object" ? (params as EquipementsAVenir) : null
  );
}

/**
 * Normalise les champs équipements du lead (après GET ou fusion PATCH).
 * Garde une copie V2 en mémoire pour le formulaire.
 */
export function normalizeLeadEquipmentFields<
  T extends {
    equipement_actuel?: string | null;
    equipement_actuel_params?: unknown;
    equipements_a_venir?: unknown;
  },
>(lead: T): T {
  const actuelV2 = ensureActuelV2FromApi(
    lead.equipement_actuel_params,
    lead.equipement_actuel ?? null
  );
  const avenirV2 = ensureAvenirV2FromApi(lead.equipements_a_venir);
  return {
    ...lead,
    equipement_actuel: legacyActuelStringFromItems(actuelV2.items),
    equipement_actuel_params: actuelV2 as unknown as T["equipement_actuel_params"],
    equipements_a_venir: avenirV2 as unknown as T["equipements_a_venir"],
  };
}

/**
 * Chaîne legacy V1 (flags) : au plus un mot-clé par famille,
 * même s’il y a plusieurs unités du même type (plusieurs PAC, etc.).
 */
export function legacyActuelStringFromItems(items: EquipmentItem[]): string | null {
  const flags = { ve: false, pac: false, ballon: false };
  for (const it of items) {
    if (it.kind === "ve") flags.ve = true;
    else if (it.kind === "pac") flags.pac = true;
    else if (it.kind === "ballon") flags.ballon = true;
  }
  const s = buildEquipementActuelString(flags);
  return s ?? null;
}

function summaryChunkForGrouped(items: EquipmentItem[]): string {
  const groups = buildOrderedEquipmentGroups(items);
  return groups
    .map((g) => {
      const n = g.items.length;
      const k = g.items[0]?.kind;
      const lab =
        k === "ve"
          ? "VE"
          : k === "ballon"
            ? "Ballon ECS"
            : k === "pac"
              ? g.items[0]?.pac_type === "air_air"
                ? "PAC air/air (chauf. + froid)"
                : "PAC air/eau (chauffage)"
              : (k ?? "?");
      return n > 1 ? `${n}× ${lab}` : lab;
    })
    .join(", ");
}

export function buildEquipmentV2SectionSummary(
  actuel: EquipmentV2,
  avenir: EquipmentV2
): string | null {
  const parts: string[] = [];
  if (actuel.items.length) parts.push(`Actuels : ${summaryChunkForGrouped(actuel.items)}`);
  if (avenir.items.length) parts.push(`À venir : ${summaryChunkForGrouped(avenir.items)}`);
  return parts.length ? parts.join(" • ") : null;
}

export function createDefaultEquipmentItem(
  kind: EquipmentKind,
  opts?: { pac_type?: PacType }
): EquipmentItem {
  const id = newId("new");
  switch (kind) {
    case "ve":
      return {
        id,
        kind: "ve",
        mode_charge: "nuit",
        charges_semaine: 3,
        batterie_kwh: 50,
      };
    case "pac": {
      const pt: PacType = opts?.pac_type === "air_air" ? "air_air" : "air_eau";
      if (pt === "air_air") {
        return {
          id,
          kind: "pac",
          pac_type: "air_air",
          role: "principal",
          puissance_kw: 3.5,
          usage_hiver: "moyen",
          usage_ete: "moyen",
        };
      }
      return {
        id,
        kind: "pac",
        puissance_kw: 9,
        pac_type: "air_eau",
        role: "principal",
        fonctionnement: "moyen",
      };
    }
    case "ballon":
      return {
        id,
        kind: "ballon",
        volume_litres: 200,
        mode_charge: "hc",
      };
  }
}

/** Payload API : objets complets, jamais undefined */
export function toEquipmentV2Payload(doc: EquipmentV2): EquipmentV2 {
  const items = (Array.isArray(doc.items) ? doc.items : []).map((it) => {
    const { _migratedFromClim: _m, ...rest } = it as EquipmentItem & {
      _migratedFromClim?: boolean;
    };
    return rest as EquipmentItem;
  });
  return {
    schemaVersion: 2,
    items,
  };
}
