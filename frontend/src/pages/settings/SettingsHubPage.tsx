import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { DataTable, PageHeader, type DataTableColumn } from "../../components/ui";
import { getUserPermissions } from "../../services/auth.service";
import "./settings-hub-page.css";

type SettingsCard = {
  title: string;
  description: string;
  href: string;
  group: "Compte" | "Organisation" | "Commercial" | "Technique" | "Controle";
  status: string;
  permission: string;
  adminOnly?: boolean;
};

const ADMIN_PERMISSIONS = [
  "org.settings.manage",
  "structure.manage",
  "rbac.manage",
  "user.manage",
];

const SETTINGS_CARDS: SettingsCard[] = [
  {
    title: "Mon compte",
    description: "Acces personnel, sessions et verification du compte.",
    href: "/settings/security",
    group: "Compte",
    status: "Personnel",
    permission: "Utilisateur connecte",
  },
  {
    title: "Securite",
    description: "MFA, sessions actives et regles de securite.",
    href: "/settings/security",
    group: "Compte",
    status: "Disponible",
    permission: "Utilisateur connecte",
  },
  {
    title: "Organisation",
    description: "Identite entreprise, logo et informations officielles.",
    href: "/organization/company",
    group: "Organisation",
    status: "Admin",
    permission: "Admin org ou structure.manage",
    adminOnly: true,
  },
  {
    title: "Utilisateurs",
    description: "Membres, invitations et acces internes.",
    href: "/organization/users",
    group: "Organisation",
    status: "Admin",
    permission: "Admin org ou user.manage",
    adminOnly: true,
  },
  {
    title: "Roles",
    description: "Roles, permissions et droits applicatifs.",
    href: "/organization/roles",
    group: "Organisation",
    status: "Admin",
    permission: "Admin org ou rbac.manage",
    adminOnly: true,
  },
  {
    title: "Equipes / agences",
    description: "Structure commerciale, agences et repartition des equipes.",
    href: "/organization/teams",
    group: "Organisation",
    status: "Admin",
    permission: "Admin org ou structure.manage",
    adminOnly: true,
  },
  {
    title: "Catalogue devis",
    description: "Articles, textes, modeles et parametrage commercial des devis.",
    href: "/organization/catalog",
    group: "Commercial",
    status: "Admin",
    permission: "Admin org ou org.settings.manage",
    adminOnly: true,
  },
  {
    title: "Messagerie",
    description: "Comptes mail, signatures, templates et droits d'acces.",
    href: "/settings/mail",
    group: "Organisation",
    status: "Configuration",
    permission: "Admin org ou org.settings.manage",
    adminOnly: true,
  },
  {
    title: "Parametres PV",
    description: "Parametres techniques et economiques utilises par le CRM solaire.",
    href: "/admin/settings/pv",
    group: "Technique",
    status: "Technique",
    permission: "Admin org ou org.settings.manage",
    adminOnly: true,
  },
  {
    title: "Journal d'audit",
    description: "Evenements sensibles, actions admin et traces de securite.",
    href: "/admin/audit-log",
    group: "Controle",
    status: "Controle",
    permission: "Admin org ou super admin",
    adminOnly: true,
  },
];

const GROUP_ORDER: SettingsCard["group"][] = ["Compte", "Organisation", "Commercial", "Technique", "Controle"];

const MATRIX_COLUMNS: DataTableColumn<SettingsCard>[] = [
  {
    id: "section",
    header: "Section",
    render: (row) => <strong>{row.title}</strong>,
    width: "22%",
  },
  {
    id: "path",
    header: "Route",
    render: (row) => <code>{row.href}</code>,
    width: "22%",
  },
  {
    id: "permission",
    header: "Permission",
    render: (row) => row.permission,
  },
  {
    id: "status",
    header: "Statut",
    render: (row) => <span className="settings-hub__status">{row.status}</span>,
    width: "16%",
  },
];

function canSeeAdminSettings(permissions: string[], superAdmin: boolean) {
  return superAdmin || permissions.includes("*") || ADMIN_PERMISSIONS.some((p) => permissions.includes(p));
}

export default function SettingsHubPage() {
  const [permissions, setPermissions] = useState<string[]>([]);
  const [superAdmin, setSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getUserPermissions()
      .then((result) => {
        if (cancelled) return;
        setPermissions(result.permissions ?? []);
        setSuperAdmin(result.superAdmin === true);
      })
      .catch(() => {
        if (!cancelled) {
          setPermissions([]);
          setSuperAdmin(false);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleCards = useMemo(() => {
    const admin = canSeeAdminSettings(permissions, superAdmin);
    return SETTINGS_CARDS.filter((card) => !card.adminOnly || admin);
  }, [permissions, superAdmin]);

  const groups = useMemo(() => {
    return GROUP_ORDER
      .map((group) => ({
        group,
        cards: visibleCards.filter((card) => card.group === group),
      }))
      .filter((section) => section.cards.length > 0);
  }, [visibleCards]);

  return (
    <main className="settings-hub">
      <PageHeader
        eyebrow="Parametres"
        title="Centre de configuration CRM"
        description="Un hub unique pour retrouver les reglages compte, organisation, messagerie, securite, audit et parametres PV sans passer par les menus operationnels."
      />

      {loading ? (
        <div className="settings-hub__loading">Verification des acces...</div>
      ) : (
        <div className="settings-hub__sections">
          {groups.map(({ group, cards }) => (
            <section className="settings-hub__section" key={group}>
              <h2>{group}</h2>
              <div className="settings-hub__grid">
                {cards.map((card) => (
                  <Link className="settings-hub__card" to={card.href} key={`${card.href}:${card.title}`}>
                    <div className="settings-hub__card-head">
                      <strong>{card.title}</strong>
                      <span className="settings-hub__status">{card.status}</span>
                    </div>
                    <span className="settings-hub__card-description">{card.description}</span>
                    <small>{card.permission}</small>
                  </Link>
                ))}
              </div>
            </section>
          ))}
          <DataTable
            className="settings-hub__matrix"
            title="Matrice sections / permissions"
            columns={MATRIX_COLUMNS}
            rows={visibleCards}
            getRowKey={(row) => `${row.href}:${row.title}`}
            dense
          />
        </div>
      )}
    </main>
  );
}
