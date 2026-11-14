#!/usr/bin/env bash
# Read-only preflight. Never print credentials, environment contents or user records.
set -euo pipefail
export LC_ALL=C
date -u +%FT%TZ
printf 'SERVICE_STATES\n'
systemctl is-active po-puti nginx || true
printf 'RUNTIME\n'
node --version
nginx -v 2>&1
printf 'APPLICATION_CHECKOUT\n'
git -C /opt/po-puti rev-parse HEAD
git -C /opt/po-puti branch --show-current
git -C /opt/po-puti status --porcelain
printf 'UNIT_PATHS\n'
systemctl show po-puti -p FragmentPath -p WorkingDirectory -p EnvironmentFiles -p User -p Group
printf 'LISTENERS\n'
ss -H -ltn '( sport = :80 or sport = :443 or sport = :8443 or sport = :8080 )'
printf 'LOCAL_HEALTH\n'
curl --noproxy '*' -fsS --max-time 5 http://127.0.0.1:8080/api/health
printf '\nTLS_SITE_DIRECTIVES\n'
nginx -T 2>&1 | awk '/^# configuration file / || /^[[:space:]]*(listen|server_name|ssl_certificate|ssl_protocols|proxy_pass)[[:space:]]/{print}'
printf 'PUBLIC_ENV_CONFIGURATION\n'
python3 - <<'PY'
import pathlib,subprocess,json
pid=int(subprocess.check_output(['systemctl','show','po-puti','-p','MainPID','--value'],text=True))
env=dict(x.split(b'=',1) for x in pathlib.Path(f'/proc/{pid}/environ').read_bytes().split(b'\0') if b'=' in x)
for key in ['HOST','PORT','DATA_DIR','PUBLIC_ORIGIN','APP_ORIGINS','NODE_ENV','RELEASE_SHA']:
 value=env.get(key.encode(),b'').decode()
 print(key+'='+json.dumps(value))
print('ADMIN_PASSWORD_PRESENT='+str(bool(env.get(b'ADMIN_PASSWORD'))))
for path in ['/var/lib/po-puti/po-puti.sqlite','/var/lib/po-puti/uploads','/etc/po-puti/po-puti.env']:
 p=pathlib.Path(path)
 print('PERSISTENT_PATH '+path+' exists='+str(p.exists())+' mode='+ (oct(p.stat().st_mode&0o777) if p.exists() else 'missing'))
PY
printf 'CERTIFICATE\n'
openssl x509 -in /etc/letsencrypt/live/vputipoputka.ru/fullchain.pem -noout -dates -subject
printf 'LOCAL_HTTPS\n'
for port in 443 8443; do
 curl --noproxy '*' -sS --resolve "vputipoputka.ru:$port:127.0.0.1" --connect-timeout 2 --max-time 5 -o /dev/null -w "port=$port http=%{http_code} verify=%{ssl_verify_result}\n" "https://vputipoputka.ru:$port/api/health" || true
done
