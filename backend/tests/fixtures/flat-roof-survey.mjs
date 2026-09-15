import { computeSunPosition } from '../../services/shading/solarPosition.js';
export const rect=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
export const clearHorizon={source:'IGN_GEOPLATEFORME',mask:Array.from({length:360},(_,az)=>({az,elev:0}))};
const annual=Array.from({length:8760},(_,hour)=>{
  const date=new Date(Date.UTC(2026,0,1,hour)),sun=computeSunPosition(date,49.17144,2.375402);
  const daylight=Math.max(0,Math.sin(sun.elevationDeg*Math.PI/180));
  return {timestamp:date.toISOString(),directWh:100*daylight,diffuseWh:100000*daylight,reflectedWh:0,diffuseFarTransmission:1,diffuseCombinedTransmission:1};
});
/** Synthetic qualification scene and controlled hourly POA inputs, never a site survey. */
export function flatRoofSurvey({obstacle=false}={}) {
  return {schemaVersion:'v2',geometryContractVersion:'flat-roof-survey-v1',
    gps:{lat:49.17144,lon:2.375402},scale:{metersPerPixel:0.1},north:{angleDeg:0},
    verticalReference:{datum:'LOCAL_GROUND',roofElevationM:3},
    pans:[{id:'pan1',roofKind:'FLAT',roofKindProvenance:'EXPLICIT',tiltDeg:0,heightM:3,polygonPx:rect(0,0,300,300)}],
    frozenBlocks:[{id:'block',panId:'pan1',panels:[{id:'p1',panId:'pan1',polygonPx:rect(90,90,20,20),verticalReference:'ROOF_SURFACE',heightM:0}]}],
    panel:{powerWc:500},localObstacleSurvey:{status:'complete',source:'manual_survey',surveyedAt:'2026-09-15T00:00:00Z',obstaclesComplete:true},
    obstacles:obstacle?[{id:'small-shadow',polygonPx:rect(70,140,60,10),heightM:4,baseHeightM:0,verticalReference:'ROOF_SURFACE'}]:[],
    irradianceSamples:structuredClone(annual)};
}
