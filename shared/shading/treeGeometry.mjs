/** Geometry shared by the annual ray tracer and the interactive map. */
export function crownBoxes(t) {
  if(!t.columns)return null;
  const s=t.diameter/t.measuredDiameter,v=(t.height-t.crownBottom)/(t.measuredHeight-t.measuredCrownBottom),half=t.cellSize*s/2;
  return t.columns.map(([x,y,low,high])=>[t.x+x*s-half,t.y+y*s-half,t.groundZ+t.crownBottom+(low-t.measuredCrownBottom)*v,t.x+x*s+half,t.y+y*s+half,t.groundZ+t.crownBottom+(high-t.measuredCrownBottom)*v]);
}
export function rayHitsBox(p,d,b) {
  let lo=0,hi=Infinity;
  for(let i=0;i<3;i++){
    if(Math.abs(d[i])<1e-12){if(p[i]<b[i]||p[i]>b[i+3])return false;continue;}
    let a=(b[i]-p[i])/d[i],c=(b[i+3]-p[i])/d[i];if(a>c)[a,c]=[c,a];lo=Math.max(lo,a);hi=Math.min(hi,c);if(hi<lo)return false;
  }
  return hi>1e-5;
}
export function convexHull(points){
  const ps=points.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lower=[],upper=[];
  for(const p of ps){while(lower.length>=2&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
  for(const p of ps.slice().reverse()){while(upper.length>=2&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
  lower.pop();upper.pop();return lower.concat(upper);
}
