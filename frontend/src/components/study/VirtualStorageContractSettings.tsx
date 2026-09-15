export type VirtualStorageContract = {
  oa_contract_status?: 'unconfirmed'|'active'|'terminated'|'none';
  oa_exit_effective_date?: string|null;
  oa_exit_document_reference?: string|null;
  virtual_storage_start_date?: string|null;
};
export default function VirtualStorageContractSettings({value={},onChange,disabled=false}:{value?:VirtualStorageContract;onChange:(v:VirtualStorageContract)=>void;disabled?:boolean}) {
 const set=(patch:Partial<VirtualStorageContract>)=>onChange({...value,...patch});
 return <section className="sqb-section"><h2 className="sqb-h2">Contrat de vente et passage à la batterie virtuelle</h2>
  <p>Un contrat d’obligation d’achat actif ou retenu pour ce projet doit faire l’objet d’un changement explicite avant le passage à la batterie virtuelle. Renseignez la fin ou la renonciation documentée, effective au plus tard à la date de démarrage.</p>
  <div className="sqb-financing-inline">
   <label>Contrat d’obligation d’achat actuel<select className="sn-input" disabled={disabled} value={value.oa_contract_status??'unconfirmed'} onChange={e=>set({oa_contract_status:e.target.value as VirtualStorageContract['oa_contract_status']})}><option value="unconfirmed">À confirmer</option><option value="active">Actif</option><option value="terminated">Résilié</option><option value="none">Aucun contrat OA</option></select></label>
   <label>Début prévu de la batterie virtuelle<input className="sn-input" type="date" disabled={disabled} value={value.virtual_storage_start_date??''} onChange={e=>set({virtual_storage_start_date:e.target.value||null})}/></label>
   <label>Date effective de sortie ou de renonciation à l’OA<input className="sn-input" type="date" disabled={disabled} value={value.oa_exit_effective_date??''} onChange={e=>set({oa_exit_effective_date:e.target.value||null})}/></label>
   <label>Référence du justificatif de sortie ou de renonciation<input className="sn-input" disabled={disabled} value={value.oa_exit_document_reference??''} onChange={e=>set({oa_exit_document_reference:e.target.value||null})}/></label>
  </div>
 </section>;
}
