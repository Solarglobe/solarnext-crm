import React from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PortalDocumentDownload } from '../PortalDocumentDownload';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('portal download guard', () => {
  it('keeps the portal visible and explains a refused stale document', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 409 }));
    vi.stubGlobal('fetch', fetch);
    render(<><p>Historique consultable</p><PortalDocumentDownload href="/fixture.pdf" fileName="fixture.pdf" /></>);
    fireEvent.click(screen.getByRole('link', { name: 'Télécharger' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ce document doit être recalculé');
    expect(screen.getByText('Historique consultable')).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not present an unavailable response as a downloaded document', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
    render(<PortalDocumentDownload href="/fixture.pdf" fileName="fixture.pdf" />);
    fireEvent.click(screen.getByRole('link', { name: 'Télécharger' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('momentanément indisponible');
  });

  it('aborts an in-flight download when the client portal unmounts', () => {
    let signal: AbortSignal;
    vi.stubGlobal('fetch', vi.fn((_href, options) => { signal = options.signal; return new Promise(() => {}); }));
    const view = render(<PortalDocumentDownload href="/fixture.pdf" fileName="fixture.pdf" />);
    fireEvent.click(screen.getByRole('link', { name: 'Télécharger' }));
    view.unmount();
    expect(signal!.aborted).toBe(true);
  });
});
