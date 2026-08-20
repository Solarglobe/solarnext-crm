import { describe, expect, it } from "vitest";
import {
  defaultMailInboxUrlState,
  parseMailInboxUrlState,
  serializeMailInboxUrlState,
} from "../mailInboxUrlState";

describe("mail inbox URL state", () => {
  it("représente dossier, conversation, recherche, filtres et tri dans l'URL", () => {
    const parsed = parseMailInboxUrlState(
      "?folder=f-1&thread=t-1&q=devis&mode=unread&sort=oldest&account=a-1&tag=tag-1&from=2026-01-01&to=2026-01-31&sender=alice%40example.test&recipient=bob%40example.test&reply=no&client=c-1&lead=l-1"
    );
    expect(parsed.folderId).toBe("f-1");
    expect(parsed.threadId).toBe("t-1");
    expect(parsed.q).toBe("devis");
    expect(parsed.mode).toBe("unread");
    expect(parsed.sort).toBe("oldest");
    expect(parsed.filters).toMatchObject({
      accountId: "a-1",
      tagId: "tag-1",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      sender: "alice@example.test",
      recipient: "bob@example.test",
      hasReply: "no",
      clientId: "c-1",
      leadId: "l-1",
    });
  });

  it("sérialise uniquement les valeurs utiles", () => {
    const state = defaultMailInboxUrlState();
    state.folderId = "inbox-1";
    state.threadId = "thread-1";
    state.q = " facture ";
    state.mode = "attachments";
    state.filters.accountId = "account-1";
    state.filters.sender = " long.sender@example.test ";
    state.filters.recipient = "recipient@example.test";
    const qs = serializeMailInboxUrlState(state);
    expect(qs).toContain("folder=inbox-1");
    expect(qs).toContain("thread=thread-1");
    expect(qs).toContain("q=facture");
    expect(qs).toContain("mode=attachments");
    expect(qs).toContain("account=account-1");
    expect(qs).toContain("sender=long.sender%40example.test");
    expect(qs).toContain("recipient=recipient%40example.test");
    expect(qs).not.toContain("sort=");
  });

  it("préserve les vues spéciales sans dossier actif", () => {
    const state = defaultMailInboxUrlState();
    state.folderId = "ignored";
    state.drafts = true;
    expect(serializeMailInboxUrlState(state)).toBe("?view=drafts");
    expect(parseMailInboxUrlState("?view=legacy_archive").legacyArchive).toBe(true);
  });
});
