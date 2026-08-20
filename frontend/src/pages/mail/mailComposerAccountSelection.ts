import type { MailAccountRow } from "../../services/mailApi";

export function resolveInitialAccountId(accounts: MailAccountRow[], preferred: string | null | undefined): string {
  const sendable = accounts.filter((a) => a.capabilities?.canSend !== false);
  if (preferred && sendable.some((a) => a.id === preferred)) return preferred;
  const def = sendable.find((a) => a.is_default_send_account);
  return def?.id ?? sendable[0]?.id ?? "";
}
