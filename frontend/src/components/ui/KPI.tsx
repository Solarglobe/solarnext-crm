import type { ReactNode } from "react";
import type { KpiTrendTone } from "./KpiStrip";
import "./crm-foundation.css";

export interface KPIProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  trend?: ReactNode;
  trendTone?: KpiTrendTone;
  loading?: boolean;
  className?: string;
}

export function KPI({
  label,
  value,
  hint,
  trend,
  trendTone = "flat",
  loading = false,
  className = "",
}: KPIProps) {
  return (
    <article className={`sn-kpi-strip__item ${className}`.trim()} aria-busy={loading}>
      <span className="sn-kpi-strip__label">{label}</span>
      <strong className="sn-kpi-strip__value">
        {loading ? <span className="sn-skeleton-line" aria-hidden /> : value}
      </strong>
      {trend && !loading ? (
        <span className={`sn-kpi-strip__trend sn-kpi-strip__trend--${trendTone}`}>{trend}</span>
      ) : null}
      {hint && !loading ? <span className="sn-kpi-strip__hint">{hint}</span> : null}
    </article>
  );
}
