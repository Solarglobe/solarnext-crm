/** Exact vertical prism intersection, sharing the tree engine's rays and samples. */
export function rayHitsPrism(p,d,{polygon,plane,height}) {
 const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
 const inside=(x,y)=>{let odd=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])odd=!odd;}return odd;};
 const h=p[2]-plane[0]*p[0]-plane[1]*p[1]-plane[2],v=d[2]-plane[0]*d[0]-plane[1]*d[1];let lo=1e-5,hi=Infinity;
 if(Math.abs(v)<1e-12){if(h<0||h>height)return false;}else{const a=-h/v,b=(height-h)/v;lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));if(hi<lo)return false;}
 if(inside(p[0]+d[0]*lo,p[1]+d[1]*lo))return true;
 for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],edge=[b[0]-a[0],b[1]-a[1]],offset=[a[0]-p[0],a[1]-p[1]],det=cross(d,edge);if(Math.abs(det)<1e-12)continue;const t=cross(offset,edge)/det,u=cross(offset,d)/det;if(t>=lo&&t<=hi&&u>=0&&u<=1)return true;}
 return false;
}
