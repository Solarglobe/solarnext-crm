import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { showCrmInlineToast } from "../../components/ui/crmInlineToast";
import { computeInstallerInstallationCost, listInstallers } from "../../services/installers.service";
import {
  ELECTRICAL_TYPE_LABELS,
  formatEuroHtFromCents,
  formatKwcFromWc,
  formatDateFr,
  INSTALLATION_TYPE_LABELS,
  centsToEuros,
  eurosToCents,
} from "./installers.format";
import type {
  ElectricalType,
  InstallationType,
  InstallerCostOptionInput,
  InstallerCostResult,
  InstallerListRow,
} from "./installers.types";
import "../../pages/installers/installers-page.css";

const INSTALLATION_TYPES: InstallationType[] = ["ROOF_SUPERIMPOSED", "FLAT_ROOF", "GROUND"];
const ELECTRICAL_TYPES: ElectricalType[] = ["MONO", "TRI"];
const OPTION_ORDER = [
  "BATTERY_UP_TO_5_KWH",
  "BATTERY_OVER_5_KWH",
  "EV_CHARGER",
  "MULTIPLE_ROOF_SECTIONS",
  "NEW_SLATE_INSTALLATION",
  "TECHNICAL_VISIT",
  "CABLE_AND_CONNECTION",
];

function optionLabel(code: string): string {
  const labels: Record<string, string> = {
    BATTERY_UP_TO_5_KWH: "Batterie ≤ 5 kWh",
    BATTERY_OVER_5_KWH: "Batterie > 5 kWh",
    EV_CHARGER: "Borne de recharge",
    MULTIPLE_ROOF_SECTIONS: "Plusieurs pans",
    NEW_SLATE_INSTALLATION: "Ardoise neuve",
    TECHNICAL_VISIT: "Visite technique",
    CABLE_AND_CONNECTION: "Câble / raccordement",
  };
  return labels[code] ?? code;
}

function extractBackendCode(e: unknown): string | null {
  if (e && typeof e === "object" && "code" in e) return String((e as { code?: unknown }).code ?? "");
  return null;
}

export function InstallerCostSummary({ result, frozen = false }: { result: InstallerCostResult; frozen?: boolean }) {
  return (
    <div className={frozen ? "installer-snapshot-freeze" : "installer-quote-result"}>
      {frozen ? <strong>Tarif figé au moment du devis</strong> : <strong>Coût installation {result.installer?.name}</strong>}
      <div className="installers-summary-grid" style={{ marginTop: 12 }}>
        <div className="installers-summary-item">
          <span className="installers-summary-label">Puissance projet</span>
          <span className="installers-summary-value">{formatKwcFromWc(result.requested_power_wc)}</span>
        </div>
        <div className="installers-summary-item">
          <span className="installers-summary-label">Palier appliqué</span>
          <span className="installers-summary-value">{formatKwcFromWc(result.matched_power_wc)}</span>
        </div>
        <div className="installers-summary-item">
          <span className="installers-summary-label">Version</span>
          <span className="installers-summary-value">{result.tariff_version?.version_label ?? "—"}</span>
        </div>
      </div>
      <p style={{ margin: "12px 0 4px" }}>
        {INSTALLATION_TYPE_LABELS[result.installation_type]} · {ELECTRICAL_TYPE_LABELS[result.electrical_type]}
      </p>
      <div>
        <div>Base pose : {formatEuroHtFromCents(result.base_amount_ht_cents)}</div>
        {result.electrical_adjustments.map((item) => (
          <div key={item.code}>{item.label} : +{formatEuroHtFromCents(item.amount_ht_cents)}</div>
        ))}
        {result.options.map((item) => (
          <div key={item.code}>
            {item.label} : +{formatEuroHtFromCents(item.final_amount_ht_cents)}
            {item.override ? ` (catalogue ${formatEuroHtFromCents(item.catalog_amount_ht_cents)})` : ""}
          </div>
        ))}
      </div>
      {result.manual_override ? (
        <p className="installers-badge installers-badge--draft" style={{ marginTop: 10 }}>
          Modification manuelle : {result.manual_override.reason}
        </p>
      ) : null}
      <div className="installer-quote-total">
        <span>{result.manual_override ? "Coût retenu" : "Total installateur"}</span>
        <span>{formatEuroHtFromCents(result.final_total_ht_cents)}</span>
      </div>
      {result.manual_override ? (
        <p className="installers-muted">Coût calculé catalogue : {formatEuroHtFromCents(result.catalog_total_ht_cents)}</p>
      ) : null}
    </div>
  );
}

