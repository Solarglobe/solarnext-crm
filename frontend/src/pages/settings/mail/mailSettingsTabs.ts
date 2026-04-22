export const MAIL_SETTINGS_TAB_IDS = ["accounts", "signatures", "templates", "access"] as const;

export type MailSettingsTabId = (typeof MAIL_SETTINGS_TAB_IDS)[number];

export function parseMailSettingsTab(raw: string | null): MailSettingsTabId {
  if (raw && (MAIL_SETTINGS_TAB_IDS as readonly string[]).includes(raw)) {
    return raw as MailSettingsTabId;
  }
  return "accounts";
}
