/**
 * Vue Kanban Leads — drag & drop (@dnd-kit + sortable)
 * Board à hauteur fixe : scroll horizontal (molette, pan, bords au drag) + scroll vertical par colonne.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  closestCorners,
  defaultDropAnimation,
  pointerWithin,
  useSensor,
  useSensors,
  useDroppable,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS as DndCss } from "@dnd-kit/utilities";
import { LeadCard } from "./LeadCard";
import { getLeadName, updateLeadStage, type Lead } from "../../services/leads.service";
import { ConfirmModal } from "../ui/ConfirmModal";
import { UndoToast } from "../ui/UndoToast";
import { useUndoAction } from "../../hooks/useUndoAction";
import {
  COLUMN_CLASS_BY_CODE,
  getKanbanColumnTitle,
  inferStageCode,
  sortStagesForKanban,
} from "../../modules/leads/kanban-config";

interface Stage {
  id: string;
  name: string;
  position?: number;
  is_closed?: boolean;
  code?: string | null;
}

interface LeadsKanbanViewProps {
  leads: Lead[];
  stages: Stage[];
  /** CP-078B — SUPER_ADMIN mode support : désactive drag + menus d’écriture */
  readOnly?: boolean;
  onLeadMoved: (
    leadId: string,
    newStageId: string
  ) => void | Promise<void>;
  /** Menu carte — archivage (stopPropagation pour ne pas casser le DnD) */
  onArchiveLead?: (leadId: string) => void;
}

function getColumnClass(stage: Stage, index: number): string {
  const base = "sn-leads-kanban-col";
  const code = inferStageCode(stage);
  const extra = code && COLUMN_CLASS_BY_CODE[code] ? COLUMN_CLASS_BY_CODE[code]! : "";
  const pos = stage.position ?? index + 1;
  if (/signé/i.test(stage.name) || code === "SIGNED") {
    return `${base} sn-leads-kanban-col-signed${extra ? ` ${extra}` : ""}`.trim();
  }
  /* Perdu : même base que Offre envoyée (col-4), sans overlay « mort » */
  if (code === "LOST") {
    return `${base} sn-leads-kanban-col-4`.trim();
  }
  /* Contacté : même palette que RDV planifié (col-3) */
  if (code === "CONTACTED") {
    return `${base} sn-leads-kanban-col-3`.trim();
  }
  const colMap: Record<number, string> = {
    1: "sn-leads-kanban-col-1",
    2: "sn-leads-kanban-col-2",
    3: "sn-leads-kanban-col-3",
    4: "sn-leads-kanban-col-4",
    5: "sn-leads-kanban-col-4",
    6: "sn-leads-kanban-col-4",
  };
  const legacy = colMap[pos] ?? "sn-leads-kanban-col-1";
  return `${base} ${legacy}${extra ? ` ${extra}` : ""}`.trim();
}

function isCardOrInteractiveTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return !!el.closest(
    ".sn-leads-kanban-card-wrap, .lead-card, a, button, input, select, textarea, [role='button']"
  );
}

function findStageForLeadId(
  itemsByStage: Record<string, string[]>,
  leadId: string
): string | null {
  for (const [stageId, ids] of Object.entries(itemsByStage)) {
    if (ids.includes(leadId)) return stageId;
  }
  return null;
}

function cloneItemsByStage(
  items: Record<string, string[]>
): Record<string, string[]> {
  const o: Record<string, string[]> = {};
  for (const k of Object.keys(items)) {
    o[k] = [...(items[k] ?? [])];
  }
  return o;
}

/** Cible d’insertion : colonne + index dans la liste après retrait du lead actif. */
type InsertionTarget = { stageId: string; index: number };

function boardEqual(
  a: Record<string, string[]>,
  b: Record<string, string[]>
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const aa = a[k] ?? [];
    const bb = b[k] ?? [];
    if (aa.length !== bb.length) return false;
    for (let i = 0; i < aa.length; i++) {
      if (aa[i] !== bb[i]) return false;
    }
  }
  return true;
}

/**
 * Un seul calcul de plateau à partir du snapshot initial du drag (pas de divergence preview / drop).
 */
