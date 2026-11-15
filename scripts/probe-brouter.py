#!/usr/bin/env python3
"""Public road probes only; no live database or account required."""
import json,sys,time,urllib.parse,urllib.request,urllib.error
base=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:17777'
for label,points in [('Moscow-Tver','37.6173,55.7558|35.9176,56.8587'),('Moscow-Yekaterinburg','37.6173,55.7558|60.5975,56.8389')]:
 query=urllib.parse.urlencode({'lonlats':points,'profile':'car-fast','alternativeidx':'0','format':'geojson'})
 start=time.monotonic()
 for attempt in range(10):
  try:
   with urllib.request.urlopen(base+'/brouter?'+query,timeout=120) as response:data=json.load(response)
   break
  except urllib.error.HTTPError as error:
   print('FREE_ROAD_PROBE_ERROR',error.code,error.read(400).decode(errors='replace'),flush=True);raise
  except urllib.error.URLError:
   if attempt==9:raise
   time.sleep(0.5)
 p=data['features'][0]['properties'];distance=float(p['track-length']);duration=float(p['total-time'])
 if not 100000<distance<3000000 or not 1800<duration<172800:raise RuntimeError('Unexpected road probe values')
 print('FREE_ROAD_PROBE_OK '+json.dumps({'route':label,'distance_m':distance,'duration_seconds':duration,'request_seconds':round(time.monotonic()-start,2)}),flush=True)
