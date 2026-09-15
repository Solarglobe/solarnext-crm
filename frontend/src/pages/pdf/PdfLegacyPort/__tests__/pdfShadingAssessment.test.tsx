import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect} from 'vitest';
import Page from '../PdfPageShading';
for(const status of ['not_calculated','insufficient_data','error','stale']) it('PDF preserves '+status+' even with obsolete numeric zeros',()=>{
 const html=renderToStaticMarkup(<Page viewModel={{fullReport:{p_shading:{assessment:{status,nearStatus:status,farStatus:status,reasons:[]},nearLossPct:0,farLossPct:0,combinedLossPct:0,annualLossKwh:0}}}}/>);
 expect(html).not.toContain('Excellent');expect(html).not.toMatch(/>0,0 %</);
 expect(html).toContain(status==='error'?'Erreur de calcul':status==='stale'?'Résultat périmé':status==='not_calculated'?'Non calculé':'Non évalué');
});
it('PDF distinguishes an actually computed zero from a small positive loss',()=>{
 for(const loss of [0,.0004]) {
  const html=renderToStaticMarkup(<Page viewModel={{fullReport:{p_shading:{assessment:{status:'computed',nearStatus:'computed',farStatus:'computed',reasons:[]},nearLossPct:loss,farLossPct:0,combinedLossPct:loss}}}}/>);
  expect(html).toContain(loss===0?'0,0 %':'&lt; 0,1 %');
 }
});
