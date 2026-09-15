import test from 'node:test';
import assert from 'node:assert/strict';
import {azimuthDegToPvgisAspect,computeFactorACForTests} from '../services/pvgisService.js';
import {buildPanHourly} from '../services/pvHourlyModel.service.js';
import {monthlySums} from '../services/energyCalendar.service.js';
// Frozen public PVGIS monthly module yields, loss=0, two mirrored directions.
// No customer record or network request is needed for this numerical regression.
const west=[15.32,30.05,64.25,93.69,114.17,115.88,115.18,94.48,69.55,41.39,18.73,12.77];
const east=[17.03,32.53,67.47,106.04,123.36,123.64,123.62,103.01,72.74,41.79,20.39,13.76];
const sum=a=>a.reduce((s,v)=>s+v,0),near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
test('Synthetic east pan maps to negative PVGIS aspect without mirroring to west',()=>{
  near(azimuthDegToPvgisAspect(90),-90);
  near(azimuthDegToPvgisAspect(270),90);
});
test('Historical rounding versus precise AC losses has an explicit reproducible bridge',()=>{
  const factor=computeFactorACForTests({form:{pv_inverter:{euro_efficiency_pct:96.5}}}).factorAC;
  const old=raw=>raw.map(v=>Math.round(Math.round(Math.round(v)*factor)*9*.99741*100)/100*.99);
  near(sum(old(west)),6363.0468);
  near(sum(old(east))-sum(old(west)),497.673);
  const precise=east.map(v=>v*factor*9*.99741*.99);
  near(sum(precise),6858.510788495546);
  near(sum(precise)-sum(old(east)),-2.209011504454);
  near(sum(precise)-(sum(old(west))-5.13702041671),500.601008912258);
});
test('A PVGIS hourly shape only redistributes the already corrected AC monthly targets',()=>{
  const factor=computeFactorACForTests({form:{pv_inverter:{euro_efficiency_pct:96.5}}}).factorAC;
  const target=east.map(v=>v*factor*9*.99741*.99);
  const hourlyReference=Array.from({length:8784},(_,i)=>({timestamp:new Date(Date.UTC(2020,0,1)+i*3600000).toISOString(),power_w:i%24>=6&&i%24<17?100:0}));
  const hourly=buildPanHourly({monthly_kwh:target,latitude:49,longitude:2,azimuth:90,tilt:45,pvgis_hourly:hourlyReference});
  monthlySums(hourly).forEach((v,i)=>near(v,target[i]));
  near(sum(hourly),6858.510788495546);
  assert.ok(Math.max(...hourly)<9,'No artificial clipping should be introduced by monthly normalization');
});
