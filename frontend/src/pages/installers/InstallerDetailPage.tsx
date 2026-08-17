import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { DataTable, type DataTableColumn } from "../../components/ui/DataTable";
import { PageHeader } from "../../components/ui/PageHeader";
import { showCrmInlineToast } from "../../components/ui/crmInlineToast";
import { getUserPermissions } from "../../services/auth.service";
import {
  activateInstallerTariffVersion,
  createInstallerTariffVersion,
  getInstaller,
  getInstallerTariffVersion,
  patchInstaller,
  replaceInstallerTariffCatalog,
  replaceInstallerZones,
} from "../../services/installers.service";
import {
  ELECTRICAL_TYPE_LABELS,
  formatDateFr,
  formatEuroHtFromCents,
  formatKwcFromWc,
  eurosToCents,
  centsToEuros,
  INSTALLATION_TYPE_LABELS,
} from "../../modules/installers/installers.format";
import type {
  ElectricalType,
  InstallationType,
  Installer,
  InstallerAncillaryService,
  InstallerElectricalRule,
  InstallerOption,
  InstallerTariffCatalog,
  InstallerTariffRow,
  InstallerTariffVersion,
  InstallerZone,
} from "../../modules/installers/installers.types";
import "./installers-page.css";

type TabId = "info" | "zones" | "tarifs" | "options" | "versions";

const INSTALLATION_TYPES: InstallationType[] = ["ROOF_SUPERIMPOSED", "FLAT_ROOF", "GROUND"];
const OHELEC_DEFAULT_POWERS_WC = Array.from({ length: 27 }, (_, index) => 2000 + index * 500);

function statusBadge(version: InstallerTariffVersion) {
  const cls =
    version.status === "ACTIVE"
      ? " installers-badge--active"
      : version.status === "DRAFT"
        ? " installers-badge--draft"
        : " installers-badge--archived";
  return <span className={`installers-badge${cls}`}>{version.status}</span>;
}

function defaultGridCodeForType(type: InstallationType, installerName?: string | null): string {
  const isOhelec = String(installerName ?? "").trim().toUpperCase() === "OHELEC";
  if (isOhelec) {
    if (type === "ROOF_SUPERIMPOSED") return "OHELEC_ROOF_SUPERIMPOSED_GRID";
    if (type === "FLAT_ROOF") return "OHELEC_FLAT_ROOF_GRID";
    return "OHELEC_GROUND_GRID";
  }
  return type === "ROOF_SUPERIMPOSED" ? "ROOF_SUPERIMPOSED_GRID" : `${type}_GRID`;
}

