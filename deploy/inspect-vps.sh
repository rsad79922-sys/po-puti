#!/usr/bin/env bash
# Read-only preflight for both existing and freshly reinstalled Ubuntu.
# Never print credentials, environment contents, database rows or private keys.
set -euo pipefail
export LC_ALL=C
date -u +%FT%TZ
printf 'SERVICE_STATES\n'
systemctl is-active po-puti nginx || true
printf 'OPERATING_SYSTEM\n'
sed -nE '/^(PRETTY_NAME|VERSION_ID)=/p' /etc/os-release
printf 'CAPACITY\n'
getconf _NPROCESSORS_ONLN
free -m
df -m /var/lib/po-puti
printf 'RUNTIME\n'
if command -v node >/dev/null; then node --version; else echo NODE_NOT_INSTALLED; fi
if command -v nginx >/dev/null; then nginx -v 2>&1; else echo NGINX_NOT_INSTALLED; fi
printf 'APPLICATION_CHECKOUT\n'
if [[ -d /opt/po-puti/.git ]]; then
 git -C /opt/po-puti rev-parse HEAD
 git -C /opt/po-puti branch --show-current
 git -C /opt/po-puti status --porcelain
else
 echo APPLICATION_CHECKOUT_MISSING
fi
printf 'UNIT_PATHS\n'
systemctl show po-puti -p FragmentPath -p WorkingDirectory -p EnvironmentFiles -p User -p Group || true
printf 'LISTENERS\n'
ss -H -ltn '( sport = :80 or sport = :443 or sport = :8443 or sport = :8080 )'
printf 'LOCAL_HEALTH\n'
curl --noproxy '*' -fsS --max-time 5 http://127.0.0.1:8080/api/health || true
printf '\nTLS_SITE_DIRECTIVES\n'
if command -v nginx >/dev/null; then
 nginx -T 2>&1 | awk '/^# configuration file / || /^[[:space:]]*(listen|server_name|ssl_protocols)[[:space:]]/{print}' || true
fi
printf 'PERSISTENT_DATA_AND_PUBLIC_ENV\n'
python3 - <<'PY'
import pathlib,subprocess,json
result=subprocess.run(['systemctl','show','po-puti','-p','MainPID','--value'],capture_output=True,text=True)
pid=int(result.stdout.strip() or '0')
if pid>0:
 env=dict(x.split(b'=',1) for x in pathlib.Path(f'/proc/{pid}/environ').read_bytes().split(b'\0') if b'=' in x)
 for key in ['HOST','PORT','DATA_DIR','PUBLIC_ORIGIN','APP_ORIGINS','NODE_ENV','RELEASE_SHA']:
  print(key+'='+json.dumps(env.get(key.encode(),b'').decode()))
 print('ADMIN_PASSWORD_PRESENT='+str(bool(env.get(b'ADMIN_PASSWORD'))))
else:
 print('APPLICATION_NOT_RUNNING')
for path in ['/var/lib/po-puti/po-puti.sqlite','/var/lib/po-puti/uploads','/opt/po-puti/server-data/po-puti.sqlite','/etc/po-puti/po-puti.env','/var/backups/po-puti']:
 p=pathlib.Path(path)
 print('PERSISTENT_PATH '+path+' exists='+str(p.exists())+' mode='+ (oct(p.stat().st_mode&0o777) if p.exists() else 'missing'))
 if p.is_file() and p.suffix=='.sqlite':print('DATABASE_BYTES='+str(p.stat().st_size))
p=pathlib.Path('/var/backups/po-puti')
if p.is_dir():print('BACKUP_ENTRY_COUNT='+str(len(list(p.iterdir()))))
PY
printf 'CERTIFICATE\n'
if [[ -f /etc/letsencrypt/live/vputipoputka.ru/fullchain.pem ]]; then
 openssl x509 -in /etc/letsencrypt/live/vputipoputka.ru/fullchain.pem -noout -dates -subject
else
 echo CERTIFICATE_MISSING
fi
printf 'LOCAL_HTTPS\n'
for port in 443 8443; do
 curl --noproxy '*' -sS --resolve "vputipoputka.ru:$port:127.0.0.1" --connect-timeout 2 --max-time 5 -o /dev/null -w "port=$port http=%{http_code} verify=%{ssl_verify_result}\n" "https://vputipoputka.ru:$port/api/health" || true
done

printf 'FREE_MAP_DOWNLOAD_CONNECTIVITY\n'
for tls in 1.2 1.3; do
 curl -4 --noproxy '*' --tlsv"$tls" --tls-max "$tls" --http1.1 --fail --silent --show-error --connect-timeout 8 --max-time 20 -o /dev/null -w "tls=$tls http=%{http_code} bytes=%{size_download} total=%{time_total}\n" https://brouter.de/brouter/segments4/ || true
done

printf "GEOCODER_SAFE_DIAGNOSIS\n"
node --input-type=module <<'GEO_DIAG'
import {readFileSync} from 'node:fs';import {parseEnv} from 'node:util';
let env={};try{env=parseEnv(readFileSync('/etc/po-puti/routing.env','utf8'))}catch{}
console.log('GEOCODER_SETTINGS',JSON.stringify({provider:env.GEOCODING_PROVIDER||null,keyPresent:!!env.GEOCODING_API_KEY,router:env.ROUTING_PROVIDER||null}));
if(env.GEOCODING_API_KEY){const url=new URL(env.GEOCODING_URL||'https://geocode-maps.yandex.ru/v1');url.searchParams.set('apikey',env.GEOCODING_API_KEY);url.searchParams.set('geocode','Москва, Тверская улица, 1');url.searchParams.set('format','json');url.searchParams.set('lang','ru_RU');url.searchParams.set('results','5');try{const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(10000)});let data;try{data=await response.json()}catch{}console.log('GEOCODER_UPSTREAM',JSON.stringify({http:response.status,matches:data?.response?.GeoObjectCollection?.featureMember?.length??null,errorCode:data?.statusCode??null}));}catch(e){console.log('GEOCODER_UPSTREAM',JSON.stringify({error:e.name,networkCode:e.cause?.code||null}))}}

GEO_DIAG
