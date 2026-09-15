import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {electricityBillDisplay} from '@shared/electricityBillDisplay.js';
import {consumptionSourceLabel} from '../resultPresentation';
import Table from '../ScenarioComparisonTable';
import PdfPage11 from '@/pages/pdf/PdfLegacyPort/PdfPage11';
import PdfPage2 from '@/pages/pdf/PdfLegacyPort/PdfPage2';

describe('résultats cohérents sur chaque horizon',()=>{
  for(const horizon of [20,25,30])it(`conserve le cumul final et ${horizon} années dans le PDF`,()=>{
    const flows=Array.from({length:horizon},(_,i)=>({year:i+1,cumul_eur:(i+1)*1000}));
    const html=renderToStaticMarkup(<Table orderedScenarios={[{id:'BASE',energy:{production_kwh:5000},finance:{economie_horizon_years:horizon,annual_cashflows:flows,economie_year_1:1000}}]}/>);
    expect(html).toContain(`Gain net après investissement (${horizon} ans)`);expect(html).toContain((horizon*1000).toLocaleString('fr-FR'));
    const pdf=renderToStaticMarkup(<PdfPage11 viewModel={{fullReport:{p11:{meta:{horizon_years_pdf:horizon},data:{series:{economies_annuelles:Array.from({length:horizon},(_,i)=>i===10?-1500:1000),paiement_annuel:Array(horizon).fill(0),reste_a_charge_annuel:Array(horizon).fill(1000)}}}}}}/>);
    expect(pdf).toContain(`Projection ${horizon} ans`);expect(pdf).toContain('#b91c1c');expect(pdf).not.toMatch(/height="-/);
    const p2=renderToStaticMarkup(<PdfPage2 viewModel={{fullReport:{p2:{p2_auto:{p2_horizon:`${horizon} ans`,p2_economie_totale:10000}}}}}/>);
    expect(p2).toContain(`Étude financière ${horizon} ans`);
  });
  it('dit moins déficitaire lorsque tous les gains sont négatifs',()=>{
    const html=renderToStaticMarkup(<Table orderedScenarios={['BASE','BATTERY_PHYSICAL'].map((id,i)=>({id,energy:{production_kwh:5000},finance:{economie_total:-1000-i*1000,economie_year_1:100}}))}/>);
    expect(html).toContain('Option la moins déficitaire');expect(html).not.toContain('Meilleure option');
  });
  it('décrit les courbes importées et reconstruites sans les qualifier de réelles',()=>{
    expect(consumptionSourceLabel('IMPORTED_HOURLY')).toBe('Courbe horaire importée');
    expect(consumptionSourceLabel('IMPORTED_DAILY_RECONSTRUCTED')).toBe('Profil reconstitué depuis les relevés quotidiens');
    expect(consumptionSourceLabel('PROVIDED_HOURLY_PROFILE')).not.toContain('réel');
  });
  it('soustrait les montants arrondis affichés sans altérer la facture originale',()=>{
    const original={bill_before_eur:100.004,bill_after_eur:50.005,bill_savings_eur:49.999};
    expect(electricityBillDisplay(original)).toMatchObject({bill_before_eur:100,bill_after_eur:50.01,bill_savings_eur:49.99});
    expect(electricityBillDisplay(original,0)).toMatchObject({bill_before_eur:100,bill_after_eur:50,bill_savings_eur:50});
    expect(original.bill_savings_eur).toBe(49.999);
  });
});
