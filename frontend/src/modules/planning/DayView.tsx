/**
 * Mission Engine V1 — Vue jour (1 colonne, créneaux horaires)
 * Drag custom via pointer events (plus de HTML5 DnD)
 */

import React, { useRef } from "react";
import type { Mission } from "../../services/missions.service";
import { toLocalISODate } from "../../utils/date.utils";
import { HOUR_HEIGHT_DAY } from "./planning-drag.utils";
import { usePlanningDrag } from "./usePlanningDrag";
import PlanningDragPreview from "./PlanningDragPreview";
import MissionCard from "./MissionCard";

const HOURS = Array.from({ length: 14 }, (_, i) => i + 6);

interface DayViewProps {
  date: Date;
  missions: Mission[];
  getSlotTime: (day: Date, hour: number, quarter?: number) => string;
  onDrop: (missionId: string, newStartISO: string) => void;
  onMissionDragStart: (m: Mission) => void;
  onMissionDragEnd: () => void;
  onMissionClick?: (missionId: string) => void;
  onResizeEnd?: (missionId: string, newEndISO: string) => void;
}

export default function DayView({
  date,
  missions,
  getSlotTime,
  onDrop,
  onMissionDragStart,
  onMissionDragEnd,
  onMissionClick,
  onResizeEnd,
}: DayViewProps) {
  const dayKey = toLocalISODate(date);
  const dayMissions = missions.filter(
    (m) => toLocalISODate(new Date(m.start_at)) === dayKey
  );
  const bodyRef = useRef<HTMLDivElement>(null);

  const getGridStartMs = (_ms: number) => {
    const d = new Date(date);
    d.setHours(HOURS[0], 0, 0, 0);
    return d.getTime();
  };

  const getGridBounds = (m: Mission) => {
    const d = new Date(m.start_at);
    const minD = new Date(d);
    minD.setHours(6, 0, 0, 0);
    const maxD = new Date(d);
    maxD.setHours(20, 0, 0, 0);
    const durationMs =
      new Date(m.end_at).getTime() - new Date(m.start_at).getTime();
    return {
      minMs: minD.getTime(),
      maxMs: maxD.getTime() - durationMs,
    };
  };

  const {
    dragState,
    previewRef,
    getMissionPointerHandlers,
    getResizePointerHandlers,
  } = usePlanningDrag({
    hourHeight: HOUR_HEIGHT_DAY,
    getGridStartMs,
    getGridBounds,
    onDrop,
    onDragStart: onMissionDragStart,
    onDragEnd: onMissionDragEnd,
    onMissionClick,
    onResizeEnd,
  });

  return (
    <div className="planning-day-view">
      <div className="planning-day-header">
        <span className="planning-day-label">
          {date.toLocaleDateString("fr-FR", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </span>
      </div>
      <div ref={bodyRef} className="planning-day-body">
        {HOURS.map((hour) => {
          const slotStart = getSlotTime(date, hour, 0);
          const slotEnd = getSlotTime(date, hour + 1, 0);
          const slotMissions = dayMissions.filter((m) => {
            const ms = new Date(m.start_at).getTime();
            const me = new Date(m.end_at).getTime();
            const ss = new Date(slotStart).getTime();
            const se = new Date(slotEnd).getTime();
            return ms < se && me > ss;
          });

          return (
            <div
              key={hour}
              className="planning-day-slot planning-day-slot-with-quarters"
            >
              <div className="planning-day-hour-label">{hour}h</div>
              <div className="planning-day-slot-content">
                {slotMissions.map((m) => {
                  const mStart = new Date(m.start_at);
                  const mEnd = new Date(m.end_at);
                  const slotStartMs = new Date(slotStart).getTime();
                  const top =
                    ((mStart.getTime() - slotStartMs) / (60 * 60 * 1000)) * 100;
                  const h =
                    ((mEnd.getTime() - mStart.getTime()) / (60 * 60 * 1000)) *
                    100;
                  const isDragging = dragState.mission?.id === m.id;
                  const pointerHandlers = getMissionPointerHandlers(
                    m,
                    () => bodyRef.current
                  );

                  return (
                    <MissionCard
                      key={m.id}
                      mission={m}
                      isDragging={isDragging}
                      style={{
                        top: `${top}%`,
                        height: `${h}%`,
                      }}
                      pointerHandlers={pointerHandlers}
                      resizeHandlers={getResizePointerHandlers(m, () =>
                        bodyRef.current
                      )}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
        <PlanningDragPreview
          dragState={dragState}
          previewRef={previewRef}
          hourHeight={HOUR_HEIGHT_DAY}
        />
      </div>
    </div>
  );
}
