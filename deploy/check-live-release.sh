#!/usr/bin/env bash
# Read-only release verification: tests the REAL server without creating users.
# Does not modify configuration, services, database or repository.
set -u
PORT="${PORT:-8080}"
LOCAL="http://127.0.0.1:${PORT}"
PUBLIC="https://vputipoputka.ru"
fail=0
check(){
  local label="$1" url="$2" expected="$3" actual
  actual="$(curl --noproxy '*' --max-time 12 --connect-timeout 5 -sS -o /dev/null -w '%{http_code}' -H 'Accept: text/html' "$url")" || actual="000"
  if [[ "$actual" = "$expected" ]]; then
    printf 'OK   %-36s HTTP %s\n' "$label" "$actual"
  else
    printf 'FAIL %-36s HTTP %s expected %s\n' "$label" "$actual" "$expected"
    fail=1
  fi
}
echo "Po Puti read-only live release verification"
echo "Running at $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "Local backend:"
check 'home 1st open' "$LOCAL/" 200
check 'home 2nd open' "$LOCAL/" 200
check 'home 3rd open' "$LOCAL/" 200
check 'index.html' "$LOCAL/index.html" 200
check 'direct /login' "$LOCAL/login" 200
check 'direct /trips' "$LOCAL/trips" 200
check 'direct /ride/id' "$LOCAL/ride/test-id" 200
check 'JavaScript' "$LOCAL/app.js" 200
check 'CSS' "$LOCAL/styles.css" 200
check 'PWA worker' "$LOCAL/sw.js" 200
check 'Backend config' "$LOCAL/config.js" 200
check 'API health' "$LOCAL/api/health" 200
check 'nonexistent JS must remain 404' "$LOCAL/__does_not_exist__.js" 404
echo "Public HTTPS:"
check 'home over TLS' "$PUBLIC/" 200
check 'mobile app JavaScript over TLS' "$PUBLIC/app.js" 200
check 'direct route over TLS' "$PUBLIC/login" 200
if [[ "$fail" -eq 0 ]]; then echo 'RESULT: all HTTP release checks passed';else echo 'RESULT: some HTTP release checks FAILED';fi
exit "$fail"
