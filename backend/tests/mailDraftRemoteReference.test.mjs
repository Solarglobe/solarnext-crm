import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { simpleParser } from 'mailparser';
import { buildSimpleRfc822Mime } from '../services/mail/mailMimeBuilder.service.js';

// Provider implementation is real, transport is memory only (no db.js import).
const source = readFileSync(new URL('../services/mail/mailImapDraftProvider.service.js', import.meta.url), 'utf8')
  .replace(/^import\s+[\s\S]*?\s+from\s+["'][^"']+["'];?\r?$/gm, '')
  .replace(/^export (?=(?:async )?function\b)/gm, '');
const { appendDraftWithClient, deleteDraftWithClient } = vm.runInNewContext(`${source}\n({ appendDraftWithClient, deleteDraftWithClient })`, { simpleParser, Error, Buffer, Date });

function client({ uidValidity = 'uv-A', draftIdentity = 'generation-A', messageId = '<draft-A@test>', exists = true } = {}) {
  const calls = [];
  return {
    calls, mailbox: { uidValidity },
    async mailboxOpen(path) { calls.push(['SELECT', path]); return { uidValidity }; },
    async *fetch(uid) {
      calls.push(['FETCH', uid]);
      if (exists) yield { uid: Number(uid), source: buildSimpleRfc822Mime({ messageId, draftIdentity, subject: 'fixture' }) };
    },
    async messageDelete(uid, opts) { calls.push(['DELETE', uid, opts.uid]); },
    async append(path) { calls.push(['APPEND', path]); return { uid: 43, uidValidity }; },
  };
}
const reference = { folderPath: 'A Drafts', uid: 42, expectedUidValidity: 'uv-A', draftIdentity: 'generation-A', messageId: '<draft-A@test>' };
const noDelete = imap => assert.equal(imap.calls.some(call => call[0] === 'DELETE'), false);

test('refuses a UID without a mailbox generation and message identity', async () => {
  const imap = client();
  await assert.rejects(() => deleteDraftWithClient(imap, { folderPath: 'Drafts', uid: 42 }), { code: 'DRAFT_REMOTE_REFERENCE_MISMATCH' });
  assert.deepEqual(imap.calls, []);
});

test('never deletes a reused UID after UIDVALIDITY changes', async () => {
  const imap = client({ uidValidity: 'reset-generation' });
  await assert.rejects(() => deleteDraftWithClient(imap, reference), { code: 'DRAFT_REMOTE_REFERENCE_MISMATCH' });
  noDelete(imap);
});

test('same UID and UIDVALIDITY in another mailbox cannot authorize an unrelated message', async () => {
  const imap = client({ draftIdentity: 'unrelated-B', messageId: '<unrelated-B@test>' });
  await assert.rejects(() => deleteDraftWithClient(imap, reference), { code: 'DRAFT_REMOTE_REFERENCE_MISMATCH' });
  noDelete(imap);
});

test('deletes an external Outlook draft without X-id only with its exact Message-ID', async () => {
  const imap = client({ draftIdentity: null, messageId: '<outlook-draft@test>' });
  const result = await deleteDraftWithClient(imap, { ...reference, messageId: '<outlook-draft@test>' });
  assert.equal(result.deleted, true);
  assert.deepEqual(imap.calls.filter(call => call[0] === 'DELETE'), [['DELETE', '42', true]]);
});

test('does not fall back to an absent identity on a draft without X-id or Message-ID', async () => {
  const imap = client({ draftIdentity: null, messageId: '<other@test>' });
  await assert.rejects(() => deleteDraftWithClient(imap, { ...reference, messageId: null }), { code: 'DRAFT_REMOTE_REFERENCE_MISMATCH' });
  noDelete(imap);
});

test('permissions can veto the final DELETE after fetching the matching message', async () => {
  const imap = client();
  await assert.rejects(() => deleteDraftWithClient(imap, { ...reference, beforeDelete: async () => { throw new Error('permission revoked'); } }), /permission revoked/);
  assert.ok(imap.calls.some(call => call[0] === 'FETCH')); noDelete(imap);
});

test('permissions can veto APPEND after opening the selected folder', async () => {
  const imap = client();
  await assert.rejects(() => appendDraftWithClient(imap, { folderPath: 'A Drafts', mime: Buffer.from('synthetic'), beforeAppend: async () => { throw new Error('permission revoked'); } }), /permission revoked/);
  assert.equal(imap.calls.some(call => call[0] === 'APPEND'), false);
});

test('a message already absent is idempotent without issuing DELETE', async () => {
  const imap = client({ exists: false });
  const result = await deleteDraftWithClient(imap, reference);
  assert.equal(result.alreadyGone, true); noDelete(imap);
});
