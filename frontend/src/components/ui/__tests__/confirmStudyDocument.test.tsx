import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { confirmStudyDocument } from '../confirmStudyDocument';

describe('study export confirmation', () => {
  it('waits for the explicit decision and cancels without exporting', async () => {
    let decision!: Promise<boolean>;
    let resolved = false;
    await act(async () => { decision = confirmStudyDocument('Analyse indisponible'); });
    void decision.then(() => { resolved = true; });
    expect(screen.getByText('Analyse indisponible')).toBeTruthy();
    expect(resolved).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(await decision).toBe(false);
  });

  it('continues only after confirmation and rejects duplicate pending clicks', async () => {
    let decision!: Promise<boolean>;
    await act(async () => { decision = confirmStudyDocument('PDF sans ombrage'); });
    expect(await confirmStudyDocument('duplicate')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(await decision).toBe(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
