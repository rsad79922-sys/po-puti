#!/usr/bin/env bash
# Read-only diagnosis of domain reachability and PWA entry from Ubuntu.
# Does not modify services, files, accounts, databases, DNS or firewall.
set -u
DOMAIN="vputipoputka.ru"
echo "=== PO PUTI read-only connectivity diagnosis ==="
date -u
echo
echo "--- DNS IPv4 ---"
getent ahostsv4 "$DOMAIN" || true
echo
echo "--- DNS IPv6 ---"
getent ahostsv6 "$DOMAIN" || true
echo
echo "--- Listening ports ---"
ss -ltnp || true
echo
echo "--- Local backend health (no proxy) ---"
curl --noproxy '*' --connect-timeout 4 --max-time 10 -sS -i "http://127.0.0.1:8080/api/health" || true
echo
echo "--- Local backend main HTML headers ---"
curl --noproxy '*' --connect-timeout 4 --max-time 10 -sS -I "http://127.0.0.1:8080/" || true
echo
echo "--- Domain main HTML over IPv4 ---"
curl -4 --noproxy '*' --connect-timeout 5 --max-time 12 -sS -I "https://$DOMAIN/?probe=20261112" || true
echo
echo "--- Domain app.js over IPv4 ---"
curl -4 --noproxy '*' --connect-timeout 5 --max-time 12 -sS -I "https://$DOMAIN/app.js?v=boot12" || true
echo
echo "--- Domain service worker over IPv4 ---"
curl -4 --noproxy '*' --connect-timeout 5 --max-time 12 -sS -I "https://$DOMAIN/sw.js" || true
echo
echo "--- Domain main HTML over IPv6 (if available) ---"
curl -6 --noproxy '*' --connect-timeout 5 --max-time 12 -sS -I "https://$DOMAIN/" || true
echo
echo "--- Nginx local HTTPS with correct hostname / certificate ---"
curl --noproxy '*' --resolve "$DOMAIN:443:127.0.0.1" --connect-timeout 5 --max-time 12 -sS -I "https://$DOMAIN/" || true
echo
echo "--- Recent real nginx error log (may contain client IPs; redact before sharing) ---"
if [ -r /var/log/nginx/error.log ]; then
  tail -n 25 /var/log/nginx/error.log
else
  echo "Nginx error.log is not readable or does not exist."
fi
echo
echo "--- Nginx service journal (start/restart events, NOT HTTP errors) ---"
journalctl -u nginx --no-pager -n 10 2>/dev/null || true
echo
echo "=== END OF DIAGNOSIS ==="
