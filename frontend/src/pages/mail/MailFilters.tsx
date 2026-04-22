import React, { useCallback, useEffect, useRef, useState } from "react";
import type { MailHasReplyFilter, MailThreadTagRow } from "../../services/mailApi";
import { quickSearchClients, quickSearchLeads, type QuickEntityItem } from "../../services/mailApi";

export interface MailFiltersValue {
  tagId: string;
  dateFrom: string;
  dateTo: string;
  hasReply: MailHasReplyFilter;
  clientId: string;
  leadId: string;
}

interface MailFiltersProps {
  mailTags: MailThreadTagRow[];
  value: MailFiltersValue;
  onChange: (next: MailFiltersValue) => void;
  /** `toolbar` = barre horizontale compacte (au-dessus de la liste) */
  layout?: "sidebar" | "toolbar";
}

function useDebounced<T>(value: T, delay: number): T {
  const [d, setD] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setD(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return d;
}

function EntityPicker({
  label,
  labelClassName,
  placeholder,
  selectedId,
  selectedLabel,
  onSelect,
  onClear,
  searchFn,
}: {
  label: string;
  labelClassName?: string;
  placeholder: string;
  selectedId: string;
  selectedLabel: string;
  onSelect: (item: QuickEntityItem) => void;
  onClear: () => void;
  searchFn: (q: string) => Promise<QuickEntityItem[]>;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<QuickEntityItem[]>([]);
  const debounced = useDebounced(q.trim(), 300);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  useEffect(() => {
    if (debounced.length < 2) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void searchFn(debounced)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, searchFn]);

  const showList = open && debounced.length >= 2 && (loading || items.length > 0);

  const lc = labelClassName ?? "mail-inbox__sidebar-title";
  return (
    <div className="mail-filters__entity" ref={rootRef}>
      <label className={lc} htmlFor={`mail-entity-${label}`}>
        {label}
      </label>
      {selectedId ? (
        <div className="mail-filters__entity-picked">
          <span className="mail-filters__entity-picked-label" title={selectedLabel}>
            {selectedLabel}
          </span>
          <button type="button" className="mail-filters__entity-clear" onClick={onClear} aria-label="Effacer">
            ×
          </button>
        </div>
      ) : (
        <>
          <input
            id={`mail-entity-${label}`}
            type="text"
            className="mail-filters__select"
            placeholder={placeholder}
            autoComplete="off"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
          />
          {showList && (
            <ul className="mail-filters__entity-list" role="listbox">
              {loading && <li className="mail-filters__entity-li mail-filters__entity-li--muted">Recherche…</li>}
              {!loading &&
                items.map((it) => (
                  <li key={it.id}>
                    <button
                      type="button"
                      className="mail-filters__entity-opt"
                      onClick={() => {
                        onSelect(it);
                        setQ("");
                        setOpen(false);
                        setItems([]);
                      }}
                    >
                      <span className="mail-filters__entity-opt-name">{it.label}</span>
                      {it.email ? <span className="mail-filters__entity-opt-email">{it.email}</span> : null}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export const MailFilters = React.memo(function MailFilters({
  mailTags,
  value,
  onChange,
  layout = "sidebar",
}: MailFiltersProps) {
  const searchClients = useCallback((q: string) => quickSearchClients(q), []);
  const searchLeads = useCallback((q: string) => quickSearchLeads(q), []);

  const [clientLabelState, setClientLabelState] = useState("");
  const [leadLabelState, setLeadLabelState] = useState("");

  useEffect(() => {
    if (!value.clientId) setClientLabelState("");
  }, [value.clientId]);

  useEffect(() => {
    if (!value.leadId) setLeadLabelState("");
  }, [value.leadId]);

  const onClientSelect = useCallback(
    (item: QuickEntityItem) => {
      setClientLabelState(item.label);
      onChange({ ...value, clientId: item.id });
    },
    [onChange, value]
  );

  const onLeadSelect = useCallback(
    (item: QuickEntityItem) => {
      setLeadLabelState(item.label);
      onChange({ ...value, leadId: item.id });
    },
    [onChange, value]
  );

  const toolbar = layout === "toolbar";
  const lbl = toolbar ? "mail-filters__lbl-toolbar" : "mail-inbox__sidebar-title";

  return (
    <div className={toolbar ? "mail-filters mail-filters--toolbar" : "mail-filters"}>
      {!toolbar ? <p className="mail-inbox__sidebar-title">Filtres</p> : null}

      <div className={toolbar ? "mail-filters__cell" : undefined}>
        <label className={lbl} htmlFor="mail-tag-filter">
          Tags
        </label>
        <select
          id="mail-tag-filter"
          className="mail-filters__select"
          value={value.tagId}
          onChange={(e) => onChange({ ...value, tagId: e.target.value })}
        >
          <option value="">Tous les tags</option>
          {mailTags.map((tg) => (
            <option key={tg.id} value={tg.id}>
              {tg.name}
            </option>
          ))}
        </select>
      </div>

      <div className={`mail-filters__field mail-filters__field--range${toolbar ? " mail-filters__field--toolbar" : ""}`}>
        <label htmlFor="mail-filter-df">Depuis</label>
        <input
          id="mail-filter-df"
          type="date"
          value={value.dateFrom}
          onChange={(e) => onChange({ ...value, dateFrom: e.target.value })}
        />
      </div>
      <div className={`mail-filters__field mail-filters__field--range${toolbar ? " mail-filters__field--toolbar" : ""}`}>
        <label htmlFor="mail-filter-dt">Jusqu’au</label>
        <input
          id="mail-filter-dt"
          type="date"
          value={value.dateTo}
          onChange={(e) => onChange({ ...value, dateTo: e.target.value })}
        />
      </div>

      <div className={toolbar ? "mail-filters__cell" : undefined}>
        <label className={lbl} htmlFor="mail-has-reply">
          Réponse envoyée
        </label>
        <select
          id="mail-has-reply"
          className="mail-filters__select"
          value={value.hasReply}
          onChange={(e) => onChange({ ...value, hasReply: e.target.value as MailHasReplyFilter })}
        >
          <option value="all">Tous</option>
          <option value="yes">Avec réponse</option>
          <option value="no">Sans réponse</option>
        </select>
      </div>

      <EntityPicker
        labelClassName={lbl}
        label="Client"
        placeholder="Rechercher par nom…"
        selectedId={value.clientId}
        selectedLabel={clientLabelState}
        onSelect={onClientSelect}
        onClear={() => {
          setClientLabelState("");
          onChange({ ...value, clientId: "" });
        }}
        searchFn={searchClients}
      />

      <EntityPicker
        labelClassName={lbl}
        label="Lead"
        placeholder="Rechercher par nom…"
        selectedId={value.leadId}
        selectedLabel={leadLabelState}
        onSelect={onLeadSelect}
        onClear={() => {
          setLeadLabelState("");
          onChange({ ...value, leadId: "" });
        }}
        searchFn={searchLeads}
      />
    </div>
  );
});
