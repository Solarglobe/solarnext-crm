import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
const mocks=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('../../../../services/shadingWorkflow',()=>({shadingRequest:mocks.request,shadingKey:()=> 'fictional:1',ensureSavedShading:vi.fn()}));
vi.mock('../../../../pages/studies/TreeShadingPage',()=>({TreeShadingFrame:()=>null}));
import {Phase3Trees} from '../Phase3Trees';
afterEach(()=>{cleanup();vi.clearAllMocks();});

it('the visible continuation waits for saving/validation and prevents duplicate clicks',async()=>{
 mocks.request.mockResolvedValue({job:{id:'fixture-job',status:'failed',error:'Hauteur de toiture indisponible'},result:null,excluded:false});
 let finish!:()=>void;const continuing=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
 render(<Phase3Trees studyId="fictional" versionId="1" panelCount={30} onContinueWithoutShading={continuing}/>);
 const button=await screen.findByRole('button',{name:'Continuer sans analyse d’ombrage'});
 fireEvent.click(button);fireEvent.click(button);expect(continuing).toHaveBeenCalledOnce();
 expect(screen.getByRole('button',{name:'Enregistrement…'})).toBeDisabled();
 mocks.request.mockResolvedValue({job:{id:'fixture-job',status:'failed'},result:null,excluded:true});finish();
 await screen.findByText('Ombrage non évalué. Aucune perte n’a été calculée.');
 expect(mocks.request.mock.calls.every(args=>args[2]==='/jobs')).toBe(true);
 expect(screen.queryByText('0,00 %')).not.toBeInTheDocument();
});

it('a rejected continuation stays on the page with a visible error and can be retried',async()=>{
 mocks.request.mockResolvedValue({job:{id:'fixture-job',status:'failed'},result:null,excluded:false});
 const continuing=vi.fn().mockRejectedValue(Error('Enregistrement impossible'));
 render(<Phase3Trees studyId="fictional" versionId="1" panelCount={30} onContinueWithoutShading={continuing}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Continuer sans analyse d’ombrage'}));
 await screen.findByText('Error: Enregistrement impossible');
 await waitFor(()=>expect(screen.getByRole('button',{name:'Continuer sans analyse d’ombrage'})).toBeEnabled());
});
