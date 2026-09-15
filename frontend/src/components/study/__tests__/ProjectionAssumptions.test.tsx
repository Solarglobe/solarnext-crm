import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import ProjectionAssumptions from '../ProjectionAssumptions';
describe('conditions de vente affichées selon le contrat calculé',()=>{
 it('affiche la durée OA et le prix après contrat uniquement pour OA',()=>{
  const html=renderToStaticMarkup(<ProjectionAssumptions value={{surplus_sale_type:'oa',horizon_years:30,oa_contract_years:20,post_contract_sale_price_eur_kwh:.11}}/>);
  expect(html).toContain('Durée contractuelle 20 ans');expect(html).toContain('prix post-contrat 0,11 €/kWh');
 });
 it('affiche le marché sur tout l’horizon sans lui appliquer l’échéance OA',()=>{
  const html=renderToStaticMarkup(<ProjectionAssumptions value={{surplus_sale_type:'market',horizon_years:30,oa_contract_years:20,post_contract_sale_price_eur_kwh:.11}}/>);
  expect(html).toContain('projeté sur 30 ans');expect(html).not.toContain('Durée contractuelle 20 ans');expect(html).not.toContain('prix post-contrat');
 });
 for(const type of ['none','unconfirmed'] as const)it(`${type} annonce explicitement l’absence de revenu confirmé`,()=>{
  const html=renderToStaticMarkup(<ProjectionAssumptions value={{surplus_sale_type:type,horizon_years:30,oa_contract_years:20,post_contract_sale_price_eur_kwh:.11}}/>);
  expect(html).toContain('Aucun revenu de vente confirmé n’est compté.');expect(html).not.toContain('Durée contractuelle');expect(html).not.toContain('prix post-contrat');
 });
});
