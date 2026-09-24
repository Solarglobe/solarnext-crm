import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';

// Actual React composer + actual Tiptap editor; only external services are simulated.
// JSDOM resource loading is disabled. No account, server or send is involved.
const require=createRequire(import.meta.url);
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://synthetic.invalid'});
for(const key of ['window','document','HTMLElement','HTMLImageElement','HTMLAnchorElement','Node','DOMParser','MutationObserver','getComputedStyle','navigator','localStorage','File','FileReader','Blob','Event','MouseEvent'])Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]});
globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);globalThis.cancelAnimationFrame=clearTimeout;
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const rect={top:0,left:0,right:0,bottom:0,width:0,height:0};
dom.window.Range.prototype.getBoundingClientRect=()=>rect;
dom.window.Range.prototype.getClientRects=()=>[];
const React=require('react'),act=React.act||require('react-dom/test-utils').act,{createRoot}=require('react-dom/client');
const tiptap=require('@tiptap/react');
let activeEditor, saves=[], uploads=0, attachmentRows=[];
const A={id:'sig-a',name:'Synthetic A',signature_html:'<p style="color:#123456">Signature A</p>',is_default:true};
const B={id:'sig-b',name:'Synthetic B',signature_html:'<p>Signature B</p>',is_default:false};
const api={
  getSignatures:async()=>({signatures:[A,B],defaultSignature:A}),
  getTemplates:async()=>({templates:[{id:'template',name:'Synthetic template'}]}),
  renderMailTemplate:async(_id,ctx)=>({rendered:{subject:'Template subject',bodyHtml:'<p>Template body</p>'+ctx.signature}}),
  getMailRecipientSuggestions:async()=>({suggestions:[]}),
  createMailDraft:async payload=>{saves.push(structuredClone(payload));return{id:'synthetic-draft'};},
  updateMailDraft:async(_id,payload)=>{saves.push(structuredClone(payload));return{id:'synthetic-draft'};},
  deleteMailDraft:async()=>{},deleteMailDraftAttachment:async()=>{},
  listMailDraftAttachments:async()=>attachmentRows,
  downloadMailDraftAttachment:async()=>new Blob(['synthetic attachment'],{type:'text/plain'}),
  uploadMailDraftAttachment:async()=>{uploads++;return{id:'synthetic-attachment'};},
  sendMail:async()=>{assert.fail('M3 must never send');},
};
const cache=new Map(),sourceRoot=fileURLToPath(new URL('../',import.meta.url));
function load(relative){
  let file=path.resolve(sourceRoot,relative);
  if(!path.extname(file))file+=existsSync(file+'.ts')?'.ts':'.tsx';
  if(cache.has(file))return cache.get(file);
  const exports={};cache.set(file,exports);
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInThisContext('(function(exports,require){'+code+'\n})',{filename:file})(exports,name=>{
    if(name.endsWith('.css'))return{};
    if(name==='@tiptap/react')return{...tiptap,useEditor:(...args)=>{const editor=tiptap.useEditor(...args);if(editor)activeEditor=editor;return editor;}};
    if(name==='react-router-dom')return{Link:({to,children,...props})=>React.createElement('a',{...props,href:to},children)};
    if(name.endsWith('/mailApi'))return api;
    if(name.endsWith('/api'))return{apiFetch:()=>{assert.fail('Unexpected API access');}};
    if(name.endsWith('/crmApiBase'))return{getCrmApiBase:()=>''};
    if(name==='./mailComposerTemplateContext')return{buildMailComposerRenderContext:async()=>({})};
    if(name.startsWith('.'))return load(path.relative(sourceRoot,path.resolve(path.dirname(file),name)));
    return require(name);
  });return exports;
}
const {MailComposer}=load('src/pages/mail/MailComposer.tsx');
const {wrapMailSignatureHtml}=load('src/pages/mail/mailSignatureHtml.ts');
const count=(text,part)=>text.split(part).length-1;
const accounts=[{id:'synthetic-account',email:'sender@example.invalid',is_default_send_account:true,capabilities:{canSend:true}}];
const base={mode:'new',accounts,preferredAccountId:'synthetic-account',messages:[],onClose(){},onSent(){}};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function mount(props={}){
  saves=[];uploads=0;activeEditor=null;
  const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
  await act(async()=>{root.render(React.createElement(MailComposer,{...base,...props}));});
  await act(async()=>{await pause(30);});
  assert.ok(activeEditor && !activeEditor.isDestroyed);
  return{container,editor:activeEditor,async close(){await act(async()=>{root.unmount();await pause(10);});container.remove();}};
}
async function select(app,id){await act(async()=>{const field=app.container.querySelector('.mail-composer-field__select--sig');assert.ok(field);field.value=id;field.dispatchEvent(new Event('change',{bubbles:true}));});}
async function autosave(){await act(async()=>{await pause(650);});}
const draft=html=>({id:'synthetic-draft',mail_account_id:'synthetic-account',to:'recipient@example.invalid',cc:'',bcc:'',subject:'Synthetic subject',body_html:html});
after(()=>dom.window.close());

