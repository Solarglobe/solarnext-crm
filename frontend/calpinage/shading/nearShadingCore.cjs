/**
 * === WRAPPER NODE (proxy) — métier dans shared/shading/nearShadingCore.cjs ===
 * Ne pas dupliquer la logique. Navigateur : public/.../nearShadingCore.cjs (sync, sans ce fichier).
 * @see docs/shading-governance.md
 */
const path = require("path");
module.exports = require(path.join(__dirname, "../../../shared/shading/nearShadingCore.cjs"));
