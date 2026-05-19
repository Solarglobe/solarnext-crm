import type { ReactNode } from "react";
import "./crm-foundation.css";

export type KpiTrendTone = "up" | "down" | "flat";

export interface KpiStripItem {
  id: string;
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  trend?: ReactNode;
  trendTone?: KpiTrendTone;
}

export interface KpiStripProps {
  items: KpiStripItem[];
  loading?: boolean;
  className?: string;
}

export function KpiStrip({ items, loading = false, className = "" }: KpiStripProps) {
  return (
    <section className={`sn-kpi-strip ${className}`.trim()} aria-busy={loading}>
      {items.map((item) => (
        <article className="sn-kpi-strip__item" key={item.id}>
          <span className="sn-kpi-strip__label">{item.label}</span>
          <strong className="sn-kpi-strip__value">
            {loading ? <span className="sn-skeleton-line" aria-hidden /> : item.value}
          </strong>
          {item.trend && !loading ? (
            <span className={`sn-kpi-strip__trend sn-kpi-strip__trend--${item.trendTone ?? "flat"}`}>
              {item.trend}
            </span>
          ) : null}
          {item.hint && !loading ? <span className="sn-kpi-strip__hint">{item.hint}</span> : null}
        </article>
      ))}
    </section>
  );
}
