/**
 * Mission Engine V1 — Modal édition mission
 * Champs identiques à MissionCreateModal + statut + suppression
 */

import React, { useCallback, useEffect, useId, useState } from "react";
import { ModalShell } from "../../components/ui/ModalShell";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import "./planning-mission-modal.css";
import {
  fetchMissionById,
  updateMission,
  deleteMission,
  fetchMissionTypes,
  type Mission,
  type MissionType,
} from "../../services/missions.service";
import { fetchClients, type Client } from "../../services/clients.service";
import { fetchStudiesByClientId, type Study } from "../../services/studies.service";
import { getUserPermissions, getCurrentUser } from "../../services/auth.service";
import { apiFetch } from "../../services/api";
import UserMultiSelect from "./UserMultiSelect";
import SearchableDropdown, { type DropdownOption } from "./SearchableDropdown";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import dayjs from "dayjs";
import "dayjs/locale/fr";
import PlanningDateTimeField from "./PlanningDateTimeField";
import { showCrmInlineToast } from "../../components/ui/crmInlineToast";
import { getCrmApiBase } from "@/config/crmApiBase";

const API_BASE = getCrmApiBase();

const STATUS_OPTIONS = [
  { id: "scheduled", label: "Planifiée" },
  { id: "in_progress", label: "En cours" },
  { id: "completed", label: "Terminée" },
  { id: "cancelled", label: "Annulée" },
];

interface MissionEditModalProps {
  missionId: string;
  onClose: () => void;
  onSaved: (mission: Mission) => void;
  onDeleted: (missionId: string) => void;
  users?: { id: string; email?: string }[];
  teams?: { id: string; name: string }[];
  missionTypes?: MissionType[];
}

