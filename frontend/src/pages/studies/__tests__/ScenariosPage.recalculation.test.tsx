import React from 'react';
import '@testing-library/jest-dom/vitest';
import { it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Page from '../ScenariosPage';
vi.mock('../../../contexts/OrganizationContext', () => ({ useSuperAdminReadOnly: () => false }));
vi.mock('../../../services/api', () => ({ apiFetch: (url: string, opts?: RequestInit) => fetch(url, opts) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const scenario = (production: number) => ({ id: 'BASE', energy: { production_kwh: production }, finance: { economie_year_1: 150, roi_years: 8 } });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

it('cancel is read only; a failed recalculation preserves results and can be retried, compared and confirmed', async () => {
  let attempts = 0, done = false;
  const calls = vi.fn(async (url: string, opts?: RequestInit) => {
    if (opts?.method === 'POST') {
      expect(url).toMatch(/\/versions\/7\/calc$/);
      attempts++; if (attempts === 1) return response({ error: 'Données incomplètes' }, 400);
      done = true; return response({ ok: true });
    }
    if (url.endsWith('/history/0')) return response({ scenarios: [scenario(700)], engine_version: 'V21-old' });
    if (url.endsWith('/scenarios')) return response({ ok: true, scenarios: [scenario(done ? 476 : 700)], needs_recompute: !done, history_count: done ? 1 : 0, current_engine_version: 'V21-current' });
    return response({ study: { id: 'study' }, versions: [{ id: 'version-uuid', version_number: 7 }] });
  }); vi.stubGlobal('fetch', calls);
  render(<MemoryRouter initialEntries={['/studies/study/versions/version-uuid/scenarios']}><Routes><Route path="/studies/:studyId/versions/:versionId/scenarios" element={<Page />} /></Routes></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Recalculer les scénarios' }));
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Annuler' })); }); expect(attempts).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Recalculer les scénarios' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Recalculer l’étude' }));
  await screen.findByText(/Les résultats précédents sont conservés/);
  expect(screen.getByRole('button', { name: 'Vérifier les données du devis' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Recalculer les scénarios' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Recalculer l’étude' }));
  const comparison = await screen.findByRole('region', { name: 'Comparaison après recalcul' });
  await within(comparison).findByText('700 kWh/an'); expect(within(comparison).getByText('476 kWh/an')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Choisir sans stockage' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Choisir sans stockage' }));
  await screen.findByRole('dialog', { name: 'Confirmer le scénario : Sans batterie' });
  expect(attempts).toBe(2); fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
});
