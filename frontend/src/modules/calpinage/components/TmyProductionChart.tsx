/**
 * TmyProductionChart — Graphique SVG pur de production mensuelle P50/P90.
 * Aucune dépendance externe.
 */

export interface TmyProductionChartProps {
  monthlyP50: number[];   // 12 valeurs kWh
  monthlyP90: number[];   // 12 valeurs kWh
  p50Annual: number;      // kWh/an P50
  p90Annual: number;      // kWh/an P90
}

const MONTHS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];

function fmtAxisY(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));
}

function fmtAnnual(n: number): string {
  return Math.round(n).toLocaleString("fr-FR");
}

export function TmyProductionChart({ monthlyP50, monthlyP90, p50Annual, p90Annual }: TmyProductionChartProps) {
  // Dimensions et marges
  const W = 520;
  const H = 200;
  const marginLeft = 38;
  const marginRight = 10;
  const marginTop = 28;
  const marginBottom = 46; // axe X + légende

  const chartW = W - marginLeft - marginRight;
  const chartH = H - marginTop - marginBottom;

  // Garde-fou : tableaux valides à 12 éléments
  const p50 = monthlyP50.length === 12 ? monthlyP50 : Array(12).fill(0);
  const p90 = monthlyP90.length === 12 ? monthlyP90 : Array(12).fill(0);

  const maxVal = Math.max(...p50, ...p90, 1);
  const yMax = maxVal * 1.1;

  const barGroupW = chartW / 12;
  const barW = Math.max(barGroupW * 0.38, 4);
  const barGap = barW * 0.25;

  // Axe Y : 4 graduations
  const yTicks = [0, 0.25, 0.5, 0.75, 1.0].map((f) => ({
    frac: f,
    label: fmtAxisY(f * yMax),
    y: marginTop + chartH * (1 - f),
  }));

  const barX = (i: number) => marginLeft + i * barGroupW + (barGroupW - barW * 2 - barGap) / 2;

  const barHeight = (v: number) => (v / yMax) * chartH;

  return (
    <div style={{ width: "100%" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        xmlns="http://www.w3.org/2000/svg"
        style={{ width: "100%", height: "auto", display: "block" }}
        aria-label="Production mensuelle estimée (TMY)"
      >
        {/* Titre */}
        <text
          x={W / 2}
          y={16}
          textAnchor="middle"
          fontSize="11"
          fontWeight="600"
          fill="#374151"
          fontFamily="system-ui, sans-serif"
        >
          Production mensuelle estimée (TMY)
        </text>

        {/* Fond graphique */}
        <rect
          x={marginLeft}
          y={marginTop}
          width={chartW}
          height={chartH}
          fill="#f9fafb"
          rx="3"
        />

        {/* Grille Y + labels axe Y */}
        {yTicks.map((t) => (
          <g key={t.frac}>
            <line
              x1={marginLeft}
              y1={t.y}
              x2={marginLeft + chartW}
              y2={t.y}
              stroke="#e5e7eb"
              strokeWidth="1"
              strokeDasharray={t.frac === 0 ? "none" : "3 3"}
            />
            <text
              x={marginLeft - 4}
              y={t.y + 3.5}
              textAnchor="end"
              fontSize="9"
              fill="#9ca3af"
              fontFamily="system-ui, sans-serif"
            >
              {t.label}
            </text>
          </g>
        ))}

        {/* Barres P50 (bleues) */}
        {p50.map((v, i) => {
          const bh = barHeight(v);
          const x = barX(i);
          const y = marginTop + chartH - bh;
          return (
            <rect
              key={`p50-${i}`}
              x={x}
              y={y}
              width={barW}
              height={bh}
              fill="#3b82f6"
              opacity="1"
              rx="1.5"
            />
          );
        })}

        {/* Barres P90 (rouge translucide) — au-dessus des P50 visuellement */}
        {p90.map((v, i) => {
          const bh = barHeight(v);
          const x = barX(i) + barW + barGap;
          const y = marginTop + chartH - bh;
          return (
            <rect
              key={`p90-${i}`}
              x={x}
              y={y}
              width={barW}
              height={bh}
              fill="#ef4444"
              opacity="0.55"
              rx="1.5"
            />
          );
        })}

        {/* Labels axe X (mois) */}
        {MONTHS.map((m, i) => (
          <text
            key={`month-${i}`}
            x={marginLeft + i * barGroupW + barGroupW / 2}
            y={marginTop + chartH + 13}
            textAnchor="middle"
            fontSize="9"
            fill="#6b7280"
            fontFamily="system-ui, sans-serif"
          >
            {m}
          </text>
        ))}

        {/* Légende */}
        {/* Carré bleu P50 */}
        <rect x={marginLeft} y={H - 14} width={9} height={9} fill="#3b82f6" rx="1" />
        <text
          x={marginLeft + 12}
          y={H - 6}
          fontSize="10"
          fill="#374151"
          fontFamily="system-ui, sans-serif"
        >
          {`P50 : ${fmtAnnual(p50Annual)} kWh/an`}
        </text>

        {/* Carré rouge P90 */}
        <rect x={marginLeft + 140} y={H - 14} width={9} height={9} fill="#ef4444" opacity="0.55" rx="1" />
        <text
          x={marginLeft + 153}
          y={H - 6}
          fontSize="10"
          fill="#374151"
          fontFamily="system-ui, sans-serif"
        >
          {`P90 : ${fmtAnnual(p90Annual)} kWh/an`}
        </text>
      </svg>
    </div>
  );
}
