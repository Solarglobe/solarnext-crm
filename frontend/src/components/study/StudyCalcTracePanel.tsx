/**
 * Traçabilité du dernier calcul multi-compteur (lecture study_versions.data_json).
 */

import React from "react";
import type { StudyVersionDataJson } from "../../services/studies.service";

function formatFrDateTime(iso: string | undefined | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
  });
}

export default function StudyCalcTracePanel({ data }: { data?: StudyVersionDataJson | null }) {
  const computedAt = data?.meter_snapshot_captured_at ?? data?.calc_result?.computed_at ?? null;
  if (!computedAt) {
    return (
      <div
        className="study-calc-trace-panel"
        style={{
          marginBottom: "var(--spacing-20)",
          padding: "14px 16px",
          borderRadius: 12,
          border: "1px solid var(--sn-border-soft, rgba(255,255,255,0.08))",
          background: "var(--sn-bg-elevated, rgba(0,0,0,0.2))",
        }}
      >
        <p style={{ margin: 0, fontSize: 13, color: "var(--sn-text-secondary, #9CA8C6)" }}>
          Aucun calcul enregistré sur cette version. Lancez un calcul depuis le lead ou le flux étude pour
          afficher la traçabilité compteur.
        </p>
      </div>
    );
  }

  const meterName = data?.meter_snapshot?.name ?? null;
  const hasPrevious =
    !!data?.meter_snapshot_previous_captured_at && data?.meter_snapshot_previous != null;
  const lines = Array.isArray(data?.meter_calc_change_lines_fr)
    ? data!.meter_calc_change_lines_fr!
    : [];

  let changeBlock: React.ReactNode;
  if (!hasPrevious) {
    changeBlock = (
      <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--sn-text-secondary, #9CA8C6)" }}>
        Premier calcul enregistré pour cette version. Les prochains recalculs afficheront ici les écarts sur
        les données compteur.
      </p>
    );
  } else if (lines.length === 0) {
    changeBlock = (
      <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--sn-text-secondary, #9CA8C6)" }}>
        Aucun changement significatif détecté sur les données compteur depuis le calcul précédent.
      </p>
    );
  } else {
    changeBlock = (
      <ul
        style={{
          margin: "10px 0 0",
          paddingLeft: 18,
          fontSize: 13,
          color: "var(--sn-text-primary, #e8eaef)",
          lineHeight: 1.55,
        }}
      >
        {lines.map((line, i) => (
          <li key={i} style={{ marginBottom: 4 }}>
            {line}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div
      className="study-calc-trace-panel"
      style={{
        marginBottom: "var(--spacing-20)",
        padding: "16px 18px",
        borderRadius: 12,
        border: "1px solid color-mix(in srgb, var(--brand-gold) 35%, transparent)",
        background: "linear-gradient(135deg, color-mix(in srgb, var(--brand-gold) 8%, transparent), rgba(0,0,0,0.15))",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "var(--brand-gold)", marginBottom: 8 }}>
        DERNIER RECALCUL
      </div>
      <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--sn-text-primary, #f2f4f8)" }}>
        {formatFrDateTime(computedAt)}
      </p>
      <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--sn-text-secondary, #b8c0d4)" }}>
        Compteur utilisé :{" "}
        <span style={{ color: "var(--sn-text-primary, #e8eaef)", fontWeight: 500 }}>
          {meterName || "—"}
        </span>
      </p>
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--sn-border-soft, rgba(255,255,255,0.08))" }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", color: "var(--sn-text-secondary, #9CA8C6)" }}>
          Depuis le calcul précédent
        </div>
        {changeBlock}
      </div>
    </div>
  );
}
