import type { MailFolderRow } from "../../services/mailApi";

type FolderLike = Pick<MailFolderRow, "name" | "type">;

function normalizeFolderName(name: string | null | undefined): string {
  return (name || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function isMostlyUppercase(value: string): boolean {
  const letters = value.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, "");
  return letters.length > 3 && letters === letters.toUpperCase();
}

function toSoftTitleCase(value: string): string {
  return value
    .toLocaleLowerCase("fr-FR")
    .replace(/(^|[\s'’.-])([a-zà-öø-ÿ])/g, (_match, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase("fr-FR")}`);
}

export function formatMailAccountLabel(displayName: string | null | undefined, fallback?: string | null): string {
  const label = (displayName || fallback || "Compte mail").trim();
  if (!label || label.includes("@")) return label || "Compte mail";
  return isMostlyUppercase(label) ? toSoftTitleCase(label) : label;
}

export function formatMailFolderLabel(folder: FolderLike | null | undefined): string {
  if (!folder) return "Mail";

  const rawName = folder.name?.trim() || "";
  const normalized = normalizeFolderName(rawName);

  if (folder.type === "INBOX" || normalized === "inbox") return "Boîte de réception";
  if (folder.type === "SENT" || normalized === "sent" || normalized === "sentitems") return "Envoyés";
  if (folder.type === "TRASH" || normalized === "trash" || normalized === "deleteditems") return "Corbeille";
  if (folder.type === "JUNK" || normalized === "spam" || normalized === "junk" || normalized === "junkemail") {
    return "Courrier indésirable";
  }
  if (folder.type === "ARCHIVE" || normalized === "archive" || normalized === "archives") return "Archives";
  if (folder.type === "DRAFT") {
    if (normalized === "draft" || normalized === "drafts") return "Brouillons serveur";
    return "Brouillons";
  }

  if (normalized === "socialnetworks" || normalized === "social") return "Réseaux sociaux";
  if (normalized === "promotions") return "Promotions";
  if (normalized === "newsletters" || normalized === "newsletter") return "Newsletters";
  if (normalized === "outbox") return "Boîte d’envoi";

  return rawName || "Dossier mail";
}
