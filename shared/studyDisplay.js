/** Shared display boundary. Never use these rounded values as simulation inputs. */
export function displayNumber(value, digits = 0, missing = '—') {
  if(value==null||value===''||!Number.isFinite(Number(value)))return missing;
  return Number(value).toLocaleString('fr-FR',{minimumFractionDigits:digits,maximumFractionDigits:digits});
}
export function displayKwh(value) { const n=displayNumber(value);return n==='—'?n:`${n} kWh`; }
export function displayEuro(value, digits = 0) {const n=displayNumber(value,digits);return n==='—'?n:`${n} €`;}
export function displayPercent(value, digits = 0) {const n=displayNumber(value,digits);return n==='—'?n:`${n} %`;}
