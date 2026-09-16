import React from 'react';import {afterEach,beforeEach,expect,it,vi} from 'vitest';import {render,fireEvent,screen,waitFor,cleanup} from '@testing-library/react';
const mocks=vi.hoisted(()=>({navigate:vi.fn(),api:vi.fn(),validate:null as any,continueWithout:null as any}));
vi.mock('react-router-dom',()=>({useNavigate:()=>mocks.navigate}));vi.mock('../../services/api',()=>({apiFetch:mocks.api}));
vi.mock('../../modules/calpinage/CalpinageApp',()=>({default:({onValidate,onContinueWithoutShading}:any)=>{mocks.validate=onValidate;mocks.continueWithout=onContinueWithoutShading;return <><canvas id="calpinage-canvas-el" width="300" height="200"/><button onClick={()=>onValidate({geometry_json:{frozenBlocks:[{panels:[{}]}]}})}>Valider le calepinage</button></>}}));
import CalpinageOverlay from '../CalpinageOverlay';import {shadingResumeKey} from '../../services/shadingWorkflow';
let job:any=null,result:any=null,posts=0,saves=0,validated=0,failed=false,excluded=false;
const completed={scope:'combined-shading-v1',lossPercent:32.99,hash:'saved-global'};
const mount=()=>render(<CalpinageOverlay studyId="fictional" versionId="1" onClose={()=>{}} onSaved={()=>{}}/>);
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();job=result=null;posts=saves=validated=0;failed=excluded=false;vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockReturnValue('data:image/png;base64,fictional');Object.assign(window,{getCalpinageGeometryForPersist:()=>({geometry_json:{frozenBlocks:[{panels:[{}]}]}})});
mocks.api.mockImplementation(async(url:string,opts:any={})=>{if(url.endsWith('/has-active-study'))return {ok:true,json:async()=>({})};if(url.endsWith('/calpinage')){saves++;return {ok:true,json:async()=>({})}}if(url.endsWith('/calpinage/validate')){validated++;return {ok:true,json:async()=>({})}}if(url.endsWith('/tree-shading/jobs')){if(opts.method==='POST'){posts++;job={id:'durable-job',status:failed?'failed':'running',step:'annual',error:failed?'IGN indisponible':null};}return {ok:true,json:async()=>({job,result,excluded})};}throw Error('Unexpected request '+url)});});
afterEach(()=>{cleanup();document.querySelectorAll('.calpinage-overlay-toast').forEach(e=>e.remove());vi.restoreAllMocks();});
it('direct validation saves then creates one job even with multiple calls, then navigates after result',async()=>{mount();fireEvent.click(screen.getByText('Valider le calepinage'));mocks.validate({geometry_json:{frozenBlocks:[{panels:[{}]}]}});await waitFor(()=>expect(posts).toBe(1));expect(saves).toBe(1);expect(validated).toBe(0);job.status='completed';result=completed;await waitFor(()=>expect(validated).toBe(1),{timeout:2500});expect(mocks.navigate).toHaveBeenCalledWith('/studies/fictional/quote-builder');expect(sessionStorage.getItem(shadingResumeKey('fictional','1'))).toBeNull();});
it('reload resumes a server job without posting another calculation',async()=>{job={id:'existing-job',status:'running',step:'annual'};sessionStorage.setItem(shadingResumeKey('fictional','1'),'pending');mount();await waitFor(()=>expect(saves).toBe(1));expect(posts).toBe(0);job.status='completed';result=completed;await waitFor(()=>expect(validated).toBe(1),{timeout:2500});expect(posts).toBe(0);});
it('failed acquisition never validates implicitly; explicit continuation saves current panels before excluding shading and validating',async()=>{
 failed=true;mount();fireEvent.click(screen.getByText('Valider le calepinage'));await screen.findByText('IGN indisponible');expect(validated).toBe(0);expect(result).toBeNull();
 const panels=Array.from({length:30},(_,i)=>({id:`panel-${i}`}));
 Object.assign(window,{getCalpinageGeometryForPersist:()=>({geometry_json:{frozenBlocks:[{panels}]}})});
 const original=mocks.api.getMockImplementation()!;const order:string[]=[];let storedPanels=1;
 mocks.api.mockImplementation(async(url:string,opts:any={})=>{
  if(url.endsWith('/calpinage')){order.push('save');storedPanels=JSON.parse(opts.body).geometry_json.frozenBlocks[0].panels.length;excluded=false;}
  if(url.endsWith('/tree-shading/skip')){order.push('skip');expect(storedPanels).toBe(30);excluded=true;return {ok:true,json:async()=>({excluded:true})};}
  if(url.endsWith('/calpinage/validate')){order.push('validate');expect(excluded).toBe(true);expect(storedPanels).toBe(30);}
  return original(url,opts);
 });
 await mocks.continueWithout();expect(order).toEqual(['save','skip','validate']);expect(validated).toBe(1);expect(posts).toBe(1);expect(result).toBeNull();expect(mocks.navigate).toHaveBeenCalledOnce();
});

it('continuation requested just before the failed validation settles is not lost or run concurrently',async()=>{
 mount();fireEvent.click(screen.getByText('Valider le calepinage'));await waitFor(()=>expect(posts).toBe(1));job.status='failed';job.error='IGN indisponible';
 const original=mocks.api.getMockImplementation()!;
 mocks.api.mockImplementation(async(url:string,opts:any={})=>url.endsWith('/tree-shading/skip')?(excluded=true,{ok:true,json:async()=>({excluded:true})}):original(url,opts));
 await mocks.continueWithout();expect(validated).toBe(1);expect(mocks.navigate).toHaveBeenCalledOnce();expect(result).toBeNull();
});

it.each(['save','skip'])('a %s failure preserves the layout and never validates or navigates',async(stage)=>{
 mount();const original=mocks.api.getMockImplementation()!;
 mocks.api.mockImplementation(async(url:string,opts:any={})=>{
  if((stage==='save'&&url.endsWith('/calpinage'))||url.endsWith('/tree-shading/skip'))return {ok:false,status:409,json:async()=>({error:'Version modifiée'})};
  return original(url,opts);
 });
 await mocks.continueWithout();expect(validated).toBe(0);expect(mocks.navigate).not.toHaveBeenCalled();expect((window as any).getCalpinageGeometryForPersist?.()).toBeTruthy();expect(result).toBeNull();
});
