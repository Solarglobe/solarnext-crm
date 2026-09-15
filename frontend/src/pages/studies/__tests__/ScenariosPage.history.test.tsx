import React from 'react';
import '@testing-library/jest-dom/vitest';
import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import Page from '../ScenariosPage';
vi.mock('../../../contexts/OrganizationContext',()=>({useSuperAdminReadOnly:()=>false}));
vi.mock('../../../services/api',async original=>({...await original<typeof import('../../../services/api')>(),apiFetch:(url:string,opts?:RequestInit)=>fetch(url,opts)}));
const scenario=(gain:number)=>({id:'BASE',consumption_source:'IMPORTED_DAILY_RECONSTRUCTED',energy:{production_kwh:5000},finance:{economie_total:gain,economie_year_1:1000}});
const mount=()=>render(<MemoryRouter initialEntries={['/studies/study/versions/version/scenarios']}><Routes><Route path="/studies/:studyId/versions/:versionId/scenarios" element={<Page/>}/></Routes></MemoryRouter>);
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('charge l’index à l’ouverture, le détail à la demande et bloque les exports historiques',async()=>{
 let recomputed=false;
 const fetchMock=vi.fn(async(url:string,opts?:RequestInit)=>{
  if(opts?.method==='POST'){recomputed=true;return new Response('{}',{status:200});}
  let body:unknown;
  if(url.includes('/history?'))body={items:[{id:'0',computed_at:'2026-09-14',input_fingerprint:'old-hash'}],total:1,next_offset:null};
  else if(url.endsWith('/history/0'))body={scenarios:[scenario(2000)]};
  else if(url.endsWith('/scenarios'))body={ok:true,scenarios:[scenario(recomputed?6000:2000)],needs_recompute:!recomputed,stale_reason:recomputed?null:'INPUTS_CHANGED',input_fingerprint:recomputed?'current-hash':'old-hash',history_count:recomputed?1:0};
  else body={study:{id:'study',title:'Étude historique'},versions:[{id:'version',version_number:1}]};
  return new Response(JSON.stringify(body),{status:200});
 });vi.stubGlobal('fetch',fetchMock);mount();
 await screen.findByText('Données modifiées — recalcul nécessaire');
 expect(screen.getByRole('button',{name:'Choisir sans stockage'})).toBeDisabled();
 expect(screen.getByTestId('scenarios-stale')).not.toHaveStyle({pointerEvents:'none'});
 fireEvent.click(screen.getByRole('button',{name:'Recalculer les scénarios'}));
 await waitFor(()=>expect(screen.queryByText('Données modifiées — recalcul nécessaire')).not.toBeInTheDocument());
 expect(screen.getByRole('button',{name:'Choisir sans stockage'})).toBeEnabled();
 expect(fetchMock.mock.calls.filter(([url])=>url.includes('/history'))).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'Consulter l’historique (1)'}));
 const select=await screen.findByRole('combobox',{name:'Résultats à consulter'});
 await screen.findByRole('option',{name:/Historique 2026/});
 expect(fetchMock.mock.calls.filter(([url])=>url.endsWith('/history/0'))).toHaveLength(0);
 fireEvent.change(select,{target:{value:'0'}});
 await screen.findAllByText(/^2\s000\s€/);
 expect(screen.getByRole('status')).toHaveTextContent('old-hash');
 expect(screen.getByRole('button',{name:'Choisir sans stockage'})).toBeDisabled();
 fireEvent.change(select,{target:{value:''}});
 expect(screen.getByRole('button',{name:'Choisir sans stockage'})).toBeEnabled();
});
it('pagine l’index sans télécharger les tableaux de résultats',async()=>{
 const calls:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
  calls.push(url);let body;
  if(url.endsWith('/scenarios'))body={ok:true,scenarios:[scenario(6000)],history_count:21};
  else if(url.includes('offset=0'))body={items:Array.from({length:20},(_,i)=>({id:String(i),computed_at:`calcul-${i}`})),total:21,next_offset:20};
  else if(url.includes('offset=20'))body={items:[{id:'20',computed_at:'dernier historique'}],total:21,next_offset:null};
  else body={study:{id:'study'},versions:[{id:'version',version_number:1}]};
  return new Response(JSON.stringify(body),{status:200});
 }));mount();
 fireEvent.click(await screen.findByRole('button',{name:'Consulter l’historique (21)'}));
 fireEvent.click(await screen.findByRole('button',{name:'Charger les calculs précédents'}));
 await screen.findByRole('option',{name:/dernier historique/});
 expect(screen.getAllByRole('option')).toHaveLength(22);
 expect(calls.filter(url=>url.includes('/history'))).toEqual([expect.stringContaining('offset=0&limit=20'),expect.stringContaining('offset=20&limit=20')]);
});
