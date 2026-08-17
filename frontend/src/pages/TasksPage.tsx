import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { fetchLeadsMeta, type LeadsMeta } from "../services/leads.service";
import {
  completeCrmTask,
  fetchCrmTasks,
  snoozeCrmTask,
  updateCrmTask,
  type CrmTask,
  type CrmTaskBucket,
  type CrmTaskPriority,
  type CrmTaskType,
} from "../services/tasks.service";
import "./tasks-page.css";

const BUCKETS: Array<{ key: CrmTaskBucket; label: string }> = [
  { key: "today", label: "Aujourd'hui" },
  { key: "overdue", label: "En retard" },
  { key: "week", label: "Cette semaine" },
  { key: "all", label: "Toutes" },
];

const TYPE_LABELS: Record<CrmTaskType, string> = {
  CALL: "Appel",
  EMAIL: "Email",
  ADMIN: "Admin",
  POST_INSTALL: "Post-install",
  SAV: "SAV",
  PARRAINAGE: "Parrainage",
  OTHER: "Autre",
};

const PRIORITY_LABELS: Record<CrmTaskPriority, string> = {
  LOW: "Basse",
  NORMAL: "Normale",
  HIGH: "Haute",
  URGENT: "Urgente",
};

function toDateInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDateInputValue(value: string): string {
  return new Date(value).toISOString();
}

function formatDue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Date invalide";
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function overdueLabel(task: CrmTask): string {
  const due = new Date(task.due_at).getTime();
  if (Number.isNaN(due)) return "";
  const diff = Date.now() - due;
  if (diff <= 0) return "";
  const days = Math.floor(diff / 86_400_000);
  if (days >= 1) return `en retard depuis ${days} j`;
  const hours = Math.max(1, Math.floor(diff / 3_600_000));
  return `en retard depuis ${hours} h`;
}

function entityUrl(task: CrmTask): string | null {
  if (task.lead_id) return `/leads/${task.lead_id}`;
  if (task.client_id) return `/clients/${task.client_id}`;
  return null;
}

