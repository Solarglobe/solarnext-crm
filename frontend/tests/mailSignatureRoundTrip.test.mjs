import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';

const require=createRequire(import.meta.url);
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://synthetic.invalid'});
for(const key of ['window','document','HTMLElement','HTMLImageElement','HTMLAnchorElement','Node','DOMParser','MutationObserver','getComputedStyle'])Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]});
Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});
globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);globalThis.cancelAnimationFrame=clearTimeout;
const {Editor}=require('@tiptap/core');
let captured;
const hooks={forwardRef:fn=>fn,useRef:()=>({current:null}),useState:value=>[value,()=>{}],useCallback:fn=>fn,useEffect:()=>{},useImperativeHandle:()=>{}};
const cache=new Map();
const sourceRoot=process.env.MAIL_TEST_SOURCE_ROOT||fileURLToPath(new URL('../',import.meta.url));
function load(relative){
  let file=path.resolve(sourceRoot,relative);
  if(!path.extname(file))file+=existsSync(file+'.ts')?'.ts':'.tsx';
  if(cache.has(file))return cache.get(file);
  const exports={};cache.set(file,exports);
  const source=readFileSync(file,'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInThisContext('(function(exports,require){'+code+'\n})',{filename:file})(exports,name=>{
    if(name.endsWith('.css'))return{};
    if(name==='react')return hooks;
    if(name==='@tiptap/react')return{useEditor:options=>{captured=options;return null;},EditorContent:()=>null};
    if(name.startsWith('.'))return load(path.relative(sourceRoot,path.resolve(path.dirname(file),name)));
    return require(name);
  });return exports;
}
const component=load('src/pages/mail/MailHtmlEditor.tsx');
const signatures=load('src/pages/mail/mailSignatureHtml.ts');
const sanitizers=load('src/pages/mail/mailHtmlSanitize.ts');
const logic=load('src/pages/mail/mailComposerLogic.ts');
const A='<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;max-width:640px;color:#123456"><tbody><tr><td width="148" bgcolor="#C39847" style="width:148px;padding:0 16px 8px 0;vertical-align:middle;background-color:#C39847"><p style="margin:0;line-height:1.4">Signature A</p><a href="https://example.invalid">Lien</a><img src="https://example.invalid/logo.png" width="42" height="20" alt="Logo"></td></tr></tbody></table>';
const B='<p style="color:#0000ff">Signature B</p>';
const editors=[];
function editor(content,variant='composer'){
  component.MailHtmlEditor({variant,docKey:'synthetic',initialHtml:content},null);
  assert.ok(captured?.extensions?.length,'uses the actual MailHtmlEditor extension configuration');
  const ed=new Editor({...captured,element:document.createElement('div'),onUpdate:undefined});editors.push(ed);return ed;
}
after(()=>{editors.forEach(e=>e.destroy());dom.window.close();});
const parsed=html=>{const el=document.createElement('div');el.innerHTML=html;return el;};
const change=(ed,signature,mode='new')=>{const next=signatures.injectMailSignatureHtml(ed.getHTML(),signature,mode);if(next!==ed.getHTML())ed.commands.setContent(next,{emitUpdate:false});};
const count=(html,text)=>html.split(text).length-1;