test('M3 real composer default insertion, editing around node, A/B/A/removal and autosave',async()=>{
  localStorage.clear();const app=await mount();
  try{
    assert.equal(count(app.editor.getHTML(),'Signature A'),1);
    await act(async()=>{app.editor.commands.insertContentAt(0,'<p>User before</p>');app.editor.commands.insertContentAt(app.editor.state.doc.content.size,'<p>User after</p>');});
    for(const id of ['sig-b','sig-a']){
      await select(app,id);const html=app.editor.getHTML();assert.equal(count(html,'data-mail-signature="1"'),1);
      assert.ok(html.includes('User before'));assert.ok(html.includes('User after'));
    }
    await autosave();assert.ok(saves.length);assert.equal(count(saves.at(-1).bodyHtml,'Signature A'),1);
    await select(app,'');await autosave();assert.equal(count(app.editor.getHTML(),'Signature A'),0);
    assert.ok(saves.at(-1).bodyHtml.includes('User after'));assert.equal(count(saves.at(-1).bodyHtml,'data-mail-signature'),0);
  }finally{await app.close();}
});

test('M3 server draft reload preserves selected B, surrounding text and uploaded attachment',async()=>{
  attachmentRows=[{id:'synthetic-attachment',fileName:'synthetic.txt',mimeType:'text/plain',createdAt:'2026-01-01T00:00:00Z'}];
  const app=await mount({initialDraft:draft('<p>Saved before</p>'+wrapMailSignatureHtml(B.signature_html,B.id)+'<p>Saved after</p>')});
  let saved;
  try{
    assert.equal(app.container.querySelector('.mail-composer-field__select--sig').value,'sig-b');
    assert.equal(count(app.editor.getHTML(),'Signature A'),0);assert.equal(count(app.editor.getHTML(),'Signature B'),1);
    await select(app,'sig-a');await autosave();saved=saves.at(-1);
    assert.ok(saved.bodyHtml.includes('Saved after'));assert.equal(saved.attachments[0].filename,'synthetic.txt');assert.equal(uploads,0);
  }finally{await app.close();}
  const restored=await mount({initialDraft:draft(saved.bodyHtml)});
  try{await select(restored,'sig-b');assert.equal(count(restored.editor.getHTML(),'Signature A'),0);assert.equal(count(restored.editor.getHTML(),'Signature B'),1);}
  finally{await restored.close();attachmentRows=[];}
});

