import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
const component=new URL('../src/pages/settings/mail/MailHealthPanel.tsx',import.meta.url);
let source;
if(existsSync(component))source=readFileSync(component,'utf8');
else {
  const page=readFileSync(new URL('../src/pages/settings/mail/MailAccountsTab.tsx',import.meta.url),'utf8');
  source='export default function MailHealthPanel({health}) { return <>'+page.slice(page.indexOf('{health ? ('),page.indexOf('{addOpen ? ('))+'</>; }';
}
const exports={};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,require:name=>name==='react/jsx-runtime'?jsx:React});
const counts={pending:70,scanning:70,unavailable:70,retryScheduled:70,exhausted:70,clean:70,infected:70,failedUnscheduled:0,unknown:0,total:490};
const data=()=>({queues:{outboxDepth:0,draftJobsDepth:3,sentArchivePending:0,flagJobsDepth:0,moveJobsDepth:0,scanPending:70,scanInfected:70,draftConflicts:1},
  scans:{messages:{...counts},drafts:{...counts,pending:2,total:422},maxAttempts:6},
  jobs:{drafts:{queued:1,retrying:1,running:1,completed:5,failed:2},sentArchive:{queued:0,retrying:0,running:2,completed:3,failed:0}},
  scanner:{availability:'unavailable',required:true,provider:'clamav',errorCode:'SCANNER_UNAVAILABLE'}});
const render=h=>renderToStaticMarkup(React.createElement(exports.default,{health:h}));
test('M9 real panel renders separate 490-item categories, never 490 pending',()=>{
  const html=render(data());
  for(const text of['En attente : 70','En cours : 70','Nouvelle tentative prévue : 70','Tentatives épuisées : 70','Scanner indisponible : 70','Propres : 70','Infectés / bloqués : 70'])assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/attente[^<]*490/);assert.match(html,/Brouillons/);
});
for(const [availability,label]of[['available','Disponible'],['unavailable','Indisponible'],['unknown','État inconnu'],['disabled','Désactivé']])test(`M9 scanner ${availability}`,()=>{
  const h=data();h.scanner.availability=availability;assert.ok(render(h).includes(label));
});
test('M9 missing old API details are unknown rather than fabricated zero or pending',()=>{
  const h=data();delete h.scans;delete h.scanner;delete h.jobs;
  const html=render(h);assert.match(html,/État inconnu/);assert.match(html,/Détail des scans indisponible/);
});
test('M9 draft running/completed/failed states and conflicts are visible',()=>{
  const html=render(data());assert.match(html,/En cours : 1/);assert.match(html,/Terminés : 5/);assert.match(html,/Échoués : 2/);assert.match(html,/Conflits de brouillons : 1/);
});
test('M9 accounts page mounts the health component',()=>{
  const page=readFileSync(new URL('../src/pages/settings/mail/MailAccountsTab.tsx',import.meta.url),'utf8');
  assert.match(page,/<MailHealthPanel health=\{health\}/);
});
