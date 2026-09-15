import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('PDF rendering never posts consumption to ERP with production API configured',()=>{
  let listener,posts=0;
  const window={location:{hostname:'example.test'},__VITE_API_URL__:'https://api.example.test',API:{}};
  const document={getElementById:id=>id==='pdf-app'?{}:null};
  vm.runInNewContext(fs.readFileSync(new URL('../../frontend/public/pdf-engines/engine-p1.js',import.meta.url),'utf8'),{window,document,console,fetch:()=>{posts++;return Promise.resolve({json:async()=>({})});}});
  window.API.bindEngineP1({on:(_event,callback)=>{listener=callback;},getP1:()=>null});
  listener({p1_auto:{p1_ref:'SYNTHETIC-STUDY',p1_param_conso:12000}});
  assert.equal(posts,0);
});
