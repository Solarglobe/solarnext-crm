import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd(), "frontend");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("mail phase 5 source audit", () => {
  it("AppLayout centralise le badge global non lu sur l'entrée Mail", () => {
    const layout = read("src/layout/AppLayout.tsx");
    const store = read("src/pages/mail/mailUnreadStore.tsx");
    expect(layout).toContain("MailUnreadSummaryProvider");
    expect(layout).toContain("MailSidebarUnreadBadge");
    expect(layout).toContain("Boite mail");
    expect(store).toContain('getInboxUnreadSummary({ mailbox: "inbox" })');
    expect(store).toContain("REFRESH_INTERVAL_MS = 55_000");
    expect(store).toContain('window.addEventListener("focus"');
  });

  it("MailInboxPage conserve recherche, filtres, tri et conversation dans l'URL", () => {
    const page = read("src/pages/mail/MailInboxPage.tsx");
    const main = read("src/main.tsx");
    expect(page).toContain("parseMailInboxUrlState");
    expect(page).toContain("serializeMailInboxUrlState");
    expect(page).toContain("setSortMode");
    expect(page).toContain("AbortController");
    expect(page).toContain("invalidateMailUnreadSummary");
    expect(read("src/pages/settings/mail/MailAccessTab.tsx")).toContain("invalidateMailUnreadSummary");
    expect(main).toContain('path: "/dev/mail-ui"');
    expect(main).toContain("React.lazy(() => import(\"./pages/mail/MailInboxDemoPage\"))");
    expect(main).not.toContain('import MailInboxDemoPage from "./pages/mail/MailInboxDemoPage"');
  });

  it("Phase 5B expose filtres avances et raccourcis proteges", () => {
    const page = read("src/pages/mail/MailInboxPage.tsx");
    const filters = read("src/pages/mail/MailFilters.tsx");
    const shortcuts = read("src/pages/mail/useMailKeyboardShortcuts.ts");
    const api = read("src/services/mailApi.ts");
    expect(filters).toContain("accountId");
    expect(filters).toContain("Expéditeur");
    expect(filters).toContain("Destinataire");
    expect(page).toContain("resetAllFilters");
    expect(page).toContain("useMailKeyboardShortcuts");
    expect(shortcuts).toContain("isMailShortcutEditableTarget");
    expect(shortcuts).toContain("hasDialogOpen && action !== \"escape\"");
    expect(shortcuts).toContain("!root.contains(active)");
    expect(api).toContain('sp.set("sender"');
    expect(api).toContain('sp.set("recipient"');
  });

  it("le CSS définit les breakpoints desktop, tablette et mobile", () => {
    const css = read("src/pages/mail/mail-inbox.css");
    for (const bp of ["1280px", "1024px", "768px", "430px"]) {
      expect(css).toContain(`max-width: ${bp}`);
    }
  });

  it("la lecture mail affiche le HTML sans mini iframe scrollable", () => {
    const message = read("src/pages/mail/MailThreadMessage.tsx");
    const css = read("src/pages/mail/mail-inbox.css");
    expect(message).not.toContain("<iframe");
    expect(message).not.toContain("srcDoc");
    expect(message).toContain('className="mail-msg__html"');
    expect(message).toContain('role="document"');
    expect(css).not.toContain("mail-msg__html-frame");
    expect(css).toContain(".mail-msg__html :where(table)");
  });
});
