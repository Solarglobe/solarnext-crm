import React from 'react';
import '@testing-library/jest-dom/vitest';
import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,waitFor,act,cleanup} from '@testing-library/react';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import Page from '../ScenariosPage';
vi.mock('../../../contexts/OrganizationContext',()=>({useSuperAdminReadOnly:()=>false}));
vi.mock('../../../services/api',async original=>({...await original<typeof import('../../../services/api')>(),apiFetch:(url:string,opts?:RequestInit)=>fetch(url,opts)}));
const scenario=(gain:number)=>({id:'BASE',energy:{production_kwh:5000},finance:{economie_total:gain,economie_year_1:1000}});
const response=(body:unknown)=>new Response(JSON.stringify(body),{status:200});
const pack={study:{id:'study',title:'Étude fraîcheur'},versions:[{id:'version',version_number:1}]};
const revision={calculated_at:'2026-09-15T10:00:00Z',input_fingerprint:'saved'};
const mount=()=>render(<MemoryRouter initialEntries={['/studies/study/versions/version/scenarios']}><Routes><Route path="/studies/:studyId/versions/:versionId/scenarios" element={<Page/>}/></Routes></MemoryRouter>);
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});

for(const trigger of ['focus','visibilitychange'])it(`${trigger} consulte seulement les flags et bloque l’export sans recalcul`,async()=>{
 let stale=false,reads=0,flags=0;
 vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
 const fetchMock=vi.fn(async(url:string)=>{
  if(url.endsWith('/freshness')){flags++;return response({...revision,needs_recompute:stale,export_blocked:stale});}
  if(url.endsWith('/scenarios')){reads++;return response({ok:true,scenarios:[scenario(6000)],...revision});}return response(pack);
 });vi.stubGlobal('fetch',fetchMock);mount();
 await waitFor(()=>expect(screen.getByRole('button',{name:'Choisir sans stockage'})).toBeEnabled());
 stale=true;fireEvent(trigger==='focus'?window:document,new Event(trigger));
 await screen.findByText('Données modifiées — recalcul nécessaire');
 expect(screen.getByRole('button',{name:'Choisir sans stockage'})).toBeDisabled();expect(reads).toBe(1);expect(flags).toBe(1);
 expect(fetchMock.mock.calls.every(([url])=>!url.endsWith('/calc'))).toBe(true);
});

it('regroupe les événements, ne recharge un résultat changé qu’une fois et garde le choix historique',async()=>{
 let reads=0,flags=0,release:(value:Response)=>void=()=>{};
 vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
  if(url.endsWith('/freshness')){flags++;return new Promise<Response>(resolve=>{release=resolve;});}
  if(url.includes('/history?'))return response({items:[{id:'0',input_fingerprint:'historical-hash'}],total:1,next_offset:null});
  if(url.endsWith('/history/0'))return response({scenarios:[scenario(2000)]});
  if(url.endsWith('/scenarios')){reads++;return response({ok:true,...revision,calculated_at:reads===1?revision.calculated_at:'new',scenarios:[scenario(reads===1?6000:9000)],history_count:1});}
  return response(pack);
 }));mount();
 fireEvent.click(await screen.findByRole('button',{name:'Consulter l’historique (1)'}));
 fireEvent.change(await screen.findByRole('combobox',{name:'Résultats à consulter'}),{target:{value:'0'}});
 await screen.findAllByText(/^2\s000\s€/);
 fireEvent(window,new Event('focus'));fireEvent(document,new Event('visibilitychange'));fireEvent(window,new Event('focus'));
 expect(flags).toBe(1);expect(reads).toBe(1);
 await act(async()=>release(response({...revision,calculated_at:'new',history_count:1})));
 expect(reads).toBe(2);expect(screen.getByRole('combobox',{name:'Résultats à consulter'})).toHaveValue('0');
 expect(screen.getByRole('status')).toHaveTextContent('historical-hash');
 expect(screen.getAllByText(/^2\s000\s€/).length).toBeGreaterThan(0);
 expect(screen.queryByText(/^9\s000\s€/)).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Choisir sans stockage'})).toBeDisabled();
 fireEvent.change(screen.getByRole('combobox',{name:'Résultats à consulter'}),{target:{value:''}});
 expect(screen.getAllByText(/^9\s000\s€/).length).toBeGreaterThan(0);
});

it('vérifie les flags toutes les 30 secondes uniquement quand visible et arrête après démontage',async()=>{
 vi.useFakeTimers();let visible:DocumentVisibilityState='visible',stale=false,reads=0,flags=0;
 vi.spyOn(document,'visibilityState','get').mockImplementation(()=>visible);
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
  if(url.endsWith('/freshness')){flags++;return response({...revision,needs_recompute:stale});}
  if(url.endsWith('/scenarios')){reads++;return response({ok:true,...revision,scenarios:[scenario(6000)]});}return response(pack);
 }));
 const view=mount();await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
 expect(reads).toBe(1);visible='hidden';stale=true;
 await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});expect(flags).toBe(0);
 visible='visible';await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});expect(flags).toBe(1);expect(reads).toBe(1);
 expect(screen.getByText('Données modifiées — recalcul nécessaire')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Choisir sans stockage'})).toBeDisabled();
 view.unmount();await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});expect(flags).toBe(1);
});

it('une lecture légère ne lève pas un blocage de cohérence connu sans nouveau résultat complet',async()=>{
 let reads=0,flags=0;
 vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
  if(url.endsWith('/freshness')){flags++;return response({...revision,needs_recompute:false,export_blocked:false});}
  if(url.endsWith('/scenarios')){reads++;return response({ok:true,...revision,engine_coherent:false,blocked_reason:'ENGINE_INCOHERENT',scenarios:[scenario(6000)]});}
  return response(pack);
 }));mount();await screen.findByText('Données modifiées — recalcul nécessaire');
 fireEvent(window,new Event('focus'));await waitFor(()=>expect(flags).toBe(1));
 expect(screen.getByRole('button',{name:'Choisir sans stockage'})).toBeDisabled();
 expect(screen.getByText('Données modifiées — recalcul nécessaire')).toBeInTheDocument();expect(reads).toBe(1);
});
