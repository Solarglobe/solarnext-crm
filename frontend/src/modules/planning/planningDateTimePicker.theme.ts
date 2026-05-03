/**
 * LOT B — Styles centralisés MUI DateTimePicker (planning missions).
 * Variantes clair (co ModalShell CRM) / sombre (theme-dark).
 * z-index popper au-dessus de ModalShell (1000), sous ConfirmModal stacked (1100).
 */

import type { SxProps, Theme } from "@mui/material/styles";

export const PLANNING_DTP_POPPER_Z_INDEX = 1300;

const ACCENT = "var(--brand-gold)";

function textFieldSx(inputColor: string): SxProps<Theme> {
  return {
    "& .MuiPickersInputBase-root": { color: inputColor },
    "& .MuiPickersInputBase-root *": {
      color: inputColor,
      WebkitTextFillColor: inputColor,
    },
    "& .MuiPickersSectionList-root": { color: inputColor },
    "& .MuiPickersSectionList-section": {
      color: inputColor,
      WebkitTextFillColor: inputColor,
    },
    "& .MuiPickersInputBase-section": {
      color: inputColor,
      WebkitTextFillColor: inputColor,
    },
    '& span[contenteditable="true"]': {
      color: inputColor,
      WebkitTextFillColor: inputColor,
      caretColor: inputColor,
    },
    "& .MuiPickersInputBase-separator": {
      color: inputColor,
      WebkitTextFillColor: inputColor,
    },
    "& .MuiSvgIcon-root": { color: inputColor },
  };
}

function popperSxLight(): SxProps<Theme> {
  return {
    zIndex: PLANNING_DTP_POPPER_Z_INDEX,
    "& .MuiPaper-root": {
      backgroundColor: "var(--bg-card)",
      color: "#111",
      borderRadius: "14px",
      boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
      border: "1px solid rgba(0,0,0,0.08)",
    },
    "& .MuiPickersLayout-root": {
      backgroundColor: "var(--bg-card)",
    },
    "& .MuiTypography-root": {
      color: "#111",
    },
    "& .MuiPickersCalendarHeader-label": {
      color: "#111",
      fontWeight: 600,
    },
    "& .MuiPickersArrowSwitcher .MuiIconButton-root": {
      color: "#111",
    },
    "& .MuiPickersCalendarHeader-switchViewButton": {
      color: "#111",
    },
    "& .MuiDayCalendar-weekDayLabel": {
      color: "#555",
      fontWeight: 500,
    },
    "& .MuiPickersDay-root": {
      color: "#111",
      fontWeight: 500,
    },
    "& .MuiPickersDay-root.Mui-selected": {
      backgroundColor: ACCENT,
      color: "#fff",
    },
    "& .MuiPickersDay-root.MuiPickersDay-today": {
      border: `1px solid ${ACCENT}`,
    },
    "& .MuiYearCalendar-button": {
      color: "#111",
    },
    "& .MuiMonthCalendar-button": {
      color: "#111",
    },
    "& .MuiMenuItem-root": {
      color: "#111",
    },
    "& .MuiMenuItem-root.Mui-selected": {
      backgroundColor: "color-mix(in srgb, var(--brand-gold) 15%, transparent)",
      color: ACCENT,
      fontWeight: 600,
    },
    "& .MuiMultiSectionDigitalClock-root": {
      borderBottom: "1px solid rgba(0,0,0,0.08)",
    },
    "& .MuiMultiSectionDigitalClockSection-root": {
      borderLeft: "1px solid rgba(0,0,0,0.08)",
    },
    "& .MuiPickersLayout-actionBar .MuiButton-root": {
      color: ACCENT,
      fontWeight: 600,
    },
    "& .MuiButtonBase-root:focus-visible": {
      outline: `2px solid ${ACCENT}`,
    },
  };
}

function popperSxDark(): SxProps<Theme> {
  const paperBg = "#1c1a2e";
  const text = "rgba(243, 246, 255, 0.96)";
  const muted = "rgba(226, 232, 240, 0.72)";
  return {
    zIndex: PLANNING_DTP_POPPER_Z_INDEX,
    "& .MuiPaper-root": {
      backgroundColor: paperBg,
      color: text,
      borderRadius: "14px",
      boxShadow: "0 20px 48px rgba(0,0,0,0.55)",
      border: "1px solid rgba(255,255,255,0.1)",
      maxWidth: 360,
    },
    "& .MuiPickersLayout-root": {
      backgroundColor: paperBg,
    },
    "& .MuiTypography-root": {
      color: text,
    },
    "& .MuiPickersCalendarHeader-label": {
      color: text,
      fontWeight: 600,
    },
    "& .MuiPickersArrowSwitcher .MuiIconButton-root": {
      color: muted,
    },
    "& .MuiPickersArrowSwitcher .MuiIconButton-root:hover": {
      color: text,
      backgroundColor: "rgba(255,255,255,0.08)",
    },
    "& .MuiPickersCalendarHeader-switchViewButton": {
      color: text,
    },
    "& .MuiDayCalendar-weekDayLabel": {
      color: muted,
      fontWeight: 500,
    },
    "& .MuiPickersDay-root": {
      color: text,
      fontWeight: 500,
    },
    "& .MuiPickersDay-root.Mui-selected": {
      backgroundColor: ACCENT,
      color: "#0b1220",
    },
    "& .MuiPickersDay-root.MuiPickersDay-today": {
      border: `1px solid ${ACCENT}`,
    },
    "& .MuiYearCalendar-button": {
      color: text,
    },
    "& .MuiMonthCalendar-button": {
      color: text,
    },
    "& .MuiMenuItem-root": {
      color: text,
    },
    "& .MuiMenuItem-root.Mui-selected": {
      backgroundColor: "color-mix(in srgb, var(--brand-gold) 20%, transparent)",
      color: ACCENT,
      fontWeight: 600,
    },
    "& .MuiMultiSectionDigitalClock-root": {
      borderBottom: "1px solid rgba(255,255,255,0.1)",
    },
    "& .MuiMultiSectionDigitalClockSection-root": {
      borderLeft: "1px solid rgba(255,255,255,0.1)",
    },
    "& .MuiPickersLayout-actionBar .MuiButton-root": {
      color: ACCENT,
      fontWeight: 600,
    },
    "& .MuiButtonBase-root:focus-visible": {
      outline: `2px solid ${ACCENT}`,
    },
  };
}

/**
 * slotProps pour @mui/x-date-pickers DateTimePicker (planning).
 */
export function buildPlanningDateTimePickerSlotProps(isDark: boolean) {
  const inputColor = isDark ? "#F3F6FF" : "#1a1625";
  return {
    textField: {
      fullWidth: true,
      sx: textFieldSx(inputColor),
    },
    popper: {
      placement: "right-start" as const,
      sx: isDark ? popperSxDark() : popperSxLight(),
    },
  };
}
