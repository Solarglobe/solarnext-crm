/**
 * Validation optionnelle des JSON équipements (V2 schemaVersion + items).
 * La V1 (objet sans schemaVersion 2) reste libre.
 */

const ALLOWED_KINDS = new Set(["ve", "pac", "ballon"]);

/**
 * @param {unknown} val
 * @param {string} fieldName
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateEquipmentJsonbField(val, fieldName) {
  if (val === null || val === undefined) return { ok: true };
  if (typeof val !== "object" || Array.isArray(val)) {
    return { ok: false, error: `${fieldName} doit être un objet ou null` };
  }
  if (Number(val.schemaVersion) !== 2) return { ok: true };

  if (!Array.isArray(val.items)) {
    return { ok: false, error: `${fieldName} : en V2, items[] est obligatoire` };
  }
  if (val.items.length > 50) {
    return { ok: false, error: `${fieldName} : maximum 50 équipements` };
  }
  for (let i = 0; i < val.items.length; i++) {
    const it = val.items[i];
    if (!it || typeof it !== "object") {
      return { ok: false, error: `${fieldName}.items[${i}] invalide` };
    }
    const k = String(it.kind || "").toLowerCase();
    if (!ALLOWED_KINDS.has(k)) {
      return { ok: false, error: `${fieldName}.items[${i}].kind inconnu` };
    }
  }
  return { ok: true };
}
