import { afterEach, describe, expect, it } from 'vitest';
import { minimalCalpinageRuntimeFixture } from '../../dev/minimalCalpinageRuntimeFixture';
import { clearOfficialSolarScene3DCache, getOrBuildOfficialSolarScene3DFromCalpinageRuntime } from '../officialSolarScene3DGateway';
import { computeRuntimeSceneStructuralSignatures } from '../sceneRuntimeStructuralSignature';
import { getEffectivePanelVisualShading } from '../../viewer/visualShading/effectivePanelVisualShading';
import { premiumTintHexForQualityScore } from '../../viewer/visualShading/premiumVisualShadingColors';

type Runtime = Record<string, any>;
const clone = (): Runtime => structuredClone(minimalCalpinageRuntimeFixture) as Runtime;
const ridge = (id: string, h = 5) => ({ id, a: { x: 100, y: 100, h }, b: { x: 200, y: 100, h } });
const trait = (id: string, h = 5) => ({ id, a: { x: 100, y: 200, h }, b: { x: 200, y: 200, h } });
const geometry = (scene: any) => scene ? ({
  patches: scene.roofModel.roofPlanePatches.map((p: any) => ({ id: p.id, corners: p.cornersWorld })),
  edges: scene.roofModel.roofEdges,
  ridges: scene.roofModel.roofRidges,
  shell: scene.buildingShell,
}) : null;

describe('G3 structural cache follows consumed geometry', () => {
  afterEach(clearOfficialSolarScene3DCache);
  const cases: Array<[string, (runtime: Runtime) => void]> = [
    ['add ridge', r => { r.ridges = [ridge('ridge-1')]; }],
    ['delete ridge', r => { r.ridges = []; }],
    ['move ridge endpoint/length', r => { r.ridges[0].b.x = 180; }],
    ['change ridge endpoint height', r => { r.ridges[0].a.h = 8; }],
    ['change consumed trait', r => { r.traits[0].a.h = 8; }],
    ['change contour height used by shell/roof', r => { r.contours[0].points[0].h = 8; }],
  ];
  for(const [name, mutate] of cases) it(name, () => {
    const before = clone();before.ridges = [ridge('ridge-1')];before.traits = [trait('trait-1')];
    if(name==='add ridge')before.ridges=[];
    const first = getOrBuildOfficialSolarScene3DFromCalpinageRuntime(before);
    const changed = structuredClone(before);mutate(changed);
    const current = getOrBuildOfficialSolarScene3DFromCalpinageRuntime(changed);
    const forced = getOrBuildOfficialSolarScene3DFromCalpinageRuntime(changed,{forceStructuralRebuild:true});
    expect(first.ok).toBe(true);expect(current.ok).toBe(true);expect(forced.ok).toBe(true);
    expect(current.sceneStructuralSignatures.sceneRuntimeSignature).not.toBe(first.sceneStructuralSignatures.sceneRuntimeSignature);
    expect(current.sceneSyncDiagnostics.usedSceneCache).toBe(false);
    expect(geometry(current.scene)).toEqual(geometry(forced.scene));
  });
  it('keeps cache for identical geometry and non-geometric UI data', () => {
    const base=clone();base.ridges=[ridge('r2'),{...ridge('r1'),a:{x:100,y:130,h:5},b:{x:200,y:130,h:5}}];
    base.traits=[trait('t2'),{...trait('t1'),a:{x:100,y:170,h:5},b:{x:200,y:170,h:5}}];
    const first=getOrBuildOfficialSolarScene3DFromCalpinageRuntime(base);
    const same=structuredClone(base);same.ridges.reverse();same.traits.reverse();same.uiTool='draw';
    same.pans[0].displayName='Pure UI label';same.roof.scale.source='metadata-only';
    const second=getOrBuildOfficialSolarScene3DFromCalpinageRuntime(same);
    expect(second.sceneStructuralSignatures.sceneRuntimeSignature).toBe(first.sceneStructuralSignatures.sceneRuntimeSignature);
    expect(second.sceneSyncDiagnostics.usedSceneCache).toBe(true);
    const forced=getOrBuildOfficialSolarScene3DFromCalpinageRuntime(same,{forceStructuralRebuild:true});
    expect(geometry(second.scene)).toEqual(geometry(forced.scene));
  });
  it('keeps input precedence for coincident competing lines',()=>{
    const base=clone();base.ridges=[ridge('first',5),ridge('second',8)];
    const other=structuredClone(base);other.ridges.reverse();
    expect(computeRuntimeSceneStructuralSignatures(other).roofSignature)
      .not.toBe(computeRuntimeSceneStructuralSignatures(base).roofSignature);
  });
  it('tracks generated IDs when anonymous structural lines change order',()=>{
    const base=clone();base.ridges=[
      {a:{x:100,y:100,h:5},b:{x:200,y:100,h:5}},
      {a:{x:100,y:130,h:5},b:{x:200,y:130,h:5}},
    ];
    getOrBuildOfficialSolarScene3DFromCalpinageRuntime(base);
    const swapped=structuredClone(base);swapped.ridges.reverse();
    const cached=getOrBuildOfficialSolarScene3DFromCalpinageRuntime(swapped);
    const forced=getOrBuildOfficialSolarScene3DFromCalpinageRuntime(swapped,{forceStructuralRebuild:true});
    expect(geometry(cached.scene)).toEqual(geometry(forced.scene));
  });
});

