/** Canonical, explicitly surveyed horizontal scene. No legacy inference or tilt tolerance.
 * Coordinates are image pixels; every ray height is relative to the roof surface.
 * roofElevationM ties that surface to the surveyed local ground datum.
 */
export const FLAT_ROOF_SURVEY_VERSION = 'flat-roof-survey-v1';
export const SUPPORTED_FLAT_TILT_DEG = 0;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const id = s => typeof s === 'string' && s.trim().length > 0;
const cross = (a,b,c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const on = (a,b,p) => cross(a,b,p) === 0 && p.x >= Math.min(a.x,b.x) && p.x <= Math.max(a.x,b.x) && p.y >= Math.min(a.y,b.y) && p.y <= Math.max(a.y,b.y);
function intersects(a,b,c,d) {
  return (Math.sign(cross(a,b,c))*Math.sign(cross(a,b,d)) < 0 && Math.sign(cross(c,d,a))*Math.sign(cross(c,d,b)) < 0) || on(a,b,c) || on(a,b,d) || on(c,d,a) || on(c,d,b);
}
export function isSimplePolygon(p) {
  if (!Array.isArray(p) || p.length < 3 || !p.every(v => v && finite(v.x) && finite(v.y))) return false;
  if (new Set(p.map(v => `${v.x},${v.y}`)).size !== p.length) return false;
  const area = p.reduce((s,a,i) => { const b=p[(i+1)%p.length]; return s+a.x*b.y-b.x*a.y; },0);
  if (!finite(area) || Math.abs(area) === 0) return false;
  for (let i=0;i<p.length;i++) for (let j=i+1;j<p.length;j++) {
    if (j === i+1 || (i === 0 && j === p.length-1)) continue;
    if (intersects(p[i],p[(i+1)%p.length],p[j],p[(j+1)%p.length])) return false;
  }
  // Reject an adjacent edge which doubles back over itself.
  return p.every((b,i) => { const a=p[(i+p.length-1)%p.length],c=p[(i+1)%p.length]; return cross(a,b,c)!==0 || !on(a,b,c) && !on(b,c,a); });
}
function inside(p, roof) {
  let yes=false;
  for(let i=0,j=roof.length-1;i<roof.length;j=i++) {
    const a=roof[j],b=roof[i]; if(on(a,b,p)) return true;
    if((a.y>p.y)!==(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) yes=!yes;
  }
  return yes;
}
function contained(p,roof) {
  if(!p.every(v=>inside(v,roof))) return false;
  // Split at every roof vertex lying on an edge, then check each interval.
  // This also rejects an edge bridging a concave notch through boundary vertices.
  return p.every((a,i)=>{
    const b=p[(i+1)%p.length], dx=b.x-a.x,dy=b.y-a.y;
    const cuts=[0,1,...roof.filter(v=>on(a,b,v)).map(v=>Math.abs(dx)>=Math.abs(dy)?(v.x-a.x)/dx:(v.y-a.y)/dy)].sort((x,y)=>x-y);
    if(!cuts.slice(1).every((t,k)=>inside({x:a.x+dx*(t+cuts[k])/2,y:a.y+dy*(t+cuts[k])/2},roof))) return false;
    return roof.every((c,j)=>{const d=roof[(j+1)%roof.length];return !(Math.sign(cross(a,b,c))*Math.sign(cross(a,b,d))<0 && Math.sign(cross(c,d,a))*Math.sign(cross(c,d,b))<0);});
  });
}
export function validateFlatRoofSurvey(g) {
  const checks=[]; const check=(code,ok)=>{checks.push({code,passed:!!ok});};
  const pans=Array.isArray(g.pans)?g.pans:[],p=pans[0],survey=g.localObstacleSurvey;
  check('GEOMETRY_CONTRACT_UNSUPPORTED',g.geometryContractVersion===FLAT_ROOF_SURVEY_VERSION);
  // Canonical root fields are the only source. Competing legacy physical inputs are refused.
  check('GEOMETRY_CONTRACT_AMBIGUOUS',!['roofState','roof','validatedRoofData','panels','roofModel','roofModelV1','geometry3d'].some(k=>g[k]!=null) && ![g.shadowVolumes,g.roofExtensions].some(v=>v!=null && (!Array.isArray(v)||v.length>0)));
  check('MULTIPLE_ROOF_PLANES_UNSUPPORTED',pans.length===1);
  check('ROOF_KIND_MISSING',id(p?.roofKind) && p.roofKind!=='UNKNOWN');
  check('ROOF_KIND_UNSUPPORTED',p?.roofKind==='FLAT' && p.roofKindProvenance==='EXPLICIT' && p.tiltDeg===SUPPORTED_FLAT_TILT_DEG);
  const roofValid=isSimplePolygon(p?.polygonPx);
  check('ROOF_POLYGON_INVALID',roofValid);
  check('METRIC_SCALE_INVALID',finite(g.scale?.metersPerPixel)&&g.scale.metersPerPixel>0);
  check('GPS_INVALID',finite(g.gps?.lat)&&Math.abs(g.gps.lat)<=90&&finite(g.gps?.lon)&&Math.abs(g.gps.lon)<=180);
  check('NORTH_INVALID',finite(g.north?.angleDeg)&&g.north.angleDeg>=0&&g.north.angleDeg<360);
  check('LOCAL_SURVEY_INCOMPLETE',survey?.status==='complete'&&survey.source==='manual_survey'&&id(survey.surveyedAt)&&Number.isFinite(Date.parse(survey.surveyedAt)));
  check('OBSTACLE_LIST_INCOMPLETE',survey?.obstaclesComplete===true&&Array.isArray(g.obstacles));
  const blocks=Array.isArray(g.frozenBlocks)?g.frozenBlocks:[];
  const panels=blocks.flatMap(b=>Array.isArray(b?.panels)?b.panels:[]);
  check('PANEL_BINDING_INVALID',id(p?.id)&&blocks.length>0&&panels.length>0&&blocks.every(b=>b?.panId===p.id&&Array.isArray(b?.panels)&&b.panels.length>0&&b.panels.every(v=>v?.panId===p.id&&id(v.id)))&&new Set(panels.map(v=>v?.id)).size===panels.length);
  check('PANEL_GEOMETRY_INVALID',panels.length>0&&panels.every(v=>isSimplePolygon(v?.polygonPx)));
  check('PANEL_OUTSIDE_ROOF',roofValid&&panels.length>0&&panels.every(v=>isSimplePolygon(v?.polygonPx)&&contained(v.polygonPx,p.polygonPx)));
  const obstacles=Array.isArray(g.obstacles)?g.obstacles:[];
  check('OBSTACLE_GEOMETRY_INVALID',obstacles.every(o=>id(o?.id)&&isSimplePolygon(o.polygonPx)&&finite(o.heightM)&&o.heightM>=0)&&new Set(obstacles.map(o=>o?.id)).size===obstacles.length);
  check('VERTICAL_REFERENCE_INVALID',g.verticalReference?.datum==='LOCAL_GROUND'&&finite(g.verticalReference.roofElevationM)&&g.verticalReference.roofElevationM>=0&&p?.heightM===g.verticalReference.roofElevationM&&panels.every(v=>v?.verticalReference==='ROOF_SURFACE'&&v.heightM===0)&&obstacles.every(o=>o?.verticalReference==='ROOF_SURFACE'&&o.baseHeightM===0));
  const blockingCodes=checks.filter(c=>!c.passed).map(c=>c.code);
  return {checks,blockingCodes,certified:blockingCodes.length===0,panels,obstacles};
}
