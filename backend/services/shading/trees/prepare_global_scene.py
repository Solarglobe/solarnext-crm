"""Adapt explicit CRM obstacles to the existing IGN local coordinates; no ray model here."""
import json,sys,math
import numpy as np
from pyproj import Transformer
from prepare_scene import prepare

def enrich(raw,g):
    scene=prepare(raw,g);s=g['roofState'];m=s['map'];origin=scene['origin']
    if raw.get('status') != 'available':
        scene['opaqueObstacles']=[]
        return scene
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
            # Runtime shapeMeta angles are radians, unlike shadow-volume rotation.
            ang=sm.get('angle',0);cc,ss=math.cos(ang),math.sin(ang)
            poly=[{'x':sm['centerX']+dx*cc-dy*ss,'y':sm['centerY']+dx*ss+dy*cc} for dx,dy in [(-sm['width']/2,-sm['height']/2),(sm['width']/2,-sm['height']/2),(sm['width']/2,sm['height']/2),(-sm['width']/2,sm['height']/2)]]
        elif not poly and o.get('type')=='rect' and all(k in o for k in ['x','y','w','h']):
            poly=[{'x':o['x']+dx,'y':o['y']+dy} for dx,dy in [(0,0),(o['w'],0),(o['w'],o['h']),(0,o['h'])]]
        elif not poly and o.get('type')=='circle' and all(k in o for k in ['x','y','r']):
            poly=[{'x':o['x']+o['r']*math.cos(i*math.tau/64),'y':o['y']+o['r']*math.sin(i*math.tau/64)} for i in range(64)]
        if not poly and all(o.get(k) is not None for k in ['x','y','width']) and (o.get('depth') or o.get('depthM')):
            hx=float(o['width'])/s['scale']['metersPerPixel']/2;hy=float(o.get('depth',o.get('depthM')))/s['scale']['metersPerPixel']/2
            ang=math.radians(o.get('rotation',0));cc,ss=math.cos(ang),math.sin(ang)
            poly=[{'x':o['x']+dx*cc-dy*ss,'y':o['y']+dx*ss+dy*cc} for dx,dy in [(-hx,-hy),(hx,-hy),(hx,hy),(-hx,hy)]]
        height=o.get('height',{}).get('heightM') if isinstance(o.get('height'),dict) else o.get('heightM',o.get('heightRelM',o.get('height',o.get('ridgeHeightRelM'))))
        if not poly or len(poly)<3 or height is None or not math.isfinite(float(height)) or float(height)<0:raise ValueError('Obstacle proche : contour et hauteur mesurée requis')
        if float(height)==0:continue
        polygon=[xy(p) for p in poly];center=[sum(p[i] for p in polygon)/len(polygon) for i in (0,1)]
        roof=next((r for r in scene['roofs'] if inside(center,r['polygon'])),None)
        if o.get('groundZ') is not None and math.isfinite(float(o['groundZ'])):
            plane=[0,0,float(o['groundZ'])];datum='IGN69_MANUAL'
        elif roof and roof['datum']!='UNSET':
            plane=roof['plane'];datum='IGN69_ROOF'
        elif roof:
            raise ValueError('Hauteur à vérifier sur le pan '+str(roof['id'])+' portant un obstacle.')
        else:
            # A local viewer baseZ is not an IGN altitude. Use classified ground
            # returns only, with nearby, surrounding support and measured fit.
            ground=np.asarray(raw.get('groundPoints',[]),dtype=float).reshape(-1,3)
            near=ground[np.linalg.norm(ground[:,:2]-center,axis=1)<=5]
            if len(near)<6 or not np.all(np.min(near[:,:2],axis=0)<=center) or not np.all(np.max(near[:,:2],axis=0)>=center):
                raise ValueError('Obstacle hors toiture : altitude du terrain à renseigner.')
            A=np.column_stack([near[:,:2]-center,np.ones(len(near))]);coef=np.linalg.lstsq(A,near[:,2],rcond=None)[0]
            if np.linalg.matrix_rank(A)<3 or np.sqrt(np.mean((near[:,2]-A@coef)**2))>.4:
                raise ValueError('Obstacle hors toiture : altitude du terrain à vérifier.')
            plane=[float(coef[0]),float(coef[1]),float(coef[2]-np.dot(coef[:2],center))];datum='IGN69_GROUND'
        obstacles.append({'id':'obstacle-'+str(o.get('id',len(obstacles))),'polygon':polygon,'plane':plane,'height':float(height),'datum':datum})
    scene['opaqueObstacles']=obstacles
    return scene
if __name__=='__main__':
    raw=json.load(open(sys.argv[1],encoding='utf-8-sig'));saved=json.load(open(sys.argv[2],encoding='utf-8-sig'))
    try:
        print(json.dumps(enrich(raw,saved.get('geometry',saved)),ensure_ascii=False,allow_nan=False))
    except ValueError as e:
        print(json.dumps({'error':str(e),'code':'SCENE_DATUM_REQUIRED'},ensure_ascii=False));sys.exit(1)
