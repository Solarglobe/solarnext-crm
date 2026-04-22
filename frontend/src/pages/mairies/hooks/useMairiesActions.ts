/**
 * Actions terrain : touch last_used_at, ouverture portail, changement statut inline.
 */
import { useCallback } from "react";
import {
  updateMairie,
  type MairieAccountStatus,
  type MairieDto,
} from "../../../services/mairies.api";
import { showMairieToast } from "../mairiesToast";

type PatchRow = (id: string, patch: Partial<MairieDto>) => void;

export function useMairiesActions(patchRow: PatchRow) {
  const touchLastUsed = useCallback(
    (id: string) => {
      const iso = new Date().toISOString();
      patchRow(id, { last_used_at: iso });
      void updateMairie(id, { last_used_at: iso }).catch(() => {});
    },
    [patchRow]
  );

  const openPortalTab = useCallback(
    (id: string, href: string) => {
      window.open(href, "_blank", "noopener,noreferrer");
      touchLastUsed(id);
    },
    [touchLastUsed]
  );

  const patchAccountStatusInline = useCallback(
    async (row: MairieDto, next: MairieAccountStatus) => {
      const prev = row.account_status;
      if (prev === next) return;
      patchRow(row.id, { account_status: next });
      try {
        await updateMairie(row.id, { account_status: next });
      } catch (e) {
        patchRow(row.id, { account_status: prev });
        showMairieToast(e instanceof Error ? e.message : "Mise à jour impossible", "err");
      }
    },
    [patchRow]
  );

  return {
    touchLastUsed,
    openPortalTab,
    patchAccountStatusInline,
  };
}
