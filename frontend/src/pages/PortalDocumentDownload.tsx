import { useEffect, useRef, useState, type MouseEvent } from 'react';

/** Keep the portal open when the server refuses a stale or unavailable document. */
export function PortalDocumentDownload({ href, fileName }: { href: string; fileName: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const objectUrl = useRef<string | null>(null);
  const revokeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    request.current?.abort();
    if (revokeTimer.current) clearTimeout(revokeTimer.current);
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, []);

  const download = async (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(href, { signal: controller.signal });
      if (!response.ok) {
        setError(response.status === 409
          ? 'Ce document doit être recalculé par votre conseiller avant de pouvoir être téléchargé.'
          : 'Ce document est momentanément indisponible. Veuillez contacter votre conseiller.');
        return;
      }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      if (revokeTimer.current) clearTimeout(revokeTimer.current);
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      const url = URL.createObjectURL(blob);
      objectUrl.current = url;
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
      revokeTimer.current = setTimeout(() => {
        URL.revokeObjectURL(url);
        objectUrl.current = null;
        revokeTimer.current = null;
      }, 1000);
    } catch {
      if (!controller.signal.aborted) setError('Le téléchargement a échoué. Veuillez réessayer.');
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  return <div>
    <a className="cp-btn-doc cp-btn-doc--outline" href={href} download={fileName} aria-disabled={busy} onClick={download}>
      {busy ? 'Téléchargement…' : 'Télécharger'}
    </a>
    {error && <p role="alert">{error}</p>}
  </div>;
}
