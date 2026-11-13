#!/usr/bin/env python3
"""Install sealed user-provided brand profiles locally. Runtime never fetches assets."""
from __future__ import annotations
import argparse,hashlib,json,os,re,subprocess,sys,tempfile
from pathlib import Path,PurePosixPath
ROOT=Path(__file__).resolve().parents[1]

class AssetError(ValueError):pass

def digest(data):return hashlib.sha256(data).hexdigest()

def read_json(path):
    try:return json.loads(Path(path).read_text())
    except (OSError,ValueError) as exc:raise AssetError(f'Cannot read brand metadata at {path}: {exc}') from None

def safe_path(root,relative):
    if not isinstance(relative,str) or not relative or '\\' in relative:raise AssetError('Invalid path in brand manifest.')
    p=PurePosixPath(relative)
    if p.is_absolute() or '..' in p.parts or str(p)!=relative:raise AssetError(f'Unsafe path in brand manifest: {relative}')
    root=Path(root).resolve();target=(root/relative).resolve()
    if not target.is_relative_to(root) or target==root:raise AssetError(f'Brand asset escapes its root: {relative}')
    return target

def identity(brand=None):
    name=brand or os.environ.get('HARNESS_REBRAND_BRAND')
    if not isinstance(name,str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}',name):
        raise AssetError('Choose a brand with --brand ID. No default identity is assumed.')
    return name

def state_folder(root=ROOT):
    return Path(os.environ.get('HARNESS_REBRAND_STATE',str(Path(root)/'.state'))).expanduser().resolve()

def cache_folder(root=ROOT):return state_folder(root)/'assets'

def read_lock(root=ROOT,brand=None):
    name=identity(brand)
    lock=read_json(state_folder(root)/'locks'/f'{name}.json')
    if (not isinstance(lock,dict) or lock.get('schema')!=1 or lock.get('brand')!=name
        or not re.fullmatch(r'[a-f0-9]{64}',str(lock.get('sha256',''))) or lock.get('manifest')!=f'{name}/rebrand/manifest.json'):
        raise AssetError('Unsupported installed asset lock. Run rebrand setup again with the selected brands folder.')
    return lock

def parse_manifest(raw,lock):
    if digest(raw)!=lock['sha256']:raise AssetError('Brand manifest does not match the installed asset lock.')
    try:m=json.loads(raw)
    except ValueError:raise AssetError('Invalid brand manifest JSON.') from None
    if not isinstance(m,dict) or m.get('schema')!=1 or m.get('brand')!=lock['brand'] or not isinstance(m.get('files'),dict):
        raise AssetError('Brand manifest identity or schema mismatch.')
    required={'assets/brand.json','assets/icons/library.zip','references/visual-review.md',
              f"assets/{lock['brand']}/brand.json",f"assets/{lock['brand']}/rules.md",f"assets/{lock['brand']}/template.pptx"}
    if not required.issubset(m['files']):raise AssetError('Brand manifest is missing required assets.')
    for target,spec in m['files'].items():
        safe_path('/snapshot',target)
        if not target.startswith(('assets/','references/')) or not isinstance(spec,dict):raise AssetError('Only brand data belongs in a snapshot.')
        safe_path('/data',spec.get('source'))
        if not re.fullmatch(r'[a-f0-9]{64}',str(spec.get('sha256',''))):raise AssetError(f'Invalid asset hash: {target}')
    return m

def verify(snapshot,lock):
    snapshot=Path(snapshot)
    try:
        manifest=parse_manifest((snapshot/'manifest.json').read_bytes(),lock)
        for name,spec in manifest['files'].items():
            if digest(safe_path(snapshot,name).read_bytes())!=spec['sha256']:raise AssetError(f'Cached brand asset changed: {name}')
        brand=read_json(snapshot/'assets/brand.json')
        if brand.get('id')!=lock['brand'] or brand.get('profile')!=f"assets/{lock['brand']}":raise AssetError('Cached configuration identifies the wrong brand or profile.')
        for key in ('doc_logo','section_image'):
            relative=brand.get('runtime',{}).get(key)
            if relative and f"{brand['profile']}/{relative}" not in manifest['files']:raise AssetError(f'Unverified brand artwork reference: {key}')
        return snapshot
    except OSError as exc:raise AssetError(f'Brand assets are missing or incomplete. Run rebrand setup with your local brands folder. {exc}') from None