test('M3 managed signature identity survives actual Tiptap HTML and JSON round trips',()=>{
  const ed=editor(signatures.wrapMailSignatureHtml(A));
  assert.equal(parsed(ed.getHTML()).querySelectorAll('[data-signature]').length,1);
  const again=editor(ed.getHTML());assert.equal(parsed(again.getHTML()).querySelectorAll('[data-signature]').length,1);
  assert.ok(JSON.stringify(ed.getJSON()).includes('mailSignature'));
});
test('M3 required table attributes/styles survive the actual editor',()=>{
  const html=editor(signatures.wrapMailSignatureHtml(A)).getHTML(),root=parsed(html),table=root.querySelector('table'),td=root.querySelector('td');
  assert.equal(table.getAttribute('cellpadding'),'0');assert.equal(table.style.borderCollapse,'collapse');
  assert.equal(td.getAttribute('width'),'148');assert.equal(td.style.paddingRight,'16px');
  assert.equal(td.style.verticalAlign,'middle');assert.ok(td.style.backgroundColor);assert.equal(root.querySelector('img').getAttribute('width'),'42');
});
test('M3 initial insert then repeated insertion never duplicates',()=>{
  const ed=editor('<p>Body</p>');change(ed,A);change(ed,A);assert.equal(count(ed.getHTML(),'Signature A'),1);
});
test('M3 Sans signature removes the current signature',()=>{
  const ed=editor(signatures.wrapMailSignatureHtml(A));change(ed,'');assert.equal(count(ed.getHTML(),'Signature A'),0);
});
test('M3 A to B replaces at the same position and preserves surrounding user text',()=>{
  const ed=editor('<p>Before</p>'+signatures.wrapMailSignatureHtml(A)+'<p>After</p>');change(ed,B);
  const text=parsed(ed.getHTML()).textContent;assert.equal(count(text,'Signature A'),0);assert.equal(count(text,'Signature B'),1);
  assert.ok(text.indexOf('Before')<text.indexOf('Signature B'));assert.ok(text.indexOf('Signature B')<text.indexOf('After'));
});
test('M3 A to B to A remains unique',()=>{
  const ed=editor(signatures.wrapMailSignatureHtml(A));change(ed,B);change(ed,A);
  assert.equal(count(ed.getHTML(),'Signature A'),1);assert.equal(count(ed.getHTML(),'Signature B'),0);
});
test('M3 draft HTML save sanitize reload remains replaceable',()=>{
  const first=editor('<p>Saved body</p>');change(first,A);
  const saved=JSON.parse(JSON.stringify({bodyHtml:sanitizers.sanitizeComposerHtml(first.getHTML())}));
  const restored=editor(saved.bodyHtml);change(restored,B);assert.equal(count(restored.getHTML(),'Signature A'),0);assert.equal(count(restored.getHTML(),'Signature B'),1);
});
for(const mode of ['reply','replyAll','forward'])test(`M3 ${mode} preserves quoted signature and changes only current signature`,()=>{
  const quote='<blockquote><p>Quoted</p>'+signatures.wrapMailSignatureHtml(A)+'</blockquote>';
  const ed=editor('<p>Answer</p>'+quote);const before=parsed(ed.getHTML()).querySelector('blockquote').innerHTML;
  change(ed,B,mode);assert.equal(parsed(ed.getHTML()).querySelector('blockquote').innerHTML,before);
  change(ed,'',mode);assert.equal(parsed(ed.getHTML()).querySelector('blockquote').innerHTML,before);
  assert.equal(count(ed.getHTML(),'Signature B'),0);
});
test('M3 quote marker is not removed even before a Tiptap round trip',()=>{
  const quote='<blockquote>'+signatures.wrapMailSignatureHtml(A)+'</blockquote>';
  const changed=signatures.injectMailSignatureHtml(quote,B,'reply');assert.equal(count(changed,'Signature A'),1);
});
test('M3 adjacent ordinary content identical to signature text is never removed',()=>{
  const ed=editor('<p>Signature A is mentioned here</p>'+signatures.wrapMailSignatureHtml(A)+'<p>Personal postscript</p>');change(ed,'');
  const text=parsed(ed.getHTML()).textContent;assert.equal(text,'Signature A is mentioned herePersonal postscript');
});
test('M3 unmarked historic HTML is preserved conservatively',()=>{
  const ed=editor('<p>Historic body</p>'+A);const before=ed.getHTML();change(ed,'');assert.equal(ed.getHTML(),before);
});
test('M3 ordinary lists links tables images and reply context remain supported',()=>{
  const ed=editor('<p>Hello <a href="https://example.invalid">link</a></p><ul><li><p>One</p></li></ul><table><tr><td><p>Cell</p></td></tr></table><p><img src="data:image/png;base64,AA==" alt="inline"></p>');
  change(ed,A);change(ed,'');const root=parsed(ed.getHTML());for(const tag of['ul','li','a','table','td','img'])assert.ok(root.querySelector(tag),tag);
  const message={direction:'INBOUND',messageId:'<parent@example.invalid>',participants:[{type:'FROM',email:'sender@example.invalid'},{type:'TO',email:'self@example.invalid'},{type:'CC',email:'other@example.invalid'}],bodyHtml:A};
  assert.equal(logic.buildReplyContext([message],'Subject').inReplyTo,message.messageId);
  assert.equal(logic.buildReplyAllContext([message],'Subject','self@example.invalid').cc,'other@example.invalid');
  assert.ok(logic.buildForwardInitialBody([message]).includes('blockquote'));
});

