import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {instantaneous} from './treeEngine.js';
const root=new URL('../../../../',import.meta.url);
export async function renderTreePdf(scene,result,directory,view={}){
  const date=/^\d{4}-\d{2}-\d{2}$/.test(view.date||'')?view.date:'2023-06-21',hour=Number(view.hour??12);
  if(!Number.isFinite(Date.parse(date))||hour<4||hour>20)throw Error('Date ou heure de rendu invalide');
  const stamp=date+'T'+String(Math.floor(hour)).padStart(2,'0')+':'+String(Math.round(hour%1*60)).padStart(2,'0')+':00Z';
  const sun=instantaneous(scene,stamp);const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1400,height:1100}});
    const assets={ '/':new URL('frontend/calpinage/trees/index.html',root),'/app.js':new URL('frontend/calpinage/trees/app.js',root),'/style.css':new URL('frontend/calpinage/trees/style.css',root),'/treeGeometry.js':new URL('shared/shading/treeGeometry.mjs',root)};
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());if(url.origin!=='http://tree-render.invalid')return route.abort();
      if(url.pathname==='/api/scene')return route.fulfill({json:{scene,result}});
      if(url.pathname==='/api/instant')return route.fulfill({json:sun});
      if(url.pathname==='/ortho.png'){try{return await route.fulfill({body:await fs.readFile(directory+'/ortho.png'),contentType:'image/png'});}catch{return route.abort();}}
      const asset=assets[url.pathname];if(!asset)return route.abort();
      return route.fulfill({body:await fs.readFile(fileURLToPath(asset)),contentType:url.pathname.endsWith('.js')?'application/javascript':url.pathname.endsWith('.css')?'text/css':'text/html'});
    });
    const query=new URLSearchParams({print:'1',date,hour:String(hour),zoom:['30','50','100','150'].includes(String(view.zoom))?String(view.zoom):'50'});
    await page.goto('http://tree-render.invalid/?'+query,{waitUntil:'networkidle'});await page.waitForSelector('[data-result="computed"]');await page.waitForFunction(()=>!!document.getElementById('map').dataset.date);
    return await page.pdf({format:'A3',printBackground:true,margin:{top:'10mm',bottom:'10mm',left:'10mm',right:'10mm'}});
  }finally{await browser.close();}
}