export default function InstallerQuotePrepPanel({
  studyId,
  versionId,
  projectPowerWc,
  locked,
  value,
  onPersisted,
}: {
  studyId: string;
  versionId: string;
  projectPowerWc: number | null;
  locked: boolean;
  value?: InstallerCostResult | null;
  onPersisted: (result: InstallerCostResult | null) => void;
}) {
  const [installers, setInstallers] = useState<InstallerListRow[]>([]);
  const [installerId, setInstallerId] = useState(value?.installer?.id ?? "");
  const [installationType, setInstallationType] = useState<InstallationType>(value?.installation_type ?? "ROOF_SUPERIMPOSED");
  const [electricalType, setElectricalType] = useState<ElectricalType>(value?.electrical_type ?? "MONO");
  const [selectedOptions, setSelectedOptions] = useState<string[]>(value?.options?.map((o) => o.code) ?? []);
  const [cableOverrideEnabled, setCableOverrideEnabled] = useState(Boolean(value?.option_overrides?.some((o) => o.code === "CABLE_AND_CONNECTION")));
  const [cableOverride, setCableOverride] = useState(
    value?.option_overrides?.find((o) => o.code === "CABLE_AND_CONNECTION")?.override_amount_ht_cents != null
      ? String(centsToEuros(value.option_overrides.find((o) => o.code === "CABLE_AND_CONNECTION")?.override_amount_ht_cents))
      : ""
  );
  const [manualOverrideEnabled, setManualOverrideEnabled] = useState(Boolean(value?.manual_override));
  const [manualOverride, setManualOverride] = useState(String(centsToEuros(value?.manual_override?.amount_ht_cents ?? 0)));
  const [manualReason, setManualReason] = useState(value?.manual_override?.reason ?? "");
  const [result, setResult] = useState<InstallerCostResult | null>(value ?? null);
  const [error, setError] = useState<string | null>(null);
  const [computing, setComputing] = useState(false);

  useEffect(() => {
    listInstallers({ active: true })
      .then((data) => {
        setInstallers(data);
        if (!installerId && data[0]?.id) setInstallerId(data[0].id);
      })
      .catch(() => setInstallers([]));
  }, []);

  useEffect(() => {
    if (value) {
      setResult(value);
      setInstallerId(value.installer?.id ?? "");
      setInstallationType(value.installation_type);
      setElectricalType(value.electrical_type);
      setSelectedOptions(value.options?.map((o) => o.code) ?? []);
    }
  }, [value?.calculated_at]);

  const optionInputs = useMemo<InstallerCostOptionInput[]>(() => {
    return selectedOptions.map((code) => ({
      code,
      ...(code === "CABLE_AND_CONNECTION" && cableOverrideEnabled && cableOverride.trim()
        ? { amount_ht_cents_override: eurosToCents(cableOverride) }
        : {}),
    }));
  }, [selectedOptions, cableOverrideEnabled, cableOverride]);

  const cableCatalogAmount = result?.options?.find((item) => item.code === "CABLE_AND_CONNECTION")?.catalog_amount_ht_cents;

  useEffect(() => {
    if (locked || !installerId || !projectPowerWc || projectPowerWc <= 0) return;
    if (manualOverrideEnabled && !manualReason.trim()) {
      setError("Le motif est obligatoire pour une modification manuelle globale.");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setComputing(true);
      setError(null);
      try {
        const payload = {
          requested_power_wc: Math.round(projectPowerWc),
          installation_type: installationType,
          electrical_type: electricalType,
          options: optionInputs,
          study_id: studyId,
          study_version_id: versionId,
          save_to_quote_prep: true,
          ...(manualOverrideEnabled
            ? {
                manual_override_ht_cents: eurosToCents(manualOverride),
                manual_override_reason: manualReason.trim(),
              }
            : {}),
        };
        const next = await computeInstallerInstallationCost(installerId, payload);
        if (cancelled) return;
        setResult(next);
        onPersisted(next);
      } catch (e) {
        if (cancelled) return;
        const code = extractBackendCode(e);
        setResult(null);
        onPersisted(null);
        setError(
          code === "NO_TARIFF_FOR_POWER"
            ? "Aucun tarif installateur disponible pour cette puissance."
            : e instanceof Error
              ? e.message
              : "Calcul installateur impossible"
        );
      } finally {
        if (!cancelled) setComputing(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    locked,
    installerId,
    projectPowerWc,
    installationType,
    electricalType,
    optionInputs,
    manualOverrideEnabled,
    manualOverride,
    manualReason,
    studyId,
    versionId,
    onPersisted,
  ]);

  const toggleOption = (code: string, checked: boolean) => {
    let next = selectedOptions.filter((c) => c !== code);
    if (checked) {
      if (code === "BATTERY_UP_TO_5_KWH") next = next.filter((c) => c !== "BATTERY_OVER_5_KWH");
      if (code === "BATTERY_OVER_5_KWH") next = next.filter((c) => c !== "BATTERY_UP_TO_5_KWH");
      next.push(code);
    }
    setSelectedOptions(next);
  };

  return (
    <section className="sn-card installers-panel installer-quote-panel" aria-labelledby="installer-rge-title">
      <div>
        <h2 id="installer-rge-title" className="sqb-h2">Installateur RGE</h2>
        <p className="installers-muted">Calcul HT via le moteur backend installateur. La puissance projet est envoyée telle quelle.</p>
      </div>
      <div className="installer-quote-form">
        <label className="installers-field">
          Installateur
          <select className="installers-select" value={installerId} disabled={locked} onChange={(e) => setInstallerId(e.target.value)}>
            <option value="">Sélectionner</option>
            {installers.map((installer) => (
              <option key={installer.id} value={installer.id}>{installer.name}</option>
            ))}
          </select>
        </label>
        <label className="installers-field">
          Type d'installation
          <select className="installers-select" value={installationType} disabled={locked} onChange={(e) => setInstallationType(e.target.value as InstallationType)}>
            {INSTALLATION_TYPES.map((type) => <option key={type} value={type}>{INSTALLATION_TYPE_LABELS[type]}</option>)}
          </select>
        </label>
        <label className="installers-field">
          Électrique
          <select className="installers-select" value={electricalType} disabled={locked} onChange={(e) => setElectricalType(e.target.value as ElectricalType)}>
            {ELECTRICAL_TYPES.map((type) => <option key={type} value={type}>{ELECTRICAL_TYPE_LABELS[type]}</option>)}
          </select>
        </label>
      </div>

      <div className="installers-summary-grid">
        <div className="installers-summary-item">
          <span className="installers-summary-label">Puissance projet</span>
          <span className="installers-summary-value">{formatKwcFromWc(projectPowerWc)}</span>
        </div>
        <div className="installers-summary-item">
          <span className="installers-summary-label">Version active</span>
          <span className="installers-summary-value">{installers.find((i) => i.id === installerId)?.active_tariff_version_label ?? "—"}</span>
        </div>
        <div className="installers-summary-item">
          <span className="installers-summary-label">Date d'effet</span>
          <span className="installers-summary-value">{formatDateFr(installers.find((i) => i.id === installerId)?.active_tariff_effective_from)}</span>
        </div>
      </div>

      <div className="installer-quote-options">
        {OPTION_ORDER.map((code) => {
          const selected = selectedOptions.includes(code);
          const disabled =
            locked ||
            (code === "BATTERY_UP_TO_5_KWH" && selectedOptions.includes("BATTERY_OVER_5_KWH")) ||
            (code === "BATTERY_OVER_5_KWH" && selectedOptions.includes("BATTERY_UP_TO_5_KWH"));
          return (
            <label key={code} className="installer-quote-option">
              <input type="checkbox" checked={selected} disabled={disabled} onChange={(e) => toggleOption(code, e.target.checked)} />
              <span>
                <strong>{optionLabel(code)}</strong>
                {code === "CABLE_AND_CONNECTION" ? (
                  <span style={{ display: "block", marginTop: 6 }}>
                    <input
                      type="checkbox"
                      checked={cableOverrideEnabled}
                      disabled={locked || !selected}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setCableOverrideEnabled(checked);
                        if (checked && !cableOverride.trim() && cableCatalogAmount != null) {
                          setCableOverride(String(centsToEuros(cableCatalogAmount)));
                        }
                      }}
                    />{" "}
                    {cableCatalogAmount != null ? `Tarif catalogue : ${formatEuroHtFromCents(cableCatalogAmount)} · ` : ""}
                    Montant appliqué{" "}
                    <input
                      className="installers-price-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={cableOverride}
                      disabled={locked || !selected || !cableOverrideEnabled}
                      onChange={(e) => setCableOverride(e.target.value)}
                    />{" "}
                    € HT
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>

      <div className="installer-quote-option">
        <input type="checkbox" checked={manualOverrideEnabled} disabled={locked} onChange={(e) => setManualOverrideEnabled(e.target.checked)} />
        <div style={{ width: "100%" }}>
          <strong>Modifier manuellement le coût installateur</strong>
          {manualOverrideEnabled ? (
            <div className="installer-quote-form" style={{ marginTop: 8, gridTemplateColumns: "180px minmax(0, 1fr)" }}>
              <label className="installers-field">Montant HT<input className="installers-input" type="number" min="0" step="0.01" value={manualOverride} onChange={(e) => setManualOverride(e.target.value)} /></label>
              <label className="installers-field">Motif obligatoire<input className="installers-input" value={manualReason} onChange={(e) => setManualReason(e.target.value)} /></label>
            </div>
          ) : null}
        </div>
      </div>

      {computing ? <p className="installers-muted">Calcul installateur...</p> : null}
      {error ? <div className="installer-quote-error">{error}</div> : null}
      {result ? <InstallerCostSummary result={result} /> : null}
      {!locked && result ? <Button onClick={() => showCrmInlineToast("Calcul installateur sauvegardé dans la préparation.", "success")}>Calcul sauvegardé</Button> : null}
    </section>
  );
}
