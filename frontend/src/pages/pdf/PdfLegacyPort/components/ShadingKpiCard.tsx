/**
 * ShadingKpiCard — carte KPI pour la page "Analyse d'ombrage"
 * Styles 100% inline, thème sombre SolarNext.
 */

export interface ShadingKpiCardProps {
  label: string;
  value: string;
  sublabel?: string;
  techLines?: string[];
  valueColor?: string;
  isHero?: boolean;
  badge?: { color: string; text: string };
}

export default function ShadingKpiCard({
  label,
  value,
  sublabel,
  techLines,
  valueColor = "#E8ECF8",
  isHero = false,
  badge,
}: ShadingKpiCardProps) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 6,
        padding: "10px 12px",
        minWidth: 0,
      }}
    >
      {/* Label */}
      <div
        style={{
          fontSize: "7.5pt",
          color: "#9FA8C7",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          fontWeight: 500,
          lineHeight: 1.2,
        }}
      >
        {label}
      </div>

      {/* Valeur principale ou badge */}
      {badge ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            fontSize: isHero ? "15pt" : "13pt",
            fontWeight: isHero ? 700 : 600,
            lineHeight: 1.1,
          }}
        >
          <span style={{ color: badge.color, fontSize: "10pt" }}>●</span>
          <span style={{ color: badge.color }}>{badge.text}</span>
        </div>
      ) : (
        <div
          style={{
            fontSize: isHero ? "15pt" : "13pt",
            fontWeight: isHero ? 700 : 500,
            color: valueColor,
            lineHeight: 1.1,
          }}
        >
          {value}
        </div>
      )}

      {/* Sous-label */}
      {sublabel && (
        <div style={{ fontSize: "8.5pt", color: "#9FA8C7", lineHeight: 1.3 }}>
          {sublabel}
        </div>
      )}

      {/* Lignes techniques (niveau technicien) */}
      {techLines && techLines.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 2 }}>
          {techLines.map((line, i) => (
            <div
              key={i}
              style={{ fontSize: "7.5pt", color: "#9FA8C7", opacity: 0.8, lineHeight: 1.3 }}
            >
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
