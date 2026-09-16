"""Adapt explicit CRM obstacles to the existing IGN local coordinates; no ray model here."""
import json,sys,math
from pyproj import Transformer
from prepare_scene import prepare

def enrich(raw,g):
    scene=prepare(raw,g);s=g['roofState'];m=s['map'];origin=scene['origin']
    merc=Transformer.from_crs(4326,3857,always_xy=True);local=Transformer.from_crs(3857,2154,always_xy=True)
    lon,lat=m['centerLatLng']['lng'],m['centerLatLng']['lat'];cx,cy=merc.transform(lon,lat)
    scale=s['scale']['metersPerPixel']/math.cos(math.radians(lat));w,h=s['image']['width'],s['image']['height'];angle=math.radians(m.get('bearing',0))
    def xy(p):
        x=(p['x']-w/2)*scale;y=(h/2-p['y'])*scale
        X,Y=local.transform(cx+x*math.cos(angle)+y*math.sin(angle),cy-x*math.sin(angle)+y*math.cos(angle))
        return [X-origin['x'],Y-origin['y']]
    def inside(p,poly):
        x,y=p;odd=False
        for a,b in zip(poly,poly[1:]+poly[:1]):
            if (a[1]>y)!=(b[1]>y) and x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:odd=not odd
        return odd
    obstacles=[]
    for o in (s.get('obstacles') or g.get('obstacles') or [])+(g.get('shadowVolumes') or [])+(g.get('roofExtensions') or []):
        if o.get('enabled') is False or o.get('meta',{}).get('isShadingObstacle') is False or o.get('meta',{}).get('businessObstacleId') in ['roof_window','dormer_keepout','keepout_zone','generic_polygon_keepout','roof_drain']:continue
        poly=o.get('points') or o.get('polygon') or o.get('polygonPx')
        sm=o.get('shapeMeta') or {}
        if sm.get('originalType')=='rect':
            ang=math.radians(sm.get('angle',0));cc,ss=math.cos(ang),math.sin(ang)
            poly=[{'x':sm['centerX']+dx*cc-dy*ss,'y':sm['centerY']+dx*ss+dy*cc} for dx,dy in [(-sm['width']/2,-sm['height']/2),(sm['width']/2,-sm['height']/2),(sm['width']/2,sm['height']/2),(-sm['width']/2,sm['height']/2)]]
        elif not poly and o.get('type')=='rect' and all(k in o for k in ['x','y','w','h']):
            poly=[{'x':o['x']+dx,'y':o['y']+dy} for dx,dy in [(0,0),(o['w'],0),(o['w'],o['h']),(0,o['h'])]]
        elif not poly and o.get('type')=='circle' and all(k in o for k in ['x','y','r']):
            poly=[{'x':o['x']+o['r']*math.cos(i*math.tau/64),'y':o['y']+o['r']*math.sin(i*math.tau/64)} for i in range(64)]
        if not poly and all(o.get(k) is not None for k in ['x','y','width']) and (o.get('depth') or o.get('depthM')):
            hx=float(o['width'])/s['scale']['metersPerPixel']/2;hy=float(o.get('depth',o.get('depthM')))/s['scale']['metersPerPixel']/2
            poly=[{'x':o['x']+dx,'y':o['y']+dy} for dx,dy in [(-hx,-hy),(hx,-hy),(hx,hy),(-hx,hy)]]
        height=o.get('height',{}).get('heightM') if isinstance(o.get('height'),dict) else o.get('heightM',o.get('heightRelM',o.get('height',o.get('ridgeHeightRelM'))))
        if not poly or len(poly)<3 or height is None or not math.isfinite(float(height)) or float(height)<0:raise ValueError('Obstacle proche : contour et hauteur mesurée requis')
        if float(height)==0:continue
        polygon=[xy(p) for p in poly];center=[sum(p[i] for p in polygon)/len(polygon) for i in (0,1)]
        roof=next((r for r in scene['roofs'] if inside(center,r['polygon'])),None)
        if o.get('groundZ') is not None:plane=[0,0,float(o['groundZ'])]
        elif roof and not scene['roofSurveyRequired']:plane=roof['plane']
        else:raise ValueError('Obstacle proche : altitude de base non renseignée')
        obstacles.append({'id':'obstacle-'+str(o.get('id',len(obstacles))),'polygon':polygon,'plane':plane,'height':float(height)})
    scene['opaqueObstacles']=obstacles
    return scene
if __name__=='__main__':
    raw=json.load(open(sys.argv[1],encoding='utf-8-sig'));saved=json.load(open(sys.argv[2],encoding='utf-8-sig'))
    print(json.dumps(enrich(raw,saved.get('geometry',saved)),ensure_ascii=False,allow_nan=False))
