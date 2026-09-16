"""Read only the useful COPC octree nodes, classify vegetation, retain IGN provenance.

Dependencies: laspy[lazrs], numpy, scipy, pyproj, requests. No database access.
Input/output JSON on stdin/stdout. Raw cropped point data stays in the local cache.
"""
import sys, json, pathlib, hashlib, math, datetime
import numpy as np
import requests
from pyproj import Transformer
from scipy import ndimage
from laspy import CopcReader
from laspy.copc import Bounds
from public_http import resilient_session

def main(arg):
    cache=pathlib.Path(arg['cache']);cache.mkdir(parents=True,exist_ok=True)
    lat,lon=float(arg['lat']),float(arg['lon']);radius=float(arg.get('radius',150))
    if not (41<lat<52 and -6<lon<10 and 30<=radius<=250):raise ValueError('Unsupported location or radius')
    transform=Transformer.from_crs(4326,2154,always_xy=True)
    cx,cy=transform.transform(lon,lat);box=[cx-radius,cy-radius,cx+radius,cy+radius]
    key=hashlib.sha256(json.dumps([lat,lon,radius,.5]).encode()).hexdigest()[:20]
    meta_file=cache/(key+'-metadata.json');points_file=cache/(key+'-points.npz')
    if meta_file.exists():metadata=json.loads(meta_file.read_text())
    else:
        p={'SERVICE':'WFS','VERSION':'2.0.0','REQUEST':'GetFeature','TYPENAMES':'IGNF_LIDAR-HD_METADONNEE:metadata','OUTPUTFORMAT':'application/json','SRSNAME':'EPSG:2154','COUNT':20,'BBOX':','.join(map(str,box))+',EPSG:2154'}
        with resilient_session(requests.Session()) as session:
            r=session.get('https://data.geopf.fr/wfs/ows',params=p,timeout=(5,20));r.raise_for_status();metadata=r.json()
        meta_file.write_text(json.dumps(metadata),encoding='utf-8')
    sources=[f['properties'] for f in metadata.get('features',[]) if f['properties'].get('url_npl')]
    if not sources:return {'status':'unavailable','reason':'IGN_CLASSIFIED_LIDAR_ABSENT','trees':[],'buildings':[]}
    rectangles=[]
    for feature in metadata.get('features',[]):
        if not feature.get('properties',{}).get('url_npl'):continue
        def pairs(value):
            if isinstance(value,list) and len(value)>=2 and all(isinstance(v,(int,float)) for v in value[:2]):yield value[:2]
            elif isinstance(value,list):
                for child in value:yield from pairs(child)
        coords=list(pairs(feature.get('geometry',{}).get('coordinates',[])))
        if coords:rectangles.append([min(p[0] for p in coords),min(p[1] for p in coords),max(p[0] for p in coords),max(p[1] for p in coords)])
    xs=sorted(set([box[0],box[2]]+[max(box[0],min(box[2],r[i])) for r in rectangles for i in (0,2)]))
    ys=sorted(set([box[1],box[3]]+[max(box[1],min(box[3],r[i])) for r in rectangles for i in (1,3)]))
    complete=bool(rectangles) and len(metadata.get('features',[]))<20 and all(any(r[0]<=x<=r[2] and r[1]<=y<=r[3] for r in rectangles) for x in [(a+b)/2 for a,b in zip(xs,xs[1:])] for y in [(a+b)/2 for a,b in zip(ys,ys[1:])])
    stats={'bytes':0,'rangeRequests':0,'cacheHit':points_file.exists()}
    if points_file.exists():
        data=np.load(points_file);pts=data['pts'];classes=data['classes']
    else:
        original=requests.Session.send
        def measured(session,request,**kwargs):
            resilient_session(session)
            if kwargs.get('timeout') is None:kwargs['timeout']=(5,20)
            response=original(session,request,**kwargs)
            if request.headers.get('Range'):
                if response.status_code!=206:response.close();raise ValueError('IGN_RANGE_NOT_SUPPORTED')
                size=int(response.headers.get('Content-Length',0));stats['bytes']+=size;stats['rangeRequests']+=1
                if stats['bytes']>120_000_000:response.close();raise ValueError('AOI_DOWNLOAD_BUDGET_EXCEEDED')
            return response
        requests.Session.send=measured
        chunks=[];kinds=[]
        for source in sources:
            url=source['url_npl']
            if not url.startswith('https://data.geopf.fr/telechargement/'):raise ValueError('Untrusted source')
            print('Reading IGN COPC spatial subset '+source.get('coordonnees_nw',''),file=sys.stderr,flush=True)
            with CopcReader.open(url,http_num_threads=2) as reader:
                p=reader.query(bounds=Bounds(np.array([box[0],box[1],-100]),np.array([box[2],box[3],1000])),resolution=.5)
                chunks.append(np.column_stack((np.asarray(p.x),np.asarray(p.y),np.asarray(p.z))))
                kinds.append(np.asarray(p.classification))
        pts=np.concatenate(chunks);classes=np.concatenate(kinds)
        np.savez_compressed(points_file,pts=pts,classes=classes)
    print('STAGE:DETECTION',file=sys.stderr,flush=True)
    if len(pts)<100:raise ValueError('IGN_POINT_COVERAGE_INSUFFICIENT')
    ground=pts[classes==2]
    if len(ground)<20:raise ValueError('IGN_GROUND_DATUM_INSUFFICIENT')
    n=math.ceil(radius*2)
    terrain=np.full((n,n),np.inf)
    gi=np.clip(np.floor(ground[:,:2]-np.array(box[:2])).astype(int),0,n-1)
    np.minimum.at(terrain,(gi[:,1],gi[:,0]),ground[:,2])
    nearest=ndimage.distance_transform_edt(~np.isfinite(terrain),return_distances=False,return_indices=True)
    terrain=terrain[tuple(nearest)]
    def ground_z(xy):
        xy=np.asarray(xy);ij=np.clip(np.floor(xy-np.array(box[:2])).astype(int),0,n-1)
        return terrain[ij[...,1],ij[...,0]]
    ve=pts[np.isin(classes,[3,4,5])];gz=ground_z(ve[:,:2]);ve=ve[(ve[:,2]-gz)>2]
    n=math.ceil(radius*2);chm=np.zeros((n,n));counts=np.zeros((n,n),dtype=int)
    ij=np.floor(ve[:,:2]-np.array(box[:2])).astype(int);ij=np.clip(ij,0,n-1)
    heights=ve[:,2]-ground_z(ve[:,:2])
    np.maximum.at(chm,(ij[:,1],ij[:,0]),heights);np.add.at(counts,(ij[:,1],ij[:,0]),1)
    smoothed=ndimage.maximum_filter(chm,size=3)
    maxima=(smoothed==ndimage.maximum_filter(smoothed,size=7))&(smoothed>3)
    labels,num=ndimage.label(maxima)
    seeds=[]
    for i in range(1,num+1):
        cells=np.argwhere(labels==i);best=cells[np.argmax(chm[cells[:,0],cells[:,1]])]
        seeds.append([box[0]+best[1]+.5,box[1]+best[0]+.5])
    trees=[]
    if seeds:
        seeds=np.asarray(seeds);seed_ids=np.zeros((n,n),dtype=int)
        for i,seed in enumerate(seeds):
            j,k=np.floor(seed-np.array(box[:2])).astype(int);seed_ids[k,j]=i+1
        distances,nearest=ndimage.distance_transform_edt(seed_ids==0,return_indices=True)
        assigned_grid=seed_ids[tuple(nearest)]-1
        assignment=assigned_grid[ij[:,1],ij[:,0]];distance=distances[ij[:,1],ij[:,0]]
        for i,seed in enumerate(seeds):
            crown=ve[(assignment==i)&(distance<=12)]
            if len(crown)<8:continue
            center=np.median(crown[:,:2],axis=0);base=float(ground_z(center));top=float(np.quantile(crown[:,2],.995));bottom=float(np.quantile(crown[:,2],.10))
            rad=max(1,float(np.quantile(np.linalg.norm(crown[:,:2]-center,axis=1),.95)))
            # Preserve the measured canopy footprint: an enclosing ellipse alone
            # would bridge gaps between branches and invent vegetation over roofs.
            cells=np.floor(crown[:,:2]-np.array(box[:2])).astype(int)
            unique,indices=np.unique(cells,axis=0,return_inverse=True)
            columns=[]
            for cell_id,cell in enumerate(unique):
                heights_cell=crown[indices==cell_id,2]
                if len(heights_cell)<3:continue
                low=float(np.quantile(heights_cell,.02));high=float(np.quantile(heights_cell,.98))
                if high-low<.3:high=low+.3
                columns.append([round(float(box[0]+cell[0]+.5-center[0]),3),round(float(box[1]+cell[1]+.5-center[1]),3),round(low-base,3),round(high-base,3)])
            trees.append({'id':'ign-vegetation-'+str(i),'x':round(float(center[0]-cx),3),'y':round(float(center[1]-cy),3),'groundZ':round(base,3),'height':round(top-base,2),'diameter':round(rad*2,2),'crownBottom':round(max(1,bottom-base),2),'points':len(crown),'source':'IGN_LIDAR_HD_CLASSES_3_4_5','enabled':True,'columns':columns,'measuredHeight':round(top-base,2),'measuredDiameter':round(rad*2,2),'measuredCrownBottom':round(max(1,bottom-base),2),'cellSize':1})
    # Building points remain separate; never infer vegetation from surface height alone.
    buildings=pts[classes==6]
    thin=buildings[::max(1,len(buildings)//12000)]
    # Ground and roof support points permit a LiDAR datum instead of assumed eaves heights.
    support=pts[np.isin(classes,[2,6])]
    north=np.array(transform.transform(lon,lat+.001))-np.array([cx,cy]);north/=np.linalg.norm(north)
    source_info=[{k:s.get(k) for k in ['coordonnees_nw','date_debut_acquisition','date_fin_acquisition','date_edition','procede_classement','systeme_altimetrique','url_npl']} for s in sources]
    return {'status':'available','coverageComplete':complete,'origin':{'lat':lat,'lon':lon,'x':cx,'y':cy,'north':north.tolist()},'radius':radius,'bbox':box,'trees':trees,'buildingPoints':np.round(thin-np.array([cx,cy,0]),3).tolist(),'supportPoints':np.round(support-np.array([cx,cy,0]),3).tolist(),'sources':source_info,'classCounts':{str(c):int(np.sum(classes==c)) for c in np.unique(classes)},'samplingResolution':.5,'download':stats,'retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'cacheKey':key,'modelNote':'Detected vegetation volumes, not a botanical tree inventory; opaque crowns. Winter acquisition can miss foliage.'}

if __name__=='__main__':
    try:print(json.dumps(main(json.load(sys.stdin)),allow_nan=False))
    except Exception as e:print(json.dumps({'status':'unavailable','reason':str(e),'trees':[],'buildingPoints':[]}));sys.exit(1)
