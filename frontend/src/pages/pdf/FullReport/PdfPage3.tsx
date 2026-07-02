/**
 * Page 3 — Offre chiffrée
 */


interface P3Data {
  meta?: { client?: string; ref?: string; date?: string };
  offer?: Record<string, unknown>;
  finance?: Record<string, unknown>;
  tech?: Record<string, unknown>;
}

const EMPTY = "—";

function val(v: unknown): string {
  if (v == null || v === "") return EMPTY;
  return String(v);
}

function num(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

export default function PdfPage3({ data }: { data?: P3Data }) {
  const meta = data?.meta ?? {};
  const offer = data?.offer ?? {};
  const finance = data?.finance ?? {};

  return (
    <div className="pdf-page">
      <h2 className="pdf-title">Offre chiffrée</h2>
      <div className="pdf-meta">
        <span>{val(meta.client)}</span>
        <span>{val(meta.ref)}</span>
        <span>{val(meta.date)}</span>
      </div>
      <table className="pdf-table">
        <tbody>
          <tr><td>Matériel HT</td><td>{num(offer.materiel_ht).toLocaleString("fr-FR")} €</td></tr>
          <tr><td>Batterie HT</td><td>{num(offer.batterie_ht).toLocaleString("fr-FR")} €</td></tr>
          <tr><td>Pose HT</td><td>{num(offer.pose_ht).toLocaleString("fr-FR")} €</td></tr>
          <tr><td>Sous-total HT</td><td>{num(offer.sous_total_ht).toLocaleString("fr-FR")} €</td></tr>
          <tr><td>TVA matériel</td><td>{num(offer.tva_materiel_eur).toLocaleString("fr-FR")} €</td></tr>
          <tr><td>TVA pose</td><td>{num(offer.tva_pose_eur).toLocaleString("fr-FR")} €</td></tr>
          <tr><td><strong>Total TTC</strong></td><td><strong>{num(offer.total_ttc).toLocaleString("fr-FR")} €</strong></td></tr>
          {num(offer.prime) > 0 ? (
            <tr><td>Prime</td><td>{num(offer.prime).toLocaleString("fr-FR")} €</td></tr>
          ) : null}
          <tr><td><strong>Reste à charge</strong></td><td><strong>{num(offer.reste).toLocaleString("fr-FR")} €</strong></td></tr>
        </tbody>
      </table>
      <div className="pdf-section">
        <div className="pdf-section-title">Mensualité</div>
        <div className="pdf-value">{num(finance.mensualite).toLocaleString("fr-FR")} € / mois</div>
      </div>
      <div className="pdf-section">
        <div className="pdf-section-title">Configuration</div>
        <div className="pdf-value">Puissance : {val(offer.puissance)} kWc</div>
        <div className="pdf-value">Onduleurs : {val(offer.onduleurs)}</div>
        {/* LOT D — matériel de pose toit plat : lignes conditionnelles (snapshot Lot A).
            Absent (toiture inclinée, plat générique, ancienne étude) → rien ne change. */}
        {Array.isArray(offer.systemes_pose) && (offer.systemes_pose as string[]).length > 0 ? (
          <>
            {(offer.systemes_pose as string[]).map((line, i) => (
              <div className="pdf-value" key={`pose-${i}`}>
                {i === 0 ? "Système de pose : " : ""}
                {line}
              </div>
            ))}
            {typeof offer.systeme_pose_note === "string" && offer.systeme_pose_note ? (
              <div className="pdf-value" style={{ fontSize: "0.85em", opacity: 0.85 }}>
                {offer.systeme_pose_note}
              </div>
            ) : null}
            {/* Mention de conformité sobre (validée Benoit 03/07) — sans recopier les notes détaillées. */}
            <div className="pdf-value" style={{ fontSize: "0.85em", opacity: 0.85 }}>
              Conforme aux homologations fabricant applicables selon le système retenu.
            </div>
          </>
        ) : null}
        <div className="pdf-value">Garantie : {val(offer.garantie)}</div>
      </div>
    </div>
  );
}
