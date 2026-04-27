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
import type { QuoteLine } from "./quote.types";
import { VAT_OPTIONS, computeLineAmounts } from "./quoteCalc";
import { QUOTE_CATALOG_DESCRIPTION_MAX_CHARS } from "../../services/admin.api";
import LocaleNumberInput from "./LocaleNumberInput";

function eur(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function SortableRow({
  line,
  canEdit,
  docShowLinePricing,
  onChange,
  onRemove,
}: {
  line: QuoteLine;
  canEdit: boolean;
  docShowLinePricing: boolean;
  onChange: (id: string, patch: Partial<QuoteLine>) => void;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: line.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const a = computeLineAmounts(line);
  const hidePrices = !docShowLinePricing ? " qb-line-cell--doc-hidden" : "";
  return (
    <tr ref={setNodeRef} style={style} className="qb-line">
      <td className="qb-col-drag">
        <button type="button" className="qb-drag-handle" disabled={!canEdit} {...attributes} {...listeners} aria-label="Déplacer la ligne">
          ⋮⋮
        </button>
      </td>
      <td className="qb-col-label">
        <input
          className="sn-input qb-line-input"
          disabled={!canEdit}
          value={line.label}
          onChange={(e) => onChange(line.id, { label: e.target.value })}
          aria-label="Libellé"
        />
      </td>
      <td className="qb-col-ref">
        <input
          className="sn-input qb-line-input"
          disabled={!canEdit}
          value={line.reference ?? ""}
          onChange={(e) => onChange(line.id, { reference: e.target.value.slice(0, 120) })}
          placeholder="Réf."
          aria-label="Référence"
        />
      </td>
      <td className="qb-col-desc">
        <textarea
          className="sn-input qb-line-input qb-line-input--textarea"
          disabled={!canEdit}
          rows={5}
          maxLength={QUOTE_CATALOG_DESCRIPTION_MAX_CHARS}
          value={line.description ?? ""}
          onChange={(e) => onChange(line.id, { description: e.target.value })}
          placeholder="Description client (optionnel)"
          aria-label="Description"
        />
      </td>
      <td className="qb-col-qty qb-col-num">
        <LocaleNumberInput
          className="sn-input qb-line-input qb-line-input--num"
          min={0}
          disabled={!canEdit}
          value={line.quantity}
          onChange={(n) => onChange(line.id, { quantity: n })}
          maximumFractionDigits={2}
          aria-label="Quantité"
        />
      </td>
      <td className={`qb-col-pu qb-col-num${hidePrices}`}>
        <LocaleNumberInput
          className="sn-input qb-line-input qb-line-input--num"
          disabled={!canEdit}
          value={line.unit_price_ht}
          onChange={(n) => onChange(line.id, { unit_price_ht: n })}
          minimumFractionDigits={2}
          maximumFractionDigits={2}
          aria-label="Prix unitaire HT"
        />
      </td>
      <td className={`qb-col-rem qb-col-num${hidePrices}`}>
        <LocaleNumberInput
          className="sn-input qb-line-input qb-line-input--num"
          min={0}
          max={100}
          disabled={!canEdit}
          value={line.line_discount_percent}
          onChange={(n) => onChange(line.id, { line_discount_percent: n })}
          maximumFractionDigits={2}
          aria-label="Remise ligne %"
        />
      </td>
      <td className={`qb-col-tvasel${hidePrices}`}>
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
      <td className={`qb-col-ttc qb-num${hidePrices}`}>{eur(a.total_ttc)}</td>
      <td className="qb-col-act">
        <button
          type="button"
          className="qb-line-remove-btn"
          disabled={!canEdit}
          onClick={() => onRemove(line.id)}
          aria-label="Retirer la ligne"
          title="Retirer la ligne"
        >
          ×
        </button>
      </td>
    </tr>
  );
}

export interface QuoteLinesTableProps {
  lines: QuoteLine[];
  canEdit: boolean;
  /** Aligné sur metadata_json.pdf_show_line_pricing — masque visuellement les colonnes « document client ». */
  docShowLinePricing: boolean;
  onChangeLine: (id: string, patch: Partial<QuoteLine>) => void;
  onRemoveLine: (id: string) => void;
  onReorder: (activeId: string, overId: string) => void;
}

export default function QuoteLinesTable({
  lines,
  canEdit,
  docShowLinePricing,
  onChangeLine,
  onRemoveLine,
  onReorder,
}: QuoteLinesTableProps) {
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

  const tableClass = `qb-table qb-lines-edit${!docShowLinePricing ? " qb-lines-edit--doc-hide-pricing" : ""}`;

  if (sorted.length === 0) {
    return (
      <div className="qb-lines-empty" role="status">
        <p className="qb-lines-empty-title">Aucune ligne pour l’instant</p>
        <p className="qb-lines-empty-text">
          Ajoutez des modules catalogue, des prestations libres ou importez le chiffrage technique depuis une étude liée.
        </p>
      </div>
    );
  }

  return (
    <div className="qb-table-wrap qb-table-wrap--framed">
      {!docShowLinePricing ? (
        <p className="qb-lines-doc-banner">
          <strong>Mode document condensé</strong> — les colonnes grisées (PU HT, remise, TVA, total TTC ligne) servent au
          calcul interne mais ne seront pas imprimées sur le PDF client.
        </p>
      ) : null}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <table className={tableClass}>
          <colgroup>
            <col className="qb-col-drag" />
            <col className="qb-col-label" />
            <col className="qb-col-ref" />
            <col className="qb-col-desc" />
            <col className="qb-col-qty" />
            <col className="qb-col-pu" />
            <col className="qb-col-rem" />
            <col className="qb-col-tvasel" />
            <col className="qb-col-ttc" />
            <col className="qb-col-act" />
          </colgroup>
          <thead>
            <tr>
              <th className="qb-th-drag" aria-hidden />
              <th>Libellé</th>
              <th>Réf.</th>
              <th>Description</th>
              <th className="qb-th-num">Qté</th>
              <th className="qb-th-num">PU HT</th>
              <th className="qb-th-num">Rem. %</th>
              <th>TVA</th>
              <th className="qb-th-num">TTC ligne</th>
              <th className="qb-th-actions" />
            </tr>
          </thead>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <tbody>
              {sorted.map((line) => (
                <SortableRow
                  key={line.id}
                  line={line}
                  canEdit={canEdit}
                  docShowLinePricing={docShowLinePricing}
                  onChange={onChangeLine}
                  onRemove={onRemoveLine}
                />
              ))}
            </tbody>
          </SortableContext>
        </table>
      </DndContext>
    </div>
  );
}
