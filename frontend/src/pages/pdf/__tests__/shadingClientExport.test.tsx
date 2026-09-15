import React from 'react';
import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import ScenarioComparisonTable from '../../../components/study/ScenarioComparisonTable';
import StudySnapshotPdfPage from '../StudySnapshotPdfPage';
vi.mock('react-router-dom',()=>({useParams:()=>({})}));
vi.mock('../../../services/api',()=>({apiFetch:(...args:unknown[])=>fetch(...args as Parameters<typeof fetch>)}));
vi.mock('../PdfLegacyPort',()=>({default:()=> <div data-testid="final-client-report"/>}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const scenario=(reason:string)=>({id:'BASE',shading:{assessment:{status:['needs_recompute','display_blocked','computed'].includes(reason)?'computed':reason,nearStatus:'computed',farStatus:'computed'},near:{totalLossPct:0},far:{totalLossPct:0},combined:{totalLossPct:0}},...(reason==='needs_recompute'||reason==='display_blocked'?{[reason]:true}:{}),energy:{production_kwh:5000,consumption_kwh:6000},finance:{economie_year_1:100}} as any);
for(const reason of ['needs_recompute','display_blocked']){
 it(reason+' disables UI selection and no export callback fires',()=>{const onSelect=vi.fn();render(<ScenarioComparisonTable orderedScenarios={[scenario(reason)]} onSelectScenario={onSelect}/>);const button=screen.getByRole('button',{name:'Choisir sans stockage',exact:true});expect(button).toBeDisabled();fireEvent.click(button);expect(onSelect).not.toHaveBeenCalled();});
 it(reason+' refuses a final PDF even if the HTTP response claims success',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,viewModel:{selected_scenario_snapshot:scenario(reason)}})}));render(<StudySnapshotPdfPage studyId="study" versionId="version"/>);await waitFor(()=>expect(document.getElementById('pdf-error')).toBeTruthy());expect(window.__pdf_render_ready).toBe(false);expect(screen.queryByTestId('final-client-report')).toBeNull();});
}
it('computed zero enables selection',()=>{render(<ScenarioComparisonTable orderedScenarios={[scenario('computed')]} onSelectScenario={vi.fn()}/>);expect(screen.getByRole('button',{name:'Choisir sans stockage',exact:true})).toBeEnabled();});

for(const reason of ['stale','not_calculated','insufficient_data','error'])it(reason+' permits regular study export without shading',()=>{render(<ScenarioComparisonTable orderedScenarios={[scenario(reason)]} onSelectScenario={vi.fn()}/>);expect(screen.getByRole('button',{name:'Choisir sans stockage',exact:true})).toBeEnabled();});
