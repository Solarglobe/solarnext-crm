/**
 * Point d’entrée standalone : http://localhost:5173/dp2.html
 * Monte le DP via loadDpTool (contexte dev injecté dans le loader sur cette URL).
 */
import { loadDpTool, SN_DP_DEV_TEST_LEAD_ID } from "./modules/dp/dpToolLoader";

void (async function dp2DevMain() {
  const root = document.getElementById("dp-dev-root");
  if (!root) {
    throw new Error("#dp-dev-root introuvable");
  }

  await loadDpTool({
    container: root,
    hostPayload: {
      leadId: SN_DP_DEV_TEST_LEAD_ID,
      clientId: null,
      context: {},
      draft: null,
      updatedAt: null,
    },
    storageKey: SN_DP_DEV_TEST_LEAD_ID,
  });
})();
