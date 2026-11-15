import importlib.util,tempfile,json
from pathlib import Path
s=importlib.util.spec_from_file_location('brouter_maps','scripts/brouter-maps.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
assert m.russian_tile('E35_N55.rd5') and m.russian_tile('W180_N65.rd5')
assert not m.russian_tile('../po-puti.sqlite') and not m.russian_tile('E5_N50.rd5')
records=m.parse_index('<a href="E35_N55.rd5">E35_N55.rd5</a> 15-Nov-2026 01:03 36588225\n<a href="E5_N50.rd5">E5_N50.rd5</a> 15-Nov-2026 01:03 42')
assert len(records)==1 and records[0]['size']==36588225
with tempfile.TemporaryDirectory() as tmp:
 root=Path(tmp)
 for name in ['maps-current','maps-previous','maps-old','maps-user-files']:
  p=root/name;p.mkdir();(p/'.snapshot.json').write_text(json.dumps({'magic':m.MAGIC}));(p/'E35_N55.rd5').write_bytes(b'fixture')
 (root/'maps-user-files'/'private.sqlite').write_bytes(b'preserve')
 m.prune(root,{'maps-current','maps-previous'})
 assert not (root/'maps-old').exists()
 assert (root/'maps-current').is_dir() and (root/'maps-previous').is_dir()
 assert (root/'maps-user-files'/'private.sqlite').read_bytes()==b'preserve'
print('PASS: bounded Russian map manifest, dateline coverage, current/prior cache retained and foreign files never removed')
