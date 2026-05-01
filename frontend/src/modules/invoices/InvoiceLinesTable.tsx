import React from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { InvoiceLine } from "./invoice.types";
import { computeLineAmounts } from "./invoiceCalc";
import { VAT_OPTIONS } from "../quotes/quoteCalc";

function eur(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function SortableRow({
  line,
  canEdit,
  onChange,
  onRemove,
}: {
  line: InvoiceLine;
  canEdit: boolean;
  onChange: (id: string, patch: Partial<InvoiceLine>) => void;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: line.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const a = computeLineAmounts(line);
  return (
    <tr ref={setNodeRef} style={style} className="qb-line">
      <td className="qb-drag">
        <button type="button" className="qb-drag-handle" disabled={!canEdit} {...attributes} {...listeners} aria-label="Déplacer">
          ⋮⋮
        </button>
      </td>
      <td className="ib-col-type">
        <span className="ib-line-type-pill">{line.type === "catalog" ? "Cat." : "Libre"}</span>
      </td>
      <td className="ib-col-label">
        <input
          className="sn-input qb-line-input ib-line-label-input"
          disabled={!canEdit}
          value={line.label}
          onChange={(e) => onChange(line.id, { label: e.target.value })}
        />
      </td>
      <td className="qb-col-num">
        <input
          className="sn-input qb-line-input qb-line-input--num"
          type="number"
          min={0}
          step={0.01}
          disabled={!canEdit}
          value={line.quantity}
          onChange={(e) => onChange(line.id, { quantity: parseFloat(e.target.value) || 0 })}
        />
      </td>
      <td className="qb-col-num">
        <input
          className="sn-input qb-line-input qb-line-input--num"
          type="number"
          step={0.01}
          disabled={!canEdit}
          value={line.unit_price_ht}
          onChange={(e) => onChange(line.id, { unit_price_ht: parseFloat(e.target.value) || 0 })}
        />
      </td>
      <td className="qb-col-num">
        <input
          className="sn-input qb-line-input qb-line-input--num"
          type="number"
          min={0}
          max={100}
          step={0.25}
          disabled={!canEdit}
          value={line.line_discount_percent}
          onChange={(e) => onChange(line.id, { line_discount_percent: parseFloat(e.target.value) || 0 })}
        />
      </td>
      <td className="qb-col-num">
        <select
          className="sn-input qb-line-input qb-line-input--tva"
          disabled={!canEdit}
          value={line.tva_percent}
          onChange={(e) => onChange(line.id, { tva_percent: parseFloat(e.target.value) })}
        >
          {VAT_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v} %
            </option>
          ))}
        </select>
      </td>
      <td className="qb-num ib-amt">{eur(a.net_ht)}</td>
      <td className="qb-num ib-amt">{eur(a.total_tva)}</td>
      <td className="qb-num ib-amt ib-amt--ttc">{eur(a.total_ttc)}</td>
      <td className="qb-col-act">
        <button
          type="button"
          className="qb-line-remove-btn"
          disabled={!canEdit}
          onClick={() => onRemove(line.id)}
          aria-label="Supprimer la ligne"
          title="Supprimer la ligne"
        >
          ×
        </button>
      </td>
    </tr>
  );
}

export interface InvoiceLinesTableProps {
  lines: InvoiceLine[];
  canEdit: boolean;
  onChangeLine: (id: string, patch: Partial<InvoiceLine>) => void;
  onRemoveLine: (id: string) => void;
  onReorder: (activeId: string, overId: string) => void;
}

export default function InvoiceLinesTable({
  lines,
  canEdit,
  onChangeLine,
  onRemoveLine,
  onReorder,
}: InvoiceLinesTableProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    onReorder(String(active.id), String(over.id));
  };

  const sorted = [...lines].sort((a, b) => a.position - b.position);
  const ids = sorted.map((l) => l.id);

  return (
    <div className="qb-table-wrap qb-table-wrap--framed ib-invoice-lines-wrap">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <table className="qb-table ib-invoice-lines-table">
          <thead>
            <tr>
              <th className="qb-th-drag" />
              <th className="ib-col-type">Type</th>
              <th>Désignation</th>
              <th className="qb-th-num">Qté</th>
              <th className="qb-th-num">PU HT</th>
              <th className="qb-th-num">Rem. %</th>
              <th className="qb-th-num">TVA %</th>
              <th className="qb-th-num">Total HT ligne</th>
              <th className="qb-th-num">TVA ligne</th>
              <th className="qb-th-num">Total TTC ligne</th>
              <th />
            </tr>
          </thead>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <tbody>
              {sorted.map((line) => (
                <SortableRow
                  key={line.id}
                  line={line}
                  canEdit={canEdit}
                  onChange={onChangeLine}
                  onRemove={onRemoveLine}
                />
              ))}
            </tbody>
          </SortableContext>
        </table>
      </DndContext>
      {sorted.length === 0 ? <p className="qb-muted">Aucune ligne — ajoutez depuis le catalogue ou une ligne libre.</p> : null}
    </div>
  );
}
