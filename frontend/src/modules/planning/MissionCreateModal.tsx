/**
 * Mission Engine V1 — Modal création mission
 * Types dynamiques, UserMultiSelect, client/projet avec IDs
 */

import React, { useCallback, useEffect, useId, useState } from "react";
import { ModalShell } from "../../components/ui/ModalShell";
import "./planning-mission-modal.css";
import {
  createMission,
  createMissionFromClient,
  fetchMissionTypes,
  type Mission,
  type MissionType,
} from "../../services/missions.service";
import { fetchClients, type Client } from "../../services/clients.service";
import { fetchStudiesByClientId, type Study } from "../../services/studies.service";
import { apiFetch } from "../../services/api";
import { getCurrentUser } from "../../services/auth.service";
import UserMultiSelect from "./UserMultiSelect";
import SearchableDropdown, { type DropdownOption } from "./SearchableDropdown";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import dayjs from "dayjs";
import "dayjs/locale/fr";
import PlanningDateTimeField from "./PlanningDateTimeField";
import { snapToQuarter } from "./planningDateTime.utils";
import { getCrmApiBase } from "@/config/crmApiBase";

const API_BASE = getCrmApiBase();

interface MissionCreateModalProps {
  onClose: () => void;
  onCreated: (mission: Mission) => void;
  clientId?: string;
  users?: { id: string; email?: string }[];
  teams?: { id: string; name: string }[];
  missionTypes?: MissionType[];
}

function getClientDisplayName(c: Client): string {
  if (c.company_name) return c.company_name;
  const parts = [c.first_name, c.last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : c.email || c.id;
}

export default function MissionCreateModal({
  onClose,
  onCreated,
  clientId,
  users: usersProp = [],
  teams: teamsProp = [],
  missionTypes: typesProp = [],
}: MissionCreateModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [missionTypeId, setMissionTypeId] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [assignments, setAssignments] = useState<string[]>([]);

  useEffect(() => {
    dayjs.locale("fr");
  }, []);

  useEffect(() => {
    getCurrentUser()
      .then((user) => {
        if (user?.id) {
          setAssignments((prev) => (prev.length === 0 ? [user.id] : prev));
        }
      })
      .catch(() => {});
  }, []);
  const [selectedClientId, setSelectedClientId] = useState(clientId || "");
  const [projectId, setProjectId] = useState("");
  const [isPrivateBlock, setIsPrivateBlock] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [users, setUsers] = useState(usersProp);
  const [_teams, setTeams] = useState(teamsProp);
  const [missionTypes, setMissionTypes] = useState(typesProp);
  const [clients, setClients] = useState<Client[]>([]);
  const [studies, setStudies] = useState<Study[]>([]);

  useEffect(() => {
    const now = new Date();
    const start = snapToQuarter(now);
    const end = new Date(start);
    end.setHours(end.getHours() + 1, 0, 0, 0);
    setStartAt(start.toISOString().slice(0, 16));
    setEndAt(end.toISOString().slice(0, 16));
  }, []);

  useEffect(() => {
    if (clientId) setSelectedClientId(clientId);
  }, [clientId]);

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
    if (!clientId) {
      fetchClients().then(setClients).catch(() => setClients([]));
    }
  }, [clientId]);

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

  const formId = useId().replace(/:/g, "");
  const tryClose = useCallback(() => {
    if (saving) return;
    onClose();
  }, [saving, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    const payload = {
      title,
      description: description || undefined,
      mission_type_id: missionTypeId || undefined,
      start_at: new Date(startAt).toISOString(),
      end_at: new Date(endAt).toISOString(),
      client_id: selectedClientId || undefined,
      project_id: projectId || undefined,
      is_private_block: isPrivateBlock,
      assignments: assignments.map((user_id) => ({ user_id, team_id: undefined })),
    };

    try {
      const created = clientId
        ? await createMissionFromClient(clientId, payload)
        : await createMission(payload);
      onCreated(created);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open
      title={clientId ? "Créer un rendez-vous (client)" : "Créer un rendez-vous"}
      subtitle={
        clientId ? "Mission liée au client (pré-rempli)" : undefined
      }
      size="lg"
      onClose={tryClose}
      onEscape={saving ? () => {} : undefined}
      closeOnBackdropClick={!saving}
      showCloseButton={!saving}
      footer={
        <>
          <button
            type="button"
            className="sn-btn sn-btn-ghost"
            onClick={tryClose}
            disabled={saving}
          >
            Annuler
          </button>
          <button
            type="submit"
            form={formId}
            className="sn-btn sn-btn-primary"
            disabled={saving}
          >
            {saving ? "Création…" : "Créer"}
          </button>
        </>
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
            />
          </div>
          <div className="planning-modal-field">
            <label>Description</label>
            <textarea
              className="sn-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="planning-modal-row">
            <PlanningDateTimeField
              label="Date début"
              value={startAt}
              onChange={setStartAt}
            />
            <PlanningDateTimeField
              label="Date fin"
              value={endAt}
              onChange={setEndAt}
            />
          </div>
          <div className="planning-modal-field">
            <label>Assignation (utilisateurs)</label>
            <UserMultiSelect
              users={users}
              value={assignments}
              onChange={setAssignments}
              placeholder="Rechercher et sélectionner…"
            />
          </div>
          {!clientId && (
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
              />
              {selectedClient && (
                <div className="planning-modal-id-block">
                  Client: {getClientDisplayName(selectedClient)}
                  <br />
                  <span className="planning-modal-id">ID: {selectedClient.client_number || selectedClient.id}</span>
                </div>
              )}
            </div>
          )}
          <div className="planning-modal-field">
            <label>Projet (étude)</label>
            <SearchableDropdown
              options={studyOptions}
              value={projectId}
              onChange={setProjectId}
              placeholder={selectedClientId ? "Sélectionner un projet" : "Sélectionner d'abord un client"}
              disabled={!selectedClientId}
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
              />
              Mission libre (bloc privé)
            </label>
          </div>
          {err && <p className="planning-modal-error">{err}</p>}
        </form>
      </LocalizationProvider>
    </ModalShell>
  );
}
