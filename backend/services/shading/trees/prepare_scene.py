"""Fit the actual LiDAR roof datum and project saved panel polygons (no assumed heights)."""
import json, sys, math
import numpy as np
from pyproj import Transformer

def prepare(raw, geometry):
    state=geometry['roofState']; m=state['map']
    transform=Transformer.from_crs(4326,2154,always_xy=True)
    lon,lat=m['centerLatLng']['lng'],m['centerLatLng']['lat']
    cx,cy=transform.transform(lon,lat);north=np.array(transform.transform(lon,lat+.001))-np.array([cx,cy]);north/=np.linalg.norm(north)
    origin=raw.get('origin',{'lat':lat,'lon':lon,'x':cx,'y':cy,'north':north.tolist()})
    mercator=Transformer.from_crs(4326,3857,always_xy=True)
    inverse=Transformer.from_crs(3857,2154,always_xy=True)
    center=mercator.transform(m['centerLatLng']['lng'],m['centerLatLng']['lat'])
    scale=state['scale']['metersPerPixel']/math.cos(math.radians(m['centerLatLng']['lat']))
    w,h=state['image']['width'],state['image']['height']
    angle=math.radians(m.get('bearing',0))
    def xy(p):
        x=(p['x']-w/2)*scale;y=(h/2-p['y'])*scale
        X,Y=inverse.transform(center[0]+x*math.cos(angle)+y*math.sin(angle),center[1]-x*math.sin(angle)+y*math.cos(angle))
        return [X-origin['x'],Y-origin['y']]
    def inside(p,poly):
        x,y=p; odd=False
        for a,b in zip(poly,poly[1:]+poly[:1]):
            if (a[1]>y)!=(b[1]>y) and x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:odd=not odd
        return odd
    roofs=[];panels=[];survey_required=False
    for pan in geometry['pans']:
        polygon=[xy(p) for p in pan['polygonPx']]
        points=np.array([p for p in raw.get('buildingPoints',[]) if inside(p[:2],polygon)])
        retained=points;rms=None
        if len(points)>=20:
            for _ in range(4):
                A=np.column_stack([retained[:,:2],np.ones(len(retained))]);coef=np.linalg.lstsq(A,retained[:,2],rcond=None)[0]
                residual=points[:,2]-(np.column_stack([points[:,:2],np.ones(len(points))])@coef)
                mad=max(.08,float(np.median(np.abs(residual-np.median(residual))))*1.4826)
                retained=points[np.abs(residual)<2.5*mad]
            rms=float(np.sqrt(np.mean((retained[:,2]-np.column_stack([retained[:,:2],np.ones(len(retained))])@coef)**2)))
        valid=len(retained)>=20 and rms is not None and rms<=.4
        if not valid:
            survey_required=True
            tilt=math.radians(float(pan.get('tiltDeg',0)));az=math.radians(float(pan.get('azimuthDeg',180)))
            nx,ny=origin['north'];east=math.sin(az);northward=math.cos(az)
            coef=np.array([-math.tan(tilt)*(east*ny+northward*nx),-math.tan(tilt)*(-east*nx+northward*ny),0])
        def xyz(p,offset=0):
            x,y=p;return [x,y,float(coef[0]*x+coef[1]*y+coef[2]+offset)]
        roof={'id':pan['id'],'polygon':[xyz(p) for p in polygon],'plane':coef.tolist(),'lidarPoints':len(retained) if valid else 0,'rms':rms,'datum':'IGN69' if valid else 'UNSET'}
        roofs.append(roof)
        for block in geometry['frozenBlocks']:
            if block['panId']!=pan['id']:continue
            for panel in block['panels']:
                # Surface projection is the actual module polygon. A documented 10 cm
                # mounting offset is explicit, editable survey input, not roof altitude.
                panels.append({'id':'P'+str(len(panels)+1),'roofId':pan['id'],'polygon':[xyz(xy(p),.10) for p in panel['projection']['points']]})
    out={k:v for k,v in raw.items() if k not in ['supportPoints','buildingPoints']}
    out.update({'origin':origin,'roofSurveyRequired':survey_required,'trees':raw.get('trees',[]),'sources':raw.get('sources',[]),'download':raw.get('download',{'bytes':0,'rangeRequests':0,'cacheHit':False})})
    out.update({'id':'local-real-trees','title':'Étude fictive · arbres réels à Lamorlaye','roofs':roofs,'panels':panels,'emptySceneAttested':False,'mountingOffsetM':.10,'assumptions':['Végétation IGN : colonnes opaques de 1 m sur l’empreinte réellement mesurée, sans remplir les espaces vides entre les couronnes.','Acquisition hivernale : branches/feuillage observés en février 2022, sans reconstitution du feuillage estival. Les arbres ajoutés manuellement utilisent une couronne ellipsoïdale.','Modules à 10 cm du plan LiDAR ; hauteur de montage à confirmer sur site.','Perte d’irradiation annuelle ; ne modélise pas les diodes et les pertes électriques de mismatch.'],'buildings':raw.get('buildingPoints',[])[::5]})
    return out

if __name__=='__main__':
    raw=json.load(open(sys.argv[1],encoding='utf-8-sig'));saved=json.load(open(sys.argv[2],encoding='utf-8-sig'))
    print(json.dumps(prepare(raw,saved.get('geometry',saved)),ensure_ascii=False,allow_nan=False))
