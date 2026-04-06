/**
 * Source de vérité puissance panneau : pv_panels.power_wc via id (UUID).
 * Seul point de lecture SQL « moteur » pour pv_panels — ne pas dupliquer hors admin/API publique.
 */

/**
 * @param {import("pg").Pool | import("pg").PoolClient} poolOrClient
 * @param {string} panelId
 * @returns {Promise<null | { id: string, power_wc: number, brand: string | null, model_ref: string | null, name: string | null, width_mm: number | null, height_mm: number | null, temp_coeff_pct_per_deg: number | null, degradation_annual_pct: number | null, degradation_first_year_pct: number | null }>}
 */
export async function fetchPvPanelRowById(poolOrClient, panelId) {
  if (panelId == null || panelId === "") return null;
  const id = String(panelId).trim();
  if (!id) return null;
  try {
    const { rows } = await poolOrClient.query(
      `SELECT id, power_wc, brand, model_ref, name,
              width_mm, height_mm,
              temp_coeff_pct_per_deg, degradation_annual_pct, degradation_first_year_pct
       FROM pv_panels
       WHERE id = $1::uuid AND active = true
       LIMIT 1`,
      [id]
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Enrichit panel_input avec power_wc (et métadonnées) depuis pv_panels si panel_id / id présent.
 * @param {import("pg").Pool | import("pg").PoolClient} poolOrClient
 * @param {object | null | undefined} panelInput
 * @returns {Promise<object | null | undefined>}
 */
export async function applyPanelPowerFromCatalog(poolOrClient, panelInput) {
  if (!panelInput || typeof panelInput !== "object") return panelInput;
  const pid = panelInput.panel_id ?? panelInput.panelId ?? panelInput.id ?? null;
  if (pid == null || pid === "") return panelInput;
  const row = await fetchPvPanelRowById(poolOrClient, pid);
  if (!row) return panelInput;
  const pw = Number(row.power_wc);
  if (!Number.isFinite(pw)) return panelInput;
  const wm = row.width_mm != null ? Number(row.width_mm) : null;
  const hm = row.height_mm != null ? Number(row.height_mm) : null;
  return {
    ...panelInput,
    id: row.id ?? panelInput.id ?? null,
    panel_id: row.id,
    power_wc: pw,
    brand: row.brand ?? panelInput.brand ?? null,
    model: row.model_ref ?? row.name ?? panelInput.model ?? null,
    model_ref: row.model_ref ?? panelInput.model_ref ?? null,
    ...(wm != null && Number.isFinite(wm) && wm > 0 ? { width_mm: wm } : {}),
    ...(hm != null && Number.isFinite(hm) && hm > 0 ? { height_mm: hm } : {}),
    temp_coeff_pct_per_deg:
      row.temp_coeff_pct_per_deg ?? panelInput.temp_coeff_pct_per_deg ?? null,
    degradation_annual_pct:
      row.degradation_annual_pct ?? panelInput.degradation_annual_pct ?? null,
    degradation_first_year_pct:
      row.degradation_first_year_pct ?? panelInput.degradation_first_year_pct ?? null,
  };
}
