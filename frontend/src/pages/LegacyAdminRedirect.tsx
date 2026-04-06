/**
 * Redirections legacy /admin et /admin/organization → /organization/*
 * Supporte ?tab=catalog ou ?catalog=1 (anciens liens).
 */

import { Navigate, useLocation } from "react-router-dom";

export function LegacyAdminRedirect() {
  const { search } = useLocation();
  const q = new URLSearchParams(search);
  if (q.get("tab") === "catalog" || q.get("catalog") === "1") {
    return <Navigate to="/organization/catalog" replace />;
  }
  return <Navigate to="/organization/users" replace />;
}
