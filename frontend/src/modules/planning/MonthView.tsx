/**
 * Mission Engine V1 — Vue mois (grille 7x5)
 * Click sur jour → callback pour basculer en DayView
 */

import type { Mission } from "../../services/missions.service";
import { toLocalISODate } from "../../utils/date.utils";

function getWeekStart(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

interface MonthViewProps {
  monthStart: Date;
  missions: Mission[];
  onDayClick: (date: Date) => void;
}

export default function MonthView({
  monthStart,
  missions,
  onDayClick,
}: MonthViewProps) {
  const weekStart = getWeekStart(monthStart);
  const dayLabels = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

  const missionsByDay = new Map<string, Mission[]>();
  for (const m of missions) {
    const start = new Date(m.start_at);
    const dayKey = toLocalISODate(start);
    if (!missionsByDay.has(dayKey)) missionsByDay.set(dayKey, []);
    missionsByDay.get(dayKey)!.push(m);
  }

  const weeks = Array.from({ length: 5 }, (_, wi) =>
    Array.from({ length: 7 }, (_, di) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + wi * 7 + di);
      return d;
    })
  );

  return (
    <div className="planning-month-view">
      <div className="planning-month-header">
        {dayLabels.map((l) => (
          <div key={l} className="planning-month-day-label">
            {l}
          </div>
        ))}
      </div>
      <div className="planning-month-body">
        {weeks.map((week, wi) => (
          <div key={wi} className="planning-month-row">
            {week.map((day) => {
              const dayKey = toLocalISODate(day);
              const dayMissions = missionsByDay.get(dayKey) || [];
              const isCurrentMonth = day.getMonth() === monthStart.getMonth();
              const dotsToShow = dayMissions.slice(0, 3);
              return (
                <div
                  key={dayKey}
                  className={`planning-month-cell ${!isCurrentMonth ? "other-month" : ""}`}
                  onClick={() => onDayClick(day)}
                >
                  <div className="month-cell">
                    <div className="day-number">{day.getDate()}</div>
                    {dayMissions.length > 0 && (
                      <div className="month-mission-dots">
                        {dotsToShow.map((m, _i) => (
                          <span
                            key={m.id}
                            className="month-mission-dot"
                            style={{
                              backgroundColor:
                                m.mission_type_color || "var(--violet-strong)",
                            }}
                          />
                        ))}
                        <span className="month-mission-count">
                          {dayMissions.length}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
