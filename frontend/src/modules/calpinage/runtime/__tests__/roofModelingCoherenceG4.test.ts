// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { minimalCalpinageRuntimeFixture } from '../../canonical3d/dev/minimalCalpinageRuntimeFixture';
import { clearOfficialSolarScene3DCache,getOrBuildOfficialSolarScene3DFromCalpinageRuntime } from '../../canonical3d/scene/officialSolarScene3DGateway';
import { pushRoofModelingPastSnapshot,undoRoofModeling,redoRoofModeling,canRedoRoofModeling,resetRoofModelingHistoryForTests } from '../roofModelingHistory';
import { applyRoofVertexHeightEdit } from '../applyRoofVertexHeightEdit';
import { syncRoofPansMirrorFromPans } from '../../legacy/phase2RoofDerivedModel';
import { getEffectivePanelVisualShading } from '../../canonical3d/viewer/visualShading/effectivePanelVisualShading';
import { premiumTintHexForQualityScore } from '../../canonical3d/viewer/visualShading/premiumVisualShadingColors';

type Runtime=Record<string,any>;
const clone=():Runtime=>structuredClone(minimalCalpinageRuntimeFixture) as Runtime;
const line=(id:string,h:number)=>({id,a:{x:100,y:100,h},b:{x:200,y:100,h}});
const fixture=()=>{const r=clone();r.pans[0].roofType='FLAT';r.pans[0].polygonPx=r.pans[0].polygonPx.map((p:any)=>({...p,h:5}));syncRoofPansMirrorFromPans(r);r.ridges=[line('ridge-1',5)];r.traits=[line('trait-1',5)];r.contours[0].points=r.contours[0].points.map((p:any)=>({...p,h:5}));return r;};
const model=(r:Runtime)=>({pans:r.pans,roofPans:r.roof.roofPans,ridges:r.ridges,traits:r.traits,contours:r.contours,roofExtensions:r.roofExtensions});
const sceneGeometry=(r:Runtime)=>{const out=getOrBuildOfficialSolarScene3DFromCalpinageRuntime(r);return{sig:out.sceneStructuralSignatures.sceneRuntimeSignature,patches:out.scene?.roofModel.roofPlanePatches.map(p=>p.cornersWorld),ridges:out.scene?.roofModel.roofRidges};};
const sceneShape=(scene:any)=>({patches:scene?.roofModel.roofPlanePatches,edges:scene?.roofModel.roofEdges,ridges:scene?.roofModel.roofRidges,shell:scene?.buildingShell});
beforeEach(()=>{resetRoofModelingHistoryForTests();clearOfficialSolarScene3DCache();});
afterEach(()=>{resetRoofModelingHistoryForTests();clearOfficialSolarScene3DCache();});
describe('G4 history restores the modeled geometry as one operation',()=>{
  it('height 5→8 on pan and ridge, undo→5, redo→8, with coherent scene and exportable model',()=>{
    const r=fixture();const before=structuredClone(model(r));const sceneBefore=sceneGeometry(r);
    pushRoofModelingPastSnapshot(structuredClone(r));
    for(let i=0;i<r.pans[0].polygonPx.length;i++)expect(applyRoofVertexHeightEdit(r,{panId:'pan-a',vertexIndex:i,heightM:8}).ok).toBe(true);
    r.ridges[0].a.h=8;r.ridges[0].b.h=8;syncRoofPansMirrorFromPans(r);
    const after=structuredClone(model(r));const sceneAfter=sceneGeometry(r);
    expect(undoRoofModeling(r)).toBe(true);expect(model(r)).toEqual(before);
    expect(sceneGeometry(r)).toEqual(sceneBefore);
    expect(JSON.parse(JSON.stringify(model(r)))).toEqual(before);
    expect(redoRoofModeling(r)).toBe(true);expect(model(r)).toEqual(after);
    expect(sceneGeometry(r)).toEqual(sceneAfter);
  });
  it('restores simultaneous pan, ridge, contour and trait mutations',()=>{
    const r=fixture(),before=structuredClone(model(r));pushRoofModelingPastSnapshot(structuredClone(r));
    r.pans[0].polygonPx[0].x=105;r.ridges[0].b.x=195;r.contours[0].points[0].x=105;r.traits[0].a.h=7;
    r.roofExtensions=[{id:'new-extension'}];
    syncRoofPansMirrorFromPans(r);const after=structuredClone(model(r));
    expect(undoRoofModeling(r)).toBe(true);expect(model(r)).toEqual(before);
    expect(redoRoofModeling(r)).toBe(true);expect(model(r)).toEqual(after);
  });
  it('supports multiple operations, multiple undo/redo and clears redo after a new branch',()=>{
    const r=fixture(),states=[structuredClone(model(r))];
    for(const h of[6,7,8]){pushRoofModelingPastSnapshot(structuredClone(r));r.ridges[0].a.h=h;r.pans[0].polygonPx[0].h=h;syncRoofPansMirrorFromPans(r);states.push(structuredClone(model(r)));}
    for(let i=2;i>=0;i--){expect(undoRoofModeling(r)).toBe(true);expect(model(r)).toEqual(states[i]);}
    for(let i=1;i<=3;i++){expect(redoRoofModeling(r)).toBe(true);expect(model(r)).toEqual(states[i]);}
    expect(undoRoofModeling(r)).toBe(true);pushRoofModelingPastSnapshot(structuredClone(r));r.traits[0].b.h=9;expect(canRedoRoofModeling()).toBe(false);
  });
});

