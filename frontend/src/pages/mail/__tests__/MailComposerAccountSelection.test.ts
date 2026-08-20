import { describe, expect, it } from "vitest";
import { resolveInitialAccountId } from "../mailComposerAccountSelection";
import type { MailAccountRow } from "../../../services/mailApi";

function account(id: string, opts: Partial<MailAccountRow> = {}): MailAccountRow {
  return {
    id,
    email: `${id}@example.com`,
    capabilities: { state: "CONNECTED", canDisplay: true, canSync: true, canSend: true, canMutate: true, canModify: true, readOnly: false, needsReconnect: false },
    ...opts,
  };
}

describe("MailComposer account selection", () => {
  it("respecte le choix explicite disponible", () => {
    expect(resolveInitialAccountId([account("a"), account("b")], "b")).toBe("b");
  });

  it("utilise le compte d'envoi par defaut si aucun choix explicite", () => {
    expect(resolveInitialAccountId([account("a"), account("b", { is_default_send_account: true })], null)).toBe("b");
  });

  it("ne bascule pas silencieusement vers un compte indisponible", () => {
    expect(
      resolveInitialAccountId(
        [
          account("a", { capabilities: { state: "AUTH_REQUIRED", canDisplay: true, canSync: false, canSend: false, canMutate: false, canModify: true, readOnly: true, needsReconnect: true } }),
          account("b"),
        ],
        "a"
      )
    ).toBe("b");
  });
});
