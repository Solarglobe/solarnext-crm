import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import {
  completeCrmTask,
  createCrmTask,
  fetchCrmTasks,
  snoozeCrmTask,
  type CrmTask,
  type CrmTaskPriority,
  type CrmTaskType,
} from "../../services/tasks.service";
import "./entity-tasks-panel.css";

interface EntityTasksPanelProps {
  leadId?: string | null;
  clientId?: string | null;
  assignedUserId?: string | null;
  readOnly?: boolean;
  compact?: boolean;
}

const TYPE_OPTIONS: Array<{ value: CrmTaskType; label: string }> = [
  { value: "CALL", label: "Appel" },
  { value: "EMAIL", label: "Email" },
  { value: "ADMIN", label: "Admin" },
  { value: "POST_INSTALL", label: "Post-install" },
  { value: "SAV", label: "SAV" },
  { value: "PARRAINAGE", label: "Parrainage" },
  { value: "OTHER", label: "Autre" },
];

function toInputDate(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function formatDue(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isOverdue(task: CrmTask): boolean {
  return new Date(task.due_at).getTime() < Date.now();
}

export default function EntityTasksPanel({
  leadId,
  clientId,
  assignedUserId,
  readOnly = false,
  compact = false,
}: EntityTasksPanelProps) {
  const [openTasks, setOpenTasks] = useState<CrmTask[]>([]);
  const [doneTasks, setDoneTasks] = useState<CrmTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<CrmTaskType>("CALL");
  const [priority, setPriority] = useState<CrmTaskPriority>("NORMAL");
  const [dueAt, setDueAt] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return toInputDate(d);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!leadId && !clientId) return;
    setLoading(true);
    setError(null);
    try {
      const base = leadId ? { lead_id: leadId } : { client_id: clientId || undefined };
      const [active, done] = await Promise.all([
        fetchCrmTasks({ ...base, status: "OPEN,SNOOZED", bucket: "all", limit: 20 }),
        fetchCrmTasks({ ...base, status: "DONE", bucket: "all", limit: 10 }),
      ]);
      setOpenTasks(active);
      setDoneTasks(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur relances");
    } finally {
      setLoading(false);
    }
  }, [clientId, leadId]);

  useEffect(() => {
    void load();
  }, [load]);

  const nextTask = useMemo(() => [...openTasks].sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())[0] || null, [openTasks]);
  const overdue = openTasks.filter(isOverdue);

  async function createManualTask() {
    if (!assignedUserId || !title.trim()) return;
    setBusy(true);
    try {
      await createCrmTask({
        lead_id: leadId || null,
        client_id: clientId || null,
        assigned_user_id: assignedUserId,
        type,
        title: title.trim(),
        due_at: new Date(dueAt).toISOString(),
        priority,
      });
      setTitle("");
      setFormOpen(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function quickSnooze(task: CrmTask) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    await snoozeCrmTask(task.id, d.toISOString());
    await load();
  }

  return (
    <section className={compact ? "entity-tasks entity-tasks--compact" : "entity-tasks"}>
      <div className="entity-tasks__head">
        <div>
          <h2>Relances</h2>
          <p>{nextTask ? `Prochaine : ${formatDue(nextTask.due_at)}` : "Aucune relance active"}</p>
        </div>
        {!readOnly ? (
          <Button type="button" variant="outlineGold" size="sm" onClick={() => setFormOpen((v) => !v)}>
            {formOpen ? "Fermer" : "Nouvelle"}
          </Button>
        ) : null}
      </div>

      {overdue.length > 0 ? (
        <div className="entity-tasks__alert">{overdue.length} relance{overdue.length > 1 ? "s" : ""} en retard</div>
      ) : null}

      {formOpen ? (
        <div className="entity-tasks__form">
          <input className="sn-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre de la relance" />
          <select className="sn-input" value={type} onChange={(e) => setType(e.target.value as CrmTaskType)}>
            {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select className="sn-input" value={priority} onChange={(e) => setPriority(e.target.value as CrmTaskPriority)}>
            <option value="NORMAL">Normale</option>
            <option value="HIGH">Haute</option>
            <option value="URGENT">Urgente</option>
            <option value="LOW">Basse</option>
          </select>
          <input className="sn-input" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          <Button type="button" variant="primary" size="sm" disabled={busy || !assignedUserId || !title.trim()} onClick={() => void createManualTask()}>
            Créer
          </Button>
        </div>
      ) : null}

      {error ? <p className="entity-tasks__error">{error}</p> : null}
      {loading ? <p className="entity-tasks__empty">Chargement...</p> : null}
      {!loading && openTasks.length === 0 ? <p className="entity-tasks__empty">Aucune tâche ouverte.</p> : null}
      <div className="entity-tasks__list">
        {openTasks.slice(0, compact ? 4 : 8).map((task) => (
          <div key={task.id} className={isOverdue(task) ? "entity-task is-overdue" : "entity-task"}>
            <div>
              <strong>{task.title}</strong>
              <span>{formatDue(task.due_at)} · {task.type}</span>
            </div>
            {!readOnly ? (
              <div className="entity-task__actions">
                <button type="button" onClick={() => void completeCrmTask(task.id).then(load)}>Terminer</button>
                <button type="button" onClick={() => void quickSnooze(task)}>Demain</button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {doneTasks.length > 0 ? (
        <details className="entity-tasks__history">
          <summary>Historique terminé</summary>
          {doneTasks.map((task) => (
            <div key={task.id} className="entity-task entity-task--done">
              <strong>{task.title}</strong>
              <span>{task.completed_at ? formatDue(task.completed_at) : formatDue(task.updated_at)}</span>
            </div>
          ))}
        </details>
      ) : null}
    </section>
  );
}