function getClientDisplayName(c: Client): string {
  if (c.company_name) return c.company_name;
  const parts = [c.first_name, c.last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : c.email || c.id;
}

export default function MissionEditModal({
  missionId,
  onClose,
  onSaved,
  onDeleted,
  users: usersProp = [],
  teams: teamsProp = [],
  missionTypes: typesProp = [],
}: MissionEditModalProps) {
  const [mission, setMission] = useState<Mission | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [missionTypeId, setMissionTypeId] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [assignments, setAssignments] = useState<string[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [isPrivateBlock, setIsPrivateBlock] = useState(false);
  const [status, setStatus] = useState("scheduled");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [users, setUsers] = useState(usersProp);
  const [teams, setTeams] = useState(teamsProp);
  const [missionTypes, setMissionTypes] = useState(typesProp);
  const [clients, setClients] = useState<Client[]>([]);
  const [studies, setStudies] = useState<Study[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [canDelete, setCanDelete] = useState(false);

  const formId = useId().replace(/:/g, "");
  const tryClose = useCallback(() => {
    if (loading || saving || deleting) return;
    onClose();
  }, [loading, saving, deleting, onClose]);

  const handleEscape = useCallback(() => {
    if (showDeleteConfirm) {
      if (!deleting) setShowDeleteConfirm(false);
      return;
    }
    if (loading || saving || deleting) return;
    onClose();
  }, [showDeleteConfirm, deleting, loading, saving, onClose]);

  useEffect(() => {
    dayjs.locale("fr");
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [m, permsRes, currentUser] = await Promise.all([
          fetchMissionById(missionId),
          getUserPermissions().catch(() => ({ permissions: [] as string[] })),
          getCurrentUser().catch(() => null),
        ]);
        setMission(m);
        setTitle(m.title);
        setDescription(m.description || "");
        setMissionTypeId(m.mission_type_id || "");
        setStartAt(m.start_at.slice(0, 16));
        setEndAt(m.end_at.slice(0, 16));
        setSelectedClientId(m.client_id || "");
        setProjectId(m.project_id || "");
        setIsPrivateBlock(m.is_private_block ?? false);
        setStatus(m.status || "scheduled");
        setAssignments(
          (m.assignments || [])
            .map((a) => a.user_id)
            .filter(Boolean)
        );

        const perms = permsRes.permissions || [];
        const superAdmin = (permsRes as { superAdmin?: boolean }).superAdmin;
        const hasUpdateAll = superAdmin || perms.includes("*") || perms.includes("mission.update.all");
        const hasUpdateSelf = perms.includes("mission.update.self");
        const assignedUserIds = (m.assignments || []).map((a) => a.user_id).filter(Boolean);
        const currentUserId = currentUser?.id;
        const isAssigned = currentUserId ? assignedUserIds.includes(currentUserId) : false;
        const canModify = !!(hasUpdateAll || (hasUpdateSelf && isAssigned));
        setCanEdit(canModify);
        setCanDelete(canModify);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Erreur chargement");
      } finally {
        setLoading(false);
      }
    })();
  }, [missionId]);

  useEffect(() => {
    (async () => {
      try {
        const [metaRes, typesRes] = await Promise.all([
          apiFetch(`${API_BASE}/api/missions/meta`),
          fetchMissionTypes(),
        ]);
        if (metaRes.ok) {
          const meta = await metaRes.json();
          setUsers(meta.users || []);
          setTeams(meta.teams || []);
        }
        setMissionTypes(typesRes);
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    fetchClients().then(setClients).catch(() => setClients([]));
  }, []);

  useEffect(() => {
    if (selectedClientId) {
      fetchStudiesByClientId(selectedClientId).then(setStudies).catch(() => setStudies([]));
    } else {
      setStudies([]);
      setProjectId("");
    }
  }, [selectedClientId]);

  const typeOptions: DropdownOption[] = missionTypes.map((t) => ({
    id: t.id,
    label: t.name,
    color: t.color,
  }));

  const clientOptions: DropdownOption[] = clients.map((c) => ({
    id: c.id,
    label: `${getClientDisplayName(c)}${c.client_number ? ` (${c.client_number})` : ""}`,
  }));

  const studyOptions: DropdownOption[] = studies.map((s) => ({
    id: s.id,
    label: `${s.title || s.study_number}${s.study_number ? ` (${s.study_number})` : ""}`,
  }));

  const selectedClient = clients.find((c) => c.id === selectedClientId);
  const selectedStudy = studies.find((s) => s.id === projectId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setErr(null);
    try {
      const updated = await updateMission(missionId, {
        title,
        description: description || undefined,
        mission_type_id: missionTypeId || undefined,
        start_at: new Date(startAt).toISOString(),
        end_at: new Date(endAt).toISOString(),
        status,
        client_id: selectedClientId || undefined,
        project_id: projectId || undefined,
        is_private_block: isPrivateBlock,
        assignments: assignments.map((user_id) => ({ user_id, team_id: undefined })),
      });
      onSaved(updated);
      showCrmInlineToast("Mission enregistrée", "success");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!canDelete) return;
    setDeleting(true);
    setErr(null);
    try {
      await deleteMission(missionId);
      onDeleted(missionId);
      setShowDeleteConfirm(false);
      showCrmInlineToast("Mission supprimée", "success");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur suppression");
    } finally {
      setDeleting(false);
    }
  };

  const disabled = !canEdit;

  if (loading) {
    return (
      <ModalShell
        open
        title="Modifier le rendez-vous"
        onClose={tryClose}
        onEscape={handleEscape}
        closeOnBackdropClick={false}
        showCloseButton={false}
        size="md"
      >
        <p>Chargement…</p>
      </ModalShell>
    );
  }

  if (!mission) {
    return (
      <ModalShell
        open
        title="Modifier le rendez-vous"
        onClose={tryClose}
        onEscape={handleEscape}
        size="md"
        footer={
          <button type="button" className="sn-btn sn-btn-ghost" onClick={tryClose}>
            Fermer
          </button>
        }
      >
        <p>Mission non trouvée</p>
      </ModalShell>
    );
  }

  return (
    <>
      <ModalShell
        open
        title="Modifier le rendez-vous"
        subtitle={
          !canEdit
            ? "Lecture seule — vous n'avez pas les droits de modification"
            : undefined
        }
        size="lg"
        onClose={tryClose}
        onEscape={handleEscape}
        closeOnBackdropClick={!saving && !deleting}
        showCloseButton={!saving && !deleting}
        footer={
          <div className="planning-mission-edit-footer">
            {canDelete && (
              <button
                type="button"
                className="sn-btn sn-btn-danger"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={saving}
              >
                Supprimer
              </button>
            )}
            <div style={{ flex: 1 }} />
            <div className="planning-mission-edit-footer-end">
              <button
                type="button"
                className="sn-btn sn-btn-ghost"
                onClick={tryClose}
                disabled={saving}
              >
                Annuler
              </button>
              {canEdit && (
                <button
                  type="submit"
                  form={formId}
                  className="sn-btn sn-btn-primary"
                  disabled={saving}
                >
                  {saving ? "Enregistrement…" : "Enregistrer"}
                </button>
              )}
            </div>
          </div>
        }
      >
        <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="fr">
        <form id={formId} onSubmit={handleSubmit}>
          <div className="planning-modal-field">
            <label>Type mission</label>
            <SearchableDropdown
              options={typeOptions}
              value={missionTypeId}
              onChange={setMissionTypeId}
              placeholder="Sélectionner un type"
              disabled={disabled}
            />
          </div>
          <div className="planning-modal-field">
            <label>Titre</label>
            <input
              className="sn-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="Titre de la mission"
              disabled={disabled}
            />
          </div>
          <div className="planning-modal-field">
            <label>Description</label>
            <textarea
              className="sn-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              disabled={disabled}
            />
          </div>
          <div className="planning-modal-row">
            <PlanningDateTimeField
              label="Date début"
              value={startAt}
              onChange={setStartAt}
              disabled={disabled}
            />
            <PlanningDateTimeField
              label="Date fin"
              value={endAt}
              onChange={setEndAt}
              disabled={disabled}
            />
          </div>
          <div className="planning-modal-field">
            <label>Statut</label>
            <SearchableDropdown
              options={STATUS_OPTIONS.map((s) => ({ id: s.id, label: s.label }))}
              value={status}
              onChange={setStatus}
              placeholder="Statut"
              disabled={disabled}
            />
          </div>
          <div className="planning-modal-field">
            <label>Assignation (utilisateurs)</label>
            <UserMultiSelect
              users={users}
              value={assignments}
              onChange={setAssignments}
              placeholder="Rechercher et sélectionner…"
              disabled={disabled}
            />
          </div>
          <div className="planning-modal-field">
            <label>Client</label>
            <SearchableDropdown
              options={clientOptions}
              value={selectedClientId}
              onChange={(id) => {
                setSelectedClientId(id);
                setProjectId("");
              }}
              placeholder="Sélectionner un client"
              disabled={disabled}
            />
            {selectedClient && (
              <div className="planning-modal-id-block">
                Client: {getClientDisplayName(selectedClient)}
                <br />
                <span className="planning-modal-id">ID: {selectedClient.client_number || selectedClient.id}</span>
              </div>
            )}
          </div>
          <div className="planning-modal-field">
            <label>Projet (étude)</label>
            <SearchableDropdown
              options={studyOptions}
              value={projectId}
              onChange={setProjectId}
              placeholder={selectedClientId ? "Sélectionner un projet" : "Sélectionner d'abord un client"}
              disabled={!selectedClientId || disabled}
            />
            {selectedStudy && (
              <div className="planning-modal-id-block">
                Projet: {selectedStudy.title || selectedStudy.study_number}
                <br />
                <span className="planning-modal-id">ID: {selectedStudy.study_number || selectedStudy.id}</span>
              </div>
            )}
          </div>
          <div className="planning-modal-field">
            <label>
              <input
                type="checkbox"
                checked={isPrivateBlock}
                onChange={(e) => setIsPrivateBlock(e.target.checked)}
                disabled={disabled}
              />
              Mission libre (bloc privé)
            </label>
          </div>
          {err && <p className="planning-modal-error">{err}</p>}
        </form>
        </LocalizationProvider>
      </ModalShell>

      <ConfirmModal
        open={showDeleteConfirm}
        title="Êtes-vous sûr ?"
        message="Cette action est irréversible."
        confirmLabel={deleting ? "Suppression…" : "Supprimer"}
        cancelLabel="Annuler"
        variant="danger"
        onConfirm={() => void handleDelete()}
        onCancel={() => setShowDeleteConfirm(false)}
        elevation="stacked"
        confirmDisabled={deleting}
        cancelDisabled={deleting}
      />
    </>
  );
}
