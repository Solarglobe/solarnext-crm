/**
 * Test basique du IGN Dynamic Tile Loader.
 * Appelle ensureIgnTileAvailable(48.85, 2.35) et affiche si la tuile existe localement
 * ou si elle a été téléchargée + index mis à jour.
 */

import { ensureIgnTileAvailable } from "../services/dsmDynamic/ignDynamicLoader.js";

async function main() {
  const lat = 48.85;
  const lon = 2.35;

  const result = await ensureIgnTileAvailable(lat, lon);

  if (result.ok && result.existed) {
    console.log("Tile exists locally");
  } else if (result.ok && result.downloaded) {
    console.log("Tile downloaded + index updated");
  } else {
    console.error("Error:", result.error ?? "Unknown");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
