/**
 * Test concurrence du IGN Dynamic Tile Loader.
 * Lance 10 appels en parallèle à ensureIgnTileAvailable(48.85, 2.35).
 * Vérifie : pas d'exception, lock n'a pas cassé le run.
 */

import { ensureIgnTileAvailable } from "../services/dsmDynamic/ignDynamicLoader.js";

async function main() {
  const lat = 48.85;
  const lon = 2.35;
  const n = 10;

  console.log(`Launching ${n} parallel ensureIgnTileAvailable(${lat}, ${lon})...`);

  const results = await Promise.all(
    Array.from({ length: n }, () => ensureIgnTileAvailable(lat, lon))
  );

  const allOk = results.every((r) => r && r.ok);
  const existed = results.filter((r) => r?.existed).length;
  const downloaded = results.filter((r) => r?.downloaded).length;

  console.log(`Results: ${results.length} OK, existed=${existed}, downloaded=${downloaded}`);
  if (!allOk) {
    const failed = results.filter((r) => !r?.ok);
    console.error("Failed:", failed);
    process.exit(1);
  }
  console.log("Concurrency test OK (no exception, lock did not break run).");
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