test('M3 historic unmarked server draft never gains default signature and keeps ambiguous text',async()=>{
  const app=await mount({initialDraft:draft('<p>History</p><p>Signature A</p><p>Postscript</p>')});
  try{
    assert.equal(count(app.editor.getHTML(),'Signature A'),1);assert.equal(count(app.editor.getHTML(),'data-mail-signature'),0);
    assert.match(app.container.textContent,/ancienne signature sans repère/);
    await select(app,'sig-b');await select(app,'');
    assert.equal(count(app.editor.getHTML(),'Signature A'),1);assert.equal(count(app.editor.getHTML(),'Signature B'),0);assert.ok(app.editor.getHTML().includes('Postscript'));
  }finally{await app.close();}
});

test('M3 saved signature absent from settings stays intact until explicit removal',async()=>{
  const app=await mount({initialDraft:draft('<p>Body</p>'+wrapMailSignatureHtml('<p>Removed from settings</p>','old-id'))});
  try{
    assert.equal(app.container.querySelector('.mail-composer-field__select--sig').value,'__preserved__');
    assert.ok(app.editor.getHTML().includes('Removed from settings'));assert.equal(count(app.editor.getHTML(),'Signature A'),0);
    await act(async()=>{app.container.querySelector('.mail-composer__templates-item').click();});
    await act(async()=>{Array.from(app.container.querySelectorAll('button')).find(b=>b.textContent==='Ajouter à la suite').click();});
    assert.equal(count(app.editor.getHTML(),'Removed from settings'),1);
    await select(app,'');assert.ok(!app.editor.getHTML().includes('Removed from settings'));assert.ok(app.editor.getHTML().includes('Body'));
  }finally{await app.close();}
});
for(const choice of ['Ajouter à la suite','Remplacer le message'])test(`M3 template signature remains managed: ${choice}`,async()=>{
  const app=await mount();
  try{
    await act(async()=>{app.editor.commands.insertContentAt(0,'<p>Original user body</p>');});
    await act(async()=>{app.container.querySelector('.mail-composer__templates-item').click();});
    const button=Array.from(app.container.querySelectorAll('button')).find(b=>b.textContent===choice);assert.ok(button);
    await act(async()=>{button.click();});
    assert.equal(count(app.editor.getHTML(),'Signature A'),1);assert.ok(app.editor.getHTML().includes('Template body'));
    if(choice==='Ajouter à la suite')assert.ok(app.editor.getHTML().includes('Original user body'));
    await select(app,'sig-b');assert.equal(count(app.editor.getHTML(),'Signature A'),0);assert.equal(count(app.editor.getHTML(),'Signature B'),1);
  }finally{await app.close();}
});

for(const mode of ['reply','replyAll','forward'])test(`M3 real ${mode} local autosave and resume keep quote and signature identity`,async()=>{
  localStorage.clear();
  const messages=[{direction:'INBOUND',messageId:'<parent@example.invalid>',participants:[{type:'FROM',email:'remote@example.invalid'},{type:'TO',email:'sender@example.invalid'},{type:'CC',email:'other@example.invalid'}],bodyHtml:wrapMailSignatureHtml('<p>Quoted signature</p>','quoted'),subject:'Original'}];
  const props={mode,threadId:'synthetic-thread',messages,userEmail:'sender@example.invalid'};
  const app=await mount(props);let saved;
  try{
    assert.equal(count(app.editor.getHTML(),'Signature A'),1);
    const quote=app.container.querySelector('blockquote')?.innerHTML;
    await select(app,'sig-b');await autosave();
    saved=JSON.parse(localStorage.getItem(`mail_draft_synthetic-thread_${mode}`));
    assert.ok(saved.bodyHtml.includes('Signature B'));
    if(mode==='forward')assert.equal(app.container.querySelector('blockquote').innerHTML,quote);
  }finally{await app.close();}
  const restored=await mount(props);
  try{
    assert.equal(restored.container.querySelector('.mail-composer-field__select--sig').value,'sig-b');
    await select(restored,'');assert.equal(count(restored.editor.getHTML(),'Signature B'),0);
    if(mode==='forward')assert.ok(restored.editor.getHTML().includes('Quoted signature'));
  }finally{await restored.close();}
});
