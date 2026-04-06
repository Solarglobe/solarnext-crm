/**
 * Calcul unifié baseZ / topZ pour shadow + extension.
 * Évite divergence future entre moteurs d'ombrage et d'extension.
 *
 * @param {{ x: number, y: number, heightM?: number, getHeightAtXY?: (x: number, y: number) => number }} params
 * @returns {{ baseZ: number, topZ: number }}
 */
function computeObjectZ({ x, y, heightM, getHeightAtXY }) {
  const roofZ =
    typeof getHeightAtXY === "function"
      ? (() => {
          const z = getHeightAtXY(x, y);
          return typeof z === "number" && Number.isFinite(z) ? z : 0;
        })()
      : 0;
  return {
    baseZ: roofZ,
    topZ: roofZ + (heightM || 0),
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { computeObjectZ };
}
