#!/usr/bin/env python3
"""Read only presence checks; never print endpoints, credentials or account data."""
from pathlib import Path
import shlex
values = {}
for path in (Path('/etc/po-puti/po-puti.env'), Path('/etc/po-puti/routing.env')):
    if not path.is_file():
        continue
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        if key in ('ROUTING_PROVIDER', 'ROUTING_URL', 'ROUTING_API_KEY', 'ROUTING_FALLBACK_PROVIDER', 'ROUTING_FALLBACK_URL', 'ROUTING_FALLBACK_API_KEY', 'GEOCODING_URL'):
            try:
                parts = shlex.split(value, comments=True)
                values[key] = bool(parts and parts[0])
            except ValueError:
                values[key] = False
for key in ('ROUTING_PROVIDER', 'ROUTING_URL', 'ROUTING_API_KEY', 'ROUTING_FALLBACK_PROVIDER', 'GEOCODING_URL'):
    print('CONFIG_' + key + '_PRESENT=' + ('yes' if values.get(key) else 'no'))
print('ROUTING_PREFLIGHT_READ_ONLY: no endpoint, key or user data exported; custom systemd environment sources require separate owner verification')
