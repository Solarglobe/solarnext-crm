/**
 * Mise à jour d’un message sortant déjà créé (file d’attente) après envoi SMTP réussi ou échec final.
 */

import { getSentFolderId } from "./mailSendPersistence.service.js";
import { rebuildThreadMetadata } from "./mailThreading.service.js";

/**
 * @param {import('pg').PoolClient} client
 * @param {{
 *   organizationId: string,
 *   messageId: string,
 *   threadId: string,
 *   mailAccountId: string,
 *   smtpMessageId: string | null,
 *   sentAt: Date,
 *   providerResponse: string | null,
 * }} p
 */
export async function finalizeOutboundSentInTransaction(client, p) {
  const { organizationId, messageId, threadId, mailAccountId, smtpMessageId, sentAt, providerResponse } = p;
  const folderId = await getSentFolderId(client, { organizationId, mailAccountId });
  await client.query(
    `UPDATE mail_messages SET
      message_id = $2,
      status = 'SENT'::mail_message_status,
      sent_at = $3,
      folder_id = COALESCE($4, folder_id),
      failure_code = NULL,
      failure_reason = NULL,
      provider_response = $5
    WHERE id = $1 AND organization_id = $6`,
    [messageId, smtpMessageId, sentAt, folderId, providerResponse, organizationId]
  );
  await rebuildThreadMetadata({ client, threadId });
}

/**
 * @param {import('pg').PoolClient} client
 * @param {{
 *   organizationId: string,
 *   messageId: string,
 *   threadId: string,
 *   failureCode: string,
 *   failureReason: string,
 *   providerResponse?: string | null,
 * }} p
 */
export async function markOutboundMessageFailedInTransaction(client, p) {
  const { organizationId, messageId, threadId, failureCode, failureReason, providerResponse = null } = p;
  await client.query(
    `UPDATE mail_messages SET
      status = 'FAILED'::mail_message_status,
      failure_code = $2,
      failure_reason = $3,
      provider_response = COALESCE($4, provider_response)
    WHERE id = $1 AND organization_id = $5`,
    [messageId, failureCode, failureReason, providerResponse, organizationId]
  );
  await rebuildThreadMetadata({ client, threadId });
}

/**
 * @param {import('pg').PoolClient} client
 * @param {{ organizationId: string, messageId: string, threadId: string }} p
 */
export async function markOutboundMessageQueuedInTransaction(client, p) {
  const { organizationId, messageId, threadId } = p;
  await client.query(
    `UPDATE mail_messages SET
      status = 'QUEUED'::mail_message_status
    WHERE id = $1 AND organization_id = $2`,
    [messageId, organizationId]
  );
  await rebuildThreadMetadata({ client, threadId });
}
