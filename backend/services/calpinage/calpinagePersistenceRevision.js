import { createHash } from 'node:crypto';

// The database returns JSON values only. Serialize object keys in a stable order
// without dropping fields or rounding numbers (unlike the visual geometry hash).
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Opaque revision of the complete persisted geometry; null means no row. */
export function computeCalpinagePersistenceRevision(geometryJson) {
  if (geometryJson == null) return null;
  return createHash('sha256').update(canonicalJson(geometryJson), 'utf8').digest('hex');
}
