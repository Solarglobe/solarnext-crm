/**
 * CP-LEAD-V2 — Onglet Rendez-vous
 * Missions liées, bouton Nouveau RDV (MissionCreateModal)
 */

import { useNavigate } from "react-router-dom";
import type { Mission } from "../../../services/missions.service";
import LeadEmptyState from "./LeadEmptyState";

interface RdvTabProps {
  missions: Mission[];
  missionsLoading: boolean;
  onNewRdv: () => void;
  /** CP-LEAD-CLIENT-UNIFICATION — Si true (Lead), afficher message au lieu des missions */
  isLead?: boolean;
}

export default function RdvTab({ missions, missionsLoading, onNewRdv, isLead }: RdvTabProps) {
  const navigate = useNavigate();

  if (isLead) {
    return (
      <section className="crm-lead-card">
        <div className="crm-lead-card-head">
          <h2 className="crm-lead-card-title">Rendez-vous</h2>
        </div>
        <LeadEmptyState
          title="Planifiez un premier contact"
          description="Posez une date concrète pour avancer sur ce projet. Le rendez-vous sera visible dans le planning commercial de toute l’équipe."
          actionLabel="Planifier un rendez-vous"
          onAction={onNewRdv}
          secondaryHint="Les visites terrain et devis définitifs seront accessibles après conversion en client."
        />
      </section>
    );
  }

  return (
    <section className="crm-lead-card">
      <div className="crm-lead-card-head">
        <h2 className="crm-lead-card-title">Rendez-vous</h2>
      </div>
      <div className="crm-lead-fields" style={{ marginBottom: 16 }}>
        <button type="button" className="sn-btn sn-btn-primary" onClick={onNewRdv}>
          Nouveau rendez-vous
        </button>
      </div>
      {missionsLoading ? (
        <p className="crm-lead-empty">Chargement…</p>
      ) : missions.length === 0 ? (
        <LeadEmptyState
          title="Aucun rendez-vous planifié"
          description="Créez une mission pour verrouiller une date avec votre client ou votre équipe. Elle apparaîtra aussi dans le planning global."
          actionLabel="Créer un rendez-vous"
          onAction={onNewRdv}
        />
      ) : (
        <ul className="crm-lead-list">
          {missions.map((m) => (
            <li key={m.id} className="crm-lead-list-item">
              <span>{m.title}</span>
              <span className="crm-lead-list-meta">
                {new Date(m.start_at).toLocaleString("fr-FR", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                –{" "}
                {new Date(m.end_at).toLocaleTimeString("fr-FR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {m.mission_type_name && ` • ${m.mission_type_name}`}
              </span>
              <button
                type="button"
                className="sn-btn sn-btn-ghost sn-btn-sm"
                onClick={() => navigate("/planning")}
              >
                Voir planning
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
