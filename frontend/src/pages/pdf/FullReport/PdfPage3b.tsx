/**
 * Page 3b — Calepinage toiture
 */


interface P3bData {
  p3b_auto?: Record<string, unknown>;
}

const EMPTY = "—";

function val(v: unknown): string {
  if (v == null || v === "") return EMPTY;
  return String(v);
}

export default function PdfPage3b({ data }: { data?: P3bData }) {
  const a = data?.p3b_auto ?? {};

  return (
    <div className="pdf-page">
      <h2 className="pdf-title">Calepinage toiture</h2>
      <div className="pdf-meta">
        <span>{val(a.client)}</span>
        <span>{val(a.ref)}</span>
        <span>{val(a.date)}</span>
      </div>
      <div className="pdf-kpi-grid">
        <div className="pdf-kpi-card">
          <span className="pdf-kpi-label">Orientation</span>
          <span className="pdf-kpi-value">{val(a.orientation)}</span>
        </div>
        <div className="pdf-kpi-card">
          <span className="pdf-kpi-label">Inclinaison</span>
          <span className="pdf-kpi-value">{val(a.inclinaison)}</span>
        </div>
        <div className="pdf-kpi-card">
          <span className="pdf-kpi-label">Surface</span>
          <span className="pdf-kpi-value">{a.surface_m2 != null ? `${a.surface_m2} m²` : EMPTY}</span>
        </div>
        <div className="pdf-kpi-card">
          <span className="pdf-kpi-label">Panneaux</span>
          <span className="pdf-kpi-value">{val(a.nb_panneaux)}</span>
        </div>
      </div>
    </div>
  );
}
