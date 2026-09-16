import {PDFDocument} from 'pdf-lib';
import fs from 'node:fs/promises';
import path from 'node:path';
import {readTreeState,treeDataDir,stateDirectory} from './crmState.js';
import {renderTreePdf} from './renderTreePdf.js';
export async function appendTreeAnalysis(buffer,{organizationId,versionId,loadGeometry},{root=treeDataDir(),render=renderTreePdf}={}) {
 try { await fs.access(path.join(stateDirectory(root,organizationId,versionId),'crm-state.json')); } catch(e) { if(e.code==='ENOENT')return buffer;throw e; }
 const state=await readTreeState(root,organizationId,versionId,await loadGeometry());
 // Optional: an absent or outdated analysis contributes neither a page nor a loss.
 if(!state)return buffer;
 const annex=await render(state.scene,state.result,state.directory);
 const fresh=await readTreeState(root,organizationId,versionId,await loadGeometry());
 if(!fresh||fresh.result.hash!==state.result.hash||fresh.revision!==state.revision)throw Error('Analyse des arbres modifiée pendant le PDF : relancez l’export');
 const document=await PDFDocument.load(buffer),extra=await PDFDocument.load(annex);
 for(const page of await document.copyPages(extra,extra.getPageIndices()))document.addPage(page);
 return Buffer.from(await document.save());
}
