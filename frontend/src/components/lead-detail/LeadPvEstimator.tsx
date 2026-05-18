import { useEffect, useMemo, useState } from "react";
import { getCrmApiBase } from "../../config/crmApiBase";
import { apiFetch } from "../../services/api";

const API_BASE = getCrmApiBase();

type QuickPvEstimation = {
  inputs?: {
    roof_area_m2?: number;
    orientation?: string;
    tilt_deg?: number;
    postal_code?: string;
    annual_consumption_kwh?: number;
  };
  results?: {
    panel_count?: number;
    installable_power_kwc?: number;
    annual_production_kwh?: number;
    autoconsumption_rate_pct?: number;
    annual_savings_eur?: number;
    indicative_payback_years?: number | null;
  };
};

interface LeadPvEstimatorProps {
  leadId?: string;
  energyProfile?: unknown;
  defaultPostalCode?: string;
  defaultAnnualConsumptionKwh?: number | null;
  readOnly?: boolean;
  onSaved?: (energyProfile: unknown) => void;
}

const ORIENTATIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const TILTS = [0, 15, 30, 45];

function quickEstimateFromProfile(profile: unknown): QuickPvEstimation | null {
  if (!profile || typeof profile !== "object") return null;
  const row = profile as { quick_pv_estimation?: QuickPvEstimation };
  return row.quick_pv_estimation ?? null;
}

function fmtNumber(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(Number(value))) return "-";
  return Number(value).toLocaleString("fr-FR", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export default function LeadPvEstimator({
  leadId,
  energyProfile,
  defaultPostalCode,
  defaultAnnualConsumptionKwh,
  readOnly = false,
  onSaved,
}: LeadPvEstimatorProps) {
  const saved = useMemo(() => quickEstimateFromProfile(energyProfile), [energyProfile]);
  const [roofAreaM2, setRoofAreaM2] = useState(saved?.inputs?.roof_area_m2 ?? 40);
  const [orientation, setOrientation] = useState(saved?.inputs?.orientation ?? "S");
  const [tiltDeg, setTiltDeg] = useState(saved?.inputs?.tilt_deg ?? 30);
  const [postalCode, setPostalCode] = useState(saved?.inputs?.postal_code ?? defaultPostalCode ?? "");
  const [annualConsumptionKwh, setAnnualConsumptionKwh] = useState(
    saved?.inputs?.annual_consumption_kwh ?? defaultAnnualConsumptionKwh ?? 5000
  );
  const [estimation, setEstimation] = useState<QuickPvEstimation | null>(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next = quickEstimateFromProfile(energyProfile);
    if (!next) return;
    setEstimation(next);
    setRoofAreaM2(next.inputs?.roof_area_m2 ?? 40);
    setOrientation(next.inputs?.orientation ?? "S");
    setTiltDeg(next.inputs?.tilt_deg ?? 30);
    setPostalCode(next.inputs?.postal_code ?? defaultPostalCode ?? "");
    setAnnualConsumptionKwh(next.inputs?.annual_consumption_kwh ?? defaultAnnualConsumptionKwh ?? 5000);
  }, [energyProfile, defaultAnnualConsumptionKwh, defaultPostalCode]);

  async function computeAndSave() {
    if (!leadId || readOnly) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/leads/${encodeURIComponent(leadId)}/pv-estimation`, {
        method: "POST",
        body: JSON.stringify({
          roofAreaM2,
          orientation,
          tiltDeg,
          postalCode,
          annualConsumptionKwh,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Estimation impossible");
      setEstimation(json.estimation ?? null);
      onSaved?.(json.energy_profile);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Estimation impossible");
    } finally {
      setSaving(false);
    }
  }

  const r = estimation?.results;

  return (
    <section className="lead-pv-estimator" aria-label="Estimation rapide PV">
      <div className="lead-pv-estimator__head">
        <div>
          <h3>Estimation rapide PV</h3>
          <p>20 m2 correspond environ a 10 panneaux standard.</p>
        </div>
        <button
          type="button"
          className="sn-btn sn-btn-primary sn-btn-sm"
          disabled={saving || readOnly || !leadId}
          onClick={() => void computeAndSave()}
        >
          {saving ? "Calcul..." : "Calculer"}
        </button>
      </div>

      <div className="lead-pv-estimator__form">
        <label>
          <span>Surface toiture disponible</span>
          <input
            className="sn-input"
            type="number"
            min={0}
            step={1}
            value={roofAreaM2}
            onChange={(e) => setRoofAreaM2(Number(e.target.value || 0))}
          />
        </label>
        <label>
          <span>Code postal</span>
          <input
            className="sn-input"
            inputMode="numeric"
            maxLength={5}
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value)}
          />
        </label>
        <label>
          <span>Consommation annuelle</span>
          <input
            className="sn-input"
            type="number"
            min={0}
            step={100}
            value={annualConsumptionKwh}
            onChange={(e) => setAnnualConsumptionKwh(Number(e.target.value || 0))}
          />
        </label>
      </div>

      <div className="lead-pv-estimator__controls">
        <div className="lead-pv-estimator__control">
          <span>Orientation</span>
          <div className="lead-pv-estimator__compass" role="group">
            {ORIENTATIONS.map((o) => (
              <button
                key={o}
                type="button"
                className={orientation === o ? "active" : ""}
                onClick={() => setOrientation(o)}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
        <div className="lead-pv-estimator__control">
          <span>Inclinaison</span>
          <div className="lead-pv-estimator__tilts" role="group">
            {TILTS.map((t) => (
              <button
                key={t}
                type="button"
                className={tiltDeg === t ? "active" : ""}
                onClick={() => setTiltDeg(t)}
              >
                {t === 0 ? "Plat" : `${t} deg`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error ? <div className="crm-lead-energy-status crm-lead-energy-status-empty">{error}</div> : null}

      <div className="lead-pv-estimator__results">
        <div><span>Puissance</span><strong>{fmtNumber(r?.installable_power_kwc, 2)} kWc</strong></div>
        <div><span>Production</span><strong>{fmtNumber(r?.annual_production_kwh)} kWh/an</strong></div>
        <div><span>Autoconso.</span><strong>{fmtNumber(r?.autoconsumption_rate_pct, 1)} %</strong></div>
        <div><span>Economies</span><strong>{fmtNumber(r?.annual_savings_eur)} euros/an</strong></div>
        <div><span>Retour</span><strong>{r?.indicative_payback_years == null ? "-" : `${fmtNumber(r.indicative_payback_years, 1)} ans`}</strong></div>
      </div>
    </section>
  );
}
