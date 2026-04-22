/** Toasts légers module Mairies (partagé page + hooks). */
export function showMairieToast(message: string, kind: "ok" | "err") {
  const el = document.createElement("div");
  el.className = `mairie-toast mairie-toast--${kind === "ok" ? "ok" : "err"}`;
  el.setAttribute("role", "alert");
  el.textContent = message;
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 3400);
}
