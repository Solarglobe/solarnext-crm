/**
 * CP-REFAC-004.1 — Utilisateurs (entreprise)
 */

import { AdminTabUsers } from "../../modules/admin/AdminTabUsers";
import "../../modules/finance/financial-pole.css";

export default function OrganizationUsersPage() {
  return (
    <div className="qb-page fin-pole-shell">
      <div className="fin-pole-list-hero">
        <div className="fin-pole-list-hero__text">
          <h1 className="sg-title">Utilisateurs</h1>
          <p className="fin-pole-lead">Comptes, rôles et accès équipes</p>
        </div>
      </div>
      <AdminTabUsers />
    </div>
  );
}
