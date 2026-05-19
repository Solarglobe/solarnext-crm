import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { getUserPermissions } from "../../services/auth.service";
import "./settings-hub-page.css";

type SettingsCard = {
  title: string;
  description: string;
  href: string;
  group: "Compte" | "Organisation" | "Commercial" | "Technique";
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
    title: "Securite",
    description: "MFA, sessions actives et regles de securite du compte.",
    href: "/settings/security",
    group: "Compte",
  },
  {
    title: "Organisation",
    description: "Identite entreprise, equipes, agences et informations officielles.",
    href: "/organization/structure",
    group: "Organisation",
    adminOnly: true,
  },
  {
    title: "Utilisateurs",
    description: "Membres, invitations et acces internes.",
    href: "/organization/users",
    group: "Organisation",
    adminOnly: true,
  },
  {
    title: "Roles",
    description: "Roles, permissions et droits applicatifs.",
    href: "/organization/roles",
    group: "Organisation",
    adminOnly: true,
  },
  {
    title: "Catalogue devis",
    description: "Articles, textes, modeles et parametrage commercial des devis.",
    href: "/organization/catalog",
    group: "Commercial",
    adminOnly: true,
  },
  {
    title: "Messagerie",
    description: "Comptes mail, signatures, templates et droits d'acces.",
    href: "/settings/mail",
    group: "Organisation",
    adminOnly: true,
  },
  {
    title: "Parametres PV",
    description: "Parametres techniques et economiques utilises par le CRM solaire.",
    href: "/admin/settings/pv",
    group: "Technique",
    adminOnly: true,
  },
  {
    title: "Journal d'audit",
    description: "Evenements sensibles, actions admin et traces de securite.",
    href: "/admin/audit-log",
    group: "Organisation",
    adminOnly: true,
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
    return ["Compte", "Organisation", "Commercial", "Technique"]
      .map((group) => ({
        group,
        cards: visibleCards.filter((card) => card.group === group),
      }))
      .filter((section) => section.cards.length > 0);
  }, [visibleCards]);

  return (
    <main className="settings-hub">
      <header className="settings-hub__header">
        <p>Parametres</p>
        <h1>Centre de configuration CRM</h1>
        <span>
          Les reglages sont regroupes ici pour eviter les menus disperses et les pages difficiles a retrouver.
        </span>
      </header>

      {loading ? (
        <div className="settings-hub__loading">Verification des acces...</div>
      ) : (
        <div className="settings-hub__sections">
          {groups.map(({ group, cards }) => (
            <section className="settings-hub__section" key={group}>
              <h2>{group}</h2>
              <div className="settings-hub__grid">
                {cards.map((card) => (
                  <Link className="settings-hub__card" to={card.href} key={card.href}>
                    <strong>{card.title}</strong>
                    <span>{card.description}</span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
