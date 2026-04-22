/**
 * État liste mairies : filtres, pagination, tri par défaut usage récent.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchMairiesList,
  type MairieDto,
  type MairiesListQuery,
} from "../../../services/mairies.api";

export const PAGE_LIMIT = 25;

/** API : tri par last_used_at décroissant (puis tie-break m.id côté serveur). */
const DEFAULT_LIST_QUERY: Pick<MairiesListQuery, "sort" | "order"> = {
  sort: "last_used_at",
  order: "desc",
};

export function useMairies(listMode: boolean) {
  const [list, setList] = useState<MairieDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [accountStatus, setAccountStatus] = useState("");
  const [portalType, setPortalType] = useState("");
  const [postalFilter, setPostalFilter] = useState("");
  const [cityFilter, setCityFilter] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), 400);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const patchRow = useCallback((id: string, patch: Partial<MairieDto>) => {
    setList((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const query: MairiesListQuery = {
        page,
        limit: PAGE_LIMIT,
        ...DEFAULT_LIST_QUERY,
      };
      if (debouncedSearch) query.q = debouncedSearch;
      if (accountStatus) query.account_status = accountStatus;
      if (portalType) query.portal_type = portalType;
      const pc = postalFilter.trim();
      if (pc) query.postal_code = pc;
      const cv = cityFilter.trim();
      if (cv) query.city = cv;

      const res = await fetchMairiesList(query);
      setList(res.items ?? []);
      setTotal(typeof res.total === "number" ? res.total : 0);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Erreur");
      setList([]);
      setTotal(0);
    } finally {
      setListLoading(false);
    }
  }, [page, debouncedSearch, accountStatus, portalType, postalFilter, cityFilter]);

  useEffect(() => {
    if (!listMode) return;
    void loadList();
  }, [listMode, loadList]);

  const hasActiveFilters = useMemo(() => {
    return Boolean(
      debouncedSearch || accountStatus || portalType || postalFilter.trim() || cityFilter.trim()
    );
  }, [debouncedSearch, accountStatus, portalType, postalFilter, cityFilter]);

  const resetFilters = useCallback(() => {
    setSearchInput("");
    setDebouncedSearch("");
    setAccountStatus("");
    setPortalType("");
    setPostalFilter("");
    setCityFilter("");
    setPage(1);
  }, []);

  return {
    list,
    total,
    page,
    setPage,
    listLoading,
    listError,
    searchInput,
    setSearchInput,
    debouncedSearch,
    accountStatus,
    setAccountStatus,
    portalType,
    setPortalType,
    postalFilter,
    setPostalFilter,
    cityFilter,
    setCityFilter,
    loadList,
    patchRow,
    hasActiveFilters,
    resetFilters,
  };
}
