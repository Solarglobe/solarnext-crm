import React,{useState} from 'react';
import {describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import Projection,{type FinanceProjection} from '../FinanceProjectionSettings';
import Inputs from '../QuoteCalculationInputs';
import Financing,{mergeFinancing,financingInputError,type FinancingConfig} from '../QuoteFinancingSettings';

describe('devis technique : provenance et compatibilité',()=>{
 it('personnalise puis retire seulement la surcharge sans recopier les paramètres',()=>{
  const defaults=Object.freeze({maintenance_pct:.5,elec_growth_pct:5});
  function Form(){const[value,set]=useState<FinanceProjection>({surplus_sale_type:'oa',aid_payment_schedule:[{year:1,share_pct:100}]});return <MemoryRouter><Inputs defaults={defaults} total={10000} disabled={false} value={value} onChange={set}>{null}</Inputs><output>{JSON.stringify(value)}</output></MemoryRouter>;}
  render(<Form/>);
  fireEvent.click(screen.getAllByRole('button',{name:'Personnaliser pour cette étude'})[0]);
  fireEvent.change(screen.getByLabelText('Entretien annuel'),{target:{value:1.2}});
  expect(JSON.parse(screen.getByRole('status').textContent!)).toMatchObject({maintenance_pct:1.2,surplus_sale_type:'oa'});
  fireEvent.click(screen.getByRole('button',{name:'Revenir à la valeur par défaut'}));
  expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual({surplus_sale_type:'oa',aid_payment_schedule:[{year:1,share_pct:100}]});
  expect(defaults).toEqual({maintenance_pct:.5,elec_growth_pct:5});
 });
 it('conserve un ancien horizon et les champs inconnus sans réécriture au montage',()=>{
  const onChange=vi.fn(),value={horizon_years:20,unknown_legacy:'preserved',battery_replacements:[{year:12,cost_eur:1200}]};
  render(<Projection value={value} onChange={onChange}/>);
  expect(screen.getByLabelText(/Horizon de simulation/)).toHaveValue('20');expect(onChange).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Prix après contrat (€/kWh)'),{target:{value:.04}});
  expect(onChange).toHaveBeenCalledWith({...value,post_contract_sale_price_eur_kwh:.04});
 });
 it('distingue une liste onduleur vide de la politique héritée',()=>{
  function Form(){const[value,set]=useState<FinanceProjection>({inverter_replacements:[]});return <><Projection value={value} onChange={set}/><output>{JSON.stringify(value)}</output></>;}
  render(<Form/>);expect(screen.getByText('Aucun remplacement prévu pour cette étude.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Revenir à la valeur par défaut'}));expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual({});
 });
 it('modifie et supprime les versements sans changer les autres hypothèses',()=>{
  function Form(){const[value,set]=useState<FinanceProjection>({oa_contract_years:18});return <><Projection value={value} onChange={set}/><output>{JSON.stringify(value)}</output></>;}
  render(<Form/>);fireEvent.click(screen.getByRole('button',{name:'Ajouter un versement'}));fireEvent.change(screen.getByLabelText('Année du versement 1'),{target:{value:2}});
  expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual({oa_contract_years:18,aid_payment_schedule:[{year:2,share_pct:100}]});
  fireEvent.click(screen.getByRole('button',{name:'Supprimer le versement 1'}));expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual({oa_contract_years:18,aid_payment_schedule:[]});
 });
 it('verrouille les surcharges et listes d’une étude validée',()=>{
  render(<Projection disabled value={{horizon_years:30,aid_payment_schedule:[{year:1,share_pct:100}]}} onChange={vi.fn()}/>);
  for(const field of screen.getAllByRole('spinbutton'))expect(field).toBeDisabled();
  for(const button of screen.getAllByRole('button'))expect(button).toBeDisabled();
 });
});
describe('financement explicite',()=>{
 const saved:FinancingConfig={enabled:true,amount:12000,duration_months:120,interest_rate_annual:4,taeg_pct:4.4,insurance_eur:60,application_fee_eur:0,other_costs_eur:null};
 it('éteint, conserve, rallume et recharge le crédit sans perdre de valeur',()=>{
  function Form(){const[value,set]=useState(saved);return <><Financing value={value} onChange={set} disabled={false} total={10000}/><output>{JSON.stringify(value)}</output></>;}
  render(<Form/>);fireEvent.click(screen.getByRole('switch'));expect(screen.queryByLabelText('Montant financé (€)')).not.toBeInTheDocument();
  const off=JSON.parse(screen.getByRole('status').textContent!);expect(off).toEqual({...saved,enabled:false});expect(mergeFinancing(off,10000)).toEqual(off);
  fireEvent.click(screen.getByRole('switch'));expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual(saved);
 });
 it('un vide reste null, un zéro saisi reste zéro',()=>{
  function Form(){const[value,set]=useState(saved);return <><Financing value={value} onChange={set} disabled={false} total={10000}/><output>{JSON.stringify(value)}</output></>;}
  render(<Form/>);fireEvent.change(screen.getByLabelText('Taux nominal annuel (%)'),{target:{value:''}});
  const empty=JSON.parse(screen.getByRole('status').textContent!);expect(mergeFinancing(empty,10000).interest_rate_annual).toBeNull();expect(financingInputError(empty)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Taux nominal annuel (%)'),{target:{value:'0'}});expect(financingInputError(JSON.parse(screen.getByRole('status').textContent!))).toBeNull();
 });
 it('conserve l’activation implicite des dossiers anciens sans enabled',()=>{
  expect(mergeFinancing({amount:12000,duration_months:120,interest_rate_annual:0},10000)).toMatchObject({enabled:true,amount:12000,interest_rate_annual:0});
 });
 it('ne transforme pas un taux absent d’un ancien dossier en taux nul',()=>{
  expect(mergeFinancing({amount:12000,duration_months:120},10000)).toMatchObject({enabled:false,interest_rate_annual:null});
  expect(financingInputError(mergeFinancing({enabled:true,amount:12000,duration_months:120},10000))).toBeTruthy();
 });
 it('conserve un taux déjà saisi quand le montant et la durée restent à compléter',()=>{
  const onChange=vi.fn();
  const partial={...saved,enabled:false,amount:0,duration_months:0};
  render(<Financing value={partial} onChange={onChange} disabled={false} total={10000}/>);
  fireEvent.click(screen.getByRole('switch'));
  expect(onChange).toHaveBeenCalledWith({...partial,enabled:true});
 });
});
