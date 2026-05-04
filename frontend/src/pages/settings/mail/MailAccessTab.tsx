import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getMailPermissionsMatrix,
  updateMailPermission,
  type MailPermissionsCell,
  type MailPermissionsAccountRow,
  type MailPermissionsUserRow,
} from "../../../services/mailApi";
import { getUserPermissions } from "../../../services/auth.service";
import "../mail-permissions-page.css";

function cellKey(mailAccountId: string, userId: string) {
  return `${mailAccountId}:${userId}`;
}

function mergePermission(
  list: MailPermissionsCell[],
  mailAccountId: string,
  userId: string,
  patch: Partial<MailPermissionsCell>
): MailPermissionsCell[] {
  return list.map((p) =>
    p.mailAccountId === mailAccountId && p.userId === userId ? { ...p, ...patch } : p
  );
}

export function MailAccessTab() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<MailPermissionsAccountRow[]>([]);
  const [users, setUsers] = useState<MailPermissionsUserRow[]>([]);
  const [permissions, setPermissions] = useState<MailPermissionsCell[]>([]);

  const [filterAccount, setFilterAccount] = useState("");
  const [filterUser, setFilterUser] = useState("");

  const [popover, setPopover] = useState<{
    mailAccountId: string;
    userId: string;
    x: number;
    y: number;
  } | null>(null);
  const [draft, setDraft] = useState({ canRead: false, canSend: false, canManage: false });

  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!draft.canRead && (draft.canSend || draft.canManage)) {
      setDraft((d) => ({ ...d, canSend: false, canManage: false }));
    }
  }, [draft.canRead, draft.canSend, draft.canManage]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await getUserPermissions();
        const perms = p.permissions ?? [];
        const ok =
          p.superAdmin === true ||
          perms.includes("*") ||
          perms.includes("mail.accounts.manage");
        if (cancelled) return;
        setAllowed(ok);
        if (!ok) {
          setLoading(false);
          return;
        }
        const data = await getMailPermissionsMatrix();
        if (cancelled) return;
        setAccounts(data.accounts ?? []);
        setUsers(data.users ?? []);
        setPermissions(data.permissions ?? []);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const permMap = useMemo(() => {
    const m = new Map<string, MailPermissionsCell>();
    for (const p of permissions) {
      m.set(cellKey(p.mailAccountId, p.userId), p);
    }
    return m;
  }, [permissions]);

  const filteredAccounts = useMemo(() => {
    const q = filterAccount.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) =>
        a.email.toLowerCase().includes(q) ||
        (a.display_name && a.display_name.toLowerCase().includes(q))
    );
  }, [accounts, filterAccount]);

  const filteredUsers = useMemo(() => {
    const q = filterUser.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        u.label.toLowerCase().includes(q) ||
        (u.first_name && u.first_name.toLowerCase().includes(q)) ||
        (u.last_name && u.last_name.toLowerCase().includes(q))
    );
  }, [users, filterUser]);

  const patchCell = useCallback(
    async (mailAccountId: string, userId: string, next: MailPermissionsCell) => {
      const k = cellKey(mailAccountId, userId);
      setSavingKey(k);
      setError(null);
      try {
        await updateMailPermission({
          mailAccountId,
          userId,
          canRead: next.canRead,
          canSend: next.canSend,
          canManage: next.canManage,
        });
        setPermissions((prev) => mergePermission(prev, mailAccountId, userId, next));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSavingKey(null);
      }
    },
    []
  );

  const toggleRead = useCallback(
    (mailAccountId: string, userId: string) => {
      const p = permMap.get(cellKey(mailAccountId, userId));
      if (!p || p.locked) return;
      const on = !p.canRead;
      void patchCell(mailAccountId, userId, {
        ...p,
        canRead: on,
        canSend: on ? p.canSend : false,
        canManage: on ? p.canManage : false,
      });
    },
    [permMap, patchCell]
  );

  const openPopover = useCallback(
    (e: React.MouseEvent, mailAccountId: string, userId: string) => {
      e.stopPropagation();
      const p = permMap.get(cellKey(mailAccountId, userId));
      if (!p || p.locked) return;
      setDraft({
        canRead: p.canRead,
        canSend: p.canSend,
        canManage: p.canManage,
      });
      setPopover({
        mailAccountId,
        userId,
        x: e.clientX,
        y: e.clientY,
      });
    },
    [permMap]
  );

  useEffect(() => {
    if (!popover) return;
    const onDoc = (ev: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(ev.target as Node)) {
        setPopover(null);
      }
    };
    const t = window.setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [popover]);

  const applyPopover = useCallback(() => {
    if (!popover) return;
    const p = permMap.get(cellKey(popover.mailAccountId, popover.userId));
    if (!p) return;
    let { canRead, canSend, canManage } = draft;
    if (canSend && !canRead) canRead = true;
    if (canManage && !canRead) canRead = true;
    void patchCell(popover.mailAccountId, popover.userId, {
      ...p,
      canRead,
      canSend,
      canManage,
    });
    setPopover(null);
  }, [popover, draft, permMap, patchCell]);

  if (loading) {
    return (
      <div className="mail-perm mail-perm--tab">
        <p>Chargement…</p>
      </div>
    );
  }

  if (allowed === false) {
    return (
      <div className="mail-perm mail-perm--tab">
        <div className="mail-perm__alert">
          Cette page est réservée aux utilisateurs disposant de la permission <strong>mail.accounts.manage</strong> (gestion
          des comptes mail).
        </div>
      </div>
    );
  }

  return (
    <div className="mail-perm mail-perm--tab">
      <div className="mail-perm__header">
        <h2>Accès aux boîtes mail</h2>
        <p>Qui peut lire, envoyer ou gérer les délégations pour chaque compte — vue matrice.</p>
      </div>

      {error ? <div className="mail-perm__error">{error}</div> : null}

      {allowed && !loading && accounts.length === 0 ? (
        <div className="mail-perm__alert">
          Aucun compte mail n’est encore configuré pour cette organisation. Créez un connecteur dans les paramètres
          techniques ou via l’API comptes mail.
        </div>
      ) : null}

      <div className="mail-perm__filters">
        <input
          type="search"
          placeholder="Filtrer les comptes…"
          value={filterAccount}
          onChange={(e) => setFilterAccount(e.target.value)}
          aria-label="Filtrer les comptes"
        />
        <input
          type="search"
          placeholder="Filtrer les utilisateurs…"
          value={filterUser}
          onChange={(e) => setFilterUser(e.target.value)}
          aria-label="Filtrer les utilisateurs"
        />
      </div>

      <div className="mail-perm__scroll">
        {filteredAccounts.length === 0 ? (
          <p style={{ padding: "1rem", margin: 0, color: "var(--sn-text-muted, #64748b)" }}>
            Aucun compte mail ne correspond au filtre.
          </p>
        ) : filteredUsers.length === 0 ? (
          <p style={{ padding: "1rem", margin: 0, color: "var(--sn-text-muted, #64748b)" }}>
            Aucun utilisateur ne correspond au filtre.
          </p>
        ) : null}
        {filteredAccounts.length > 0 && filteredUsers.length > 0 ? (
        <table className="sn-ui-table mail-perm__table">
          <thead>
            <tr>
              <th className="mail-perm__corner">Compte mail</th>
              {filteredUsers.map((u) => (
                <th key={u.id} className="mail-perm__user-head">
                  <span className="mail-perm__user-label" title={u.email}>
                    {u.label}
                  </span>
                  <div className="mail-perm__role-sn-stack">
                    {u.hasViewAll ? <span className="sn-badge sn-badge-success">Accès global</span> : null}
                    {u.hasAccountsManage ? (
                      <span className="sn-badge sn-badge-warn">Gestion boîtes</span>
                    ) : null}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredAccounts.map((acc) => (
              <tr key={acc.id}>
                <td className="mail-perm__account-cell">
                  <div className="mail-perm__account-title" title={acc.email}>
                    {acc.display_name?.trim() || acc.email}
                  </div>
                  <div className="mail-perm__account-sub">{acc.email}</div>
                </td>
                {filteredUsers.map((u) => {
                  const p = permMap.get(cellKey(acc.id, u.id));
                  if (!p) {
                    return (
                      <td key={u.id}>
                        <span aria-hidden>—</span>
                      </td>
                    );
                  }
                  const locked = p.locked != null;
                  const busy = savingKey === cellKey(acc.id, u.id);
                  const hasAccess = p.canRead || p.canSend || p.canManage;
                  return (
                    <td
                      key={u.id}
                      className={[
                        "mail-perm__cell",
                        hasAccess ? "mail-perm__cell--on" : "mail-perm__cell--off",
                        locked ? "mail-perm__cell--locked" : "mail-perm__cell--interactive",
                      ].join(" ")}
                    >
                      <div
                        className="mail-perm__cell-inner"
                        onClick={() => !locked && !busy && toggleRead(acc.id, u.id)}
                        onKeyDown={(ev) => {
                          if (locked || busy) return;
                          if (ev.key === "Enter" || ev.key === " ") {
                            ev.preventDefault();
                            toggleRead(acc.id, u.id);
                          }
                        }}
                        role={locked ? undefined : "button"}
                        tabIndex={locked ? -1 : 0}
                        title={
                          locked
                            ? p.locked === "owner"
                              ? "Propriétaire — accès automatique"
                              : "Accès global (RBAC) — non modifiable ici"
                            : "Clic : activer / désactiver la lecture"
                        }
                      >
                        <span
                          className={["mail-perm__cell-icon", p.canRead ? "mail-perm__cell-icon--on" : ""].join(" ")}
                          title="Lecture"
                          aria-hidden
                        >
                          👁
                        </span>
                        <span
                          className={["mail-perm__cell-icon", p.canSend ? "mail-perm__cell-icon--on" : ""].join(" ")}
                          title="Envoi"
                          aria-hidden
                        >
                          ✉️
                        </span>
                        <span
                          className={["mail-perm__cell-icon", p.canManage ? "mail-perm__cell-icon--on" : ""].join(" ")}
                          title="Gestion des délégations"
                          aria-hidden
                        >
                          ⚙️
                        </span>
                        {!locked ? (
                          <button
                            type="button"
                            className="mail-perm__cell-btn"
                            title="Réglages lecture / envoi / gestion"
                            onClick={(e) => openPopover(e, acc.id, u.id)}
                          >
                            ⋯
                          </button>
                        ) : null}
                        {busy ? <span aria-hidden>…</span> : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        ) : null}
      </div>

      {popover ? (
        <div
          ref={popoverRef}
          className="mail-perm__popover"
          style={{
            left: Math.min(popover.x, window.innerWidth - 220),
            top: Math.min(popover.y + 8, window.innerHeight - 200),
          }}
        >
          <h4>Droits sur la boîte</h4>
          <label>
            <input
              type="checkbox"
              checked={draft.canRead}
              onChange={(e) => setDraft((d) => ({ ...d, canRead: e.target.checked }))}
            />
            Lire
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.canSend}
              onChange={(e) => setDraft((d) => ({ ...d, canSend: e.target.checked }))}
            />
            Envoyer
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.canManage}
              onChange={(e) => setDraft((d) => ({ ...d, canManage: e.target.checked }))}
            />
            Gérer les délégations
          </label>
          <div className="mail-perm__popover-actions">
            <button type="button" onClick={() => setPopover(null)}>
              Annuler
            </button>
            <button type="button" className="primary" onClick={applyPopover}>
              Appliquer
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
