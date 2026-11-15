#!/usr/bin/env python3
"""Own BRouter OSM map cache; never opens application databases or uploads."""
import concurrent.futures, hashlib, json, os, re, shutil, sys, time, urllib.request, ssl
from pathlib import Path
BASE='https://brouter.de/brouter/segments4/'
MAGIC='po-puti-brouter-map-cache-v1'
MAX_BYTES=3*1024**3

def russian_tile(name):
    match=re.fullmatch(r'([EW])(\d+)_N(\d+)\.rd5',name)
    if not match:return False
    side,x,y=match[1],int(match[2]),int(match[3])
    return (side=='E' and 15<=x<=175 and 40<=y<=80 or side=='W' and 165<=x<=180 and 60<=y<=80) and x%5==0 and y%5==0

def parse_index(body):
    records=[]
    for line in body.splitlines():
        match=re.search(r'href="([EW]\d+_N\d+\.rd5)".*?(\d{2}-[A-Za-z]{3}-\d{4}\s+\d{2}:\d{2})\s+(\d+)\s*$',line)
        if match and russian_tile(match[1]):records.append({'name':match[1],'stamp':match[2],'size':int(match[3])})
    if not records or len(records)>350 or any(r['size']<=0 or r['size']>1024**3 for r in records) or sum(r['size'] for r in records)>MAX_BYTES:raise RuntimeError('Map manifest outside safety bounds')
    return sorted(records,key=lambda r:r['name'])

def request(url):
    context=ssl.create_default_context();context.minimum_version=ssl.TLSVersion.TLSv1_2;context.maximum_version=ssl.TLSVersion.TLSv1_2
    return urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'PoPuti-self-hosted-BRouter/1 (offline map cache)','Connection':'close','Accept-Encoding':'identity'}),timeout=45,context=context)

def prune(root,keep):
    # A repeated update of the same snapshot must still retain the prior one.
    keep=set(keep)
    if len(keep-{None})<2:
        previous=[]
        for directory in root.glob('maps-*'):
            if directory.name in keep or directory.is_symlink():continue
            try:
                metadata=json.loads((directory/'.snapshot.json').read_text())
                if metadata.get('magic')==MAGIC:previous.append((metadata.get('created',0),directory.name))
            except (OSError,ValueError):continue
        if previous:keep.add(max(previous)[1])
    # Only snapshots created here, containing strictly map files and our marker.
    for directory in root.glob('maps-*'):
        if directory.name in keep or directory.is_symlink() or not directory.is_dir():continue
        marker=directory/'.snapshot.json'
        try:metadata=json.loads(marker.read_text())
        except (OSError,ValueError):continue
        if metadata.get('magic')!=MAGIC:continue
        if any(p.is_symlink() or not p.is_file() or p.name!='.snapshot.json' and not re.fullmatch(r'[EW]\d+_N\d+\.rd5',p.name) for p in directory.iterdir()):continue
        shutil.rmtree(directory)

def update(root):
    os.umask(0o027);root=Path(root).resolve()
    if root in (Path('/'),Path('/var'),Path('/var/lib')):raise RuntimeError('Refusing unsafe map-cache root')
    marker=root/'.po-puti-brouter-cache'
    if root.exists() and not marker.is_file() and any(root.iterdir()):raise RuntimeError('Existing directory is not a managed BRouter cache')
    root.mkdir(parents=True,exist_ok=True);root.chmod(0o750);marker.write_text(MAGIC+'\n')
    records=None
    for attempt in range(3):
        try:
            with request(BASE) as response:records=parse_index(response.read(1000000).decode())
            break
        except Exception:
            if attempt==2:raise
            time.sleep(2)
    if records is None:raise RuntimeError('Map index is unavailable')
    total=sum(r['size'] for r in records)
    if shutil.disk_usage(root).free<total+3*1024**3:raise RuntimeError('Insufficient free disk; leave 3 GiB for the application')
    snapshot='maps-'+hashlib.sha256(json.dumps(records,sort_keys=True).encode()).hexdigest()[:16]
    destination=root/snapshot;destination.mkdir(exist_ok=True);destination.chmod(0o750)
    print(f'MAP_PLAN files={len(records)} bytes={total} source=official-BRouter-OSM',flush=True)
    def download(record):
        name,size=record['name'],record['size'];target=destination/name
        if target.exists() and target.stat().st_size==size:return
        last=None
        for attempt in range(2):
            part=destination/(name+'.part')
            try:
                received=0
                with request(BASE+name) as response,part.open('wb') as file:
                    while chunk:=response.read(1024*1024):
                        received+=len(chunk)
                        if received>size:raise RuntimeError('Map snapshot changed during download')
                        file.write(chunk)
                if received!=size:raise RuntimeError('Incomplete map file')
                part.chmod(0o640);part.replace(target);return
            except Exception as error:
                last=error
                if part.exists():part.unlink()
                if attempt==0:time.sleep(1)
        raise RuntimeError('Map download failed: '+name) from last
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for count,_ in enumerate(pool.map(download,records),1):
            if count%20==0 or count==len(records):print(f'MAP_PROGRESS {count}/{len(records)}',flush=True)
    (destination/'.snapshot.json').write_text(json.dumps({'magic':MAGIC,'created':time.time(),'files':records}))
    current=root/'current';previous=current.resolve().name if current.is_symlink() else None
    temporary=root/('current-new-'+str(os.getpid()))
    if temporary.is_symlink():temporary.unlink()
    temporary.symlink_to(snapshot,target_is_directory=True);temporary.replace(current)
    prune(root,{snapshot,previous})
    try:
        import grp
        group=grp.getgrnam('poputi-router').gr_gid
        for path in [root,*root.rglob('*')]:
            if not path.is_symlink():os.chown(path,-1,group)
    except KeyError:pass
    print('MAP_UPDATE_OK: owned offline maps activated; current and prior snapshot retained; application data untouched',flush=True)

if __name__=='__main__':
    if len(sys.argv)!=2:raise SystemExit('Usage: brouter-maps.py /absolute/managed-cache-root')
    if not Path(sys.argv[1]).is_absolute():raise SystemExit('Absolute cache path required')
    update(sys.argv[1])
