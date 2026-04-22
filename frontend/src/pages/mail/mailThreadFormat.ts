export function formatViewerMessageDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {}),
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatAttachmentSize(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function isImageMime(mime: string | null | undefined): boolean {
  if (!mime) return false;
  return /^image\/(jpeg|jpg|png|gif|webp|bmp)$/i.test(mime.trim());
}
