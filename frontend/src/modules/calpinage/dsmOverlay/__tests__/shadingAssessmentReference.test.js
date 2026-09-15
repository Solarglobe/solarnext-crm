// @vitest-environment jsdom
import {it,expect,afterEach} from 'vitest';
import {getShadingAssessment, getShadingComponentLossPct, formatShadingLossPct, getEnergyTemporalProfile} from '../../../../../../shared/shading/shadingAssessment.js';
import {createDsmSolarAnimationControls} from '../dsmSolarAnimationControls.js';
const assessed = (pct,status='computed') => ({assessment:{status,nearStatus:status,farStatus:status},near:{totalLossPct:pct},far:{totalLossPct:0},combined:{totalLossPct:pct}});
afterEach(()=>{document.body.innerHTML='';});
for(const status of ['not_calculated','insufficient_data','error','stale']) it(status+' never displays a stored zero',()=>{
 const s=assessed(0,status);
 expect(getShadingComponentLossPct(s)).toBeNull();
 expect(formatShadingLossPct(0,getShadingAssessment(s).status)).not.toContain('0,0');
 const root=document.createElement('div');document.body.append(root);
 const controls=createDsmSolarAnimationControls(root);controls.refreshTemporal({shading:s});
 expect(root.querySelectorAll('.dsm-temporal-hbar')).toHaveLength(0);
 expect(root.textContent).not.toContain('Mixte');expect(root.textContent).not.toContain('Excellent');
 controls.destroy();
});
it('zero and a very small positive loss remain distinct',()=>{
 expect(formatShadingLossPct(getShadingComponentLossPct(assessed(0)))).toBe('0,0 %');
 expect(formatShadingLossPct(getShadingComponentLossPct(assessed(.0004)))).toBe('< 0,1 %');
 for(const v of [null,NaN,-1,101,'0']) expect(getShadingComponentLossPct(assessed(v))).toBeNull();
});
it('bars use the same energy loss and each distribution sums to 100%',()=>{
 const s={...assessed(12),distribution:{monthly:[20,10,10,10,10,10,5,5,5,5,5,5],periods:{morning:70,midday:20,afternoon:10}}};
 const p=getEnergyTemporalProfile(s);expect(p.dayParts.reduce((a,b)=>a+b.value,0)).toBe(100);expect(p.seasons.reduce((a,b)=>a+b.value,0)).toBe(100);
 const root=document.createElement('div');document.body.append(root);const controls=createDsmSolarAnimationControls(root);controls.refreshTemporal({shading:s});
 expect(root.querySelectorAll('.dsm-temporal-hbar')).toHaveLength(7);
 expect(root.textContent).toContain('Matin · 70.0 %');
 s.distribution.periods.morning=0;controls.refreshTemporal({shading:s});expect(root.querySelectorAll('.dsm-temporal-hbar')).toHaveLength(0);
 controls.destroy();
});
it('missing, flat and incoherent distributions cannot produce a valid temporal analysis',()=>{
 expect(getEnergyTemporalProfile(assessed(0))).toBeNull();
 expect(getEnergyTemporalProfile(assessed(5))).toBeNull();
 expect(getEnergyTemporalProfile({...assessed(5),distribution:{monthly:Array(12).fill(0),periods:{morning:0,midday:0,afternoon:0}}})).toBeNull();
});
