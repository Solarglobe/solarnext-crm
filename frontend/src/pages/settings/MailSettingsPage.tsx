import React, { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  MAIL_SETTINGS_TAB_IDS,
  parseMailSettingsTab,
  type MailSettingsTabId,
} from "./mail/mailSettingsTabs";
import { MailAccountsTab } from "./mail/MailAccountsTab";
import { MailSignaturesTab } from "./mail/MailSignaturesTab";
import { MailTemplatesTab } from "./mail/MailTemplatesTab";
import { MailAccessTab } from "./mail/MailAccessTab";
import "./mail-settings-page.css";

const TAB_LABELS: Record<MailSettingsTabId, string> = {
  accounts: "Comptes",
  signatures: "Signatures",
  templates: "Templates",
  access: "Accès",
};

export default function MailSettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = useMemo(() => parseMailSettingsTab(searchParams.get("tab")), [searchParams]);

  useEffect(() => {
    const raw = searchParams.get("tab");
    const normalized = parseMailSettingsTab(raw);
    if (raw !== normalized) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("tab", normalized);
          return next;
        },
        { replace: true }
      );
    }
  }, [searchParams, setSearchParams]);

  const setTab = useCallback(
    (id: MailSettingsTabId) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("tab", id);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  return (
    <div className="mail-settings">
      <header className="mail-settings__head">
        <h1 className="mail-settings__title">Messagerie</h1>
        <p className="mail-settings__sub">
          Comptes, signatures, modèles et droits d&apos;accès — une vue unique.
        </p>
      </header>
      <nav className="mail-settings__tabs" role="tablist" aria-label="Sections messagerie">
        {MAIL_SETTINGS_TAB_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`mail-settings-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="mail-settings-panel"
            className={`mail-settings__tab${tab === id ? " mail-settings__tab--active" : ""}`}
            onClick={() => setTab(id)}
          >
            {TAB_LABELS[id]}
          </button>
        ))}
      </nav>
      <div
        className="mail-settings__panel"
        role="tabpanel"
        id="mail-settings-panel"
        aria-labelledby={`mail-settings-tab-${tab}`}
      >
        {tab === "accounts" && <MailAccountsTab />}
        {tab === "signatures" && <MailSignaturesTab />}
        {tab === "templates" && <MailTemplatesTab />}
        {tab === "access" && <MailAccessTab />}
      </div>
    </div>
  );
}
