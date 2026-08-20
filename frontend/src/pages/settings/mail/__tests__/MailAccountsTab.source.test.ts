import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../../..");
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("Mail accounts UI source guards", () => {
  it("affiche des actions distinctes pour desactiver, deconnecter, retirer et purger", () => {
    const src = read("pages/settings/mail/MailAccountsTab.tsx");
    expect(src).toContain("Désactiver sync");
    expect(src).toContain("Déconnecter");
    expect(src).toContain("Retirer");
    expect(src).toContain("Purger local");
  });

  it("explique que la purge ne supprime pas la boite distante et exige l'adresse", () => {
    const src = read("pages/settings/mail/MailAccountsTab.tsx");
    expect(src).toContain("supprime uniquement les données du compte dans le CRM");
    expect(src).toContain("ne supprime pas la boîte ni les messages chez Outlook ou votre fournisseur");
    expect(read("services/mailApi.ts")).toContain("confirmationEmail");
    expect(src).toContain("placeholder=\"adresse@domaine.fr\"");
  });

  it("expose AUTH_REQUIRED et masque les credentials en clair", () => {
    const src = read("pages/settings/mail/MailAccountsTab.tsx");
    expect(src).toContain("AUTH_REQUIRED");
    expect(src).toContain("Reconnexion requise");
    expect(src).toContain("••••••••");
    expect(src).not.toContain("encrypted_credentials");
  });

  it("prevoit le compte par defaut et OAuth Microsoft", () => {
    const src = read("pages/settings/mail/MailAccountsTab.tsx");
    expect(src).toContain("Définir par défaut");
    expect(src).toContain("Connecter Microsoft");
    expect(src).toContain("startMicrosoftMailOAuth");
  });
});