test('M3 legacy marked wrapper migrates to schema node and retains its ID after reload',()=>{
  const ed=editor('<div data-signature="1" data-signature-id="legacy">'+A+'</div>');
  const again=editor(ed.getHTML());assert.equal(signatures.getCurrentMailSignature(again.getHTML()).id,'legacy');
  change(again,B);assert.equal(count(again.getHTML(),'Signature A'),0);assert.equal(count(again.getHTML(),'Signature B'),1);
});
test('M3 malformed duplicate managed regions collapse without consuming user paragraphs',()=>{
  const ed=editor(signatures.wrapMailSignatureHtml(A)+'<p>Keep between</p>'+signatures.wrapMailSignatureHtml(B)+'<p>Keep after</p>');
  change(ed,A);assert.equal(count(ed.getHTML(),'data-mail-signature="1"'),1);assert.ok(ed.getHTML().includes('Keep between'));assert.ok(ed.getHTML().includes('Keep after'));
});
test('M3 managed content preserves safe presentation but rejects executable HTML and CSS resources',()=>{
  const dirty='<p class="arbitrary" data-signature-id="inner" style="position:fixed;animation:spin 1s;background-image:url(https://example.invalid/leak);padding:8px;color:red">Safe<script>alert(1)</script><iframe src="https://example.invalid"></iframe><a href="javascript:alert(1)" onclick="alert(1)">Bad link</a><img src="javascript:alert(1)" onerror="alert(1)"><div data-signature="1">Nested</div></p>';
  const html=editor(signatures.wrapMailSignatureHtml(dirty,'outer')).getHTML(),root=parsed(html);
  assert.equal(root.querySelectorAll('[data-signature]').length,1);assert.equal(root.querySelectorAll('[data-signature-id]').length,1);
  assert.equal(root.querySelector('script,iframe,[onclick],[onerror],.arbitrary'),null);
  assert.doesNotMatch(html,/javascript:|position:|animation:|background-image:|url\(/i);
  assert.match(html,/padding: 8px/);assert.match(html,/color: red/);
});
test('M3 signature preserves allowed image sources, links, alignments and solid background shorthand',()=>{
  const html=editor(signatures.wrapMailSignatureHtml('<table cellspacing="0" role="presentation"><tr><td align="right" valign="middle" bgcolor="#123456" style="background:#123456;padding:4px;text-align:right"><a href="mailto:synthetic@example.invalid">Mail</a><a href="tel:+33100000000">Phone</a><img src="cid:synthetic"><img src="data:image/png;base64,AA=="></td></tr></table>')).getHTML();
  const root=parsed(html);assert.equal(root.querySelector('td').getAttribute('align'),'right');assert.ok(root.querySelector('td').style.backgroundColor);
  assert.equal(root.querySelectorAll('a[href]').length,2);assert.equal(root.querySelectorAll('img[src]').length,2);
});
for(const quoteAttr of ['class="gmail_quote"','class="yahoo_quoted"','type="cite"'])test(`M3 explicit historical quote provenance survives div flattening: ${quoteAttr}`,()=>{
  const raw='<div '+quoteAttr+'>'+signatures.wrapMailSignatureHtml(A)+'</div>';
  assert.equal(signatures.getCurrentMailSignature(raw).present,false);
  const ed=editor(raw);assert.ok(ed.getHTML().includes('data-mail-signature-quoted="1"'));
  change(ed,B,'reply');change(ed,'','reply');assert.equal(count(ed.getHTML(),'Signature A'),1);assert.equal(count(ed.getHTML(),'Signature B'),0);
  const again=editor(sanitizers.sanitizeComposerHtml(ed.getHTML()));assert.equal(signatures.getCurrentMailSignature(again.getHTML()).present,false);
});
