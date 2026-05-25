import { Link, useLocation } from "react-router-dom";
import "./access-denied-page.css";

interface AccessDeniedPageProps {
  title?: string;
  description?: string;
  requiredPermissions?: string[];
  requiredRole?: string;
}

const PERMISSION_LABELS: Record<string, string> = {
  "user.manage": "Gestion des utilisateurs",
  "rbac.manage": "Gestion des roles et permissions",
  "org.settings.manage": "Parametres organisation",
  "structure.manage": "Structure de l'organisation",
  "QUOTE_CATALOG:READ": "Catalogue commercial",
  "QUOTE_CATALOG:WRITE": "Catalogue commercial",
  "mail.accounts.manage": "Parametres mail",
};

function describeRequirements(requiredPermissions: string[], requiredRole?: string): string | null {
  if (requiredRole) return requiredRole;
  if (requiredPermissions.length === 0) return null;
  const labels = requiredPermissions.map((permission) => PERMISSION_LABELS[permission] ?? "Autorisation CRM specifique");
  return Array.from(new Set(labels)).join(" ou ");
}

export default function AccessDeniedPage({
  title = "Acces refuse",
  description = "Votre compte est bien connecte, mais votre role ne permet pas d'ouvrir cette zone.",
  requiredPermissions = [],
  requiredRole,
}: AccessDeniedPageProps) {
  const location = useLocation();
  const requirement = describeRequirements(requiredPermissions, requiredRole);

  return (
    <main className="access-denied" aria-labelledby="access-denied-title">
      <section className="access-denied__panel">
        <p className="access-denied__eyebrow">403</p>
        <div className="access-denied__copy">
          <h1 id="access-denied-title">{title}</h1>
          <p>{description}</p>
        </div>
        <dl className="access-denied__details" aria-label="Details de l'acces refuse">
          <div>
            <dt>Page demandee</dt>
            <dd>{location.pathname}</dd>
          </div>
          {requirement ? (
            <div>
              <dt>Acces requis</dt>
              <dd>{requirement}</dd>
            </div>
          ) : null}
        </dl>
        <div className="access-denied__actions">
          <Link className="sn-btn sn-btn-primary" to="/dashboard">
            Retour au tableau de bord
          </Link>
          <Link className="sn-btn sn-btn-secondary" to="/settings">
            Voir mes acces
          </Link>
        </div>
      </section>
    </main>
  );
}