def installed(root=ROOT,brand=None):
    lock=read_lock(root,brand)
    return verify(cache_folder(root)/lock['sha256'],lock)

def find_data(given=None):
    if given or os.environ.get('HARNESS_BRAND_DATA'):return Path(given or os.environ['HARNESS_BRAND_DATA']).expanduser().resolve()
    config=Path(os.environ.get('XDG_CONFIG_HOME',str(Path.home()/'.config')))
    pointer=config/'harness-brand/data'
    if pointer.is_file() and (recorded:=pointer.read_text().strip()):return Path(recorded).expanduser().resolve()
    local=(Path.home()/'Library/Application Support/Harness Brand/brands' if sys.platform=='darwin' else Path.home()/'.local/share/harness-brand/brands')
    if local.is_dir():return local
    raise AssetError('No brands folder is configured. Give --data FOLDER or configure Harness Brand first.')

def available(data=None):
    source=find_data(data)
    if not source.is_dir():raise AssetError(f'No brands folder at {source}')
    return sorted(p.name for p in source.iterdir() if p.is_dir() and re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}',p.name) and (p/'rebrand/manifest.json').is_file())

def install(data=None,brand=None,*,root=ROOT):
    name=identity(brand);source=find_data(data)
    path=f'{name}/rebrand/manifest.json'
    try:raw=safe_path(source,path).read_bytes()
    except OSError:raise AssetError(f'{name} has no sealed rebranding profile in {source}. Authoring support alone does not enable rebranding.') from None
    lock={'schema':1,'brand':name,'manifest':path,'sha256':digest(raw),'source':str(source)}
    try:
        git=subprocess.run(['git','-C',str(source),'rev-parse','HEAD'],capture_output=True,text=True,timeout=10)
        if git.returncode==0:lock['revision']=git.stdout.strip()
    except (OSError,subprocess.TimeoutExpired):pass  # A local folder does not require Git.
    manifest=parse_manifest(raw,lock);cache=cache_folder(root);cache.mkdir(parents=True,exist_ok=True);target=cache/lock['sha256']
    # Always check the selected sources, even when this snapshot already exists.
    with tempfile.TemporaryDirectory(prefix='.install-',dir=cache) as temp:
        staged=Path(temp)/'snapshot';staged.mkdir();(staged/'manifest.json').write_bytes(raw)
        for relative,spec in manifest['files'].items():
            content=safe_path(source,spec['source']).read_bytes()
            if digest(content)!=spec['sha256']:raise AssetError(f'Brand source changed: {spec["source"]}. Seal and review the profile before installation.')
            destination=safe_path(staged,relative);destination.parent.mkdir(parents=True,exist_ok=True);destination.write_bytes(content)
        verify(staged,lock)
        if target.exists():verify(target,lock)
        else:
            try:staged.rename(target)
            except OSError:
                if not target.is_dir():raise
                verify(target,lock)
    locks=state_folder(root)/'locks';locks.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w',dir=locks,delete=False) as handle:
        temporary=Path(handle.name);json.dump(lock,handle,indent=2);handle.write('\n')
    try:temporary.replace(locks/f'{name}.json')
    finally:temporary.unlink(missing_ok=True)
    return target

def info(root=ROOT,brand=None):
    lock=read_lock(root,brand);snapshot=installed(root,brand)
    return {**lock,'snapshot':str(snapshot),'rules':str(snapshot/f"assets/{lock['brand']}/rules.md"),'references':str(snapshot/'references/brand')}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('command',choices=['install','paths','check','list']);p.add_argument('--brand');p.add_argument('--data');p.add_argument('--all',action='store_true');a=p.parse_args()
    try:
        if a.command=='list':print(json.dumps(available(a.data)));return 0
        names=available(a.data) if a.all and a.command=='install' else [identity(a.brand)]
        result=[]
        for name in names:
            if a.command=='install':install(a.data,name)
            result.append(info(brand=name))
        print(json.dumps(result if a.all else result[0],indent=2));return 0
    except (ValueError,OSError) as exc:print(f'Brand assets: {exc}',file=sys.stderr);return 1

if __name__=='__main__':sys.exit(main())
