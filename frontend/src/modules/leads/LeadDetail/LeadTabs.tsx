/**
 * CP-LEAD-V3 — Onglets premium
 */

import React from "react";
import { ALL_TABS, type LeadTabId } from "./constants";

export type { LeadTabId };

const TAB_LABELS: Record<LeadTabId, string> = {
  overview: "Vue générale",
  studies: "Études",
  notes: "Notes",
  rdv: "Rendez-vous",
  history: "Historique",
  documents: "Documents",
  financial: "Financier",
};

export type TabCounts = Partial<Record<LeadTabId, number>>;

interface LeadTabsProps {
  activeTab: LeadTabId;
  onTabChange: (tab: LeadTabId) => void;
  children: React.ReactNode;
  tabCounts?: TabCounts;
}

export default function LeadTabs({ activeTab, onTabChange, children, tabCounts }: LeadTabsProps) {
  if (!Array.isArray(ALL_TABS)) {
    return null;
  }

  return (
    <div className="crm-lead-tabs-wrap">
      <nav className="crm-lead-tabs-nav" role="tablist" aria-label="Sections de la fiche">
        {ALL_TABS.map((tab) => {
          const count = tabCounts?.[tab];
          const showCount =
            typeof count === "number" && count > 0 && tab !== "overview" && tab !== "financial";
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              id={`lead-tab-${tab}`}
              className={`crm-lead-tab ${activeTab === tab ? "crm-lead-tab-active" : ""}`}
              onClick={() => onTabChange(tab)}
            >
              {TAB_LABELS[tab]}
              {showCount ? <span className="crm-lead-tab-count">{count > 99 ? "99+" : count}</span> : null}
            </button>
          );
        })}
      </nav>
      <div
        className="crm-lead-tabs-content"
        role="tabpanel"
        aria-labelledby={`lead-tab-${activeTab}`}
      >
        {children}
      </div>
    </div>
  );
}
