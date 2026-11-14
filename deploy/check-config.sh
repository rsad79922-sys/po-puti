#!/usr/bin/env bash
# Validate both site templates with a throwaway certificate, never the live /etc/nginx.
set -Eeuo pipefail
repo_dir=$(cd -- "$(dirname -- "$0")/.." && pwd)
check_dir=$(mktemp -d)
trap 'rm -rf "$check_dir"' EXIT
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$check_dir/key.pem" -out "$check_dir/cert.pem" \
  -days 1 -subj /CN=localhost >/dev/null 2>&1
for template in nginx-po-puti.conf nginx-po-puti-tls.conf; do
  sed -e "s|/etc/letsencrypt/live/vputipoputka.ru/fullchain.pem|$check_dir/cert.pem|g" \
      -e "s|/etc/letsencrypt/live/vputipoputka.ru/privkey.pem|$check_dir/key.pem|g" \
      -e "s|/var/log/nginx/po-puti-|$check_dir/po-puti-|g" \
      "$repo_dir/deploy/$template" > "$check_dir/site.conf"
  cat > "$check_dir/nginx.conf" <<CONFIG
pid $check_dir/nginx.pid;
error_log $check_dir/error.log;
events {}
http {
  access_log off;
  client_body_temp_path $check_dir/client;
  proxy_temp_path $check_dir/proxy;
  fastcgi_temp_path $check_dir/fastcgi;
  uwsgi_temp_path $check_dir/uwsgi;
  scgi_temp_path $check_dir/scgi;
  include $repo_dir/deploy/nginx-log-format.conf;
  include $check_dir/site.conf;
}
CONFIG
  nginx -t -p "$check_dir/" -c "$check_dir/nginx.conf"
done
# Verify sandboxing/unit syntax without starting any service. User can be absent in CI.
for unit in "$repo_dir"/deploy/po-puti*.service "$repo_dir"/deploy/po-puti*.timer; do
 systemd-analyze verify "$unit"
done
echo CONFIG_OK
