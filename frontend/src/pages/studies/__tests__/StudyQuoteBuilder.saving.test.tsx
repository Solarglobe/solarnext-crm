import React from 'react';
import '@testing-library/jest-dom/vitest';
import {describe,it,expect,vi,beforeEach} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {setAuthToken} from '../../../services/api';
import StudyQuoteBuilder from '../StudyQuoteBuilder';

const prep={technical_snapshot_summary:{nb_panels:12,power_kwc:6,snapshot_version:1},economic_state:null,study_version_id:'version'};
function mount(){return render(<MemoryRouter initialEntries={['/studies/study/versions/version/quote-builder']}><Routes><Route path="/studies/:studyId/versions/:versionId/quote-builder" element={<StudyQuoteBuilder/>}/><Route path="/studies/study" element={<p>Résultats prêts</p>}/></Routes></MemoryRouter>);}
describe('validation sur la sauvegarde confirmée',()=>{
  beforeEach(()=>{setAuthToken('test-token');});
  for(const failure of ['http','network','missing_fingerprint'])it(`arrête le calcul après ${failure} et conserve le formulaire`,async()=>{
    const fetch=vi.fn(async(url:string,opts?:RequestInit)=>{
      if(opts?.method==='PUT'){
        if(failure==='network')throw new Error('Réseau indisponible');
        return new Response(JSON.stringify(failure==='http'?{error:'Sauvegarde refusée'}:{}),{status:failure==='http'?500:200});
      }
      return new Response(JSON.stringify(url.endsWith('/quote-prep')?prep:[]),{status:200});
    });vi.stubGlobal('fetch',fetch);mount();
    const button=await screen.findByRole('button',{name:'Valider le devis technique'});
    fireEvent.click(button);
    await waitFor(()=>expect(screen.getByText(/Vos modifications restent dans le formulaire/)).toBeInTheDocument());
    expect(screen.getByText('Préparation du devis technique')).toBeInTheDocument();
    expect(fetch.mock.calls.some(([,opts])=>opts?.method==='POST')).toBe(false);
    expect(screen.queryByText(/scénarios sont prêts/)).not.toBeInTheDocument();
  });
  it('transmet exactement la référence renvoyée par la sauvegarde avant de calculer',async()=>{
    const requests:{url:string;method?:string;body?:BodyInit|null}[]=[];
    vi.stubGlobal('fetch',vi.fn(async(url:string,opts?:RequestInit)=>{
      requests.push({url,method:opts?.method,body:opts?.body});
      const body=opts?.method==='PUT'?{saved_quote_fingerprint:'saved-revision-42'}:opts?.method==='POST'?{status:'SCENARIOS_GENERATED',scenarios:{count:4}}:url.endsWith('/quote-prep')?prep:[];
      return new Response(JSON.stringify(body),{status:200});
    }));mount();fireEvent.click(await screen.findByRole('button',{name:'Valider le devis technique'}));
    await screen.findByText('Résultats prêts');
    const index=requests.findIndex(r=>r.method==='POST');expect(index).toBeGreaterThan(0);
    expect(requests[index-1].method).toBe('PUT');
    expect(JSON.parse(String(requests[index].body))).toEqual({expected_quote_fingerprint:'saved-revision-42'});
  });
  it('conserve un financement explicitement renseigné à taux nul',async()=>{
    let saved:any;
    vi.stubGlobal('fetch',vi.fn(async(url:string,opts?:RequestInit)=>{
      if(opts?.method==='PUT') saved=JSON.parse(String(opts.body));
      const body=opts?.method==='PUT'?{saved_quote_fingerprint:'zero-rate'}:opts?.method==='POST'?{status:'SCENARIOS_GENERATED',scenarios:{count:4}}:url.endsWith('/quote-prep')?{...prep,economic_state:{data:{financing:{amount:12000,duration_months:120,interest_rate_annual:0}}}}:[];
      return new Response(JSON.stringify(body),{status:200});
    }));mount();fireEvent.click(await screen.findByRole('button',{name:'Valider le devis technique'}));
    await screen.findByText('Résultats prêts');
    expect(saved.financing).toMatchObject({enabled:true,amount:12000,duration_months:120,interest_rate_annual:0});
  });
});
