import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createTreeShadingRouter} from '../services/shading/trees/crmRouter.js';
import {applyOpacity,withUncertainty} from '../services/shading/trees/uncertainty.js';

test('opacity scenarios preserve weighted components and exact transparent/opaque ordering',()=>{
  const monthly=Array.from({length:12},(_,i)=>({baseline:100,directLost:20,diffuseLost:10}));
  const r={hash:'source',lossPercent:30,baselineKwhM2:1.2,months:monthly.map((m,i)=>({month:i+1,baseline:100,lost:30,lossPercent:30})),hours:[{hourUTC:12,baseline:1200,lost:360}],hourly:monthly.map((m,i)=>({time:`2023-${String(i+1).padStart(2,'0')}-01T12:00:00Z`,irradiance:100,directLost:20,diffuseLost:10,lost:30})),panels:[{id:'P1',baseline:1200,monthly}]};
  const q=withUncertainty(r);assert(q.uncertainty.low<q.lossPercent);assert(q.lossPercent<q.uncertainty.high);assert(q.uncertainty.high<q.opaqueLossPercent);
  assert(Math.abs(q.lostKwhM2-q.directLostKwhM2-q.diffuseLostKwhM2)<1e-12);assert(Math.abs(applyOpacity(r,'high').lossPercent-29.4)<1e-12);
  assert.notEqual(q.hash,r.hash);
});