function computePlacedState(
  snap: Record<string, string[]>,
  activeId: string,
  targetStageId: string,
  targetIndex: number
): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  for (const k of Object.keys(snap)) {
    next[k] = [...(snap[k] ?? [])].filter((id) => id !== activeId);
  }
  const dest = [...(next[targetStageId] ?? [])];
  const clamped = Math.max(0, Math.min(targetIndex, dest.length));
  dest.splice(clamped, 0, activeId);
  next[targetStageId] = dest;
  return next;
}

function escapeAttr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function leadCardEl(leadId: string): HTMLElement | null {
  return document.querySelector(
    `[data-lead-id="${escapeAttr(leadId)}"]`
  ) as HTMLElement | null;
}

function columnBodyEl(stageId: string): HTMLElement | null {
  return document.querySelector(
    `[data-stage-id="${escapeAttr(stageId)}"] .sn-leads-kanban-col__body`
  ) as HTMLElement | null;
}

/**
 * Index d’insertion dans une colonne à partir du pointeur (haut / entre / bas),
 * en s’appuyant sur les rects des cartes dans l’ordre du snapshot (sans le lead actif).
 */
function insertionIndexInColumn(
  stageId: string,
  snap: Record<string, string[]>,
  activeId: string,
  pointerY: number
): number {
  const ids = snap[stageId] ?? [];
  const without = ids.filter((id) => id !== activeId);
  if (without.length === 0) return 0;

  const body = columnBodyEl(stageId);
  if (!body) return without.length;

  const bodyRect = body.getBoundingClientRect();
  if (pointerY < bodyRect.top) return 0;
  if (pointerY > bodyRect.bottom) return without.length;

  for (let i = 0; i < without.length; i++) {
    const el = leadCardEl(without[i]);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    if (pointerY < mid) return i;
  }
  return without.length;
}

/**
 * Survol d’une carte : moitié haute → avant, moitié basse → après.
 */
function insertionIndexOverCard(
  stageId: string,
  leadId: string,
  snap: Record<string, string[]>,
  activeId: string,
  pointerY: number
): number {
  const ids = snap[stageId] ?? [];
  const without = ids.filter((id) => id !== activeId);
  const idxInWithout = without.indexOf(leadId);
  const el = leadCardEl(leadId);
  if (!el || idxInWithout === -1) {
    return insertionIndexInColumn(stageId, snap, activeId, pointerY);
  }
  const r = el.getBoundingClientRect();
  const mid = r.top + r.height / 2;
  if (pointerY < mid) return idxInWithout;
  return idxInWithout + 1;
}

function resolveInsertionTarget(
  overId: string,
  snap: Record<string, string[]>,
  activeId: string,
  pointer: { x: number; y: number }
): InsertionTarget | null {
  const activeContainer = findStageForLeadId(snap, activeId);
  if (!activeContainer) return null;

  if (overId.startsWith("stage-")) {
    const stageId = overId.replace("stage-", "");
    const index = insertionIndexInColumn(stageId, snap, activeId, pointer.y);
    return { stageId, index };
  }

  const stageId = findStageForLeadId(snap, overId);
  if (!stageId) return null;

  if (overId === activeId) {
    return {
      stageId,
      index: insertionIndexInColumn(stageId, snap, activeId, pointer.y),
    };
  }

  return {
    stageId,
    index: insertionIndexOverCard(stageId, overId, snap, activeId, pointer.y),
  };
}

/**
 * Collision : si carte + colonne se chevauchent, on privilégie la carte (demi-hauteur = intention d’insertion).
 * Sinon colonne seule (gaps, bas / haut de colonne, colonne vide).
 */
const kanbanCollisionDetection: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args);
  if (pointerHits.length > 0) {
    const cards = pointerHits.filter((h) => !String(h.id).startsWith("stage-"));
    const cols = pointerHits.filter((h) => String(h.id).startsWith("stage-"));
    if (cards.length > 0) return [cards[0]];
    if (cols.length > 0) return [cols[0]];
    return pointerHits;
  }
  const corners = closestCorners(args);
  if (corners.length > 0) return corners;
  return closestCenter(args);
};

