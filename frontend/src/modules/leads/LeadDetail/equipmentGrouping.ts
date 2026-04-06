/**
 * Regroupe les items V2 par type métier (1 carte = 1 groupe).
 * Clé stable : ve | ballon | pac:air_eau | pac:air_air
 */
import type { EquipmentItem, PacType } from "./equipmentTypes";

export function equipmentGroupKey(item: EquipmentItem): string {
  if (item.kind === "ve") return "ve";
  if (item.kind === "ballon") return "ballon";
  if (item.kind === "pac") {
    const pt: PacType = item.pac_type === "air_air" ? "air_air" : "air_eau";
    return `pac:${pt}`;
  }
  return "unknown";
}

/** Ordre d’affichage des cartes (indépendant de l’ordre d’arrivée en base). */
const GROUP_SORT_ORDER: string[] = ["ve", "pac:air_eau", "pac:air_air", "ballon"];

export function sortGroupKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const ia = GROUP_SORT_ORDER.indexOf(a);
    const ib = GROUP_SORT_ORDER.indexOf(b);
    const sa = ia === -1 ? GROUP_SORT_ORDER.length : ia;
    const sb = ib === -1 ? GROUP_SORT_ORDER.length : ib;
    if (sa !== sb) return sa - sb;
    return a.localeCompare(b);
  });
}

export function buildOrderedEquipmentGroups(
  items: EquipmentItem[]
): { key: string; items: EquipmentItem[] }[] {
  const buckets = new Map<string, EquipmentItem[]>();
  for (const it of items) {
    const k = equipmentGroupKey(it);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(it);
  }
  const keys = sortGroupKeys([...buckets.keys()]);
  return keys.map((key) => ({ key, items: buckets.get(key)! }));
}