export default function InstallerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [installer, setInstaller] = useState<Installer | null>(null);
  const [catalog, setCatalog] = useState<InstallerTariffCatalog | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("info");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activateId, setActivateId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [superAdmin, setSuperAdmin] = useState(false);

  const canWriteInstaller = superAdmin || permissions.includes("installer.write");
  const canWritePricing = superAdmin || permissions.includes("installer.pricing.write");

  const load = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await getInstaller(id);
      setInstaller(data);
      const activeId = data.active_tariff?.tariff_version?.id ?? data.tariff_versions?.[0]?.id ?? null;
      setSelectedVersionId((current) => current || activeId);
      if (activeId) {
        const activeCatalog = await getInstallerTariffVersion(id, activeId);
        setCatalog(activeCatalog);
      } else {
        setCatalog(null);
      }
    } catch (e) {
      showCrmInlineToast(e instanceof Error ? e.message : "Erreur installateur", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  useEffect(() => {
    getUserPermissions()
      .then((data) => {
        setPermissions(data.permissions ?? []);
        setSuperAdmin(Boolean(data.superAdmin));
      })
      .catch(() => {
        setPermissions([]);
        setSuperAdmin(false);
      });
  }, []);

  useEffect(() => {
    if (!id || !selectedVersionId) return;
    let cancelled = false;
    getInstallerTariffVersion(id, selectedVersionId)
      .then((data) => {
        if (!cancelled) setCatalog(data);
      })
      .catch((e) => {
        if (!cancelled) showCrmInlineToast(e instanceof Error ? e.message : "Erreur version tarifaire", "error");
      });
    return () => {
      cancelled = true;
    };
  }, [id, selectedVersionId]);

  const versions = installer?.tariff_versions ?? [];
  const selectedVersion = versions.find((v) => v.id === selectedVersionId) ?? catalog?.tariff_version ?? null;

  const saveInfo = async (patch: Partial<Installer>) => {
    if (!id) return;
    if (!canWriteInstaller) {
      showCrmInlineToast("Permission insuffisante pour modifier l'installateur.", "error");
      return;
    }
    if (installer?.is_active && patch.is_active === false) {
      const ok = window.confirm("Désactiver cet installateur ? Il ne sera plus proposé pour les nouveaux calculs.");
      if (!ok) return;
    }
    setSaving(true);
    try {
      const updated = await patchInstaller(id, patch);
      setInstaller((prev) => (prev ? { ...prev, ...updated } : updated));
      showCrmInlineToast("Informations enregistrées.", "success");
    } catch (e) {
      showCrmInlineToast(e instanceof Error ? e.message : "Enregistrement impossible", "error");
    } finally {
      setSaving(false);
    }
  };

  const saveZones = async (zones: InstallerZone[]) => {
    if (!id || !installer) return;
    if (!canWriteInstaller) {
      showCrmInlineToast("Permission insuffisante pour modifier les zones.", "error");
      return;
    }
    setSaving(true);
    try {
      const saved = await replaceInstallerZones(id, zones);
      setInstaller({ ...installer, zones: saved });
      showCrmInlineToast("Zones enregistrées.", "success");
    } catch (e) {
      showCrmInlineToast(e instanceof Error ? e.message : "Zones non enregistrées", "error");
    } finally {
      setSaving(false);
    }
  };

  const saveCatalog = async (payload: Record<string, unknown>) => {
    if (!id || !selectedVersionId) return;
    if (!canWritePricing) {
      showCrmInlineToast("Permission insuffisante pour modifier la tarification.", "error");
      return;
    }
    setSaving(true);
    try {
      const next = await replaceInstallerTariffCatalog(id, selectedVersionId, payload);
      setCatalog(next);
      showCrmInlineToast("Catalogue tarifaire enregistré.", "success");
    } catch (e) {
      showCrmInlineToast(e instanceof Error ? e.message : "Catalogue non enregistré", "error");
    } finally {
      setSaving(false);
    }
  };

  const createVersion = async () => {
    if (!id) return;
    if (!canWritePricing) {
      showCrmInlineToast("Permission insuffisante pour créer une version tarifaire.", "error");
      return;
    }
    const label = window.prompt("Libellé de la nouvelle version tarifaire");
    if (!label?.trim()) return;
    try {
      const version = await createInstallerTariffVersion(id, { version_label: label.trim() });
      setInstaller((prev) => prev ? { ...prev, tariff_versions: [version, ...(prev.tariff_versions ?? [])] } : prev);
      setSelectedVersionId(version.id);
      showCrmInlineToast("Version tarifaire créée.", "success");
    } catch (e) {
      showCrmInlineToast(e instanceof Error ? e.message : "Création version impossible", "error");
    }
  };

  const confirmActivate = async () => {
    if (!id || !activateId) return;
    if (!canWritePricing) {
      showCrmInlineToast("Permission insuffisante pour activer une version tarifaire.", "error");
      return;
    }
    try {
      await activateInstallerTariffVersion(id, activateId);
      setActivateId(null);
      setInstaller(null);
      setSelectedVersionId(activateId);
      await load();
      showCrmInlineToast("Version tarifaire activée.", "success");
    } catch (e) {
      showCrmInlineToast(e instanceof Error ? e.message : "Activation impossible", "error");
    }
  };

  if (loading && !installer) {
    return <div className="installers-page"><p>Chargement installateur...</p></div>;
  }
  if (!installer) {
    return (
      <div className="installers-page">
        <p>Installateur introuvable.</p>
        <Button onClick={() => navigate("/installers")}>Retour</Button>
      </div>
    );
  }

  return (
    <div className="installers-page">
      <PageHeader
        eyebrow={<Link to="/installers">Installateurs</Link>}
        title={installer.name}
        description="Fiche partenaire RGE, zones et tarification installateur HT."
        actions={<Button variant="secondary" onClick={() => navigate("/installers")}>Retour liste</Button>}
        meta={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className={`installers-badge${installer.is_active ? " installers-badge--active" : ""}`}>
              {installer.is_active ? "Actif" : "Inactif"}
            </span>
            {selectedVersion ? statusBadge(selectedVersion) : null}
          </div>
        }
      />

      <section className="installers-card">
        <div className="installers-tabs" role="tablist">
          {[
            ["info", "Informations"],
            ["zones", "Zones d'intervention"],
            ["tarifs", "Tarifs"],
            ["options", "Options & suppléments"],
            ["versions", "Historique versions"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`installers-tab${tab === key ? " installers-tab--active" : ""}`}
              onClick={() => setTab(key as TabId)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {tab === "info" ? (
        <InstallerInfoTab installer={installer} saving={saving} canWrite={canWriteInstaller} onSave={(patch) => void saveInfo(patch)} />
      ) : null}
      {tab === "zones" ? (
        <InstallerZonesTab zones={installer.zones ?? []} saving={saving} canWrite={canWriteInstaller} onSave={(zones) => void saveZones(zones)} />
      ) : null}
      {tab === "tarifs" ? (
        <InstallerTariffsTab
          versions={versions}
          selectedVersionId={selectedVersionId}
          catalog={catalog}
          saving={saving}
          canWrite={canWritePricing}
          onSelectVersion={setSelectedVersionId}
          onCreateVersion={() => void createVersion()}
          onActivate={(versionId) => setActivateId(versionId)}
          onSaveCatalog={(payload) => void saveCatalog(payload)}
        />
      ) : null}
      {tab === "options" ? (
        <InstallerOptionsTab catalog={catalog} saving={saving} canWrite={canWritePricing} onSaveCatalog={(payload) => void saveCatalog(payload)} />
      ) : null}
      {tab === "versions" ? (
        <InstallerVersionsTab versions={versions} canWrite={canWritePricing} onCreateVersion={() => void createVersion()} onActivate={(versionId) => setActivateId(versionId)} />
      ) : null}

      <ConfirmModal
        open={Boolean(activateId)}
        title="Activer cette version tarifaire ?"
        message="Elle deviendra la version utilisée pour les nouveaux calculs. Les anciens devis ne seront pas modifiés grâce aux snapshots."
        confirmLabel="Activer"
        cancelLabel="Annuler"
        variant="warning"
        onConfirm={() => void confirmActivate()}
        onCancel={() => setActivateId(null)}
      />
    </div>
  );
}

function InstallerInfoTab({
  installer,
  saving,
  canWrite,
  onSave,
}: {
  installer: Installer;
  saving: boolean;
  canWrite: boolean;
  onSave: (patch: Partial<Installer>) => void;
}) {
  const [form, setForm] = useState({
    name: installer.name ?? "",
    legal_name: installer.legal_name ?? "",
    siret: installer.siret ?? "",
    contact_name: installer.contact_name ?? "",
    contact_email: installer.contact_email ?? "",
    contact_phone: installer.contact_phone ?? "",
    notes: installer.notes ?? "",
    is_active: installer.is_active,
  });

  useEffect(() => {
    setForm({
      name: installer.name ?? "",
      legal_name: installer.legal_name ?? "",
      siret: installer.siret ?? "",
      contact_name: installer.contact_name ?? "",
      contact_email: installer.contact_email ?? "",
      contact_phone: installer.contact_phone ?? "",
      notes: installer.notes ?? "",
      is_active: installer.is_active,
    });
  }, [installer]);

  return (
    <section className="installers-card installers-panel">
      <div className="installers-form-grid">
        <label className="installers-field">Nom<input className="installers-input" disabled={!canWrite} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="installers-field">Raison sociale<input className="installers-input" disabled={!canWrite} value={form.legal_name} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} /></label>
        <label className="installers-field">SIRET<input className="installers-input" disabled={!canWrite} value={form.siret} onChange={(e) => setForm({ ...form, siret: e.target.value })} /></label>
        <label className="installers-field">Contact<input className="installers-input" disabled={!canWrite} value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} /></label>
        <label className="installers-field">Email<input className="installers-input" disabled={!canWrite} value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} /></label>
        <label className="installers-field">Téléphone<input className="installers-input" disabled={!canWrite} value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} /></label>
        <label className="installers-field installers-field--full">Notes<textarea className="installers-input installers-textarea" disabled={!canWrite} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
        <label className="installers-field installers-field--full" style={{ flexDirection: "row", alignItems: "center" }}>
          <input type="checkbox" disabled={!canWrite} checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
          Installateur actif
        </label>
      </div>
      <div style={{ marginTop: 16 }}>
        <Button disabled={!canWrite || saving || !form.name.trim()} onClick={() => onSave(form)}>
          Enregistrer
        </Button>
      </div>
    </section>
  );
}

