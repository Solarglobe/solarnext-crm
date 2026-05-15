/**
 * PdfKpiGrid.tsx — Grille de KPI réutilisable
 *
 * Utilisé sur plusieurs pages (P1, P2, P6, …)
 * S'adapte au nombre de cartes passées en props.
 *
 * Usage :
 *   <PdfKpiGrid items={[
 *     { label: "TRI",    value: "8.4 %",    accent: true },
 *     { label: "Gains",  value: "42 000 €" },
 *   ]} />
 */

import { COLORS, FONT } from "./pdfLayout";

export interface KpiItem {
  label: string;
  value: string | number;
  /** Mettre la valeur en or (accentGold) */
  accent?: boolean;
  /** Unité affichée après la valeur */
  unit?: string;
}

interface PdfKpiGridProps {
  items: KpiItem[];
  /** Nombre de colonnes fixe (défaut: auto selon le nombre de cartes) */
  columns?: number;
}

export default function PdfKpiGrid({ items, columns }: PdfKpiGridProps) {
  const cols = columns ?? Math.min(items.length, 4);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: 8,
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      {items.map((item, i) => (
        <div
          key={i}
          style={{
            background: "rgba(255,255,255,0.05)",
            border: `1px solid ${item.accent ? COLORS.borderGold : COLORS.borderSoft}`,
            borderRadius: 8,
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            boxSizing: "border-box",
            overflow: "hidden",
          }}
        >
          <span
            style={{
              fontFamily: FONT.family,
              fontSize: "8.5pt",
              color: COLORS.textSecond,
              lineHeight: 1.2,
            }}
          >
            {item.label}
          </span>
          <span
            style={{
              fontFamily: FONT.family,
              fontSize: "11.5pt",
              fontWeight: FONT.weightBold,
              color: item.accent ? COLORS.accentGold : COLORS.textPrimary,
              lineHeight: 1.2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {String(item.value)}
            {item.unit && (
              <span
                style={{
                  fontSize: "8.5pt",
                  fontWeight: FONT.weightNormal,
                  marginLeft: 3,
                  color: COLORS.textSecond,
                }}
              >
                {item.unit}
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
