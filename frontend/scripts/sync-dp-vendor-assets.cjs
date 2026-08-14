const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const vendorDir = path.join(root, "dp-tool", "vendor");

const assets = [
  ["node_modules/ol/dist/ol.js", "ol.js"],
  ["node_modules/ol/ol.css", "ol.css"],
  ["node_modules/ol-mapbox-style/dist/olms.js", "olms.js"],
  ["node_modules/html2canvas/dist/html2canvas.min.js", "html2canvas.min.js"],
  ["node_modules/pdf-lib/dist/pdf-lib.min.js", "pdf-lib.min.js"],
];

fs.mkdirSync(vendorDir, { recursive: true });

for (const [fromRel, toName] of assets) {
  const from = path.join(root, fromRel);
  const to = path.join(vendorDir, toName);
  if (!fs.existsSync(from)) {
    throw new Error(`[sync-dp-vendor-assets] Missing vendor asset: ${fromRel}`);
  }
  fs.copyFileSync(from, to);
  console.log(`[sync-dp-vendor-assets] ${fromRel} -> dp-tool/vendor/${toName}`);
}

console.log("[sync-dp-vendor-assets] OK");
