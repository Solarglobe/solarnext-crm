/**
 * Script temporaire — Diagnostic du provider DSM réellement chargé.
 * Forcer ENV puis importer le selector pour vérifier noir sur blanc quel provider est utilisé.
 */

console.log("ENV:");
console.log("HORIZON_DSM_ENABLED:", process.env.HORIZON_DSM_ENABLED);
console.log("DSM_ENABLE:", process.env.DSM_ENABLE);
console.log("DSM_PROVIDER_TYPE:", process.env.DSM_PROVIDER_TYPE);

process.env.HORIZON_DSM_ENABLED = "true";
process.env.DSM_ENABLE = "true";
process.env.DSM_PROVIDER_TYPE = "IGN_RGE_ALTI";

console.log("ENV (after force):");
console.log("HORIZON_DSM_ENABLED:", process.env.HORIZON_DSM_ENABLED);
console.log("DSM_ENABLE:", process.env.DSM_ENABLE);
console.log("DSM_PROVIDER_TYPE:", process.env.DSM_PROVIDER_TYPE);

(async () => {
  const { selectBestProvider, computeHorizonMaskAuto } = await import(
    "../services/horizon/providers/horizonProviderSelector.js"
  );
  const params = { lat: 48.8566, lon: 2.3522, radius_m: 500, step_deg: 2 };
  const provider = selectBestProvider(params);
  const resolvedProviderName = provider?.getMode ? provider.getMode() : "unknown";
  console.log("Selector resolved provider:", resolvedProviderName);

  const result = await computeHorizonMaskAuto({ ...params, enableHD: false });
  const actualSource = result?.dataCoverage?.provider ?? result?.source ?? "?";
  console.log("Actual data source (after one compute):", actualSource);
  if (result?.meta?.fallbackReason) {
    console.log("Fallback reason:", result.meta.fallbackReason);
  }
})();
