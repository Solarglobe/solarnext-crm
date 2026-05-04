/**
 * CP-LEAD-V2 — Onglet Notes
 * Activités type === NOTE, liste + formulaire rapide ajout
 */

import React from "react";
import {
  ACTIVITY_TYPE_LABELS,
  type Activity,
  type ActivityType,
  type CreateActivityPayload,
} from "../../../services/activities.service";
import LeadEmptyState from "./LeadEmptyState";

const formatDate = (s: string) =>
  new Date(s).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const EDITABLE_TYPES: ActivityType[] = ["NOTE", "CALL", "MEETING", "EMAIL"];

function isEditableType(t: ActivityType): boolean {
  return EDITABLE_TYPES.includes(t);
}

interface NotesTabProps {
  notes: Activity[];
  notesLoading: boolean;
  addFormOpen: boolean;
  setAddFormOpen: (v: boolean) => void;
  addActivityType: "NOTE" | "CALL" | "MEETING" | "EMAIL";
  setAddActivityType: (v: "NOTE" | "CALL" | "MEETING" | "EMAIL") => void;
  addActivityTitle: string;
  setAddActivityTitle: (v: string) => void;
  addActivityContent: string;
  setAddActivityContent: (v: string) => void;
  addActivitySaving: boolean;
  onAddActivity: () => void;
  editingActivityId: string | null;
  setEditingActivityId: (v: string | null) => void;
  editContent: string;
  setEditContent: (v: string) => void;
  onEditActivity: (id: string) => void;
  onDeleteActivity: (id: string) => void;
}

export default function NotesTab({
  notes,
  notesLoading,
  addFormOpen,
  setAddFormOpen,
  addActivityType,
  setAddActivityType,
  addActivityTitle,
  setAddActivityTitle,
  addActivityContent,
  setAddActivityContent,
  addActivitySaving,
  onAddActivity,
  editingActivityId,
  setEditingActivityId,
  editContent,
  setEditContent,
  onEditActivity,
  onDeleteActivity,
}: NotesTabProps) {
  return (
    <section className="crm-lead-card">
      <div className="crm-lead-card-head">
        <h2 className="crm-lead-card-title">Notes et interactions</h2>
      </div>
      <div className="crm-lead-tab-intro">
        <p className="crm-lead-tab-intro-title">Votre journal commercial</p>
        <p className="crm-lead-tab-intro-desc">
          Consignez ici ce que vous écrivez vous-même : comptes rendus d&apos;appels, réunions, emails et
          notes libres. Ce fil est modifiable et centré sur l&apos;action terrain.
        </p>
      </div>
      <div className="crm-lead-fields" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className="sn-btn sn-btn-primary sn-btn-sm"
          onClick={() => setAddFormOpen(!addFormOpen)}
        >
          {addFormOpen ? "Annuler" : "Nouvelle note"}
        </button>
      </div>
      {addFormOpen && (
        <div className="crm-lead-add-activity-panel">
          <select
            className="sn-input"
            value={addActivityType}
            onChange={(e) =>
              setAddActivityType(e.target.value as "NOTE" | "CALL" | "MEETING" | "EMAIL")
            }
          >
            <option value="NOTE">Note</option>
            <option value="CALL">Appel</option>
            <option value="MEETING">RDV</option>
            <option value="EMAIL">Email</option>
          </select>
          <input
            className="sn-input"
            placeholder="Titre (optionnel)"
            value={addActivityTitle}
            onChange={(e) => setAddActivityTitle(e.target.value)}
          />
          <textarea
            className="sn-input"
            placeholder={addActivityType === "NOTE" ? "Contenu (obligatoire)" : "Contenu (optionnel)"}
            value={addActivityContent}
            onChange={(e) => setAddActivityContent(e.target.value)}
            rows={3}
          />
          <button
            type="button"
            className="sn-btn sn-btn-primary"
            onClick={onAddActivity}
            disabled={addActivitySaving || (addActivityType === "NOTE" && !addActivityContent.trim())}
          >
            {addActivitySaving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      )}
      <div className="crm-lead-timeline-wrap">
        {notesLoading ? (
          <p className="crm-lead-empty">Chargement…</p>
        ) : (
          <div className="crm-lead-timeline">
            {notes.length === 0 ? (
              <LeadEmptyState
                title="Aucune note sur ce dossier"
                description="Consignez vos appels, rendez-vous et décisions pour garder une trace partagée avec l’équipe."
                actionLabel="Ajouter une note"
                onAction={() => setAddFormOpen(true)}
              />
            ) : (
              notes.map((a, i) => (
                <div key={a.id} className="crm-lead-timeline-item">
                  <div className="crm-lead-timeline-dot" />
                  {i < notes.length - 1 && <div className="crm-lead-timeline-line" />}
                  <div className="crm-lead-timeline-content">
                    <span className="crm-lead-timeline-badge sn-badge sn-badge-info">
                      {ACTIVITY_TYPE_LABELS[a.type]}
                    </span>
                    <span className="crm-lead-timeline-date">{formatDate(a.occurred_at)}</span>
                    {a.title && (
                      <span className="crm-lead-timeline-title">{a.title}</span>
                    )}
                    {editingActivityId === a.id ? (
                      <div className="crm-lead-timeline-edit">
                        <textarea
                          className="sn-input"
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          rows={2}
                        />
                        <div className="crm-lead-timeline-edit-actions">
                          <button
                            type="button"
                            className="sn-btn sn-btn-primary sn-btn-sm"
                            onClick={() => onEditActivity(a.id)}
                          >
                            Valider
                          </button>
                          <button
                            type="button"
                            className="sn-btn sn-btn-ghost sn-btn-sm"
                            onClick={() => {
                              setEditingActivityId(null);
                              setEditContent("");
                            }}
                          >
                            Annuler
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {a.content && (
                          <span className="crm-lead-timeline-body">{a.content}</span>
                        )}
                        {a.created_by?.name && (
                          <span className="crm-lead-timeline-by">
                            par {a.created_by.name || a.created_by.email}
                          </span>
                        )}
                        {isEditableType(a.type) && (
                          <div className="crm-lead-timeline-actions">
                            <button
                              type="button"
                              className="sn-btn sn-btn-ghost sn-btn-sm"
                              onClick={() => {
                                setEditingActivityId(a.id);
                                setEditContent(a.content || "");
                              }}
                            >
                              Éditer
                            </button>
                            <button
                              type="button"
                              className="sn-btn sn-btn-ghost sn-btn-sm crm-lead-timeline-delete"
                              onClick={() => onDeleteActivity(a.id)}
                            >
                              Supprimer
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </section>
  );
}
