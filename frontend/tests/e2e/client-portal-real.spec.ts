import {test,expect} from '@playwright/test';
import fs from 'node:fs';

test('Portail réel : résultat courant, téléchargement, historique et refus après modification',async({page,context,browserName},testInfo)=>{
  test.setTimeout(300000);
  const fixtureFile=process.env.E2E_PORTAL_FIXTURES;
  test.skip(!fixtureFile,'E2E_PORTAL_FIXTURES requis : API et PostgreSQL locaux, trois dossiers entièrement fictifs distincts.');
  const fixture=JSON.parse(fs.readFileSync(fixtureFile!,'utf8'))[browserName];
  expect(fixture.data_note).toContain('Fictional client');
  const api=new URL(fixture.base_url),front=new URL(fixture.frontend_url);
  expect(api.hostname).toBe('127.0.0.1');expect(api.port).toBe('4138');expect(front.hostname).toBe('127.0.0.1');expect(front.port).toBe('5199');
  const errors:string[]=[];const requests:string[]=[];let expectedStale=false;
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!(expectedStale&&m.text().includes('409')))errors.push(m.text());});
  page.on('response',r=>{if(r.status()>=500)errors.push(`${r.status()} ${new URL(r.url()).pathname}`);});
  page.on('request',r=>requests.push(new URL(r.url()).pathname.replace(/\/client-portal\/[^/]+/,'/client-portal/[redacted]')));
  const login=await context.request.post(api.href+'auth/login',{data:{email:fixture.email,password:fixture.password}});expect(login.status()).toBe(200);
  const staffToken=(await login.json()).token;const headers={Authorization:'Bearer '+staffToken};
  const base=`/api/studies/${fixture.study}/versions/${fixture.version}`;
  const quote=await context.newPage();await quote.goto(front.href+`studies/${fixture.study}/versions/${fixture.version}/quote-builder`);
  await expect(quote.getByLabel(/^Horizon/)).toBeVisible();
  if(await quote.getByLabel(/^Horizon/).inputValue()==='30'){
    const reset=quote.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/quote-prep')&&JSON.parse(r.request().postData()!).finance_projection?.horizon_years===25);
    await quote.getByLabel(/^Horizon/).selectOption('25');expect((await reset).status()).toBe(200);
  }
  const save=quote.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/quote-prep')&&JSON.parse(r.request().postData()!).finance_projection?.horizon_years===30);
  await quote.getByLabel(/^Horizon/).selectOption('30');expect((await save).status()).toBe(200);
  const calculation=quote.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/validate-devis-technique'),{timeout:180000});
  await quote.getByRole('button',{name:'Valider le devis technique',exact:true}).click();expect((await calculation).status()).toBe(200);
  const physicalCard=quote.locator('.scenario-col-card').filter({has:quote.getByRole('button',{name:'Choisir batterie physique',exact:true})});
  await physicalCard.getByRole('checkbox',{name:'Ajouter aux documents',exact:true}).check();
  const pdf=quote.waitForResponse(r=>r.url().endsWith('/generate-pdf-from-scenario')&&r.request().method()==='POST',{timeout:180000});
  await physicalCard.getByRole('button',{name:'Choisir batterie physique',exact:true}).click();const generated=await pdf;expect(generated.status()).toBe(200);const generation=await generated.json();expect(generation.success).toBe(true);expect(['created','existing']).toContain(generation.leadDocument?.status);
  // Explicit staff sharing on a fictional dossier; generation alone must not
  // silently make a document client-visible.
  const leadDocuments=await context.request.get(api.href+`api/documents/lead/${fixture.lead}`,{headers});expect(leadDocuments.status()).toBe(200);
  const sharedDocument=(await leadDocuments.json()).find((doc:any)=>doc.id===generation.leadDocument.id);expect(sharedDocument).toBeTruthy();expect(sharedDocument.document_type).toBe('study_pdf');
  const shared=await context.request.patch(api.href+`api/documents/${sharedDocument.id}`,{headers,data:{is_client_visible:true}});expect(shared.status()).toBe(200);
  const portalTokenResponse=await context.request.post(api.href+`api/leads/${fixture.lead}/client-portal-token`,{headers,data:{}});expect(portalTokenResponse.status()).toBe(201);
  const portalToken=(await portalTokenResponse.json()).token;
  const loaded=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/client-portal/${portalToken}`);
  await page.goto(front.href+'client-portal/'+portalToken);const payload=await(await loaded).json();expect(payload.summary.offer.kind).toBe('scenario');
  await expect(page.locator('.cp-summary-offer--amount')).toContainText(payload.summary.offer.headline);
  expect(requests.some(p=>p.endsWith('/results-history'))).toBe(false);
  const row=page.locator('.cp-doc-row').filter({has:page.locator('a[href*="/api/client-portal/documents/"]')}).first();
  const downloadLink=row.getByRole('link',{name:'Télécharger',exact:true});await expect(downloadLink).toBeVisible();
  const downloadEvent=page.waitForEvent('download');await downloadLink.click();const download=await downloadEvent;
  const file=testInfo.outputPath('portail-courant-30ans.pdf');await download.saveAs(file);const bytes=fs.readFileSync(file);expect(bytes.subarray(0,5).toString()).toBe('%PDF-');expect(bytes.length).toBeGreaterThan(30000);
  await page.screenshot({path:testInfo.outputPath('portail-courant.png'),fullPage:true});
  const historical=page.waitForResponse(r=>r.url().includes('/results-history'));
  await page.getByRole('button',{name:'Consulter les résultats précédents',exact:true}).click();const historyResponse=await historical;expect(historyResponse.status()).toBe(200);const history=await historyResponse.json();expect(history.items.length).toBeGreaterThan(0);expect(history.items.every((r:any)=>r.export_blocked===true)).toBe(true);
  const region=page.getByRole('region',{name:'Résultats précédents'});await expect(region.getByText(/Projection sur 25 ans/).first()).toBeVisible();await expect(region.getByText(/Consultation historique/)).toBeVisible();expect(await region.getByRole('link').count()).toBe(0);
  await page.screenshot({path:testInfo.outputPath('portail-historique.png'),fullPage:true});
  await quote.goto(front.href+`studies/${fixture.study}/versions/${fixture.version}/quote-builder`);
  const growthField=quote.getByLabel('Hausse abonnements fournisseur avant et après (%/an)',{exact:true});
  const newGrowth=Number(await growthField.inputValue())===3?4:3;
  const changed=quote.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/quote-prep')&&JSON.parse(r.request().postData()!).finance_projection?.supplier_subscription_growth_pct===newGrowth);
  await growthField.fill(String(newGrowth));expect((await changed).status()).toBe(200);
  const freshness=await context.request.get(api.href.slice(0,-1)+base+'/scenarios/freshness',{headers});expect((await freshness.json()).export_blocked).toBe(true);
  expectedStale=true;const refused=page.waitForResponse(r=>new URL(r.url()).pathname.includes('/client-portal/documents/'));
  await downloadLink.click();expect((await refused).status()).toBe(409);
  await expect(row.getByRole('alert')).toContainText('Ce document doit être recalculé');
  const exportResponse=await context.request.post(api.href.slice(0,-1)+base+'/generate-pdf-from-scenario',{headers,data:{scenario_id:'BATTERY_PHYSICAL'}});expect(exportResponse.status()).toBe(409);
  await expect(region.getByText(/Consultation historique/)).toBeVisible();expect(errors).toEqual([]);
  await testInfo.attach('portal-proof',{body:JSON.stringify({browser:browserName,current_pdf_bytes:bytes.length,historical_results:history.items.length,stale_download_status:409,stale_export_status:409,errors}),contentType:'application/json'});
});
