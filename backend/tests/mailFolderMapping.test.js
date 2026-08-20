import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyMailboxType,
  collectMailboxesFromList,
  normalizeMailboxEntry,
} from "../services/mail/imap.mailbox-map.js";

describe("mail folder mapping", () => {
  it("mappe les dossiers speciaux par specialUse avant le nom", () => {
    assert.equal(classifyMailboxType({ path: "My Sent Copy", specialUse: "\\Archive" }), "ARCHIVE");
    assert.equal(classifyMailboxType({ path: "Courrier indesirable", specialUse: "\\Junk" }), "JUNK");
    assert.equal(classifyMailboxType({ path: "Bin", specialUse: "\\Trash" }), "TRASH");
  });

  it("reconnait Outlook francais et anglais sans specialUse", () => {
    assert.equal(classifyMailboxType({ path: "Elements envoyes" }), "SENT");
    assert.equal(classifyMailboxType({ path: "Éléments envoyés" }), "SENT");
    assert.equal(classifyMailboxType({ path: "Sent Items" }), "SENT");
    assert.equal(classifyMailboxType({ path: "Courrier indésirable" }), "JUNK");
    assert.equal(classifyMailboxType({ path: "Deleted Items" }), "TRASH");
  });

  it("reconnait Gmail et les dossiers archives", () => {
    assert.equal(classifyMailboxType({ path: "[Gmail]/All Mail" }), "ARCHIVE");
    assert.equal(classifyMailboxType({ path: "[Gmail]/Spam" }), "JUNK");
    assert.equal(classifyMailboxType({ path: "[Gmail]/Trash" }), "TRASH");
  });

  it("conserve les dossiers personnalises et imbriques", () => {
    const entry = normalizeMailboxEntry({
      path: "Clients/2026/Prospects",
      delimiter: "/",
      flags: [],
    });
    assert.equal(entry.type, "CUSTOM");
    assert.equal(entry.name, "Prospects");
    assert.equal(entry.parent_path, "Clients/2026");
    assert.equal(entry.depth, 2);
    assert.equal(entry.selectable, true);
  });

  it("gere les separateurs differents et \\Noselect", () => {
    const folders = collectMailboxesFromList([
      { path: "Root.Child", delimiter: ".", flags: ["\\Noselect"] },
      { path: "Root.Child.Inbox", delimiter: "." },
      { path: "Root.Child.Inbox", delimiter: "." },
    ]);
    assert.equal(folders.length, 2);
    assert.equal(folders[0].selectable, false);
    assert.equal(folders[0].parent_path, "Root");
    assert.equal(folders[1].name, "Inbox");
  });
});
