import concurrent.futures,hashlib,json,os,shutil,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import brand_assets as A

class Assets(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.data=self.root/'brands';self.data.mkdir()
        self.env=patch.dict(os.environ,{'HARNESS_REBRAND_STATE':str(self.root/'state'),'HARNESS_REBRAND_BRAND':'example'})
        self.env.start();self.addCleanup(self.env.stop)
        self.make('example')
    def make(self,name):
        config={'id':name,'profile':f'assets/{name}','runtime':{}}
        files={'assets/brand.json':json.dumps(config).encode(),'assets/icons/library.zip':b'icons',
            f'assets/{name}/brand.json':b'{}',f'assets/{name}/rules.md':b'rules',f'assets/{name}/template.pptx':b'template',
            'references/visual-review.md':b'review'}
        manifest={'schema':1,'brand':name,'files':{}}
        for key,content in files.items():
            source=f'{name}/source/{key}';p=self.data/source;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(content)
            manifest['files'][key]={'source':source,'sha256':A.digest(content)}
        path=self.data/name/'rebrand/manifest.json';path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(manifest))
        return path
    def test_snapshot_works_without_original_and_never_fetches(self):
        target=A.install(self.data,'example');shutil.rmtree(self.data)
        with patch.object(A.subprocess,'run',side_effect=AssertionError('runtime must not spawn git')):
            self.assertEqual(A.installed(),target)
    def test_multiple_brands_remain_separate(self):
        self.make('other');first=A.install(self.data,'example');second=A.install(self.data,'other')
        self.assertNotEqual(first,second)
        self.assertEqual(A.read_lock(brand='example')['brand'],'example')
        self.assertEqual(A.read_lock(brand='other')['brand'],'other')
    def test_missing_identity_never_defaults(self):
        with patch.dict(os.environ,{'HARNESS_REBRAND_BRAND':''}):
            with self.assertRaisesRegex(A.AssetError,'Choose a brand'):A.installed()
    def test_tampering_is_refused(self):
        target=A.install(self.data,'example');(target/'assets/example/template.pptx').write_bytes(b'changed')
        with self.assertRaisesRegex(A.AssetError,'Cached brand asset changed'):A.installed()
    def test_source_mismatch_does_not_replace_old_lock(self):
        original=A.install(self.data,'example');before=A.read_lock()
        (self.data/'example/source/assets/example/template.pptx').write_bytes(b'changed')
        with self.assertRaisesRegex(A.AssetError,'Brand source changed'):A.install(self.data,'example')
        self.assertEqual(A.read_lock(),before);self.assertEqual(A.installed(),original)
    def test_traversal_and_symlinks_cannot_escape(self):
        manifest=self.data/'example/rebrand/manifest.json';m=json.loads(manifest.read_text())
        m['files']['assets/brand.json']['source']='../../outside';manifest.write_text(json.dumps(m))
        with self.assertRaisesRegex(A.AssetError,'Unsafe path'):A.install(self.data,'example')
        self.make('example');path=self.data/'example/source/assets/example/template.pptx';path.unlink()
        outside=self.root/'outside';outside.write_bytes(b'template');path.symlink_to(outside)
        with self.assertRaisesRegex(A.AssetError,'escapes'):A.install(self.data,'example')
    def test_wrong_profile_is_refused(self):
        path=self.data/'example/rebrand/manifest.json';m=json.loads(path.read_text());m['brand']='other';path.write_text(json.dumps(m))
        with self.assertRaisesRegex(A.AssetError,'identity'):A.install(self.data,'example')
    def test_concurrent_installers_publish_one_snapshot(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            paths=list(pool.map(lambda _:A.install(self.data,'example'),range(3)))
        self.assertEqual(len(set(paths)),1);A.installed()
        self.assertFalse(list(A.cache_folder().glob('.install-*')))
    def test_only_rebranding_profiles_are_discovered(self):
        (self.data/'authoring-only/pack').mkdir(parents=True)
        self.assertEqual(A.available(self.data),['example'])

if __name__=='__main__':unittest.main()
