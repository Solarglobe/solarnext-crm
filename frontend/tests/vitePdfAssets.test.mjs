import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from '../node_modules/vite/dist/node/index.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('Vite sert les engines PDF comme JavaScript, sans réécriture SPA',async()=>{
 const cacheRoot=path.resolve(os.tmpdir());
 const cacheDir=await mkdtemp(path.join(cacheRoot,'solarglobe-vite-pdf-assets-'));
 const server=await createServer({root,cacheDir,configFile:path.join(root,'vite.config.ts'),server:{host:'127.0.0.1',port:0,strictPort:false},logLevel:'error'});
 try{
  await server.listen();const address=server.httpServer.address();const base=`http://127.0.0.1:${address.port}`;
  for(const file of ['engine-bridge.js','engine-p9.js','engine-p11.js']){
   const response=await fetch(`${base}/pdf-engines/${file}`);assert.equal(response.status,200,file);
   assert.match(response.headers.get('content-type'),/javascript/,file);
   const source=await response.text();assert.ok(source.includes('window.Engine'),file);assert.ok(!source.includes('<!DOCTYPE html>'),file);
  }
 }finally{
  await server.close();
  assert.equal(path.dirname(cacheDir),cacheRoot);
  assert.ok(path.basename(cacheDir).startsWith('solarglobe-vite-pdf-assets-'));
  await rm(cacheDir,{recursive:true,force:true});
 }
});
