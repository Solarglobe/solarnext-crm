import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { DataTable, EmptyState, PageHeader, SectionHeader, SettingsCard, type DataTableColumn } from "../../components/ui";
import { getUserPermissions } from "../../services/auth.service";
import "./settings-hub-page.css";

type SettingsCard = {
  title: string;
  description: string;
  href: string;
  group: "Compte" | "Organisation" | "Commercial" | "Technique" | "Controle";
  status: string;
  permission: string;
  requiredPermissions?: string[];
};

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
    permission: "org.settings.manage",
    requiredPermissions: ["org.settings.manage"],
  },
  {
    title: "Utilisateurs",
    description: "Membres, invitations et acces internes.",
    href: "/organization/users",
    group: "Organisation",
    status: "Admin",
    permission: "user.manage",
    requiredPermissions: ["user.manage"],
  },
  {
    title: "Roles",
    description: "Roles, permissions et droits applicatifs.",
    href: "/organization/roles",
    group: "Organisation",
    status: "Admin",
    permission: "rbac.manage",
    requiredPermissions: ["rbac.manage"],
  },
  {
    title: "Equipes / agences",
    description: "Structure commerciale, agences et repartition des equipes.",
    href: "/organization/teams",
    group: "Organisation",
    status: "Admin",
    permission: "structure.manage ou org.settings.manage",
    requiredPermissions: ["structure.manage", "org.settings.manage"],
  },
  {
    title: "Catalogue devis",
    description: "Articles, textes, modeles et parametrage commercial des devis.",
    href: "/organization/catalog",
    group: "Commercial",
    status: "Admin",
    permission: "QUOTE_CATALOG:READ ou QUOTE_CATALOG:WRITE",
    requiredPermissions: ["QUOTE_CATALOG:READ", "QUOTE_CATALOG:WRITE"],
  },
  {
    title: "Configuration mail",
    description: "Comptes mail, signatures, modeles et droits d'acces.",
    href: "/settings/mail",
    group: "Organisation",
    status: "Configuration",
    permission: "mail.accounts.manage",
    requiredPermissions: ["mail.accounts.manage"],
  },
  {
    title: "Parametres PV",
    description: "Parametres techniques et economiques utilises par le CRM solaire.",
    href: "/admin/settings/pv",
    group: "Technique",
    status: "Technique",
    permission: "org.settings.manage",
    requiredPermissions: ["org.settings.manage"],
  },
  {
    title: "Journal d'audit",
    description: "Evenements sensibles, actions admin et traces de securite.",
    href: "/admin/audit-log",
    group: "Controle",
    status: "Controle",
    permission: "org.settings.manage",
    requiredPermissions: ["org.settings.manage"],
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

function canSeeSettingsCard(card: SettingsCard, permissions: string[], superAdmin: boolean) {
  if (!card.requiredPermissions || card.requiredPermissions.length === 0) return true;
  if (superAdmin || permissions.includes("*")) return true;
  return card.requiredPermissions.some((permission) => permissions.includes(permission));
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
    return SETTINGS_CARDS.filter((card) => canSeeSettingsCard(card, permissions, superAdmin));
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
              <SectionHeader title={group} />
              <div className="settings-hub__grid">
                {cards.map((card) => (
                  <Link className="settings-hub__card-link" to={card.href} key={`${card.href}:${card.title}`}>
                    <SettingsCard
                      as="div"
                      title={card.title}
                      description={card.description}
                      badge={<span className="settings-hub__status">{card.status}</span>}
                      footer={card.permission}
                    />
                  </Link>
                ))}
              </div>
            </section>
          ))}
          {visibleCards.length === 0 ? (
            <EmptyState
              title="Aucun parametrage disponible"
              description="Votre role ne donne acces a aucune section de configuration."
            />
          ) : null}
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