describe('G3/G4/G7 scene coherence across history and visual updates',()=>{
  it('restores geometry through Undo/Redo while per-panel colors follow current shading',()=>{
    const r=fixture();
    const panels=[130,170].map((x,i)=>({
      id:i===0?'pv-a':'pv-b',panId:'pan-a',enabled:true,center:{x,y:150},
      polygonPx:[{x:x-12,y:140},{x:x+12,y:140},{x:x+12,y:160},{x:x-12,y:160}],
    }));
    const getAllPanels=()=>structuredClone(panels);
    r.shading={normalized:{totalLossPct:10,computedAt:100,perPanel:[
      {panelId:'pv-a',lossPct:0},{panelId:'pv-b',lossPct:20},
    ]}};
    const build=(forceStructuralRebuild=false)=>getOrBuildOfficialSolarScene3DFromCalpinageRuntime(
      r,{getAllPanels,forceStructuralRebuild});
    const colors=(scene:any)=>['pv-a','pv-b'].map(id=>premiumTintHexForQualityScore(
      getEffectivePanelVisualShading(id,scene).qualityScore01));

    const initial=build();expect(initial.ok).toBe(true);
    const geometryBefore=sceneGeometry(r);
    pushRoofModelingPastSnapshot(structuredClone(r));
    r.ridges[0].a.h=8;r.ridges[0].b.h=8;
    for(const p of r.pans[0].polygonPx)p.h=8;
    syncRoofPansMirrorFromPans(r);
    const edited=build();expect(edited.ok).toBe(true);
    const geometryAfter=sceneGeometry(r);
    expect(geometryAfter.sig).not.toBe(geometryBefore.sig);

    expect(undoRoofModeling(r)).toBe(true);
    const undone=build();const undoneForced=build(true);
    expect(r.ridges[0].a.h).toBe(5);
    expect(undone.sceneStructuralSignatures.sceneRuntimeSignature).toBe(initial.sceneStructuralSignatures.sceneRuntimeSignature);
    expect(sceneGeometry(r)).toEqual(geometryBefore);
    expect(sceneShape(undone.scene)).toEqual(sceneShape(undoneForced.scene));

    r.shading.normalized.perPanel=[{panelId:'pv-a',lossPct:20},{panelId:'pv-b',lossPct:0}];
    const recolored=build();const recoloredForced=build(true);
    expect(recolored.sceneSyncDiagnostics.usedSceneCache).toBe(true);
    expect(colors(recolored.scene)).toEqual(colors(recoloredForced.scene));
    expect(colors(recolored.scene)).toEqual(colors(initial.scene).reverse());
    expect(sceneGeometry(r)).toEqual(geometryBefore);

    expect(redoRoofModeling(r)).toBe(true);
    const redone=build();const redoneForced=build(true);
    expect(r.ridges[0].a.h).toBe(8);
    expect(sceneGeometry(r)).toEqual(geometryAfter);
    expect(sceneShape(redone.scene)).toEqual(sceneShape(redoneForced.scene));
    expect(colors(redone.scene)).toEqual(colors(redoneForced.scene));
    expect(colors(redone.scene)).toEqual(colors(recolored.scene));
  });
});
