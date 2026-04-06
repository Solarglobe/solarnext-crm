/**
 * Mission Engine V1 — Vue semaine (7 colonnes)
 * Drag custom via pointer events (plus de HTML5 DnD)
 */

import React, { useRef, useState, useEffect } from "react";
import type { Mission } from "../../services/missions.service";
import { toLocalISODate } from "../../utils/date.utils";
import { HOUR_HEIGHT_WEEK } from "./planning-drag.utils";
import { usePlanningDrag } from "./usePlanningDrag";
import PlanningDragPreview from "./PlanningDragPreview";
import MissionCard from "./MissionCard";

const HOURS = Array.from({ length: 12 }, (_, i) => i + 8);
const DAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

interface WeekViewProps {
  weekStart: Date;
  missions: Mission[];
  getSlotTime: (day: Date, hour: number, quarter?: number) => string;
  onDrop: (missionId: string, newStartISO: string) => void;
  onMissionDragStart: (m: Mission) => void;
  onMissionDragEnd: () => void;
  onMissionClick?: (missionId: string) => void;
  onResizeEnd?: (missionId: string, newEndISO: string) => void;
}

export default function WeekView({
  weekStart,
  missions,
  getSlotTime,
  onDrop,
  onMissionDragStart,
  onMissionDragEnd,
  onMissionClick,
  onResizeEnd,
}: WeekViewProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setContainerWidth(el.offsetWidth);
    });
    ro.observe(el);
    setContainerWidth(el.offsetWidth);
    return () => ro.disconnect();
  }, []);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const getGridStartMs = (ms: number) => {
    const d = new Date(ms);
    d.setHours(HOURS[0], 0, 0, 0);
    return d.getTime();
  };

  const getGridBounds = (m: Mission) => {
    const d = new Date(m.start_at);
    const minD = new Date(d);
    minD.setHours(8, 0, 0, 0);
    const maxD = new Date(d);
    maxD.setHours(20, 0, 0, 0);
    const durationMs =
      new Date(m.end_at).getTime() - new Date(m.start_at).getTime();
    return {
      minMs: minD.getTime(),
      maxMs: maxD.getTime() - durationMs,
    };
  };

  const columnWidthPx =
    containerWidth > 0 ? (containerWidth - 48) / 7 : undefined;

  const {
    dragState,
    previewRef,
    getMissionPointerHandlers,
    getResizePointerHandlers,
  } = usePlanningDrag({
    hourHeight: HOUR_HEIGHT_WEEK,
    getGridStartMs,
    getGridBounds,
    columnWidthPx,
    weekStart,
    gridMinHour: 8,
    gridMaxHour: 20,
    onDrop,
    onDragStart: onMissionDragStart,
    onDragEnd: onMissionDragEnd,
    onMissionClick,
    onResizeEnd,
  });

  const missionsBySlot = new Map<string, Mission[]>();
  for (const m of missions) {
    const start = new Date(m.start_at);
    const dayKey = toLocalISODate(start);
    if (!missionsBySlot.has(dayKey)) missionsBySlot.set(dayKey, []);
    missionsBySlot.get(dayKey)!.push(m);
  }

  return (
    <div className="planning-calendar">
      <div className="planning-calendar-header">
        <div className="planning-calendar-corner" />
        {weekDays.map((d) => (
          <div key={d.toISOString()} className="planning-calendar-day-header">
            {DAY_LABELS[d.getDay() === 0 ? 6 : d.getDay() - 1]} {d.getDate()}
          </div>
        ))}
      </div>
      <div
        ref={bodyRef}
        className="planning-calendar-body"
      >
        {HOURS.map((hour) => (
          <React.Fragment key={hour}>
            <div className="planning-calendar-hour-label">{hour}h</div>
            {weekDays.map((day) => {
              const dayKey = toLocalISODate(day);
              const slotStart = getSlotTime(day, hour, 0);
              const slotEnd = getSlotTime(day, hour + 1, 0);
              const dayMissions = (missionsBySlot.get(dayKey) || []).filter(
                (m) => {
                  const ms = new Date(m.start_at).getTime();
                  const me = new Date(m.end_at).getTime();
                  const ss = new Date(slotStart).getTime();
                  const se = new Date(slotEnd).getTime();
                  return ms < se && me > ss;
                }
              );

              return (
                <div
                  key={`${dayKey}-${hour}`}
                  className="planning-calendar-slot planning-calendar-slot-with-quarters planning-calendar-slot-week"
                >
                  {dayMissions.map((m) => {
                    const mStart = new Date(m.start_at);
                    const mEnd = new Date(m.end_at);
                    const slotStartMs = new Date(slotStart).getTime();
                    const top =
                      ((mStart.getTime() - slotStartMs) / (60 * 60 * 1000)) *
                      100;
                    const h =
                      ((mEnd.getTime() - mStart.getTime()) /
                        (60 * 60 * 1000)) *
                      100;
                    const isDragging = dragState.mission?.id === m.id;
                    const pointerHandlers = getMissionPointerHandlers(m, () =>
                      bodyRef.current
                    );

                    return (
                      <MissionCard
                        key={m.id}
                        mission={m}
                        isDragging={isDragging}
                        style={{
                          top: `${top}%`,
                          height: `${h}%`,
                          left: 6,
                          right: 6,
                        }}
                        pointerHandlers={pointerHandlers}
                        resizeHandlers={getResizePointerHandlers(m, () =>
                          bodyRef.current
                        )}
                      />
                    );
                  })}
                </div>
              );
            })}
          </React.Fragment>
        ))}
        <PlanningDragPreview
          dragState={dragState}
          previewRef={previewRef}
          hourHeight={HOUR_HEIGHT_WEEK}
          columnWidthPx={columnWidthPx}
        />
      </div>
    </div>
  );
}
