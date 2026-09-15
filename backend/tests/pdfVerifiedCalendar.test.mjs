import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEnergyReference} from '../services/energyReference.service.js';
import {bindCalendar,calendarFromInstants} from '../services/energyCalendar.service.js';
import {applyVerifiedEnergyPresentation} from '../services/pdf/verifiedEnergyPresentation.js';
const blank=()=>({meta:{},production:{},savings:{},fullReport:{p3:{energy_summary:{}},p4:{},p5:{},p6:{p6:{}},p7:{},p10:{best:{}}}});
test('PDF référence courante conserve les 366 jours et les crédits par heure Europe/Paris',()=>{
 const instants=Array.from({length:8784},(_,i)=>new Date(Date.UTC(2023,11,31,23)+i*3600000).toISOString());
 const calendar=calendarFromInstants(instants);
 const load=bindCalendar(Array(8784).fill(1),calendar),pv=bindCalendar(Array(8784).fill(0),calendar);
 const ref=buildEnergyReference({pv,load});
 const used=Array(8784).fill(0);used[0]=1;
 ref.virtual_credit={used_kwh:1,hourly_used_kwh:used};
 const vm=applyVerifiedEnergyPresentation(blank(),ref);
 assert.equal(vm.meta.results_version,'ac-energy-ledger-2');
 assert.equal(vm.fullReport.p4.consommation_annuelle,8784);
 assert.match(vm.fullReport.p5.profile_notes.production,/366 jours.*Europe\/Paris/);
 assert.equal(vm.fullReport.p5.credit_kw[0],1/366);
 assert.equal(vm.fullReport.p5.credit_kw[23],0);
});
test('lecture historique énergie v1 garde ses valeurs et explicite son ancien calendrier UTC',()=>{
 const ref=buildEnergyReference({pv:Array(8760).fill(1),load:Array(8760).fill(2)});ref.version='ac-energy-ledger-1';
 const vm=applyVerifiedEnergyPresentation(blank(),ref);
 assert.equal(vm.fullReport.p4.production_annuelle,8760);
 assert.match(vm.fullReport.p5.profile_notes.production,/365 jours.*UTC \(historique\)/);
});
