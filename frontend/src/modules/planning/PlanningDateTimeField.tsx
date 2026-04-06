/**
 * LOT B — Champ date/heure mission (MUI X) : comportement métier unique, styles centralisés.
 */

import React from "react";
import { DateTimePicker } from "@mui/x-date-pickers/DateTimePicker";
import dayjs from "dayjs";
import { buildPlanningDateTimePickerSlotProps } from "./planningDateTimePicker.theme";
import { snapToQuarter } from "./planningDateTime.utils";

export interface PlanningDateTimeFieldProps {
  label: string;
  /** Chaîne locale `YYYY-MM-DDTHH:mm` (slice ISO), comme avant LOT B */
  value: string;
  onChange: (nextLocalSlice: string) => void;
  disabled?: boolean;
}

export default function PlanningDateTimeField({
  label,
  value,
  onChange,
  disabled = false,
}: PlanningDateTimeFieldProps) {
  const isDark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("theme-dark");
  const slotProps = buildPlanningDateTimePickerSlotProps(isDark);

  return (
    <div className="planning-modal-field">
      <label>{label}</label>
      <DateTimePicker
        value={value ? dayjs(value) : null}
        onChange={(newValue) => {
          if (newValue) {
            const snapped = snapToQuarter(newValue.toDate());
            onChange(snapped.toISOString().slice(0, 16));
          }
        }}
        disabled={disabled}
        ampm={false}
        format="DD/MM/YYYY HH:mm"
        timeSteps={{ minutes: 15 }}
        minutesStep={15}
        shouldDisableTime={(tv, view) => {
          if (view === "minutes") {
            const minute = tv.minute();
            return ![0, 15, 30, 45].includes(minute);
          }
          return false;
        }}
        views={["year", "month", "day", "hours", "minutes"]}
        slotProps={slotProps}
      />
    </div>
  );
}
