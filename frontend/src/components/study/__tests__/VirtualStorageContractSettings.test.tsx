import React,{useState} from 'react';
import '@testing-library/jest-dom/vitest';
import {it,expect} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import Settings,{type VirtualStorageContract} from '../VirtualStorageContractSettings';
it('conserve les dates et la référence explicites de sortie OA sans confirmer une sortie par défaut',()=>{
 function Form(){const[value,set]=useState<VirtualStorageContract>({});return <><Settings value={value} onChange={set}/><output>{JSON.stringify(value)}</output></>;}
 render(<Form/>);
 expect(screen.getByLabelText('Contrat d’obligation d’achat actuel')).toHaveValue('unconfirmed');
 fireEvent.change(screen.getByLabelText('Contrat d’obligation d’achat actuel'),{target:{value:'active'}});
 fireEvent.change(screen.getByLabelText('Début prévu de la batterie virtuelle'),{target:{value:'2026-10-01'}});
 fireEvent.change(screen.getByLabelText('Date effective de sortie ou de renonciation à l’OA'),{target:{value:'2026-09-30'}});
 fireEvent.change(screen.getByLabelText('Référence du justificatif de sortie ou de renonciation'),{target:{value:'courrier-2026-09-15'}});
 expect(JSON.parse(screen.getByRole('status').textContent??'{}')).toEqual({oa_contract_status:'active',virtual_storage_start_date:'2026-10-01',oa_exit_effective_date:'2026-09-30',oa_exit_document_reference:'courrier-2026-09-15'});
});
