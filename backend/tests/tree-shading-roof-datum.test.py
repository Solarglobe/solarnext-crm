import pathlib, sys, unittest
import numpy as np
sys.path.insert(0, str(pathlib.Path(__file__).parents[1]/'services/shading/trees'))
from roof_datum import fit_roof
from prepare_global_scene import enrich
from pyproj import Transformer


class RoofDatumTests(unittest.TestCase):
    def test_measured_dominant_roof_survives_lower_facade_returns(self):
        rng=np.random.default_rng(3);xy=rng.uniform(-5,5,(300,2))
        roof=np.c_[xy,140+.6*xy[:,0]+.1*xy[:,1]+rng.normal(0,.025,300)]
        bad=np.c_[rng.uniform(-5,5,(80,2)),rng.uniform(130,135,80)]
        fit=fit_roof(np.r_[roof,bad])
        self.assertIsNotNone(fit);self.assertLess(fit['rms'],.05)
        np.testing.assert_allclose(fit['plane'],[.6,.1,140],atol=.015)

    def test_sparse_and_collinear_returns_are_not_a_height(self):
        self.assertIsNone(fit_roof([[i,i,4] for i in range(100)]))
        self.assertIsNone(fit_roof([[i,i%3,4] for i in range(19)]))

    def test_two_equal_roofs_must_not_be_invented_as_one(self):
        rng=np.random.default_rng(4);xy=rng.uniform(-4,4,(200,2))
        self.assertIsNone(fit_roof(np.r_[np.c_[xy,100+xy[:,0]],np.c_[xy,110-xy[:,0]]]))

    def fixture(self):
        merc=Transformer.from_crs(4326,3857,always_xy=True);lambert=Transformer.from_crs(3857,2154,always_xy=True)
        lon,lat=2,49;cx,cy=merc.transform(lon,lat);ox,oy=lambert.transform(cx,cy);scale=.1/np.cos(np.radians(lat))
        def xyz(x,y):
            X,Y=lambert.transform(cx+(x-100)*scale,cy+(100-y)*scale)
            return [X-ox,Y-oy,100+.1*(X-ox)]
        points=[xyz(x,y) for x in range(60,141,4) for y in range(60,141,4)]
        poly=[{'x':x,'y':y} for x,y in [(50,50),(150,50),(150,150),(50,150)]]
        g={'roofState':{'map':{'centerLatLng':{'lng':lon,'lat':lat}},'scale':{'metersPerPixel':.1},'image':{'width':200,'height':200}},'pans':[{'id':'a','polygonPx':poly}], 'frozenBlocks':[], 'shadowVolumes':[{'id':'chimney','x':100,'y':100,'width':1,'depth':2,'height':1.8,'rotation':30,'baseZ':-123}]}
        raw={'status':'available','origin':{'lat':lat,'lon':lon,'x':ox,'y':oy,'north':[0,1]},'buildingPoints':points[:5],'buildingSupportPoints':points,'trees':[]}
        return raw,g

    def test_dense_classified_points_fix_sparse_display_cloud_and_chimney(self):
        raw,g=self.fixture();s=enrich(raw,g)
        self.assertFalse(s['roofSurveyRequired']);self.assertEqual(s['roofs'][0]['datum'],'IGN69')
        o=s['opaqueObstacles'][0];self.assertEqual(o['datum'],'IGN69_ROOF')
        self.assertAlmostEqual(o['plane'][2],100,places=3)
        self.assertEqual(o['height'],1.8);self.assertNotEqual(o['plane'][2],-123)

    def test_unrelated_bad_roof_does_not_hide_measured_chimney_datum(self):
        raw,g=self.fixture();g['pans'].append({'id':'missing','polygonPx':[{'x':300,'y':300},{'x':350,'y':300},{'x':350,'y':350}]})
        s=enrich(raw,g);self.assertTrue(s['roofSurveyRequired'])
        self.assertEqual(s['opaqueObstacles'][0]['datum'],'IGN69_ROOF')

    def test_absent_ign_stays_unavailable(self):
        raw,g=self.fixture();raw['status']='unavailable';raw['buildingSupportPoints']=[];raw['buildingPoints']=[]
        s=enrich(raw,g);self.assertTrue(s['roofSurveyRequired']);self.assertEqual(s['status'],'unavailable')

    def test_off_roof_obstacle_requires_measured_ground(self):
        raw,g=self.fixture();g['shadowVolumes'][0].update(x=300,y=300)
        with self.assertRaisesRegex(ValueError,'terrain'):enrich(raw,g)

    def test_shape_meta_angle_is_radians(self):
        raw,g=self.fixture();g['shadowVolumes']=[]
        g['roofState']['obstacles']=[{'id':'rect','heightM':1,'shapeMeta':{'originalType':'rect','angle':np.pi/2,'centerX':100,'centerY':100,'width':10,'height':30}}]
        o=enrich(raw,g)['opaqueObstacles'][0];span=np.ptp(np.asarray(o['polygon']),axis=0)
        self.assertGreater(span[0],span[1]*2)

if __name__=='__main__':unittest.main()
