/**
 * Recherche globale CRM — barre visible dans AppLayout (debounce 300ms)
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchGlobalSearch, type GlobalSearchHit } from "../../services/search.service";

const TYPE_LABEL: Record<GlobalSearchHit["type"], string> = {
  lead: "Lead",
  client: "Client",
};

const TYPE_BADGE_CLASS: Record<GlobalSearchHit["type"], string> = {
  lead: "sn-badge sn-badge-neutral",
  client: "sn-badge sn-badge-success",
};

export function GlobalSearchBar() {
  const navigate = useNavigate();
  const inputId = useId();
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<GlobalSearchHit[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (debounced.length < 2) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    const ac = new AbortController();
    setLoading(true);
    setError(null);
    setResults([]);
    fetchGlobalSearch(debounced, ac.signal)
      .then((rows) => {
        setResults(rows);
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === "AbortError") return;
        setResults([]);
        setError(e instanceof Error ? e.message : "Erreur");
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });

    return () => ac.abort();
  }, [debounced]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const onPick = useCallback(
    (id: string) => {
      navigate(`/leads/${id}`);
      setQuery("");
      setDebounced("");
      setResults([]);
      setOpen(false);
    },
    [navigate]
  );

  const showPanel = open && (query.trim().length >= 2 || loading || error !== null);
  const showEmptyNoHit =
    !loading && !error && debounced.length >= 2 && results.length === 0;

  return (
    <div className="sn-global-search" ref={wrapRef}>
      <label htmlFor={inputId} className="sn-global-search__label">
        Recherche globale
      </label>
      <div className="sn-global-search__field">
        <span className="sn-global-search__icon" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          className="sn-global-search__input"
          placeholder="Nom, e-mail, téléphone…"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={showPanel}
          aria-controls={showPanel ? listId : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        {loading ? (
          <span className="sn-global-search__spinner" aria-hidden>
            <span className="sn-global-search__dot" />
          </span>
        ) : (
          <kbd className="sn-global-search__kbd" title="Raccourci : Ctrl+K ou ⌘K (Mac)">
            Ctrl+K
          </kbd>
        )}
      </div>
      {showPanel ? (
        <div
          id={listId}
          className="sn-global-search__panel sn-card"
          role="listbox"
          aria-label="Résultats"
          aria-busy={loading}
        >
          {error ? (
            <p className="sn-global-search__empty" role="alert">
              {error}
            </p>
          ) : null}
          {showEmptyNoHit ? (
            <p className="sn-global-search__empty">Aucun résultat</p>
          ) : null}
          {!error && results.length > 0 ? (
            <ul className="sn-global-search__list">
              {results.map((r) => (
                <li key={`${r.type}-${r.id}`} role="option">
                  <button
                    type="button"
                    className="sn-global-search__item"
                    onClick={() => onPick(r.id)}
                  >
                    <span className="sn-global-search__item-name">{r.full_name || "—"}</span>
                    <span className="sn-global-search__item-meta">
                      {r.email ? <span className="sn-global-search__item-email">{r.email}</span> : null}
                      <span className={TYPE_BADGE_CLASS[r.type]}>{TYPE_LABEL[r.type]}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
