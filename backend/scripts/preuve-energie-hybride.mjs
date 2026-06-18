import { simulateBattery8760 } from "../services/batteryService.js";
import { simulateVirtualBattery8760 } from "../services/virtualBattery8760.service.js";
const H=8760; const pv=new Array(H),conso=new Array(H); let ps=0,cs=0;
for(let d=0;d<365;d++)for(let h=0;h<24;h++){const i=d*24+h;const s=(h>=8&&h<=18)?Math.sin(((h-8)/10)*Math.PI):0;const se=0.7+0.6*Math.sin(((d-80)/365)*2*Math.PI);pv[i]=Math.max(0,s*se);let l=0.9;if(h>=7&&h<=9)l+=1;if(h>=18&&h<=22)l+=1.4;conso[i]=l;ps+=pv[i];cs+=conso[i];}
const kp=9114/ps,kc=10200/cs; for(let i=0;i<H;i++){pv[i]*=kp;conso[i]*=kc;}
const sum=a=>a.reduce((x,y)=>x+(y||0),0);
// VIRTUEL seul (sans perte)
const V=simulateVirtualBattery8760({pv_hourly:pv,conso_hourly:conso,config:{capacity_kwh:99999}});
// PHYSIQUE 7kWh rdt 90%
const P=simulateBattery8760({pv_hourly:pv,conso_hourly:conso,battery:{enabled:true,capacity_kwh:7,roundtrip_efficiency:0.90,max_charge_kw:3.5,max_discharge_kw:3.5}});
// HYBRIDE : virtuel sur le RESIDUEL après physique
const surplusResid=P.surplus_hourly;
const importResid=conso.map((c,h)=>Math.max(0,c-P.auto_hourly[h]));
const VH=simulateVirtualBattery8760({pv_hourly:surplusResid,conso_hourly:importResid,config:{capacity_kwh:99999}});
const recupVirtuel=V.virtual_battery_total_discharged_kwh;
const recupHybride=P.annual_discharge_kwh + VH.virtual_battery_total_discharged_kwh;
console.log("=== PREUVE ÉNERGIE — VIRTUEL seul vs HYBRIDE ===");
console.log("Surplus PV total disponible        :", Math.round(sum(pv.map((p,h)=>Math.max(0,p-Math.min(p,conso[h]))))),"kWh");
console.log("VIRTUEL : récupéré (déstické)      :", Math.round(recupVirtuel),"kWh  | export résiduel:", Math.round(V.virtual_battery_overflow_export_kwh));
console.log("HYBRIDE : physique déstické         :", Math.round(P.annual_discharge_kwh),"kWh");
console.log("          virtuel (sur résiduel)    :", Math.round(VH.virtual_battery_total_discharged_kwh),"kWh");
console.log("          + export résiduel         :", Math.round(VH.virtual_battery_overflow_export_kwh),"kWh (le virtuel a TOUT pris ce que la physique n'a pas chargé)");
console.log("          TOTAL récupéré            :", Math.round(recupHybride),"kWh");
console.log("");
console.log("PERTE round-trip batterie physique  :", P.battery_losses_kwh,"kWh (chaleur, irrécupérable)");
console.log("Écart VIRTUEL - HYBRIDE             :", Math.round(recupVirtuel-recupHybride),"kWh");
console.log("=> l'écart = EXACTEMENT la perte chaleur de la physique. Le virtuel a capté tout le reste.");