export default function TasksPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialBucket = (searchParams.get("bucket") as CrmTaskBucket) || "today";
  const [bucket, setBucket] = useState<CrmTaskBucket>(
    BUCKETS.some((b) => b.key === initialBucket) ? initialBucket : "today"
  );
  const [assignedUserId, setAssignedUserId] = useState(searchParams.get("assigned_user_id") || "");
  const [type, setType] = useState<CrmTaskType | "">((searchParams.get("type") as CrmTaskType) || "");
  const [priority, setPriority] = useState<CrmTaskPriority | "">((searchParams.get("priority") as CrmTaskPriority) || "");
  const [entity, setEntity] = useState<"" | "lead" | "client">((searchParams.get("entity") as "lead" | "client") || "");
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [meta, setMeta] = useState<LeadsMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [items, metaData] = await Promise.all([
        fetchCrmTasks({
          bucket,
          assigned_user_id: assignedUserId,
          type,
          priority,
          entity,
          limit: 200,
        }),
        fetchLeadsMeta().catch(() => null),
      ]);
      setTasks(items);
      setMeta(metaData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur chargement relances");
    } finally {
      setLoading(false);
    }
  }, [assignedUserId, bucket, entity, priority, type]);

  useEffect(() => {
    const next = new URLSearchParams();
    next.set("bucket", bucket);
    if (assignedUserId) next.set("assigned_user_id", assignedUserId);
    if (type) next.set("type", type);
    if (priority) next.set("priority", priority);
    if (entity) next.set("entity", entity);
    setSearchParams(next, { replace: true });
  }, [assignedUserId, bucket, entity, priority, setSearchParams, type]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const overdue = tasks.filter((t) => overdueLabel(t)).length;
    const urgent = tasks.filter((t) => t.priority === "URGENT").length;
    return { total: tasks.length, overdue, urgent };
  }, [tasks]);

  async function runAction(task: CrmTask, action: "done" | "snooze" | "date", value?: string) {
    setSavingId(task.id);
    try {
      if (action === "done") await completeCrmTask(task.id);
      if (action === "snooze") {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0);
        await snoozeCrmTask(task.id, d.toISOString());
      }
      if (action === "date" && value) await updateCrmTask(task.id, { due_at: fromDateInputValue(value) });
      await load();
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="tasks-page">
      <div className="tasks-page__header">
        <div>
          <p className="tasks-page__eyebrow">CRM</p>
          <h1>Mes relances</h1>
        </div>
        <div className="tasks-page__kpis" aria-label="Synthèse relances">
          <span><strong>{counts.total}</strong> affichées</span>
          <span><strong>{counts.overdue}</strong> en retard</span>
          <span><strong>{counts.urgent}</strong> urgentes</span>
        </div>
      </div>

      <Card className="tasks-page__toolbar">
        <div className="tasks-tabs" role="tablist" aria-label="Période">
          {BUCKETS.map((b) => (
            <button
              key={b.key}
              type="button"
              className={bucket === b.key ? "tasks-tabs__item is-active" : "tasks-tabs__item"}
              onClick={() => setBucket(b.key)}
            >
              {b.label}
            </button>
          ))}
        </div>
        <div className="tasks-filters">
          <select className="sn-input" value={assignedUserId} onChange={(e) => setAssignedUserId(e.target.value)}>
            <option value="">Tous commerciaux</option>
            {(meta?.users ?? []).map((u) => (
              <option key={u.id} value={u.id}>{u.email}</option>
            ))}
          </select>
          <select className="sn-input" value={type} onChange={(e) => setType(e.target.value as CrmTaskType | "")}>
            <option value="">Tous types</option>
            {Object.entries(TYPE_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <select className="sn-input" value={priority} onChange={(e) => setPriority(e.target.value as CrmTaskPriority | "")}>
            <option value="">Toutes priorités</option>
            {Object.entries(PRIORITY_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <select className="sn-input" value={entity} onChange={(e) => setEntity(e.target.value as "" | "lead" | "client")}>
            <option value="">Leads et clients</option>
            <option value="lead">Leads</option>
            <option value="client">Clients</option>
          </select>
        </div>
      </Card>

      {error ? <div className="tasks-page__error">{error}</div> : null}
      {loading ? <div className="tasks-page__empty">Chargement des relances...</div> : null}
      {!loading && tasks.length === 0 ? (
        <div className="tasks-page__empty">Aucune relance dans cette vue.</div>
      ) : null}

      <div className="tasks-list">
        {tasks.map((task) => {
          const overdue = overdueLabel(task);
          const url = entityUrl(task);
          return (
            <article key={task.id} className={`task-row priority-${task.priority.toLowerCase()}`}>
              <div className="task-row__main">
                <div className="task-row__topline">
                  <span className="task-row__type">{TYPE_LABELS[task.type]}</span>
                  <span className="task-row__due">{formatDue(task.due_at)}</span>
                  {overdue ? <span className="task-row__late">{overdue}</span> : null}
                </div>
                <h2>{task.entity_label || "Dossier CRM"}</h2>
                <p className="task-row__title">{task.title}</p>
                {task.description ? <p className="task-row__desc">{task.description}</p> : null}
                <div className="task-row__meta">
                  <span>{PRIORITY_LABELS[task.priority]}</span>
                  <span>{task.assigned_user_label || task.assigned_user_email || "Non assignée"}</span>
                </div>
              </div>
              <div className="task-row__actions">
                {url ? (
                  <Button type="button" variant="outlineGold" size="sm" onClick={() => navigate(url)}>
                    Ouvrir
                  </Button>
                ) : null}
                <Button type="button" variant="primary" size="sm" disabled={savingId === task.id} onClick={() => void runAction(task, "done")}>
                  Terminer
                </Button>
                <Button type="button" variant="secondary" size="sm" disabled={savingId === task.id} onClick={() => void runAction(task, "snooze")}>
                  Demain 9h
                </Button>
                <input
                  className="task-row__date"
                  type="datetime-local"
                  value={toDateInputValue(task.due_at)}
                  disabled={savingId === task.id}
                  onChange={(e) => void runAction(task, "date", e.target.value)}
                  aria-label="Modifier l'échéance"
                />
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
