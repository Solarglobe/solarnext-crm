import {useId, useState, type ReactNode} from 'react';
import {Button} from '../ui/Button';
export type StudySource = 'Compteur client'|'Paramètre général'|'Personnalisé pour cette étude'|'Calculé automatiquement';
export function SourceBadge({source}:{source:StudySource}) {
  return <span className={`sqb-source sqb-source--${source==='Personnalisé pour cette étude'?'custom':source==='Calculé automatiquement'?'computed':'inherited'}`}>{source}</span>;
}
export function StudySwitch({checked,onChange,disabled,label,description}:{checked:boolean;onChange:(next:boolean)=>void;disabled?:boolean;label:string;description?:string}) {
  const id=useId();
  return <div className="sqb-switch-row"><div><span id={id} className="sqb-switch-label">{label}</span>{description&&<p className="sqb-help">{description}</p>}</div><button type="button" role="switch" aria-checked={checked} aria-labelledby={id} disabled={disabled} onClick={()=>onChange(!checked)} className="sqb-switch"><span/></button></div>;
}
export function StudyHelp({label,children}:{label:string;children:ReactNode}) {
  const id=useId();const[open,setOpen]=useState(false);
  return <span className={`sqb-info${open?' is-open':''}`}><button type="button" className="sqb-info-trigger" aria-label={label} aria-describedby={id} onClick={()=>setOpen(!open)} onKeyDown={e=>{if(e.key==='Escape')setOpen(false);}}>{label} <span aria-hidden="true">ⓘ</span></button><span role="tooltip" id={id} className="sqb-info-content">{children}</span></span>;
}
export function InheritedNumber({label,value,fallback,unit,disabled,onChange,help,min=0,max=100}:{label:string;value?:number;fallback:number|null;unit:string;disabled?:boolean;onChange:(v:number|undefined)=>void;help?:string;min?:number;max?:number}) {
  const id=useId();const custom=value!=null;
  return <div className="sqb-source-value"><div className="sqb-value-heading"><span id={id}>{label}</span><SourceBadge source={custom?'Personnalisé pour cette étude':'Paramètre général'}/></div>
    {custom?<label className="sqb-inline-number"><input aria-labelledby={id} className="sn-input" type="number" min={min} max={max} step="0.1" disabled={disabled} value={value} onChange={e=>onChange(e.target.value===''?undefined:Number(e.target.value))}/><span>{unit}</span></label>:<strong className="sqb-read-value">{fallback==null?'Non disponible':`${fallback.toLocaleString('fr-FR')} ${unit}`}</strong>}
    {help&&<p className="sqb-help">{help}</p>}
    <Button variant="ghost" size="sm" disabled={disabled||(!custom&&fallback==null)} onClick={()=>onChange(custom?undefined:fallback!)}>{custom?'Revenir à la valeur par défaut':'Personnaliser pour cette étude'}</Button>
  </div>;
}
