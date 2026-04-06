/**
 * PdfTable.tsx — Tableau de données unifié pour le PDF
 *
 * Usage :
 *   <PdfTable
 *     rows={[
 *       { label: "Total TTC", value: "12 000 €", bold: true },
 *       { label: "Prime",     value: "500 €" },
 *     ]}
 *   />
 */

import React from "react";
import { COLORS, FONT } from "./pdfLayout";

export interface TableRow {
  label: string;
  value: string | number;
  bold?: boolean;
  accent?: boolean;
}

interface PdfTableProps {
  rows: TableRow[];
  /** Largeur de la colonne de gauche (défaut: "60%") */
  leftWidth?: string;
}

export default function PdfTable({ rows, leftWidth = "60%" }: PdfTableProps) {
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontFamily: FONT.family,
        fontSize: FONT.sizeSmall,
        tableLayout: "fixed",
      }}
    >
      <colgroup>
        <col style={{ width: leftWidth }} />
        <col />
      </colgroup>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <td
              style={{
                padding: "6px 8px",
                borderBottom: `1px solid ${COLORS.borderSoft}`,
                color: row.bold ? COLORS.textPrimary : COLORS.textSecond,
                fontWeight: row.bold ? FONT.weightBold : FONT.weightNormal,
                lineHeight: FONT.lineHeight,
              }}
            >
              {row.label}
            </td>
            <td
              style={{
                padding: "6px 8px",
                borderBottom: `1px solid ${COLORS.borderSoft}`,
                textAlign: "right",
                color: row.accent ? COLORS.accentGold : row.bold ? COLORS.textPrimary : COLORS.textSecond,
                fontWeight: row.bold ? FONT.weightBold : FONT.weightNormal,
                lineHeight: FONT.lineHeight,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {String(row.value)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
