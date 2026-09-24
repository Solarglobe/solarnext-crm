import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Run the production provider with a synthetic transport, without db.js imports.
const source = readFileSync(new URL("../services/mail/mailImapMoveProvider.service.js", import.meta.url), "utf8")
  .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "").replace(/^export\s+/gm, "");
const { applyMoveWithClient } = vm.runInNewContext(`${source}\n;({applyMoveWithClient})`, { Error, Set, String, Number });

function client(uidValidity, capabilities = ["MOVE","UIDPLUS"]) {
  const calls = [];
  return {
    calls, capabilities: new Set(capabilities),
    async mailboxOpen() { calls.push("open"); return {uidValidity,highestModseq:null}; },
    async *fetch() { calls.push("fetch"); yield {uid:42,flags:[]}; },
    async messageMove() { calls.push("move"); return {uidValidity:30n,uidMap:new Map([[42,15]])}; },
    async messageCopy() { calls.push("copy"); return {uidValidity:30n,uidMap:new Map([[42,15]])}; },
    async messageDelete() { calls.push("delete"); return true; },
  };
}

for (const hardDelete of [false,true]) for (const [label, expectedUidValidity, remoteUidValidity] of [
  ["null reference",null,"20"], ["absent reference",undefined,"20"],
  ["absent remote namespace","20",null], ["different namespace","10","20"],
]) test(`M1 ${hardDelete ? "HARD_DELETE" : "MOVE"} refuses ${label} before reading or touching a reused UID`, async () => {
  const imap = client(remoteUidValidity);
  await assert.rejects(applyMoveWithClient(imap,{sourcePath:"INBOX",sourceUid:42,expectedUidValidity,
    targetPath:"Archive",hardDelete,sourceIsTrash:true}), {code:"UIDVALIDITY_CHANGED"});
  assert.deepEqual(imap.calls,["open"]);
});

for (const [name, hardDelete, capabilities, expectedCalls] of [
  ["MOVE",false,["MOVE","UIDPLUS"],["open","fetch","move"]],
  ["COPY and targeted delete",false,["UIDPLUS"],["open","fetch","copy","delete"]],
  ["HARD_DELETE",true,["UIDPLUS"],["open","fetch","delete"]],
]) test(`M1 known namespace keeps ordinary IMAP ${name} compatible without MODSEQ`, async () => {
  const imap = client(20n,capabilities);
  const result = await applyMoveWithClient(imap,{sourcePath:"Trash",sourceUid:42,expectedUidValidity:"20",
    targetPath:"Archive",hardDelete,sourceIsTrash:true});
  assert.equal(result.source.uidValidity,"20");
  assert.deepEqual(imap.calls,expectedCalls);
});
