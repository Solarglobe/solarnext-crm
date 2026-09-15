import React from 'react';
import '@testing-library/jest-dom/vitest';
import {describe,it,expect,vi,beforeEach} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import InstallerPanel from '@/modules/installers/InstallerQuotePrepPanel';
import {computeInstallerInstallationCost} from '@/services/installers.service';
vi.mock('@/services/installers.service',()=>({listInstallers:vi.fn(async()=>[{id:'ohelec',name:'OHELEC'}]),computeInstallerInstallationCost:vi.fn(async(_id,payload)=>({installer:{id:'ohelec',name:'OHELEC'},tariff_version:{version_label:'Test'},requested_power_wc:9000,matched_power_wc:9000,installation_type:'ROOF_SUPERIMPOSED',electrical_type:payload.electrical_type,base_amount_ht_cents:260000,final_total_ht_cents:payload.electrical_type==='TRI'?285000:260000,final_total_vat_cents:payload.electrical_type==='TRI'?57000:52000,final_total_ttc_cents:payload.electrical_type==='TRI'?342000:312000,options:[],electrical_adjustments:payload.electrical_type==='TRI'?[{code:'TRI',label:'Supplément triphasé',amount_ht_cents:25000}]:[],calculated_at:new Date().toISOString()}))}));
describe('phase détectée et choix technique',()=>{
  beforeEach(()=>{vi.mocked(computeInstallerInstallationCost).mockClear();});
  it('ne transforme pas la détection en choix et transmet TRI seulement après choix explicite',async()=>{
    const saved=vi.fn();render(<InstallerPanel detectedPhase="TRI" projectPowerWc={9000} locked={false} onPersisted={saved} autoCompute={false} saveToQuotePrep={false}/>);
    const select=screen.getByRole('combobox',{name:'Électrique'});expect(select).toHaveValue('');
    await waitFor(()=>expect(screen.getByRole('button',{name:'Calculer l’installation RGE'})).toBeEnabled());
    expect(computeInstallerInstallationCost).not.toHaveBeenCalled();
    fireEvent.change(select,{target:{value:'TRI'}});fireEvent.click(screen.getByRole('button',{name:'Calculer l’installation RGE'}));
    await waitFor(()=>expect(saved).toHaveBeenCalled());
    expect(vi.mocked(computeInstallerInstallationCost).mock.calls[0][1].electrical_type).toBe('TRI');
    expect(saved.mock.calls[0][0].final_total_ttc_cents-312000).toBe(30000);
  });
  it('exige confirmation explicite de la différence et la transmet',async()=>{
    const decision=vi.fn();render(<InstallerPanel detectedPhase="TRI" projectPowerWc={9000} locked={false} onPersisted={()=>{}} onPhaseDecision={decision} autoCompute={false} saveToQuotePrep={false}/>);
    await waitFor(()=>expect(screen.getByRole('button',{name:'Calculer l’installation RGE'})).toBeEnabled());
    fireEvent.change(screen.getByRole('combobox',{name:'Électrique'}),{target:{value:'MONO'}});
    fireEvent.click(screen.getByRole('button',{name:'Calculer l’installation RGE'}));
    expect(computeInstallerInstallationCost).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox',{name:/Je confirme la phase/}));
    expect(decision).toHaveBeenLastCalledWith({detected_phase:'TRI',retained_phase:'MONO',difference_confirmed:true});
    fireEvent.click(screen.getByRole('button',{name:'Calculer l’installation RGE'}));
    await waitFor(()=>expect(computeInstallerInstallationCost).toHaveBeenCalled());
  });
});
