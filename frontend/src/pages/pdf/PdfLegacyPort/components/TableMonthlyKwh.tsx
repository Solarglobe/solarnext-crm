/**
 * TableMonthlyKwh — tableau 12 mois kWh pour la page "Analyse d'ombrage"
 * 4 lignes × 13 colonnes (12 mois + Total). Styles 100% inline.
 */

const MONTHS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jui", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"];

export interface MonthlyKwhRow {
  month: number;
  prodNoShadingKwh: number;
  prodWithShadingKwh: number;
  kwhLoss: number;
  lossPct: number | null;
}

export interface TableMonthlyKwhProps {
  rows: MonthlyKwhRow[];
  pvgisSource?: string | null;
  pvgisTiltDeg?: number | null;
  pvgisAzimuthDeg?: number | null;
}

function fmtN(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Math.round(v).toLocaleString("fr-FR");
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(1) + " %";
}

export default function TableMonthlyKwh({
  rows,
  pvgisSource,
  pvgisTiltDeg,
  pvgisAzimuthDeg,
}: TableMonthlyKwhProps) {
  const sorted = [...rows].sort((a, b) => a.month - b.month);

  const totalRef   = sorted.reduce((s, r) => s + (r.prodNoShadingKwh ?? 0), 0);
  const totalNette = sorted.reduce((s, r) => s + (r.prodWithShadingKwh ?? 0), 0);
  const totalLoss  = sorted.reduce((s, r) => s + (r.kwhLoss ?? 0), 0);
  const totalLossPct = totalRef > 0 ? (totalLoss / totalRef) * 100 : null;

  const cellBase: React.CSSProperties = {
    textAlign: "right",
    padding: "3px 5px",
    fontSize: "7.5pt",
    lineHeight: 1.3,
    borderBottom: "1px solid rgba(255,255,255,0.04)",
  };
  const labelCell: React.CSSProperties = {
    ...cellBase,
    textAlign: "left",
    color: "#9FA8C7",
    paddingRight: 8,
    whiteSpace: "nowrap",
  };
  const totalCell: React.CSSProperties = {
    ...cellBase,
    fontWeight: 600,
    borderLeft: "1px solid rgba(255,255,255,0.10)",
  };

  const rows4 = [
    {
      label: "Prod. référence (kWh)",
      values: sorted.map((r) => fmtN(r.prodNoShadingKwh)),
      total: fmtN(totalRef),
      color: "#E8ECF8",
      bold: false,
    },
    {
      label: "Prod. nette (kWh)",
      values: sorted.map((r) => fmtN(r.prodWithShadingKwh)),
      total: fmtN(totalNette),
      color: "#C39847",
      bold: true,
    },
    {
      label: "Perte (kWh)",
      values: sorted.map((r) => fmtN(r.kwhLoss)),
      total: fmtN(totalLoss),
      color: "#E57373",
      bold: false,
    },
    {
      label: "Perte (%)",
      values: sorted.map((r) => fmtPct(r.lossPct)),
      total: fmtPct(totalLossPct),
      color: "#9FA8C7",
      bold: false,
      italic: true,
    },
  ];

  // Footer PVGIS
  const footerParts: string[] = [];
  if (pvgisSource && pvgisSource !== "PVGIS_UNAVAILABLE") footerParts.push("Source : PVGIS v5.3 (JRC)");
  if (pvgisTiltDeg != null) footerParts.push(`Inclinaison : ${pvgisTiltDeg}°`);
  if (pvgisAzimuthDeg != null) footerParts.push(`Azimut : ${pvgisAzimuthDeg}°`);

  return (
    <div style={{ width: "100%" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...cellBase, textAlign: "left", color: "#9FA8C7", fontSize: "7pt", fontWeight: 500 }}></th>
            {MONTHS.map((m) => (
              <th key={m} style={{ ...cellBase, color: "#9FA8C7", fontSize: "7pt", fontWeight: 500 }}>
                {m}
              </th>
            ))}
            <th style={{ ...cellBase, ...totalCell, color: "#9FA8C7", fontSize: "7pt", fontWeight: 600 }}>
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows4.map((row, ri) => (
            <tr key={ri} style={{ background: ri % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent" }}>
              <td style={labelCell}>{row.label}</td>
              {row.values.map((v, i) => (
                <td
                  key={i}
                  style={{
                    ...cellBase,
                    color: row.color,
                    fontWeight: row.bold ? 600 : 400,
                    fontStyle: (row as { italic?: boolean }).italic ? "italic" : "normal",
                  }}
                >
                  {v}
                </td>
              ))}
              <td
                style={{
                  ...cellBase,
                  ...totalCell,
                  color: row.color,
                  fontWeight: row.bold ? 700 : 600,
                  fontStyle: (row as { italic?: boolean }).italic ? "italic" : "normal",
                }}
              >
                {row.total}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {footerParts.length > 0 && (
        <div
          style={{
            marginTop: 6,
            fontSize: "7pt",
            color: "#9FA8C7",
            opacity: 0.7,
            letterSpacing: "0.02em",
          }}
        >
          {footerParts.join("  ·  ")}
        </div>
      )}
    </div>
  );
}
