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

  it("les images distantes bloquées ne créent pas de grands rectangles vides", () => {
    const css = read("src/pages/mail/mail-inbox.css");
    expect(css).toContain(".mail-msg__html :where(img[data-remote-src-blocked])");
    expect(css).toContain("width: auto !important");
    expect(css).toContain("max-width: 220px !important");
    expect(css).toContain("max-height: 40px !important");
    expect(css).not.toContain("width: 100%;\n  min-height: 34px");
  });

  it("la lecture mail affiche les images distantes des messages sortants sans bannière", () => {
    const message = read("src/pages/mail/MailThreadMessage.tsx");
    expect(message).toContain("const shouldAllowRemoteImages = outbound || allowRemoteImages");
    expect(message).toContain("sanitizeMailHtml(raw, { allowRemoteImages: shouldAllowRemoteImages })");
    expect(message).toContain("!outbound && hasBlockedRemoteImages && !allowRemoteImages");
  });

  it("le modèle de signature pro reste compatible clients mail", () => {
    const constants = read("src/pages/mail/mailHtmlEditorConstants.ts");
    expect(constants).toContain("compatible clients mail");
    expect(constants).toContain("border-left:3px solid #C39847");
    expect(constants).not.toContain("placehold.co");
    expect(constants).not.toContain("icons8.com");
  });

  it("le composer remplace l'ancienne signature SolarGlobe fragile avant injection", () => {
    const signature = read("src/pages/mail/mailSignatureHtml.ts");
    const composer = read("src/pages/mail/MailComposer.tsx");
    const robustSignatureHtml = signature.slice(
      signature.indexOf("export const SOLARGLOBE_ROBUST_SIGNATURE_HTML"),
      signature.indexOf("export function hardenMailSignatureHtml")
    );
    expect(signature).toContain("hardenMailSignatureHtml");
    expect(signature).toContain("SOLARGLOBE_ROBUST_SIGNATURE_HTML");
    expect(robustSignatureHtml).toContain("border-left:3px solid #C39847");
    expect(robustSignatureHtml).toContain("logo-solarglobe-rect-pdf.png");
    expect(robustSignatureHtml).toContain("06 69 18 84 03");
    expect(robustSignatureHtml).toContain("facebook-signature.png");
    expect(robustSignatureHtml).toContain("instagram-signature.png");
    expect(signature).toContain("hasFragileRemoteAsset || hasLegacySolarGlobeContent");
    expect(robustSignatureHtml).not.toContain("Nicolas BRUNET");
    expect(robustSignatureHtml).not.toContain("01 72 99 47 53");
    expect(robustSignatureHtml).not.toContain("LinkedIn");
    expect(composer).toContain("hardenMailSignatureHtml");
  });

  it("le composer n'affiche pas une prévisualisation de signature séparée du message", () => {
    const composer = read("src/pages/mail/MailComposer.tsx");
    const css = read("src/pages/mail/mail-composer.css");
    expect(composer).not.toContain("selectedSigPreviewHtml");
    expect(composer).not.toContain("mail-composer__sig-preview");
    expect(css).not.toContain("mail-composer__sig-preview");
  });
});
