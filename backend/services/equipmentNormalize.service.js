/**
 * Normalisation V1 / V2 — équipements conso / pilotage (lead)
 * Le moteur travaille uniquement sur des listes d'items V2 normalisées.
 */

import { randomUUID } from "node:crypto";

const KINDS = new Set(["ve", "pac", "ballon"]);

/**
 * Legacy : clim réversible → PAC air/air (même logique métier que l’ancienne clim).
 * @param {object} raw
 * @returns {object}
 */
function migrateClimItemToPac(raw) {
  if (!raw || typeof raw !== "object") return raw;
  if (String(raw.kind || "").toLowerCase() !== "clim_reversible") return raw;
  const { kind: _k, ...rest } = raw;
  const role =
    rest.role === "principal" || rest.role === "appoint"
      ? rest.role
      : rest.chauffage_principal === true
        ? "principal"
        : "appoint";
  return {
    ...rest,
    kind: "pac",
    pac_type: "air_air",
    role,
    _migratedFromClim: true,
  };
}

/**
 * Si une PAC air/air « réelle » existe déjà, on retire les doublons issus de la migration clim
 * (évite double comptage kWh / profil horaire).
 * @param {object[]} items
 * @returns {object[]}
 */
function dedupeMigratedPacAirAir(items) {
  const hasUserPacAirAir = items.some(
    (i) =>
      i &&
      i.kind === "pac" &&
      String(i.pac_type || "air_eau").toLowerCase() === "air_air" &&
      !i._migratedFromClim
  );
  if (!hasUserPacAirAir) return items;
  return items.filter(
    (i) =>
      !(
        i &&
        i.kind === "pac" &&
        String(i.pac_type || "air_eau").toLowerCase() === "air_air" &&
        i._migratedFromClim
      )
  );
}

function stripMigrationFlag(item) {
  if (!item || typeof item !== "object" || !item._migratedFromClim) return item;
  const { _migratedFromClim: _m, ...rest } = item;
  return rest;
}

/**
 * @param {unknown} doc
 * @returns {boolean}
 */
export function isV2EquipmentDoc(doc) {
  return (
    doc != null &&
    typeof doc === "object" &&
    !Array.isArray(doc) &&
    Number(doc.schemaVersion) === 2 &&
    Array.isArray(doc.items)
  );
}

/**
 * @param {object} item
 * @returns {string}
 */
function ensureId(item) {
  if (item.id != null && String(item.id).trim() !== "") return String(item.id);
  return randomUUID();
}

/**
 * Nettoie un item : kind obligatoire, id stable.
 * @param {object} raw
 * @returns {object|null}
 */
function normalizeItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const migrated = migrateClimItemToPac(raw);
  const kind = String(migrated.kind || "").toLowerCase();
  if (!KINDS.has(kind)) return null;
  const id = ensureId(migrated);
  const { kind: _k, id: _i, schemaVersion: _s, ...rest } = migrated;
  return { kind, id, ...rest };
}

/**
 * Finalise items[] V2 : migration clim → PAC, dédup air/air, nettoyage flags internes.
 * @param {unknown[]} rawItems
 * @returns {object[]}
 */
export function finalizeV2EquipmentItems(rawItems) {
  const items = [];
  for (const raw of rawItems || []) {
    const n = normalizeItem(raw);
    if (n) items.push(n);
  }
  return dedupeMigratedPacAirAir(items).map(stripMigrationFlag);
}

/**
 * Document V2 complet (ex. PATCH JSONB) : migration + dédup.
 * @param {object} doc
 * @returns {object}
 */
export function migrateEquipmentV2Doc(doc) {
  if (!doc || typeof doc !== "object" || Number(doc.schemaVersion) !== 2 || !Array.isArray(doc.items)) {
    return doc;
  }
  return { ...doc, items: finalizeV2EquipmentItems(doc.items) };
}

/**
 * V1 actuels : chaîne equipement_actuel + params { ve, pac, ballon }
 * @param {string} eqStr
 * @param {object} params
 * @returns {{ items: object[] }}
 */
export function v1ActuelsToItems(eqStr, params) {
  const s = (eqStr || "").toLowerCase();
  const p = params && typeof params === "object" ? params : {};
  const items = [];

  if (s.includes("ve") && p.ve && typeof p.ve === "object") {
    items.push(normalizeItem({ kind: "ve", id: p.ve.id, ...p.ve }));
  }
  if (s.includes("pac") && p.pac && typeof p.pac === "object") {
    items.push(normalizeItem({ kind: "pac", id: p.pac.id, ...p.pac }));
  }
  if (s.includes("ballon") && p.ballon && typeof p.ballon === "object") {
    items.push(normalizeItem({ kind: "ballon", id: p.ballon.id, ...p.ballon }));
  }
  return { items: items.filter(Boolean) };
}

/**
 * V1 à venir : { ve?, pac?, ballon? } avec enabled
 * @param {object} avenir
 * @returns {{ items: object[] }}
 */
export function v1AvenirToItems(avenir) {
  const a = avenir && typeof avenir === "object" ? avenir : {};
  const items = [];

  if (a.ve && typeof a.ve === "object" && a.ve.enabled !== false) {
    items.push(normalizeItem({ kind: "ve", ...a.ve }));
  }
  if (a.pac && typeof a.pac === "object" && a.pac.enabled !== false) {
    items.push(normalizeItem({ kind: "pac", ...a.pac }));
  }
  if (a.ballon && typeof a.ballon === "object" && a.ballon.enabled !== false) {
    items.push(normalizeItem({ kind: "ballon", ...a.ballon }));
  }
  return { items: items.filter(Boolean) };
}

/**
 * @param {object} doc
 * @param {{ skipDisabledAvenir?: boolean }} [opts]
 */
function v2DocToItems(doc, opts = {}) {
  const rawItems = [];
  for (const raw of doc.items || []) {
    if (!raw || typeof raw !== "object") continue;
    if (opts.skipDisabledAvenir && raw.enabled === false) continue;
    rawItems.push(raw);
  }
  return { items: finalizeV2EquipmentItems(rawItems) };
}

/**
 * Entrée merged (form.conso + params) — mêmes clés que le lead / payload SolarNext.
 * @param {object} merged
 * @returns {{ actuels: { items: object[] }, avenir: { items: object[] } }}
 */
export function normalizeEquipmentBuckets(merged) {
  const actuelParams = merged.equipement_actuel_params;
  const avenirRaw = merged.equipements_a_venir;

  let actuels;
  if (isV2EquipmentDoc(actuelParams)) {
    actuels = v2DocToItems(actuelParams);
  } else {
    actuels = v1ActuelsToItems(merged.equipement_actuel || "", actuelParams);
  }

  let avenir;
  if (isV2EquipmentDoc(avenirRaw)) {
    avenir = v2DocToItems(avenirRaw, { skipDisabledAvenir: true });
  } else {
    avenir = v1AvenirToItems(avenirRaw || {});
  }

  return { actuels, avenir };
}
