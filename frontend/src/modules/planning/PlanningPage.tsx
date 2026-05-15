/**
 * Mission Engine V1 — Planning (vues Jour / Semaine / Mois)
 */

import { useEffect, useState, useCallback } from "react";
import {
  fetchMissions,
  fetchMissionTypes,
  updateMissionTime,
  type Mission,
  type MissionsFilters,
} from "../../services/missions.service";
import { fetchLeadsMeta } from "../../services/leads.service";
import { getCurrentUser } from "../../services/auth.service";
import { apiFetch } from "../../services/api";
import { toLocalISODate } from "../../utils/date.utils";
import MissionCreateModal from "./MissionCreateModal";
import MissionEditModal from "./MissionEditModal";
import WeekView from "./WeekView";
import DayView from "./DayView";
import MonthView from "./MonthView";
import { showCrmInlineToast } from "../../components/ui/crmInlineToast";
import { getCrmApiBase } from "@/config/crmApiBase";

const API_BASE = getCrmApiBase();

function getWeekStart(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function getMonthStart(d: Date): Date {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

function roundToQuarter(date: Date): Date {
  const ms = 1000 * 60 * 15;
  return new Date(Math.round(date.getTime() / ms) * ms);
}

type ViewMode = "day" | "week" | "month";

export default function PlanningPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [dayDate, setDayDate] = useState(() => new Date());
  const [monthStart, setMonthStart] = useState(() => getMonthStart(new Date()));
  const [missions, setMissions] = useState<Mission[]>([]);
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<MissionsFilters>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [users, setUsers] = useState<{ id: string; email?: string }[]>([]);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [agencies, setAgencies] = useState<{ id: string; name: string }[]>([]);
  const [missionTypes, setMissionTypes] = useState<
    { id: string; name: string; color?: string }[]
  >([]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingMissionId, setEditingMissionId] = useState<string | null>(null);
  const [_draggingMission, setDraggingMission] = useState<Mission | null>(null);
  const [_dragRevert, setDragRevert] = useState<{
    id: string;
    start: string;
    end: string;
  } | null>(null);

  const from =
    viewMode === "month"
      ? toLocalISODate(monthStart)
      : viewMode === "day"
        ? toLocalISODate(dayDate)
        : toLocalISODate(weekStart);
  const toDate =
    viewMode === "month"
      ? (() => {
          const e = new Date(monthStart);
          e.setMonth(e.getMonth() + 1);
          e.setDate(0);
          return e;
        })()
      : viewMode === "day"
        ? dayDate
        : (() => {
            const e = new Date(weekStart);
            e.setDate(e.getDate() + 6);
            return e;
          })();
  const to = toLocalISODate(toDate);

  const loadMeta = useCallback(async () => {
    try {
      const [me, meta, types] = await Promise.all([
        getCurrentUser().catch(() => null),
        apiFetch(`${API_BASE}/api/missions/meta`).then((r) =>
          r.ok ? r.json() : { users: [], teams: [], agencies: [] }
        ),
        fetchMissionTypes().catch(() => []),
      ]);
      setCurrentUserId(me?.id ?? null);
      setUsers(meta.users || []);
      setTeams(meta.teams || []);
      setAgencies(meta.agencies || []);
      setMissionTypes(types);
      if (me?.id) {
        setFilters((f) => (f.user_id ? f : { ...f, user_id: me.id }));
      }
    } catch {
      const lm = await fetchLeadsMeta().catch(() => ({ users: [] }));
      setUsers(lm.users || []);
    }
  }, []);

  const loadMissions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchMissions({
        ...filters,
        from: `${from}T00:00:00`,
        to: `${to}T23:59:59`,
      });
      setMissions(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur chargement");
      setMissions([]);
    } finally {
      setLoading(false);
    }
  }, [filters, from, to]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    loadMissions();
  }, [loadMissions]);

  const getSlotTime = (day: Date, hour: number, quarter = 0) => {
    const d = new Date(day);
    d.setHours(hour, quarter * 15, 0, 0);
    return d.toISOString();
  };

  const handleResizeEnd = async (missionId: string, newEndISO: string) => {
    const m = missions.find((x) => x.id === missionId);
    if (!m) return;
    const revertData = { id: missionId, start: m.start_at, end: m.end_at };
    const snappedEnd = roundToQuarter(new Date(newEndISO));

    setDragRevert(revertData);
    setMissions((prev) =>
      prev.map((x) =>
        x.id === missionId
          ? { ...x, end_at: snappedEnd.toISOString() }
          : x
      )
    );

    try {
      await updateMissionTime(missionId, m.start_at, snappedEnd.toISOString());
      setDragRevert(null);
    } catch (e) {
      setMissions((prev) =>
        prev.map((x) =>
          x.id === revertData.id
            ? { ...x, end_at: revertData.end }
            : x
        )
      );
      setDragRevert(null);
      showCrmInlineToast("Conflit horaire", "error");
    }
  };

  const handleDrop = async (missionId: string, newStartISO: string) => {
    const m = missions.find((x) => x.id === missionId);
    if (!m) return;
    const start = roundToQuarter(new Date(newStartISO));
    const durationMs =
      new Date(m.end_at).getTime() - new Date(m.start_at).getTime();
    const newEnd = new Date(start.getTime() + durationMs);
    const revertData = { id: missionId, start: m.start_at, end: m.end_at };
    const roundedStartISO = start.toISOString();

    setDragRevert(revertData);
    setMissions((prev) =>
      prev.map((x) =>
        x.id === missionId
          ? { ...x, start_at: roundedStartISO, end_at: newEnd.toISOString() }
          : x
      )
    );

    try {
      await updateMissionTime(missionId, roundedStartISO, newEnd.toISOString());
      setDragRevert(null);
    } catch (e) {
      setMissions((prev) =>
        prev.map((x) =>
          x.id === revertData.id
            ? { ...x, start_at: revertData.start, end_at: revertData.end }
            : x
        )
      );
      setDragRevert(null);
      showCrmInlineToast("Conflit horaire", "error");
    }
  };

  const navPrev = () => {
    if (viewMode === "day") {
      const d = new Date(dayDate);
      d.setDate(d.getDate() - 1);
      setDayDate(d);
    } else if (viewMode === "week") {
      const prev = new Date(weekStart);
      prev.setDate(prev.getDate() - 7);
      setWeekStart(prev);
    } else {
      const prev = new Date(monthStart);
      prev.setMonth(prev.getMonth() - 1);
      setMonthStart(prev);
    }
  };

  const navNext = () => {
    if (viewMode === "day") {
      const d = new Date(dayDate);
      d.setDate(d.getDate() + 1);
      setDayDate(d);
    } else if (viewMode === "week") {
      const next = new Date(weekStart);
      next.setDate(next.getDate() + 7);
      setWeekStart(next);
    } else {
      const next = new Date(monthStart);
      next.setMonth(next.getMonth() + 1);
      setMonthStart(next);
    }
  };

  const navLabel =
    viewMode === "day"
      ? dayDate.toLocaleDateString("fr-FR", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : viewMode === "week"
        ? `${weekStart.toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "short",
          })} – ${(new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000)).toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}`
        : monthStart.toLocaleDateString("fr-FR", {
            month: "long",
            year: "numeric",
          });

  const handleMonthDayClick = (date: Date) => {
    setDayDate(date);
    setViewMode("day");
  };

  return (
    <div className="planning-page">
      <header className="planning-header">
        <h1>Planning</h1>

        <div className="planning-toolbar">
          <div className="planning-toolbar-filters">
            <select
              className="planning-toolbar-select"
              value={filters.user_id ?? ""}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  user_id: e.target.value || undefined,
                }))
              }
              aria-label="Collaborateur"
              title="Collaborateur"
            >
              <option value="">Tous les collaborateurs</option>
              {currentUserId && <option value={currentUserId}>Moi</option>}
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.email || u.id}
                </option>
              ))}
            </select>
            <select
              className="planning-toolbar-select"
              value={filters.team_id ?? ""}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  team_id: e.target.value || undefined,
                }))
              }
              aria-label="Équipe"
            >
              <option value="">Équipe</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <select
              className="planning-toolbar-select"
              value={filters.agency_id ?? ""}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  agency_id: e.target.value || undefined,
                }))
              }
              aria-label="Agence"
            >
              <option value="">Agence</option>
              {agencies.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <select
              className="planning-toolbar-select"
              value={filters.mission_type_id ?? ""}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  mission_type_id: e.target.value || undefined,
                }))
              }
              aria-label="Type"
            >
              <option value="">Type</option>
              {missionTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="planning-toolbar-sep" />
          <div className="planning-toolbar-views">
            <button
              type="button"
              className={`planning-view-btn ${viewMode === "day" ? "active" : ""}`}
              onClick={() => setViewMode("day")}
            >
              Jour
            </button>
            <button
              type="button"
              className={`planning-view-btn ${viewMode === "week" ? "active" : ""}`}
              onClick={() => setViewMode("week")}
            >
              Semaine
            </button>
            <button
              type="button"
              className={`planning-view-btn ${viewMode === "month" ? "active" : ""}`}
              onClick={() => setViewMode("month")}
            >
              Mois
            </button>
          </div>
        </div>

        <div className="planning-actions">
          <button
            type="button"
            className="sn-btn sn-btn-ghost"
            onClick={navPrev}
          >
            ←
          </button>
          <span className="planning-week-label">{navLabel}</span>
          <button
            type="button"
            className="sn-btn sn-btn-ghost"
            onClick={navNext}
          >
            →
          </button>
          <button
            type="button"
            className="sn-btn sn-btn-primary"
            onClick={() => setCreateModalOpen(true)}
          >
            Nouveau rendez-vous
          </button>
        </div>
      </header>

      {error && <p className="planning-error">{error}</p>}

      {viewMode === "day" && (
        <DayView
          date={dayDate}
          missions={missions}
          getSlotTime={getSlotTime}
          onDrop={handleDrop}
          onMissionDragStart={setDraggingMission}
          onMissionDragEnd={() => setDraggingMission(null)}
          onMissionClick={(id) => setEditingMissionId(id)}
          onResizeEnd={handleResizeEnd}
        />
      )}
      {viewMode === "week" && (
        <WeekView
          weekStart={weekStart}
          missions={missions}
          getSlotTime={getSlotTime}
          onDrop={handleDrop}
          onMissionDragStart={setDraggingMission}
          onMissionDragEnd={() => setDraggingMission(null)}
          onMissionClick={(id) => setEditingMissionId(id)}
          onResizeEnd={handleResizeEnd}
        />
      )}
      {viewMode === "month" && (
        <MonthView
          monthStart={monthStart}
          missions={missions}
          onDayClick={handleMonthDayClick}
        />
      )}

      {createModalOpen && (
        <MissionCreateModal
          onClose={() => setCreateModalOpen(false)}
          onCreated={() => {
            setCreateModalOpen(false);
            loadMissions();
          }}
          users={users}
          teams={teams}
          missionTypes={missionTypes}
        />
      )}

      {editingMissionId && (
        <MissionEditModal
          missionId={editingMissionId}
          onClose={() => setEditingMissionId(null)}
          onSaved={(updated) => {
            setMissions((prev) =>
              prev.map((m) => (m.id === updated.id ? updated : m))
            );
            setEditingMissionId(null);
          }}
          onDeleted={(id) => {
            setMissions((prev) => prev.filter((m) => m.id !== id));
            setEditingMissionId(null);
          }}
          users={users}
          teams={teams}
          missionTypes={missionTypes}
        />
      )}

      <style>{`
        .planning-page { padding: 24px; width: 100%; }
        .planning-header { margin-bottom: 24px; }
        .planning-header h1 { margin: 0 0 12px 0; font-size: 24px; }
        .planning-toolbar {
          display: flex;
          align-items: center;
          gap: 16px;
          flex-wrap: nowrap;
          min-height: 48px;
          margin-bottom: 12px;
        }
        .planning-toolbar-filters {
          display: flex;
          gap: 16px;
          align-items: center;
        }
        .planning-toolbar-select {
          min-width: 160px;
          height: 40px;
          padding: 0 14px;
          font-size: 13px;
          border-radius: 12px;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
          appearance: none;
          background-repeat: no-repeat;
          background-position: right 12px center;
          background-size: 12px 12px;
          padding-right: 36px;
        }
        html.theme-dark .planning-toolbar-select {
          background-color: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          color: var(--text);
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239CA8C6' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
          color-scheme: dark;
        }
        html.theme-dark .planning-toolbar-select:hover {
          border-color: color-mix(in srgb, var(--brand-gold) 60%, transparent);
        }
        html.theme-dark .planning-toolbar-select:focus {
          outline: none;
          border-color: var(--brand-gold);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand-gold) 25%, transparent);
        }
        html.theme-dark .planning-toolbar-select option {
          background: #1c1a2e;
          color: var(--text-on-dark);
        }
        html.theme-light .planning-toolbar-select {
          background-color: rgba(255, 255, 255, 0.98);
          border: 1px solid rgba(15, 23, 42, 0.14);
          box-shadow:
            0 1px 2px rgba(15, 23, 42, 0.06),
            inset 0 1px 0 rgba(255, 255, 255, 0.95);
          color: var(--text-primary);
          color-scheme: light;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23475569' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
        }
        html.theme-light .planning-toolbar-select:hover {
          border-color: rgba(15, 23, 42, 0.22);
          background-color: var(--bg-card);
          box-shadow: 0 2px 10px rgba(15, 23, 42, 0.08);
        }
        html.theme-light .planning-toolbar-select:focus {
          outline: none;
          border-color: var(--brand-gold);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand-gold) 22%, transparent);
        }
        html.theme-light .planning-toolbar-select option {
          background: var(--bg-card);
          color: #0f172a;
        }
        .planning-toolbar-sep {
          width: 1px;
          height: 28px;
          flex-shrink: 0;
        }
        html.theme-dark .planning-toolbar-sep {
          background: rgba(255,255,255,0.12);
        }
        html.theme-light .planning-toolbar-sep {
          background: var(--border, rgba(15, 23, 42, 0.12));
        }
        .planning-toolbar-views {
          display: flex;
          gap: 4px;
        }
        .planning-view-btn {
          min-width: 80px;
          height: 40px;
          padding: 0 14px;
          font-size: 13px;
          font-weight: 500;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        html.theme-dark .planning-view-btn:not(.active) {
          background: transparent;
          border: 1px solid rgba(255,255,255,0.08);
          color: var(--text-muted);
        }
        html.theme-dark .planning-view-btn:not(.active):hover {
          color: var(--text);
          background: rgba(255,255,255,0.04);
          border-color: rgba(255,255,255,0.12);
        }
        html.theme-dark .planning-view-btn:not(.active):focus-visible {
          outline: none;
          border-color: var(--brand-gold);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand-gold) 25%, transparent);
        }
        html.theme-light .planning-view-btn:not(.active) {
          background-color: rgba(255, 255, 255, 0.98);
          border: 1px solid rgba(15, 23, 42, 0.14);
          box-shadow:
            0 1px 2px rgba(15, 23, 42, 0.06),
            inset 0 1px 0 rgba(255, 255, 255, 0.95);
          color: var(--text-muted);
        }
        html.theme-light .planning-view-btn:not(.active):hover {
          border-color: rgba(15, 23, 42, 0.22);
          background-color: var(--bg-card);
          box-shadow: 0 2px 10px rgba(15, 23, 42, 0.08);
          color: var(--text);
        }
        html.theme-light .planning-view-btn:not(.active):focus-visible {
          outline: none;
          border-color: var(--brand-gold);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand-gold) 22%, transparent);
        }
        .planning-view-btn.active {
          background: linear-gradient(180deg, var(--violet-strong) 0%, var(--primary-hover) 100%);
          color: var(--text-on-dark);
          border-color: var(--violet-strong);
          box-shadow: 0 4px 12px var(--violet-glow);
        }
        .planning-actions { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
        .planning-week-label { font-weight: 600; }
        .planning-error { color: var(--error, #ef4444); margin-bottom: 16px; }
        .planning-calendar {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-16);
          overflow: hidden;
        }
        .planning-calendar-header {
          display: grid;
          grid-template-columns: 48px repeat(7, 1fr);
          background: var(--surface-soft);
          border-bottom: 1px solid var(--border);
        }
        .planning-calendar-corner { }
        .planning-calendar-day-header {
          padding: 12px;
          text-align: center;
          font-weight: 600;
          font-size: 13px;
        }
        .planning-calendar-body {
          display: grid;
          grid-template-columns: 48px repeat(7, 1fr);
          grid-auto-rows: 60px;
          position: relative;
        }
        .planning-calendar-hour-label {
          grid-row: span 1;
          padding: 4px 8px;
          font-size: 12px;
          color: var(--text-muted);
          border-right: 1px solid var(--border);
        }
        .planning-calendar-slot {
          position: relative;
          border-right: 1px solid var(--border-soft);
          border-bottom: 1px solid var(--border-soft);
          min-height: 60px;
        }
        .planning-calendar-slot-week {
          overflow: hidden;
        }
        .planning-calendar-slot-with-quarters {
          background-image:
            repeating-linear-gradient(
              to bottom,
              transparent 0,
              transparent calc(25% - 1px),
              rgba(255,255,255,0.06) calc(25% - 1px),
              rgba(255,255,255,0.06) 25%
            ),
            repeating-linear-gradient(
              to bottom,
              transparent 0,
              transparent calc(50% - 1px),
              var(--border-soft, rgba(255,255,255,0.15)) calc(50% - 1px),
              var(--border-soft, rgba(255,255,255,0.15)) 50%
            );
          background-size: 100% 100%, 100% 100%;
        }
        .planning-mission-card {
          position: absolute;
          border-radius: 10px;
          border: 1px solid color-mix(in srgb, var(--brand-gold) 35%, transparent); /* or Solar */
          background: linear-gradient(
            180deg,
            rgba(28,24,55,0.95),
            rgba(20,18,45,0.95)
          );
          box-shadow: 0 6px 18px rgba(0,0,0,0.45);
          padding: 8px 10px;
          color: var(--text-on-dark);
          cursor: grab;
          transition:
            box-shadow 0.2s ease,
            transform 0.06s ease;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .planning-mission-card:hover {
          box-shadow: 0 10px 24px rgba(0,0,0,0.55);
        }
        .planning-mission-card:active {
          transform: scale(0.99);
          cursor: grabbing;
        }
        .planning-mission-card.mission-card-compact {
          padding: 6px 10px;
        }
        .planning-mission-card.mission-card-compact .mission-time {
          font-size: 11px;
          line-height: 1.2;
        }
        .planning-mission-card.mission-card-compact .mission-client {
          font-size: 12px;
          line-height: 1.2;
        }
        .planning-mission-card.mission-card-compact .mission-title {
          font-size: 11px;
          line-height: 1.2;
        }
        .planning-mission-card::before {
          content: "";
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 4px;
          border-radius: 10px 0 0 10px;
          background: var(--mission-color);
        }
        .mission-resize-handle {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 6px;
          cursor: ns-resize;
        }
        .mission-time {
          font-size: 12px;
          font-weight: 600;
          color: var(--brand-gold);
          margin-bottom: 2px;
        }
        .mission-client {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-on-dark);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100%;
        }
        .mission-title {
          font-size: 12px;
          color: rgba(255,255,255,0.65);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .planning-day-view {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-16);
          overflow: hidden;
        }
        .planning-day-header { padding: 12px 16px; background: var(--surface-soft); border-bottom: 1px solid var(--border); }
        .planning-day-label { font-weight: 600; font-size: 15px; }
        .planning-day-body { display: flex; flex-direction: column; position: relative; }
        .planning-day-slot {
          display: flex;
          height: 80px;
          min-height: 80px;
          border-bottom: 1px solid var(--border-soft);
        }
        .planning-day-slot-with-quarters .planning-day-slot-content {
          background-image:
            repeating-linear-gradient(
              to bottom,
              transparent 0,
              transparent calc(25% - 1px),
              rgba(255,255,255,0.06) calc(25% - 1px),
              rgba(255,255,255,0.06) 25%
            ),
            repeating-linear-gradient(
              to bottom,
              transparent 0,
              transparent calc(50% - 1px),
              var(--border-soft, rgba(255,255,255,0.15)) calc(50% - 1px),
              var(--border-soft, rgba(255,255,255,0.15)) 50%
            );
          background-size: 100% 100%, 100% 100%;
        }
        .planning-day-hour-label {
          width: 48px;
          padding: 8px;
          font-size: 12px;
          color: var(--text-muted);
          border-right: 1px solid var(--border);
          flex-shrink: 0;
        }
        .planning-day-slot-content { flex: 1; position: relative; min-height: 80px; }
        .planning-month-view {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-16);
          overflow: hidden;
        }
        .planning-month-header {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          background: var(--surface-soft);
          border-bottom: 1px solid var(--border);
        }
        .planning-month-day-label { padding: 10px; text-align: center; font-weight: 600; font-size: 12px; }
        .planning-month-body { }
        .planning-month-row { display: grid; grid-template-columns: repeat(7, 1fr); }
        .planning-month-cell {
          min-height: 80px;
          padding: 8px;
          border-right: 1px solid var(--border-soft);
          border-bottom: 1px solid var(--border-soft);
          cursor: pointer;
        }
        .planning-month-cell:hover { background: var(--surface-soft); }
        .planning-month-cell.other-month { opacity: 0.5; }
        .month-cell { display: flex; flex-direction: column; gap: 4px; }
        .day-number { font-size: 13px; font-weight: 600; }
        .month-mission-dots {
          display: flex;
          align-items: center;
          gap: 4px;
          flex-wrap: wrap;
        }
        .month-mission-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .month-mission-count { font-size: 12px; color: var(--text-muted); margin-left: 2px; }
        .planning-drag-preview-container { z-index: 20; }
        .planning-drag-preview-line {
          position: absolute;
          left: 0;
          right: 0;
          height: 1px;
          background: var(--primary, var(--violet-strong));
          opacity: 0.5;
        }
        .planning-drag-preview-ghost {
          border-radius: 10px;
          border: 1px solid color-mix(in srgb, var(--brand-gold) 35%, transparent);
          background: linear-gradient(
            180deg,
            rgba(28,24,55,0.95),
            rgba(20,18,45,0.95)
          );
          box-shadow: 0 6px 18px rgba(0,0,0,0.45);
          padding: 8px 10px;
          color: var(--text-on-dark);
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
      `}</style>
    </div>
  );
}
