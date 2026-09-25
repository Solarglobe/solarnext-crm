/** Local renderer integration control. Requires privately prepared, validated view-models.
 * No DB connection, document persistence, portal publication or deployment.
 * Usage: node backend/scripts/render-verified-pdf-controls.mjs <vm-directory> <new-output-directory> [vite-origin]
 */
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {assertStudySnapshotExportable} from '../services/studyExportValidation.service.js';
const [inputDir,outputDir,origin='http://127.0.0.1:5183']=process.argv.slice(2);
if(!inputDir||!outputDir)throw new Error('Private VM directory and new output directory required');
fs.mkdirSync(outputDir,{recursive:true});
const jobs=fs.readdirSync(inputDir).filter(f=>/^vm-.*\.json$/.test(f)).map(file=>({file,vm:JSON.parse(fs.readFileSync(path.join(inputDir,file),'utf8'))}));
if(!jobs.length)throw new Error('No prepared view models');
for(const {file,vm} of jobs){assertStudySnapshotExportable(vm.selected_scenario_snapshot);if(fs.existsSync(path.join(outputDir,(vm.control_export_filename??file.replace('.json','.pdf')))))throw new Error('Output exists: choose a versioned directory');}
const browser=await chromium.launch({headless:true});
const evidence=[];
async function worker(offset){
 const context=await browser.newContext();const page=await context.newPage();let currentVm;
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 // Vite's development asset routing differs from the deployed renderer. Serve
 // the actual repository engines locally; no substitutions of calculation code.
 await page.route('**/pdf-engines/*.js',r=>r.fulfill({path:path.resolve('frontend/public','.'+new URL(r.request().url()).pathname),contentType:'application/javascript'}));
 await page.route('**/api/internal/pdf-view-model/**',r=>r.fulfill({json:{ok:true,viewModel:currentVm}}));
 for(let i=offset;i<jobs.length;i+=2){
  const {file,vm}=jobs[i];currentVm=vm;errors.length=0;
  await page.goto(`${origin}/pdf-render.html?studyId=local-control&versionId=${encodeURIComponent(file)}&renderToken=local-control`,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__pdf_render_ready===true&&document.querySelector('#p6_chart_zone')?.style.display==='block');
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(im=>im.complete?Promise.resolve():new Promise(resolve=>{im.onload=resolve;im.onerror=resolve})));});
  assert.deepEqual(errors,[],`Renderer errors in ${file}`);
  const text=await page.locator('body').innerText();
  const norm=s=>s.replace(/\s/g,'');const a=vm.results_reference.annual;
  const expected=Math.round(a.production_kwh).toLocaleString('fr-FR');
  for(const id of ['p3','p4','p7'])assert.ok(norm(await page.locator('#'+id).innerText()).includes(norm(expected)),`${file}: inconsistent annual production in ${id}`);
  assert.ok(text.includes(vm.results_reference.input_hash),'Missing result provenance');
  if(vm.results_reference.virtual_credit) assert.ok((await page.locator('#p6').innerText()).includes('avant crédit et frais de service'),'Physical import cost must be distinguished from the bill after virtual credit');
  assert.ok(!(await page.locator('#p6').innerText()).includes('Crédit virtuel restitué'),'Physical energy chart must not label a virtual credit as a local discharge');
  assert.ok(text.includes(vm.fullReport.p1.p1_auto.p1_client),'Wrong client/scenario context');
  const geometry=await page.evaluate(()=>[...document.querySelectorAll('.pdf-legacy-port > section')].map(s=>({id:s.id,height:s.getBoundingClientRect().height,scroll:s.scrollHeight,client:s.clientHeight})));
  assert.ok(geometry.length>=11,'Missing PDF pages');
  assert.ok(geometry.every(p=>p.scroll<=p.client+1),'Content extends beyond a page');
  const out=path.join(outputDir,(vm.control_export_filename??file.replace('.json','.pdf')));
  await page.pdf({path:out,format:'A4',printBackground:true,preferCSSPageSize:true});
  fs.writeFileSync(path.join(inputDir,file.replace('.json','-render.txt')),text);
  evidence.push({file,scenario:vm.results_reference.scenario_id,input_hash:vm.results_reference.input_hash,pages:geometry,console_errors:errors.length});
  console.log('PDF_RENDER_VERIFIED',file);
 }
 await context.close();
}
try{await Promise.all([worker(0),worker(1)]);}finally{await browser.close();}
fs.writeFileSync(path.join(outputDir,'renderer-verification.json'),JSON.stringify(evidence,null,2));
