/**
 * Toast court non bloquant — usage impératif (pas de provider global).
 * LOT D planning : remplace createElement ad hoc + CSS de page.
 */

import "./crm-inline-toast.css";

export type CrmInlineToastVariant = "success" | "error";

const EXIT_MS = 200;

export function showCrmInlineToast(
  message: string,
  variant: CrmInlineToastVariant = "success",
  durationMs = 3000,
): void {
  const el = document.createElement("div");
  el.className = `sn-crm-inline-toast sn-crm-inline-toast--${variant}`;
  el.textContent = message;
  el.setAttribute("role", variant === "error" ? "alert" : "status");
  el.setAttribute("aria-live", variant === "error" ? "assertive" : "polite");
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.classList.add("sn-crm-inline-toast--visible");
  });
  window.setTimeout(() => {
    el.classList.remove("sn-crm-inline-toast--visible");
    window.setTimeout(() => el.remove(), EXIT_MS);
  }, durationMs);
}