function InstallerZonesTab({
  zones,
  saving,
  canWrite,
  onSave,
}: {
  zones: InstallerZone[];
  saving: boolean;
  canWrite: boolean;
  onSave: (zones: InstallerZone[]) => void;
}) {
  const [draft, setDraft] = useState<InstallerZone[]>(zones);
  const [newZone, setNewZone] = useState<InstallerZone>({ zone_type: "DEPARTMENT", zone_code: "", label: "" });

  useEffect(() => {
    setDraft(zones);
  }, [zones]);

  const add = () => {
    const code = newZone.zone_code.trim();
    if (newZone.zone_type === "DEPARTMENT" && !/^\d{2,3}$/.test(code)) {
      showCrmInlineToast("Département invalide.", "error");
      return;
    }
    if (!code) {
      showCrmInlineToast("Code zone requis.", "error");
      return;
    }
    if (draft.some((z) => z.zone_type === newZone.zone_type && z.zone_code === code)) return;
    setDraft([...draft, { zone_type: newZone.zone_type, zone_code: code, label: newZone.label?.trim() || code }]);
    setNewZone({ ...newZone, zone_code: "", label: "" });
  };

  return (
    <section className="installers-card installers-panel">
      <h2>Zones configurées</h2>
      <div className="installers-zone-list">
        {draft.map((zone) => (
          <span key={`${zone.zone_type}:${zone.zone_code}`} className="installers-chip">
            {zone.zone_type === "DEPARTMENT" ? "Dept" : zone.zone_type === "POSTAL_CODE" ? "CP" : "Zone"} {zone.zone_code}
            <button type="button" disabled={!canWrite} aria-label={`Retirer ${zone.zone_code}`} onClick={() => setDraft(draft.filter((z) => !(z.zone_type === zone.zone_type && z.zone_code === zone.zone_code)))}>
              ×
            </button>
          </span>
        ))}
        {draft.length === 0 ? <span className="installers-muted">Aucune zone renseignée.</span> : null}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
        <label className="installers-field">
          Type
          <select className="installers-select" disabled={!canWrite} value={newZone.zone_type} onChange={(e) => setNewZone({ ...newZone, zone_type: e.target.value as InstallerZone["zone_type"] })}>
            <option value="DEPARTMENT">Département</option>
            <option value="POSTAL_CODE">Code postal</option>
            <option value="CUSTOM">Zone libre</option>
          </select>
        </label>
        <label className="installers-field">
          Code
          <input className="installers-input" disabled={!canWrite} value={newZone.zone_code} onChange={(e) => setNewZone({ ...newZone, zone_code: e.target.value })} placeholder="ex. 59 ou 59000" />
        </label>
        <label className="installers-field">
          Libellé
          <input className="installers-input" disabled={!canWrite} value={newZone.label ?? ""} onChange={(e) => setNewZone({ ...newZone, label: e.target.value })} placeholder="Optionnel" />
        </label>
        <Button variant="secondary" disabled={!canWrite} onClick={add}>Ajouter</Button>
        <Button disabled={!canWrite || saving} onClick={() => onSave(draft)}>Sauvegarder</Button>
      </div>
    </section>
  );
}

