import { randomUUID } from 'node:crypto';

export function validSentMessageId(value) {
  const bare = String(value || '').trim().replace(/^<|>$/g, '');
  return /^[^\s<>@]+@[^\s<>@]+$/.test(bare) ? `<${bare}>` : null;
}

export function reserveSentMessageId(value) {
  if (!value) return `<${randomUUID()}@crm.local>`;
  const id = validSentMessageId(value);
  if (!id) throw Object.assign(new Error('Message-ID sortant invalide'), { code: 'INVALID_MESSAGE_ID' });
  return id;
}

// Only the top-level header changes. The body (including binary attachments) is
// preserved byte for byte; no second MIME/identity generator is invoked.
export function alignSentMimeIdentity(mime, messageId) {
  const id = reserveSentMessageId(messageId);
  const bytes = Buffer.from(mime);
  const crlf = bytes.indexOf('\r\n\r\n');
  const split = crlf >= 0 ? crlf : bytes.indexOf('\n\n');
  if (split < 0) throw Object.assign(new Error('MIME sortant invalide'), { code: 'INVALID_SENT_MIME' });
  const header = bytes.subarray(0, split).toString('latin1')
    .replace(/^Message-ID:[^\r\n]*(?:\r?\n[ \t][^\r\n]*)*(?:\r?\n|$)/gim, '');
  return Buffer.concat([Buffer.from(`Message-ID: ${id}\r\n${header}`, 'latin1'), bytes.subarray(split)]);
}

// Shared by delivery and archiving. The reread happens inside this session lock;
// a caller carrying an old job cannot submit or APPEND it a second time.
export async function withMailOutboxLock(pool, job, operation) {
  const client = await pool.connect();
  const key = `mail-outbox:${job.organization_id}:${job.id}`;
  let locked = false, lockAnswered = false, discard;
  try {
    const answer = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [key]);
    lockAnswered = true;
    locked = answer.rows[0]?.locked === true;
    if (!locked) return { skipped: true, code: 'MAIL_OUTBOX_BUSY' };
    return await operation();
  } finally {
    if (!lockAnswered) discard = new Error('Outbox lock acquisition uncertain');
    if (locked) {
      try {
        const answer = await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked', [key]);
        if (answer.rows[0]?.unlocked !== true) discard = new Error('Outbox lock release uncertain');
      } catch (error) { discard = error; }
    }
    client.release(discard);
  }
}
