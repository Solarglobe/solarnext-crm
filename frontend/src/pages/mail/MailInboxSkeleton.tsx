import React from "react";

export const MailInboxSkeleton = React.memo(function MailInboxSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <ul className="mail-skeleton-list" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="mail-skeleton-row">
          <div className="mail-skeleton-avatar" />
          <div className="mail-skeleton-body">
            <div className="mail-skeleton-line mail-skeleton-line--title" />
            <div className="mail-skeleton-line mail-skeleton-line--snippet" />
            <div className="mail-skeleton-line mail-skeleton-line--meta" />
          </div>
          <div className="mail-skeleton-right">
            <div className="mail-skeleton-line mail-skeleton-line--time" />
          </div>
        </li>
      ))}
    </ul>
  );
});