function InstallerTariffsTab({
  versions,
  selectedVersionId,
  catalog,
  saving,
  canWrite,
  onSelectVersion,
  onCreateVersion,
  onActivate,
  onSaveCatalog,
}: {
  versions: InstallerTariffVersion[];
  selectedVersionId: string | null;
  catalog: InstallerTariffCatalog | null;
  saving: boolean;
  canWrite: boolean;
  onSelectVersion: (id: string) => void;
  onCreateVersion: () => void;
  onActivate: (id: string) => void;
  onSaveCatalog: (payload: Record<string, unknown>) => void;
}) {
  return (
    <section className="installers-card installers-panel">
      <div className="installers-tariff-layout">
        <aside>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Versions</h2>
            {canWrite ? <Button size="sm" variant="secondary" onClick={onCreateVersion}>Nouvelle</Button> : null}
          </div>
          <div className="installers-version-list">
            {versions.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`installers-version-button${v.id === selectedVersionId ? " installers-version-button--active" : ""}`}
                onClick={() => onSelectVersion(v.id)}
              >
                <strong>{v.version_label}</strong>
                <div style={{ marginTop: 6 }}>{statusBadge(v)}</div>
                <small>Effet : {formatDateFr(v.effective_from)}</small>
              </button>
            ))}
          </div>
        </aside>
        <div>
          {catalog ? (
            <TariffMatrix catalog={catalog} saving={saving} canWrite={canWrite} onSaveCatalog={onSaveCatalog} onActivate={onActivate} />
          ) : (
            <p className="installers-muted">Aucune version tarifaire sélectionnée.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function TariffMatrix({
  catalog,
  saving,
  canWrite,
  onSaveCatalog,
  onActivate,
}: {
  catalog: InstallerTariffCatalog;
  saving: boolean;
  canWrite: boolean;
  onSaveCatalog: (payload: Record<string, unknown>) => void;
  onActivate: (id: string) => void;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [draftPowers, setDraftPowers] = useState<number[]>([]);
  const [newPowerWc, setNewPowerWc] = useState("");
  const mappingsByType = useMemo(
    () => new Map(catalog.installation_type_mappings.map((m) => [m.installation_type, m.pricing_grid_id])),
    [catalog.installation_type_mappings]
  );
  const gridsById = useMemo(
    () => new Map(catalog.grids.map((grid) => [grid.id, grid])),
    [catalog.grids]
  );
  const gridCodeByType = useMemo(() => {
    const map = new Map<InstallationType, string>();
    for (const type of INSTALLATION_TYPES) {
      const gridId = mappingsByType.get(type);
      const existingCode = gridId ? gridsById.get(gridId)?.code : null;
      map.set(type, existingCode || defaultGridCodeForType(type, catalog.installer.name));
    }
    return map;
  }, [catalog.installer.name, gridsById, mappingsByType]);
  const rowsByGridPower = useMemo(() => {
    const map = new Map<string, InstallerTariffRow>();
    for (const row of catalog.tariff_rows) map.set(`${row.pricing_grid_id}:${row.power_wc}`, row);
    return map;
  }, [catalog.tariff_rows]);
  const catalogPowers = useMemo(() => {
    const values = new Set(catalog.tariff_rows.map((r) => Number(r.power_wc)).filter((n) => Number.isFinite(n)));
    if (String(catalog.installer.name ?? "").trim().toUpperCase() === "OHELEC") {
      for (const power of OHELEC_DEFAULT_POWERS_WC) values.add(power);
    }
    return Array.from(values).sort((a, b) => a - b);
  }, [catalog.installer.name, catalog.tariff_rows]);

  useEffect(() => {
    setDraftPowers(catalogPowers);
  }, [catalogPowers]);

  const powers = draftPowers;

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const type of INSTALLATION_TYPES) {
      const gridId = mappingsByType.get(type);
      for (const power of powers) {
        const row = gridId ? rowsByGridPower.get(`${gridId}:${power}`) : null;
        next[`${type}:${power}`] = row ? String(centsToEuros(row.amount_ht_cents)) : "";
      }
    }
    setAmounts(next);
  }, [mappingsByType, powers, rowsByGridPower]);

  const save = () => {
    for (const power of powers) {
      for (const type of INSTALLATION_TYPES) {
        const raw = amounts[`${type}:${power}`];
        const value = Number(String(raw).replace(",", "."));
        if (!Number.isFinite(value) || value < 0) {
          showCrmInlineToast("Montant tarifaire invalide.", "error");
          return;
        }
      }
    }
    const grids = INSTALLATION_TYPES.map((type) => ({
      code: gridCodeByType.get(type) || defaultGridCodeForType(type, catalog.installer.name),
      label: INSTALLATION_TYPE_LABELS[type],
    }));
    const tariff_rows = INSTALLATION_TYPES.flatMap((type) =>
      powers.map((power, index) => ({
        grid_code: gridCodeByType.get(type) || defaultGridCodeForType(type, catalog.installer.name),
        power_wc: power,
        panel_count_hint: rowsByGridPower.get(`${mappingsByType.get(type)}:${power}`)?.panel_count_hint ?? null,
        amount_ht_cents: eurosToCents(amounts[`${type}:${power}`]),
        sort_order: index + 1,
      }))
    );
    onSaveCatalog({
      grids,
      installation_type_mappings: INSTALLATION_TYPES.map((type) => ({
        installation_type: type,
        grid_code: gridCodeByType.get(type) || defaultGridCodeForType(type, catalog.installer.name),
      })),
      tariff_rows,
    });
  };

  const addPower = () => {
    const power = Number(newPowerWc);
    if (!Number.isInteger(power) || power <= 0) {
      showCrmInlineToast("Puissance invalide.", "error");
      return;
    }
    if (draftPowers.includes(power)) return;
    setDraftPowers([...draftPowers, power].sort((a, b) => a - b));
    setNewPowerWc("");
  };

  const removePower = (power: number) => {
    setDraftPowers(draftPowers.filter((p) => p !== power));
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>{catalog.tariff_version.version_label}</h2>
          <p className="installers-muted" style={{ margin: "4px 0 0" }}>Tous les montants sont affichés en € HT.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {canWrite ? (
            <>
              <input
                className="installers-input"
                style={{ width: 130 }}
                value={newPowerWc}
                onChange={(e) => setNewPowerWc(e.target.value)}
                placeholder="Palier Wc"
              />
              <Button variant="secondary" onClick={addPower}>Ajouter palier</Button>
            </>
          ) : null}
          {canWrite && catalog.tariff_version.status !== "ACTIVE" ? (
            <Button variant="secondary" onClick={() => onActivate(catalog.tariff_version.id)}>Activer</Button>
          ) : null}
          {canWrite ? <Button disabled={saving} onClick={save}>Enregistrer tarifs</Button> : null}
        </div>
      </div>
      <div className="installers-table-wrap">
        <table className="installers-price-table">
          <thead>
            <tr>
              <th>Puissance</th>
              {INSTALLATION_TYPES.map((type) => <th key={type}>{INSTALLATION_TYPE_LABELS[type]}</th>)}
              {canWrite ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {powers.map((power) => (
              <tr key={power}>
                <td><strong>{formatKwcFromWc(power)}</strong></td>
                {INSTALLATION_TYPES.map((type) => (
                  <td key={type}>
                    <input
                      className="installers-price-input"
                      type="number"
                      min="0"
                      step="0.01"
                      disabled={!canWrite}
                      value={amounts[`${type}:${power}`] ?? ""}
                      onChange={(e) => setAmounts({ ...amounts, [`${type}:${power}`]: e.target.value })}
                      aria-label={`${INSTALLATION_TYPE_LABELS[type]} ${formatKwcFromWc(power)} € HT`}
                    />{" "}
                    € HT
                  </td>
                ))}
                {canWrite ? (
                  <td>
                    <Button size="sm" variant="ghost" onClick={() => removePower(power)}>Supprimer</Button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function InstallerOptionsTab({
  catalog,
  saving,
  canWrite,
  onSaveCatalog,
}: {
  catalog: InstallerTariffCatalog | null;
  saving: boolean;
  canWrite: boolean;
  onSaveCatalog: (payload: Record<string, unknown>) => void;
}) {
  const [rules, setRules] = useState<InstallerElectricalRule[]>([]);
  const [options, setOptions] = useState<InstallerOption[]>([]);
  const [services, setServices] = useState<InstallerAncillaryService[]>([]);

  useEffect(() => {
    setRules(catalog?.electrical_rules ?? []);
    setOptions(catalog?.options ?? []);
    setServices(catalog?.ancillary_services ?? []);
  }, [catalog]);

  if (!catalog) return <section className="installers-card installers-panel">Aucune version sélectionnée.</section>;

  const optionColumns: DataTableColumn<InstallerOption>[] = [
    { id: "label", header: "Option", render: (row) => row.label },
    { id: "code", header: "Code", render: (row) => row.code },
    {
      id: "amount",
      header: "Montant",
      align: "right",
      render: (row) => (
        <input
          className="installers-price-input"
          type="number"
          min="0"
          step="0.01"
          disabled={!canWrite}
          value={centsToEuros(row.amount_ht_cents)}
          onChange={(e) => setOptions(options.map((o) => o.code === row.code ? { ...o, amount_ht_cents: eurosToCents(e.target.value) } : o))}
        />
      ),
    },
    {
      id: "active",
      header: "Active",
      render: (row) => (
        <input
          type="checkbox"
          disabled={!canWrite}
          checked={row.is_active}
          onChange={(e) => setOptions(options.map((o) => o.code === row.code ? { ...o, is_active: e.target.checked } : o))}
        />
      ),
    },
    { id: "override", header: "Overridable", render: (row) => row.is_amount_overridable ? "Oui" : "Non" },
    { id: "group", header: "Incompatibilité", render: (row) => row.incompatible_group || "—" },
  ];

  return (
    <section className="installers-card installers-panel">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>Options & suppléments</h2>
          <p className="installers-muted" style={{ margin: "4px 0 0" }}>Options intégrées au calcul standard et prestations annexes séparées.</p>
        </div>
        {canWrite ? (
          <Button disabled={saving} onClick={() => onSaveCatalog({ electrical_rules: rules, options, ancillary_services: services })}>
            Enregistrer
          </Button>
        ) : null}
      </div>
      <div className="installers-summary-grid" style={{ marginBottom: 16 }}>
        {(["MONO", "TRI"] as ElectricalType[]).map((type) => {
          const rule = rules.find((r) => r.electrical_type === type);
          return (
            <label key={type} className="installers-summary-item">
              <span className="installers-summary-label">{ELECTRICAL_TYPE_LABELS[type]}</span>
              <input
                className="installers-price-input"
                type="number"
                min="0"
                step="0.01"
                disabled={!canWrite}
                value={centsToEuros(rule?.amount_ht_cents ?? 0)}
                onChange={(e) =>
                  setRules((prev) =>
                    prev.map((r) => r.electrical_type === type ? { ...r, amount_ht_cents: eurosToCents(e.target.value) } : r)
                  )
                }
              />{" "}
              € HT
            </label>
          );
        })}
      </div>
      <DataTable rows={options} columns={optionColumns} getRowKey={(row) => row.code} title="Options du calcul" dense />
      <div style={{ height: 16 }} />
      <DataTable
        rows={services}
        columns={[
          { id: "label", header: "Prestation annexe", render: (row) => row.label },
          { id: "code", header: "Code", render: (row) => row.code },
          { id: "amount", header: "Montant", align: "right", render: (row) => formatEuroHtFromCents(row.amount_ht_cents) },
        ]}
        getRowKey={(row) => row.code}
        title="Prestations annexes hors calcul standard"
        dense
      />
    </section>
  );
}

function InstallerVersionsTab({
  versions,
  canWrite,
  onCreateVersion,
  onActivate,
}: {
  versions: InstallerTariffVersion[];
  canWrite: boolean;
  onCreateVersion: () => void;
  onActivate: (id: string) => void;
}) {
  return (
    <section className="installers-card installers-panel">
      <DataTable
        rows={versions}
        columns={[
          { id: "label", header: "Version", render: (row) => row.version_label },
          { id: "status", header: "Statut", render: (row) => statusBadge(row) },
          { id: "from", header: "Date d'effet", render: (row) => formatDateFr(row.effective_from) },
          { id: "created", header: "Créée le", render: (row) => formatDateFr(row.created_at) },
          {
            id: "actions",
            header: "",
            align: "right",
            render: (row) =>
              canWrite && row.status !== "ACTIVE" ? (
                <Button size="sm" variant="secondary" onClick={() => onActivate(row.id)}>Activer</Button>
              ) : null,
          },
        ]}
        getRowKey={(row) => row.id}
        title="Historique des versions tarifaires"
        actions={canWrite ? <Button size="sm" onClick={onCreateVersion}>Nouvelle version</Button> : null}
        dense
      />
    </section>
  );
}
