/**
 * Donut P12 — Autoconsommation %
 * stroke-dasharray pour cercle partiel
 */

import React from "react";

interface DonutP12Props {
  autoconsPct: number;
}

const R = 42;
const CIRC = 2 * Math.PI * R;
const STROKE = 8;

export default function DonutP12({ autoconsPct }: DonutP12Props) {
  const pct = Math.max(0, Math.min(100, autoconsPct));
  const autoLen = (pct / 100) * CIRC;
  const injLen = CIRC - autoLen;

  return (
    <div className="donut-p12">
      <svg viewBox="0 0 100 100" width={120} height={120}>
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          stroke="var(--sn-border-soft, rgba(255,255,255,0.2))"
          strokeWidth={STROKE}
        />
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          stroke="#C39847"
          strokeWidth={STROKE}
          strokeDasharray={`${autoLen} ${injLen}`}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
        />
        <text x="50" y="52" textAnchor="middle" fontSize={16} fontWeight="bold" fill="var(--sn-text-primary, #E8ECF8)">
          {Math.round(pct)}%
        </text>
        <text x="50" y="68" textAnchor="middle" fontSize={9} fill="var(--sn-text-secondary, #9FA8C7)">
          Autoconso
        </text>
      </svg>
    </div>
  );
}
