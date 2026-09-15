import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect} from 'vitest';
import Page from '../PdfPageVerifiedAssumptions';
const vm=(method?:string)=>({results_reference:{ratios:{},annual:{},provenance:{}},selected_scenario_snapshot:{economic_snapshot:{horizon_years:30,projection_assumptions:{energy_projection_method:method,maintenance_pct:1,inverter_replacements:[{year:15,cost_eur:1500}],battery_replacements:[{year:15,cost_eur:4000,kind:'replacement'}]}}}});
it('décrit la resimulation horaire réellement utilisée et un seul calendrier de remplacement',()=>{
 const html=renderToStaticMarkup(<Page viewModel={vm('annual_hourly_resimulation')}/>);
 expect(html).toContain('Chaque année future est resimulée heure par heure');
 expect(html).not.toContain('sans nouvelle simulation');expect(html).not.toContain('Remplacement onduleur non chiffré');
 expect(html).toContain('Onduleur : année 15, 1 500 €');
 expect(html.match(/1 500/g)).toHaveLength(1);
});
it('n’invente pas de méthode horaire lorsqu’un résultat ancien n’en précise aucune',()=>{
 const html=renderToStaticMarkup(<Page viewModel={vm()}/>);
 expect(html).toContain('Méthode de projection annuelle non précisée dans ce résultat.');
 expect(html).not.toContain('Chaque année future est resimulée');
});
