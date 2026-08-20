import { useEffect } from "react";
import type React from "react";

export const MAIL_COMPOSER_COMMAND_EVENT = "solarnext:mail-composer-command";

export type MailKeyboardComposerMode = "reply" | "forward";

export interface MailKeyboardShortcutHandlers {
  rootRef: React.RefObject<HTMLElement>;
  enabled: boolean;
  hasDialogOpen: boolean;
  hasSelectedThread: boolean;
  onMoveSelection: (delta: -1 | 1) => void;
  onOpenSelected: () => void;
  onArchiveSelected: () => void;
  onTrashSelected: () => void;
  onToggleUnreadSelected: () => void;
  onEscape: () => void;
}

export function isMailShortcutEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    target.isContentEditable ||
    target.closest('[contenteditable="true"], [role="textbox"]') != null
  );
}

export function mailShortcutActionForKey(key: string): "prev" | "next" | "open" | "reply" | "forward" | "archive" | "trash" | "toggleUnread" | "escape" | null {
  const k = key.toLowerCase();
  if (key === "ArrowUp" || k === "k") return "prev";
  if (key === "ArrowDown" || k === "j") return "next";
  if (key === "Enter") return "open";
  if (k === "r") return "reply";
  if (k === "f") return "forward";
  if (k === "e") return "archive";
  if (key === "Delete" || key === "Backspace") return "trash";
  if (k === "u") return "toggleUnread";
  if (key === "Escape") return "escape";
  return null;
}

export function dispatchMailComposerCommand(mode: MailKeyboardComposerMode): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MAIL_COMPOSER_COMMAND_EVENT, { detail: { mode } }));
}

export function useMailKeyboardShortcuts({
  rootRef,
  enabled,
  hasDialogOpen,
  hasSelectedThread,
  onMoveSelection,
  onOpenSelected,
  onArchiveSelected,
  onTrashSelected,
  onToggleUnreadSelected,
  onEscape,
}: MailKeyboardShortcutHandlers) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const root = rootRef.current;
      if (!root) return;
      const active = document.activeElement;
      if (active && active !== document.body && !root.contains(active)) return;
      if (isMailShortcutEditableTarget(event.target)) return;
      const action = mailShortcutActionForKey(event.key);
      if (!action) return;
      if (hasDialogOpen && action !== "escape") return;

      event.preventDefault();
      if (action === "prev") onMoveSelection(-1);
      else if (action === "next") onMoveSelection(1);
      else if (action === "open") onOpenSelected();
      else if (action === "reply" && hasSelectedThread) dispatchMailComposerCommand("reply");
      else if (action === "forward" && hasSelectedThread) dispatchMailComposerCommand("forward");
      else if (action === "archive" && hasSelectedThread) onArchiveSelected();
      else if (action === "trash" && hasSelectedThread) onTrashSelected();
      else if (action === "toggleUnread" && hasSelectedThread) onToggleUnreadSelected();
      else if (action === "escape") onEscape();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    enabled,
    hasDialogOpen,
    hasSelectedThread,
    rootRef,
    onMoveSelection,
    onOpenSelected,
    onArchiveSelected,
    onTrashSelected,
    onToggleUnreadSelected,
    onEscape,
  ]);
}
