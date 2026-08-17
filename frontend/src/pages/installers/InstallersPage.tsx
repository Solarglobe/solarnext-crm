import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { DataTable, type DataTableColumn } from "../../components/ui/DataTable";
import { PageHeader } from "../../components/ui/PageHeader";
import { showCrmInlineToast } from "../../components/ui/crmInlineToast";
import { createInstaller, listInstallers } from "../../services/installers.service";
import { getUserPermissions } from "../../services/auth.service";
import type { InstallerListRow } from "../../modules/installers/installers.types";
import { formatDateFr } from "../../modules/installers/installers.format";
import "./installers-page.css";

export default function InstallersPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<InstallerListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState<"" | "true" | "false">("true");
  const [department, setDepartment] = useState("");
  const [canWrite, setCanWrite] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({
    name: "",
    legal_name: "",
    siret: "",
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    notes: "",
    is_active: true,
  });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    getUserPermissions()
      .then((data) => setCanWrite(data.permissions.includes("installer.write") || Boolean(data.superAdmin)))
      .catch(() => setCanWrite(false));
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const data = await listInstallers({
        q,
        active: active === "" ? "" : active === "true",
        department,
      });
      setLoadError(null);
      setRows(data);
    } catch (e) {
      setRows([]);
      setLoadError(e instanceof Error ? e.message : "Impossible de charger les installateurs");
      showCrmInlineToast(e instanceof Error ? e.message : "Erreur installateurs", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [q, active, department]);

  const columns = useMemo<DataTableColumn<InstallerListRow>[]>(
    () => [
      {
        id: "name",
        header: "Entreprise",
        render: (row) => (
          <button className="installers-link-button" type="button" onClick={() => navigate(`/installers/${row.id}`)}>
            {row.name}
          </button>
        ),
      },
      {
        id: "status",
        header: "Statut",
        render: (row) => (
          <span className={`installers-badge${row.is_active ? " installers-badge--active" : ""}`}>
            {row.is_active ? "Actif" : "Inactif"}
          </span>
        ),
      },
      {
        id: "zones",
        header: "Départements couverts",
        render: (row) => {
          const departments = (row.zones ?? []).filter((z) => z.zone_type === "DEPARTMENT").map((z) => z.zone_code);
          if (!departments.length) return <span className="installers-muted">—</span>;
          return (
            <div className="installers-zone-list" style={{ margin: 0 }}>
              {departments.slice(0, 4).map((dept) => <span key={dept} className="installers-chip">{dept}</span>)}
              {departments.length > 4 ? <span className="installers-muted">+{departments.length - 4}</span> : null}
            </div>
          );
        },
      },
      {
        id: "tariff",
        header: "Version active",
        render: (row) => row.active_tariff_version_label || <span className="installers-muted">Aucune</span>,
      },
      {
        id: "effective",
        header: "Date d'effet",
        render: (row) => formatDateFr(row.active_tariff_effective_from),
      },
      {
        id: "updated",
        header: "Dernière modification",
        render: (row) => formatDateFr(row.updated_at),
      },
      {
        id: "action",
        header: "",
        align: "right",
        render: (row) => (
          <Button variant="ghost" size="sm" onClick={() => navigate(`/installers/${row.id}`)}>
            Ouvrir
          </Button>
        ),
      },
    ],
    [navigate]
  );

  const handleCreate = async () => {
    const name = createForm.name.trim();
    if (!name) {
      showCrmInlineToast("Nom installateur requis.", "error");
      return;
    }
    setCreating(true);
    try {
      const installer = await createInstaller({
        ...createForm,
        name,
        legal_name: createForm.legal_name.trim() || null,
        siret: createForm.siret.trim() || null,
        contact_name: createForm.contact_name.trim() || null,
        contact_email: createForm.contact_email.trim() || null,
        contact_phone: createForm.contact_phone.trim() || null,
        notes: createForm.notes.trim() || null,
      });
      showCrmInlineToast("Installateur créé.", "success");
      navigate(`/installers/${installer.id}`);
    } catch (e) {
      showCrmInlineToast(e instanceof Error ? e.message : "Création impossible", "error");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="installers-page">
      <PageHeader
        eyebrow="Installation"
        title="Installateurs"
        description="Entreprises RGE partenaires, zones d'intervention et tarifications HT."
      />

      {canWrite ? (
        <section className="installers-card installers-panel">
          <h2>Nouvel installateur</h2>
          <div className="installers-form-grid">
            <label className="installers-field">Nom<input className="installers-input" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} /></label>
            <label className="installers-field">Raison sociale<input className="installers-input" value={createForm.legal_name} onChange={(e) => setCreateForm({ ...createForm, legal_name: e.target.value })} /></label>
            <label className="installers-field">SIRET<input className="installers-input" value={createForm.siret} onChange={(e) => setCreateForm({ ...createForm, siret: e.target.value })} /></label>
            <label className="installers-field">Contact<input className="installers-input" value={createForm.contact_name} onChange={(e) => setCreateForm({ ...createForm, contact_name: e.target.value })} /></label>
            <label className="installers-field">Email<input className="installers-input" value={createForm.contact_email} onChange={(e) => setCreateForm({ ...createForm, contact_email: e.target.value })} /></label>
            <label className="installers-field">Téléphone<input className="installers-input" value={createForm.contact_phone} onChange={(e) => setCreateForm({ ...createForm, contact_phone: e.target.value })} /></label>
            <label className="installers-field installers-field--full">Notes<textarea className="installers-input installers-textarea" value={createForm.notes} onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })} /></label>
            <label className="installers-field installers-field--full" style={{ flexDirection: "row", alignItems: "center" }}>
              <input type="checkbox" checked={createForm.is_active} onChange={(e) => setCreateForm({ ...createForm, is_active: e.target.checked })} />
              Actif
            </label>
          </div>
          <Button onClick={() => void handleCreate()} disabled={creating || !createForm.name.trim()}>
            {creating ? "Création..." : "Nouvel installateur"}
          </Button>
        </section>
      ) : null}

      <section className="installers-card">
        <div className="installers-toolbar">
          <label className="installers-field">
            Recherche
            <input className="installers-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom entreprise" />
          </label>
          <label className="installers-field">
            Statut
            <select className="installers-select" value={active} onChange={(e) => setActive(e.target.value as "" | "true" | "false")}>
              <option value="true">Actifs</option>
              <option value="">Tous</option>
              <option value="false">Inactifs</option>
            </select>
          </label>
          <label className="installers-field">
            Département
            <input className="installers-input" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="ex. 59" />
          </label>
          <Button variant="secondary" onClick={() => void load()}>
            Actualiser
          </Button>
        </div>
        {loadError ? <div className="installer-quote-error">Impossible de charger les installateurs.</div> : null}

        <DataTable
          rows={rows}
          columns={columns}
          getRowKey={(row) => row.id}
          loading={loading}
          emptyTitle="Aucun installateur"
          emptyDescription="Créez un installateur ou modifiez les filtres."
          dense
        />
      </section>
    </div>
  );
}
