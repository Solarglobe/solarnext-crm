import { useEffect, useState } from 'react';
import type { ScenarioV2 } from '../../components/study/ScenarioComparisonTable';
import { apiFetch } from '../../services/api';
import { getStudyShadingState } from '../../../../shared/shading/clientStudyExport.js';

type PreviousCalculation = { scenarios: ScenarioV2[]; engine_version?: string; computed_at?: string };
const format = (v: unknown, unit: string) => typeof v === 'number' && Number.isFinite(v)
  ? `${v.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${unit}` : 'Non renseigné';

/** Read the last preserved result, including after reopening the study. */
export default function RecalculationComparison({ baseUrl, historyCount, scenarios, engine, onReady }: {
  baseUrl: string; historyCount: number; scenarios: ScenarioV2[]; engine: string | null; onReady: (ready: boolean) => void;
}) {
  const [previous, setPrevious] = useState<PreviousCalculation | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setPrevious(null); setError(false); onReady(false);
    if (!historyCount) return;
    void (async () => {
      try {
        const response = await apiFetch(`${baseUrl}/scenarios/history/${historyCount - 1}`);
        if (!response.ok) throw new Error('history');
        const body = await response.json();
        if (!Array.isArray(body.scenarios)) throw new Error('history');
        if (active) { setPrevious(body); onReady(true); }
      } catch { if (active) setError(true); }
    })();
    return () => { active = false; };
  }, [baseUrl, historyCount, onReady]);
  if (!historyCount) return null;
  return <section className="sn-card" aria-label="Comparaison après recalcul" style={{ padding: 20, marginBottom: 20 }}>
    <h2>Comparer avant de choisir</h2>
    {error ? <p role="alert">Comparaison indisponible. Rechargez la page ou consultez l’historique avant de choisir.</p>
      : !previous ? <p>Chargement du calcul précédent…</p> : <>
        <p>Ancien calcul conservé : {previous.computed_at ? new Date(previous.computed_at).toLocaleString('fr-FR') : 'date non renseignée'}.</p>
        <p>{previous.engine_version !== engine
          ? `Le moteur a été actualisé (${previous.engine_version ?? 'ancienne version non renseignée'} → ${engine ?? 'moteur courant'}). Les règles actuelles de production et de calcul financier s’appliquent aux données enregistrées de l’étude.`
          : 'Le recalcul reprend les données et paramètres actuellement enregistrés dans l’étude.'} La répartition chiffrée de l’écart entre chaque cause n’est pas disponible.</p>
        <div style={{ overflowX: 'auto' }}><table className="sn-table">
          <thead><tr><th>Scénario</th><th>Indicateur</th><th>Ancien résultat — historique</th><th>Nouveau résultat</th></tr></thead>
          <tbody>{scenarios.flatMap(s => {
            const old = previous.scenarios.find(p => (p.id ?? p.type) === (s.id ?? s.type));
            return [
              ['Production annuelle', old?.energy?.production_kwh, s.energy?.production_kwh, 'kWh/an'],
              ['Économie annuelle', old?.finance?.economie_year_1, s.finance?.economie_year_1, '€/an'],
              ['Retour sur investissement', old?.finance?.roi_years, s.finance?.roi_years, 'ans'],
            ].map(([label, before, after, unit]) => <tr key={`${s.id}-${label}`}>
              <th>{s.label ?? s.id ?? s.type}</th><td>{label}</td><td>{format(before, String(unit))}</td><td>{format(after, String(unit))}</td>
            </tr>);
          })}</tbody>
        </table></div>
        {scenarios.some(s => !getStudyShadingState(s).shadingIncluded) && <p>Ombrage local non évalué : aucune perte locale n’est appliquée aux scénarios sans analyse vérifiée.</p>}
        <p>Choisissez le nouveau scénario souhaité dans le comparateur ci-dessous, puis confirmez son export. Les anciens PDF restent accessibles dans les documents.</p>
      </>}
  </section>;
}
