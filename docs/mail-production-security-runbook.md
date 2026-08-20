# Mail Production Security Runbook

## Threat Model

P0:
- Stored XSS from malicious email HTML, signatures, pasted composer HTML, remote drafts, replies or forwards.
- IDOR across organizations/accounts/messages/drafts/attachments.
- SMTP abuse turning a compromised CRM account into a spam relay.
- Token/secret exposure in frontend bundles, logs or provider errors.
- Unsafe attachment opening/sending before security scan.
- SSRF through IMAP/SMTP hosts or any future image proxy.

P1:
- Tracking pixels and remote images leaking IP/user-agent without consent.
- Dangerous links (`javascript:`, `data:`, invisible chars, misleading anchors).
- Path traversal and double-extension attachment tricks.
- Oversized attachments, archive bombs and mailbox volumes exhausting workers.
- Worker starvation by one broken or huge account.
- Failed Sent archival causing unclear delivery state.

P2:
- Unicode/punycode confusion in links.
- Partial history/backfill drift.
- Operational blind spots: queue age, scan backlog, auth errors, stale sync.

## Security Controls

- Render email HTML in sandboxed iframes. No scripts, forms, SVG, objects, embeds, meta refresh, external CSS or event attributes.
- Block HTTP/HTTPS remote images by default. Loading images must be an explicit per-message action.
- Attachments expose scan state. Non-`CLEAN` files must not be opened, downloaded normally, forwarded or sent.
- Production scanners must be explicitly configured. Absence of scanner is `UNAVAILABLE`, never fake `CLEAN`.
- Mail APIs must keep `verifyJWT`, organization scoping, mail permission checks and account accessibility checks.
- Do not log tokens, credentials, MIME bodies, attachment bytes or full provider payloads.

## Alert Thresholds

- No successful sync for 30 minutes on an active account.
- Oldest outbox job age greater than 10 minutes.
- Sent archive pending age greater than 30 minutes.
- Draft sync job age greater than 15 minutes.
- Scan backlog above 100 or any `INFECTED`.
- OAuth/auth errors increasing for the same provider/account.
- Disk growth in mail storage above expected daily envelope.
- Backfill with no progress for 30 minutes.

## Safe Diagnostics

- Check `GET /api/mail/sync/health` as an admin.
- Inspect structured logs by `evt` keys: `MAIL_OUTBOX_*`, `MAIL_DRAFT_*`, `MAIL_SENT_ARCHIVE_*`, `MAIL_SYNC_*`.
- Check queue depths before restarting workers.
- For scan failures, inspect only metadata: status, provider, error code, size, MIME and sanitized filename.

## Safe Actions

- Reconnect an account in Settings > Mail when lifecycle is `AUTH_REQUIRED`.
- Retry sync/backfill only for a known account and bounded folder.
- Pause a persistently failing account before retry storms.
- Quarantine/delete infected files through product-supported cleanup only.

Do not manually delete queue rows, MIME frozen payloads, tombstones or storage folders unless a written recovery plan maps every row and file by organization.

## Deployment Plan

1. Take a PostgreSQL backup and storage snapshot.
2. Verify secret inventory: `MAIL_ENCRYPTION_KEY`, Microsoft client secret, SMTP/IMAP credentials, callback URLs.
3. Run migrations on staging PostgreSQL.
4. Deploy backend with workers disabled or concurrency set to one.
5. Verify `/api/mail/sync/health`.
6. Enable workers gradually: sync, flags, move, drafts, outbox, Sent archive.
7. Deploy frontend.
8. Connect a dedicated test mailbox.
9. Run smoke tests: folder discovery, receive, read/unread, move, draft, SMTP, Sent, attachment.
10. Monitor queues, scan backlog and auth errors for at least one business day.
11. Expand to more accounts progressively.

## Rollback Plan

- Frontend rollback: redeploy previous Vercel build.
- Backend rollback: stop workers first, then deploy previous backend.
- Do not replay queued SMTP jobs blindly. Preserve `mail_outbox.smtp_completed_at`, `provider_message_id` and `stable_message_id`.
- New backend with old frontend is acceptable for read flows; old backend with new schema must be checked in staging first.
- If DB restore is required, stop workers and SMTP before restore.
- Sent archival retries may continue only for rows with `smtp_completed_at` already set.
- Pending move/flag/draft jobs must be preserved unless product owners accept loss of remote sync intent.

## PostgreSQL Validation Command

Use a non-production database:

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/solarnext_mail_staging npm --prefix backend run migrate:up
DATABASE_URL=postgres://user:pass@localhost:5432/solarnext_mail_staging npm --prefix backend run check:schema
DATABASE_URL=postgres://user:pass@localhost:5432/solarnext_mail_staging npm --prefix backend run test:integration
```

Production is not validated until these commands pass against a real PostgreSQL clone or staging service.
