import {useEffect,useMemo,useRef,useState} from 'react';

import {apiFetch} from '../../services/api';
import {buildApiUrl} from '../../config/crmApiBase';
import html from '../../../calpinage/trees/index.html?raw';
import css from '../../../calpinage/trees/style.css?raw';
import code from '../../../calpinage/trees/app.js?raw';
import geometry from '../../../../shared/shading/treeGeometry.mjs?raw';

/** Same editor as the real-data proof, routed through CRM auth and version scope. */
export function TreeShadingFrame({studyId,versionId,onChange}:{studyId:string;versionId:string;onChange?:()=>void}){const frame=useRef<HTMLIFrameElement>(null);const [height,setHeight]=useState(2100);
  const srcDoc=useMemo(()=>html.replace('<link rel="stylesheet" href="style.css">',`<style>${css}</style>`).replace('<script type="module" src="app.js"></script>',`<script>window.__TREE_CRM__=true;window.__TREE_EMBEDDED__=true;</script><script type="module">${geometry.replace(/^export /gm,'')};\n${code.replace(/^import[^\n]+\n/,'')}</script>`),[]);
  useEffect(()=>{
    let disposed=false;
    const handler=async(event:MessageEvent)=>{
      if(event.source!==frame.current?.contentWindow||event.origin!==window.location.origin)return;
      const m=event.data;if(m?.kind==='tree-height'){if(Number.isFinite(m.height))setHeight(Math.min(6000,Math.max(1000,m.height)));return;}
      if(m?.kind==='tree-changed'){onChange?.();return;}
      if(m?.kind!=='tree-request'||typeof m.id!=='string'||typeof m.path!=='string')return;
      if(!/^\/(?:api\/(?:scene|acquire|instant|calculate|pdf)|ortho\.png)(?:\?[^#]*)?$/.test(m.path)||!['GET','POST'].includes(m.method))return;
      const suffix=m.path.replace(/^\/api/,'');const base=`/api/studies/${encodeURIComponent(studyId||'')}/versions/${encodeURIComponent(versionId||'')}/tree-shading`;
      try{
        const response=await apiFetch(buildApiUrl(base+suffix),{method:m.method,...(m.method==='POST'?{headers:{'Content-Type':'application/json'},body:JSON.stringify(m.body)}:{}),timeoutMs:240000,skipErrorToast:true});
        const body=await response.arrayBuffer();if(disposed)return;
        frame.current?.contentWindow?.postMessage({kind:'tree-response',id:m.id,status:response.status,type:response.headers.get('Content-Type'),body},window.location.origin,[body]);
      }catch(e){if(!disposed)frame.current?.contentWindow?.postMessage({kind:'tree-response',id:m.id,status:422,type:'application/json',body:new TextEncoder().encode(JSON.stringify({error:e instanceof Error?e.message:'Erreur CRM'})).buffer},window.location.origin);}
    };
    window.addEventListener('message',handler);return()=>{disposed=true;window.removeEventListener('message',handler);};
  },[studyId,versionId,onChange]);
  return <iframe key={`${studyId}:${versionId}`} ref={frame} title="Détails de l’ombrage des arbres" srcDoc={srcDoc} style={{width:'100%',height,border:0,borderRadius:12}}/>;
}