function DroppableColumn({
  stage,
  index,
  children,
  leadCount,
  isDragTarget,
}: {
  stage: Stage;
  index: number;
  children: React.ReactNode;
  leadCount: number;
  isDragTarget: boolean;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `stage-${stage.id}`,
    data: { type: "column", stageId: stage.id },
  });
  const colState =
    isOver || isDragTarget
      ? " sn-leads-kanban-col--over sn-leads-kanban-col--drag-target"
      : "";
  return (
    <div
      ref={setNodeRef}
      className={`${getColumnClass(stage, index)}${colState}`}
      data-stage-id={stage.id}
    >
      <header className="sn-leads-kanban-col__head">
        <h2 className="sn-leads-kanban-col__title">{getKanbanColumnTitle(stage)}</h2>
        <span className="sn-leads-kanban-col__count" aria-label={`${leadCount} leads`}>
          {leadCount}
        </span>
      </header>
      <div className="sn-leads-kanban-col__body sn-leads-scrollbar">
        {children}
        {leadCount === 0 && (
          <p className="sn-leads-kanban-col__empty">Aucun lead à cette étape</p>
        )}
      </div>
    </div>
  );
}

function SortableLeadCard({
  lead,
  stageIndex,
  pipelineCode,
  onArchive,
  readOnly,
}: {
  lead: Lead;
  stageIndex: number;
  pipelineCode: string | null;
  onArchive?: () => void;
  readOnly?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: lead.id,
    data: { type: "lead", leadId: lead.id },
    disabled: Boolean(readOnly),
  });

  const style: React.CSSProperties = {
    transform: DndCss.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
    opacity: isDragging ? 0.22 : undefined,
    zIndex: isDragging ? 1 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      data-lead-id={lead.id}
      style={style}
      {...listeners}
      {...attributes}
      className={`sn-leads-kanban-card-wrap${isDragging ? " sn-leads-kanban-card-wrap--dragging" : ""}`}
    >
      <LeadCard
        lead={lead}
        stageIndex={stageIndex}
        pipelineCode={pipelineCode}
        onArchive={onArchive}
      />
    </div>
  );
}

const EDGE_PX = 72;
const EDGE_MAX_STEP = 20;

const kanbanDropAnimation = {
  ...defaultDropAnimation,
  duration: 200,
  easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
};

