"""Fit the actual LiDAR roof datum and project saved panel polygons (no assumed heights)."""
import json, sys, math
import numpy as np
from pyproj import Transformer
from roof_datum import fit_roof, inside_points

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
    roofs=[];panels=[];survey_required=False
    support=np.asarray(raw.get('buildingSupportPoints',raw.get('buildingPoints',[])),dtype=float).reshape(-1,3)
    for pan in geometry['pans']:
        polygon=[xy(p) for p in pan['polygonPx']]
        points=support[inside_points(support,polygon)]
        fit=fit_roof(points)
        valid=fit is not None
        rms=fit['rms'] if valid else None
        if valid:coef=fit['plane']
        if not valid:
            survey_required=True
            tilt=math.radians(float(pan.get('tiltDeg',0)));az=math.radians(float(pan.get('azimuthDeg',180)))
            nx,ny=origin['north'];east=math.sin(az);northward=math.cos(az)
            coef=np.array([-math.tan(tilt)*(east*ny+northward*nx),-math.tan(tilt)*(-east*nx+northward*ny),0])
        def xyz(p,offset=0):
            x,y=p;return [x,y,float(coef[0]*x+coef[1]*y+coef[2]+offset)]
        roof={'id':pan['id'],'polygon':[xyz(p) for p in polygon],'plane':coef.tolist(),'lidarPoints':fit['points'] if valid else 0,'fitPoints':len(points),'inlierFraction':fit['inlierFraction'] if valid else 0,'rms':rms,'datum':'IGN69' if valid else 'UNSET'}
        roofs.append(roof)
        for block in geometry['frozenBlocks']:
            if block['panId']!=pan['id']:continue
            for panel in block['panels']:
                # Surface projection is the actual module polygon. A documented 10 cm
                # mounting offset is explicit, editable survey input, not roof altitude.
                panels.append({'id':'P'+str(len(panels)+1),'roofId':pan['id'],'polygon':[xyz(xy(p),.10) for p in panel['projection']['points']]})
    out={k:v for k,v in raw.items() if k not in ['supportPoints','buildingPoints','buildingSupportPoints','groundPoints']}
    out.update({'origin':origin,'roofSurveyRequired':survey_required,'trees':raw.get('trees',[]),'sources':raw.get('sources',[]),'download':raw.get('download',{'bytes':0,'rangeRequests':0,'cacheHit':False})})
    out.update({'id':'measured-scene','title':'Analyse d’ombrage','roofs':roofs,'panels':panels,'emptySceneAttested':False,'mountingOffsetM':.10,'assumptions':['Végétation IGN : colonnes opaques de 1 m sur l’empreinte réellement mesurée, sans remplir les espaces vides entre les couronnes.','Végétation observée aux dates d’acquisition IGN indiquées dans les sources, sans reconstitution du feuillage absent. Les arbres ajoutés manuellement utilisent une couronne ellipsoïdale.','Modules à 10 cm du plan LiDAR ; hauteur de montage à confirmer sur site.','Perte d’irradiation annuelle ; ne modélise pas les diodes et les pertes électriques de mismatch.'],'buildings':raw.get('buildingPoints',[])[::5]})
    return out

if __name__=='__main__':
    raw=json.load(open(sys.argv[1],encoding='utf-8-sig'));saved=json.load(open(sys.argv[2],encoding='utf-8-sig'))
    print(json.dumps(prepare(raw,saved.get('geometry',saved)),ensure_ascii=False,allow_nan=False))
