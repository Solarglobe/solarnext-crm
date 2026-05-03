/**
 * Route catch-all : évite l’écran blanc quand aucune route ne correspond.
 */
export default function RouterNotFoundPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        padding: 32,
        fontFamily: "system-ui, sans-serif",
        background: "var(--bg-page)",
        color: "var(--text-primary)",
        maxWidth: 560,
        margin: "0 auto",
      }}
    >
      <h1 style={{ fontSize: 20, marginBottom: 12 }}>Page introuvable</h1>
      <p style={{ lineHeight: 1.55, opacity: 0.9, marginBottom: 16 }}>
        Aucune route ne correspond à cette adresse. Reprenez depuis l’<a style={{ color: "var(--brand-gold)" }} href="/">accueil</a> ou
        le menu.
      </p>
      <p style={{ lineHeight: 1.55, opacity: 0.85, fontSize: 14 }}>
        Espace client : URL du type{" "}
        <code style={{ color: "var(--brand-gold)", wordBreak: "break-all" }}>
          …/client-portal/&lt;jeton&gt;
        </code>
      </p>
    </div>
  );
}
