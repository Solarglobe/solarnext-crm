export function resolveConsumptionProvenance(engine = {}) {
  const source=engine.engine_consumption_source ?? null;
  const label=engine.annual_source_label ?? null;
  const reconstructed=/REBUILT|SYNTHETIC|DAILY|MONTHLY|ANNUAL|FALLBACK/.test(source??"");
  return {source, label:label ? `Source : ${label}${reconstructed ? " ; profil horaire reconstruit" : ""}` : "Source : profil horaire fourni ; origine et résolution initiale à confirmer", measured_hourly:source==="MEASURED_HOURLY", reconstructed, input_resolution:source?.includes("DAILY")?"day":source?.includes("MONTHLY")?"month":null, simulation_resolution:"hour", period_start:engine.period_start??null,period_end:engine.period_end??null, timezone:engine.timezone??null, operator:engine.grid_operator??null,estimated_share:engine.estimated_share??null};
}
