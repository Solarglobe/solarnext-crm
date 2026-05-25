import type { ReactNode } from "react";
import { EmptyState } from "./EmptyState";
import "./crm-foundation.css";

export interface DataTableColumn<T> {
  id: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: "left" | "center" | "right";
  width?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T, index: number) => string;
  title?: ReactNode;
  actions?: ReactNode;
  loading?: boolean;
  loadingRows?: number;
  emptyTitle?: ReactNode;
  emptyDescription?: ReactNode;
  dense?: boolean;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  title,
  actions,
  loading = false,
  loadingRows = 5,
  emptyTitle = "Aucune donnée",
  emptyDescription,
  dense = false,
  className = "",
}: DataTableProps<T>) {
  const hasToolbar = Boolean(title || actions);
  const colSpan = Math.max(columns.length, 1);

  return (
    <section className={`sn-data-table${dense ? " sn-data-table--dense" : ""} ${className}`.trim()} aria-busy={loading}>
      {hasToolbar ? (
        <div className="sn-data-table__toolbar">
          {title ? <h2 className="sn-data-table__title">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      <div className="sn-data-table__wrap">
        <table className="sn-data-table__table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.id} style={{ width: column.width }}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: loadingRows }).map((_, rowIndex) => (
                  <tr key={`loading-${rowIndex}`}>
                    {columns.map((column) => (
                      <td key={column.id}>
                        <span className="sn-skeleton-line" aria-hidden />
                      </td>
                    ))}
                  </tr>
                ))
              : null}
            {!loading && rows.length > 0
              ? rows.map((row, rowIndex) => (
                  <tr key={getRowKey(row, rowIndex)}>
                    {columns.map((column) => (
                      <td
                        key={column.id}
                        className={column.align ? `sn-data-table__cell--${column.align}` : undefined}
                        data-label={typeof column.header === "string" ? column.header : undefined}
                      >
                        {column.render(row)}
                      </td>
                    ))}
                  </tr>
                ))
              : null}
            {!loading && rows.length === 0 ? (
              <tr>
                <td className="sn-data-table__empty-cell" colSpan={colSpan}>
                  <EmptyState title={emptyTitle} description={emptyDescription} />
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