const panel=(id: string,x: number)=>({id,panId:'pan-a',enabled:true,center:{x,y:150},polygonPx:[{x:x-12,y:140},{x:x+12,y:140},{x:x+12,y:160},{x:x-12,y:160}]});
const visualRuntime=()=>{const r=clone();r.pans[0].roofType='FLAT';r.pans[0].polygonPx=r.pans[0].polygonPx.map((p: any)=>({...p,h:5}));r.shading={normalized:{totalLossPct:10,computedAt:100,perPanel:[{panelId:'pv-a',lossPct:0},{panelId:'pv-b',lossPct:20}]}};return r;};
const panels=[panel('pv-a',130),panel('pv-b',170)];
const getAllPanels=()=>structuredClone(panels);
const tint=(scene:any,id:string)=>premiumTintHexForQualityScore(getEffectivePanelVisualShading(id,scene).qualityScore01);
describe('G7 cached visual shading follows panel identity and values',()=>{
  afterEach(clearOfficialSolarScene3DCache);
  it('swaps [0,20] to [20,0] with unchanged summary and matches forced scene colors',()=>{
    const r=visualRuntime();const first=getOrBuildOfficialSolarScene3DFromCalpinageRuntime(r,{getAllPanels});
    expect(first.ok).toBe(true);expect(first.scene?.pvPanels.map(p=>p.id).sort()).toEqual(['pv-a','pv-b']);
    const colorA=tint(first.scene,'pv-a'),colorB=tint(first.scene,'pv-b');expect(colorA).not.toBe(colorB);
    r.shading.normalized.perPanel=[{panelId:'pv-a',lossPct:20},{panelId:'pv-b',lossPct:0}];
    const hit=getOrBuildOfficialSolarScene3DFromCalpinageRuntime(r,{getAllPanels});
    const forced=getOrBuildOfficialSolarScene3DFromCalpinageRuntime(r,{getAllPanels,forceStructuralRebuild:true});
    expect(hit.sceneSyncDiagnostics.usedSceneCache).toBe(true);
    expect(tint(hit.scene,'pv-a')).toBe(colorB);expect(tint(hit.scene,'pv-b')).toBe(colorA);
    expect(['pv-a','pv-b'].map(id=>tint(hit.scene,id))).toEqual(['pv-a','pv-b'].map(id=>tint(forced.scene,id)));
  });
  it('keeps visual map for row reorder and computedAt-only update, updates for one value/null/missing',()=>{
    const r=visualRuntime();const first=getOrBuildOfficialSolarScene3DFromCalpinageRuntime(r,{getAllPanels});
    r.shading.normalized.perPanel.reverse();r.shading.normalized.computedAt=200;
    const same=getOrBuildOfficialSolarScene3DFromCalpinageRuntime(r,{getAllPanels});
    expect(same.scene?.panelVisualShadingByPanelId).toBe(first.scene?.panelVisualShadingByPanelId);
    expect(same.scene?.panelVisualShadingSummary?.computedAt).toBe(200);
    r.shading.normalized.perPanel[0].lossPct=30;
    const one=getOrBuildOfficialSolarScene3DFromCalpinageRuntime(r,{getAllPanels});
    expect(one.scene?.panelVisualShadingByPanelId?.['pv-b']?.lossPct).toBe(30);
    expect(tint(one.scene,'pv-b')).toBe(tint(getOrBuildOfficialSolarScene3DFromCalpinageRuntime(r,{getAllPanels,forceStructuralRebuild:true}).scene,'pv-b'));
    r.shading.normalized.perPanel[0].lossPct=null;
    const invalid=getOrBuildOfficialSolarScene3DFromCalpinageRuntime(r,{getAllPanels});
    expect(invalid.scene?.panelVisualShadingByPanelId?.['pv-b']?.state).toBe('INVALID');
    expect(invalid.scene?.panelVisualShadingByPanelId).toEqual(getOrBuildOfficialSolarScene3DFromCalpinageRuntime(r,{getAllPanels,forceStructuralRebuild:true}).scene?.panelVisualShadingByPanelId);
    r.shading.normalized.perPanel=[];
    const missing=getOrBuildOfficialSolarScene3DFromCalpinageRuntime(r,{getAllPanels});
    expect(missing.scene?.panelVisualShadingByPanelId?.['pv-b']?.state).toBe('MISSING');
    expect(missing.scene?.panelVisualShadingByPanelId).toEqual(getOrBuildOfficialSolarScene3DFromCalpinageRuntime(r,{getAllPanels,forceStructuralRebuild:true}).scene?.panelVisualShadingByPanelId);
  });
  it('distinguishes panel add/delete via existing structural PV signature and keeps uncalculated state',()=>{
    const r=visualRuntime();const base=computeRuntimeSceneStructuralSignatures(r,{getAllPanels});
    const reordered=computeRuntimeSceneStructuralSignatures(r,{getAllPanels:()=>[panels[1],panels[0]]});
    expect(reordered.sceneRuntimeSignature).toBe(base.sceneRuntimeSignature);
    expect(computeRuntimeSceneStructuralSignatures(r,{getAllPanels:()=>[panels[0]]}).sceneRuntimeSignature).not.toBe(base.sceneRuntimeSignature);
    const two=getOrBuildOfficialSolarScene3DFromCalpinageRuntime(r,{getAllPanels});
    const one=getOrBuildOfficialSolarScene3DFromCalpinageRuntime(r,{getAllPanels:()=>[panels[0]]});
    expect(two.scene?.pvPanels.map(p=>p.id).sort()).toEqual(['pv-a','pv-b']);
    expect(one.scene?.pvPanels.map(p=>p.id)).toEqual(['pv-a']);
    const oneForced=getOrBuildOfficialSolarScene3DFromCalpinageRuntime(r,{getAllPanels:()=>[panels[0]],forceStructuralRebuild:true});
    expect(geometry(one.scene)).toEqual(geometry(oneForced.scene));
    expect(one.scene?.pvPanels).toEqual(oneForced.scene?.pvPanels);
    const newPanel=panel('pv-c',150);
    const added=getOrBuildOfficialSolarScene3DFromCalpinageRuntime(r,{getAllPanels:()=>[...panels,newPanel]});
    expect(added.scene?.pvPanels.map(p=>p.id).sort()).toEqual(['pv-a','pv-b','pv-c']);
    const addedForced=getOrBuildOfficialSolarScene3DFromCalpinageRuntime(r,{getAllPanels:()=>[...panels,newPanel],forceStructuralRebuild:true});
    expect(geometry(added.scene)).toEqual(geometry(addedForced.scene));
    expect(added.scene?.pvPanels).toEqual(addedForced.scene?.pvPanels);
    delete r.shading;const uncalculated=getOrBuildOfficialSolarScene3DFromCalpinageRuntime(r,{getAllPanels});
    expect(uncalculated.scene?.panelVisualShadingByPanelId?.['pv-a']?.state).toBe('MISSING');
  });
});