export function LeadsKanbanView({
  leads,
  stages,
  readOnly = false,
  onLeadMoved,
  onArchiveLead,
}: LeadsKanbanViewProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<Record<string, string>>({});
  const [panning, setPanning] = useState(false);
  const [itemsByStage, setItemsByStage] = useState<Record<string, string[]>>({});
  /** Colonne survolée pendant le drag (feedback premium, même si collision = carte). */
  const [dragHighlightStageId, setDragHighlightStageId] = useState<string | null>(
    null
  );
  const [pendingKanbanMove, setPendingKanbanMove] = useState<null | {
    leadId: string;
    targetStageId: string;
    sourceStageId: string;
    snap: Record<string, string[]>;
    next: Record<string, string[]>;
    stageName: string;
    leadName: string;
    stageCode: string | null;
  }>(null);

  const { scheduleUndo, activeToast } = useUndoAction();

  const itemsByStageRef = useRef(itemsByStage);
  itemsByStageRef.current = itemsByStage;

  /** État colonnes au début du drag — seule base pour preview et drop final (pas de divergence). */
  const dragStartSnapshotRef = useRef<Record<string, string[]> | null>(null);
  /** Dernière cible (colonne + index) résolue — même logique qu’au drop ; utilisée si over est null au relâchement. */
  const pendingInsertionRef = useRef<InsertionTarget | null>(null);
  /** Position du pointeur (pour moitié carte / scan colonne). */
  const pointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const scrollRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ startX: number; scrollLeft: number } | null>(null);

  const activeLead = activeId ? leads.find((l) => l.id === activeId) : null;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  const filteredStages = useMemo(
    () =>
      stages.filter(
        (s) =>
          !s.is_closed ||
          /signé/i.test(s.name) ||
          /perdu|lost/i.test(s.name) ||
          s.code === "LOST" ||
          s.code === "SIGNED"
      ),
    [stages]
  );

  const orderedStages = useMemo(
    () => sortStagesForKanban(filteredStages),
    [filteredStages]
  );

  const activeLeads = useMemo(
    () => leads.filter((l) => l.status !== "CLIENT"),
    [leads]
  );

  const stageIdsSerialized = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const s of orderedStages) {
      map[s.id] = activeLeads
        .filter((l) => (optimistic[l.id] ?? l.stage_id) === s.id)
        .map((l) => l.id);
    }
    return JSON.stringify(map);
  }, [orderedStages, activeLeads, optimistic]);

  useEffect(() => {
    if (activeId) return;
    const map = JSON.parse(stageIdsSerialized) as Record<string, string[]>;
    setItemsByStage((prev) => {
      const next: Record<string, string[]> = {};
      for (const stage of orderedStages) {
        const ids = map[stage.id] ?? [];
        const prevList = prev[stage.id] ?? [];
        const idSet = new Set(ids);
        const kept = prevList.filter((id) => idSet.has(id));
        const missing = ids.filter((id) => !kept.includes(id));
        next[stage.id] = [...kept, ...missing];
      }
      return next;
    });
  }, [stageIdsSerialized, orderedStages, activeId]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    pendingInsertionRef.current = null;
    dragStartSnapshotRef.current = cloneItemsByStage(itemsByStageRef.current);
    const ae = event.activatorEvent;
    if (ae && "clientX" in ae) {
      const p = ae as PointerEvent | MouseEvent;
      pointerRef.current = { x: p.clientX, y: p.clientY };
    }
    setActiveId(String(event.active.id));
    setDragHighlightStageId(null);
  }, []);

  const handleDragCancel = useCallback(() => {
    const snap = dragStartSnapshotRef.current;
    dragStartSnapshotRef.current = null;
    pendingInsertionRef.current = null;
    setActiveId(null);
    setDragHighlightStageId(null);
    if (snap) setItemsByStage(cloneItemsByStage(snap));
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    const snap = dragStartSnapshotRef.current;
    if (!snap) return;

    if (!over) {
      return;
    }

    const activeIdStr = String(active.id);
    const overId = String(over.id);
    const ptr = pointerRef.current;

    const target = resolveInsertionTarget(overId, snap, activeIdStr, ptr);
    if (!target) return;

    pendingInsertionRef.current = target;
    setDragHighlightStageId(target.stageId);

    const next = computePlacedState(snap, activeIdStr, target.stageId, target.index);
    setItemsByStage(next);
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      if (readOnly) {
        const snap0 = dragStartSnapshotRef.current;
        dragStartSnapshotRef.current = null;
        pendingInsertionRef.current = null;
        setActiveId(null);
        setDragHighlightStageId(null);
        if (snap0) setItemsByStage(cloneItemsByStage(snap0));
        return;
      }
      const snap = dragStartSnapshotRef.current;
      dragStartSnapshotRef.current = null;

      const { active, over } = event;
      const activeIdStr = String(active.id);
      const ptr = pointerRef.current;

      setActiveId(null);
      setDragHighlightStageId(null);

      if (!snap) {
        pendingInsertionRef.current = null;
        return;
      }

      let target: InsertionTarget | null = null;
      if (over != null) {
        target = resolveInsertionTarget(String(over.id), snap, activeIdStr, ptr);
      }
      if (!target) {
        target = pendingInsertionRef.current;
      }
      pendingInsertionRef.current = null;

      if (!target) {
        setItemsByStage(cloneItemsByStage(snap));
        return;
      }

      const next = computePlacedState(snap, activeIdStr, target.stageId, target.index);

      if (boardEqual(next, snap)) {
        setItemsByStage(cloneItemsByStage(snap));
        return;
      }

      const sourceStage = findStageForLeadId(snap, activeIdStr);
      if (!sourceStage) {
        setItemsByStage(cloneItemsByStage(snap));
        return;
      }

      if (sourceStage === target.stageId) {
        setItemsByStage(next);
        return;
      }

      const lead = leads.find((l) => l.id === activeIdStr);
      if (!lead) {
        setItemsByStage(cloneItemsByStage(snap));
        return;
      }

      setItemsByStage(cloneItemsByStage(snap));
      const tgtMeta = orderedStages.find((s) => s.id === target.stageId);
      setPendingKanbanMove({
        leadId: activeIdStr,
        targetStageId: target.stageId,
        sourceStageId: sourceStage,
        snap,
        next,
        stageName: tgtMeta?.name ?? "Colonne",
        leadName: getLeadName(lead),
        stageCode: tgtMeta ? inferStageCode(tgtMeta) : null,
      });
    },
    [readOnly, leads, orderedStages]
  );

  const confirmKanbanMove = useCallback(async () => {
    if (readOnly) return;
    if (!pendingKanbanMove) return;
    const { leadId, targetStageId, sourceStageId, snap, next, stageCode } = pendingKanbanMove;
    const isConversion = stageCode === "SIGNED";
    setPendingKanbanMove(null);
    setItemsByStage(next);
    setOptimistic((o) => ({ ...o, [leadId]: targetStageId }));
    try {
      await scheduleUndo({
        previousState: snap,
        execute: async () => {
          await updateLeadStage(leadId, targetStageId);
          await Promise.resolve(onLeadMoved(leadId, targetStageId));
        },
        rollback: async () => {
          await updateLeadStage(leadId, sourceStageId);
          setOptimistic((o) => {
            const n = { ...o };
            delete n[leadId];
            return n;
          });
          setItemsByStage(cloneItemsByStage(snap));
          await Promise.resolve(onLeadMoved(leadId, sourceStageId));
        },
        message: isConversion ? "Déplacement vers Signé enregistré" : "Carte déplacée",
      });
    } catch {
      setOptimistic((o) => {
        const n = { ...o };
        delete n[leadId];
        return n;
      });
      setItemsByStage(cloneItemsByStage(snap));
    }
  }, [readOnly, pendingKanbanMove, onLeadMoved, scheduleUndo]);

  const cancelKanbanMove = useCallback(() => {
    setPendingKanbanMove(null);
  }, []);

  /** Pointeur à jour pour resolveInsertionTarget (moitié carte / scan colonne). */
  useEffect(() => {
    if (!activeId) return;
    const onMove = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [activeId]);

  /**
   * Molette : horizontal du board si Shift, ou si le geste est clairement horizontal (trackpad).
   * Sinon le vertical reste natif → scroll du document.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (e.shiftKey) {
        e.preventDefault();
        el.scrollLeft += e.deltaY + e.deltaX;
        return;
      }
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        el.scrollLeft += e.deltaX;
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /** Pan horizontal (fond / en-têtes / marges), pas sur les cartes. */
  useEffect(() => {
    if (!panning) return;

    const onMove = (e: MouseEvent) => {
      const p = panRef.current;
      const el = scrollRef.current;
      if (!p || !el) return;
      el.scrollLeft = p.scrollLeft - (e.clientX - p.startX);
    };

    const onUp = () => {
      panRef.current = null;
      setPanning(false);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [panning]);

  /** Pan tactile sur le fond (hors cartes). */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let start: { x: number; sl: number } | null = null;

    const onStart = (e: TouchEvent) => {
      if (activeId) return;
      if (isCardOrInteractiveTarget(e.target)) return;
      const tgt = e.target as HTMLElement;
      if (tgt.closest(".sn-leads-kanban-col__body")) return;
      if (e.touches.length !== 1) return;
      start = { x: e.touches[0].clientX, sl: el.scrollLeft };
    };

    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 1) return;
      const dx = start.x - e.touches[0].clientX;
      el.scrollLeft = start.sl + dx;
      e.preventDefault();
    };

    const onEnd = () => {
      start = null;
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [activeId]);

  const onBoardMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (activeId) return;
      if (e.button !== 0) return;
      if (isCardOrInteractiveTarget(e.target)) return;
      const tgt = e.target as HTMLElement;
      if (tgt.closest(".sn-leads-kanban-col__body")) return;
      const el = scrollRef.current;
      if (!el) return;
      e.preventDefault();
      panRef.current = { startX: e.clientX, scrollLeft: el.scrollLeft };
      setPanning(true);
    },
    [activeId]
  );

  /** Auto-scroll horizontal au drag près des bords du board. */
  useEffect(() => {
    if (!activeId) return;
    const el = scrollRef.current;
    if (!el) return;

    const onPointerMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX;
      if (x < r.left + EDGE_PX) {
        const k = Math.min((r.left + EDGE_PX - x) / EDGE_PX, 1);
        el.scrollLeft -= EDGE_MAX_STEP * k;
      } else if (x > r.right - EDGE_PX) {
        const k = Math.min((x - (r.right - EDGE_PX)) / EDGE_PX, 1);
        el.scrollLeft += EDGE_MAX_STEP * k;
      }
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, [activeId]);

  const onScrollKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    const step = 120;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      el.scrollLeft -= step;
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      el.scrollLeft += step;
    } else if (e.key === "Home") {
      e.preventDefault();
      el.scrollLeft = 0;
    } else if (e.key === "End") {
      e.preventDefault();
      el.scrollLeft = el.scrollWidth;
    }
  }, []);

  const leadsById = useMemo(() => {
    const m = new Map<string, Lead>();
    for (const l of activeLeads) m.set(l.id, l);
    return m;
  }, [activeLeads]);

  const isEmpty =
    orderedStages.length > 0 && activeLeads.length === 0;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={kanbanCollisionDetection}
      autoScroll={{
        enabled: true,
        threshold: { x: 0.18, y: 0.22 },
        acceleration: 12,
      }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
    >
      <div className="sn-leads-kanban-host">
        <div
          ref={scrollRef}
          className={`sn-leads-kanban-scroll sn-leads-scrollbar${panning ? " sn-leads-kanban-scroll--panning" : ""}`}
          onMouseDown={onBoardMouseDown}
          onKeyDown={onScrollKeyDown}
          tabIndex={0}
          role="region"
          aria-label="Pipeline Kanban — utilisez la molette, les flèches ou faites glisser le fond pour défiler horizontalement"
        >
          <div className="sn-leads-kanban">
            {orderedStages.map((stage, idx) => {
              const ids = itemsByStage[stage.id] ?? [];
              const orderedLeads = ids
                .map((id) => leadsById.get(id))
                .filter((l): l is Lead => Boolean(l));
              const pipelineCode = inferStageCode(stage);
              return (
                <DroppableColumn
                  key={stage.id}
                  stage={stage}
                  index={idx}
                  leadCount={orderedLeads.length}
                  isDragTarget={Boolean(
                    activeId && dragHighlightStageId === stage.id
                  )}
                >
                  <SortableContext
                    items={ids}
                    strategy={verticalListSortingStrategy}
                  >
                    {orderedLeads.map((lead) => (
                      <SortableLeadCard
                        key={lead.id}
                        lead={lead}
                        stageIndex={idx + 1}
                        pipelineCode={pipelineCode}
                        readOnly={readOnly}
                        onArchive={
                          onArchiveLead ? () => onArchiveLead(lead.id) : undefined
                        }
                      />
                    ))}
                  </SortableContext>
                </DroppableColumn>
              );
            })}
          </div>
        </div>

        {isEmpty ? (
          <p className="sn-leads-empty" role="status">
            Aucun lead actif dans le pipeline. Créez un lead ou vérifiez les
            filtres en vue liste.
          </p>
        ) : null}
      </div>

      <ConfirmModal
        open={Boolean(pendingKanbanMove)}
        title={
          pendingKanbanMove?.stageCode === "SIGNED"
            ? "Passer en Signé"
            : "Déplacer la carte"
        }
        message={
          pendingKanbanMove
            ? pendingKanbanMove.stageCode === "SIGNED"
              ? `Placer « ${pendingKanbanMove.leadName} » sur « Signé » ? La fiche client CRM sera créée et le dossier passera en client.`
              : `Envoyer « ${pendingKanbanMove.leadName} » vers « ${pendingKanbanMove.stageName} » ?`
            : ""
        }
        confirmLabel={pendingKanbanMove?.stageCode === "SIGNED" ? "Confirmer" : "Confirmer"}
        cancelLabel="Annuler"
        variant="default"
        onCancel={cancelKanbanMove}
        onConfirm={() => void confirmKanbanMove()}
      />

      {activeToast ? (
        <UndoToast
          message={activeToast.message}
          secondsLeft={activeToast.secondsLeft}
          onUndo={activeToast.onUndo}
          onPauseChange={activeToast.onHoverPause}
        />
      ) : null}

      <DragOverlay dropAnimation={kanbanDropAnimation}>
        {activeLead ? (
          <div className="sn-leads-drag-overlay">
            <LeadCard
              lead={activeLead}
              stageIndex={Math.min(
                Math.max(
                  orderedStages.findIndex(
                    (s) =>
                      s.id ===
                      (optimistic[activeLead.id] ?? activeLead.stage_id)
                  ) + 1,
                  1
                ),
                5
              )}
              pipelineCode={
                (() => {
                  const sid = optimistic[activeLead.id] ?? activeLead.stage_id;
                  const st = orderedStages.find((s) => s.id === sid);
                  return st ? inferStageCode(st) : null;
                })()
              }
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
