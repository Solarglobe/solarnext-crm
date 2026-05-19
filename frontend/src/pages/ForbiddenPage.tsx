import { Link } from "react-router-dom";

interface ForbiddenPageProps {
  title?: string;
  description?: string;
  requiredPermissions?: string[];
}

export default function ForbiddenPage({
  title = "Acces non autorise",
  description = "Votre role ne donne pas acces a cette zone du CRM.",
  requiredPermissions = [],
}: ForbiddenPageProps) {
  return (
    <main
      style={{
        display: "grid",
        gap: 14,
        alignContent: "center",
        minHeight: "min(520px, 70vh)",
        padding: 28,
        color: "var(--text, #0f172a)",
      }}
    >
      <p
        style={{
          margin: 0,
          color: "var(--text-muted, #64748b)",
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: ".08em",
          textTransform: "uppercase",
        }}
      >
        403
      </p>
      <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.15 }}>{title}</h1>
      <p style={{ margin: 0, maxWidth: 560, color: "var(--text-muted, #64748b)", lineHeight: 1.55 }}>
        {description}
      </p>
      {requiredPermissions.length > 0 ? (
        <p style={{ margin: 0, color: "var(--text-muted, #64748b)", fontSize: 13 }}>
          Permission requise : <code>{requiredPermissions.join(" ou ")}</code>
        </p>
      ) : null}
      <div>
        <Link className="sn-btn sn-btn-primary" to="/dashboard">
          Retour au tableau de bord
        </Link>
      </div>
    </main>
  );
}
