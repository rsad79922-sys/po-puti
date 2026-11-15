#!/usr/bin/env python3
import re,sys
from pathlib import Path
path=Path(sys.argv[1]);text=path.read_text()
if 'location = /api/routes/estimate {' not in text:
 match=re.search(r'(?ms)^    location / \{\n(.*?)^    \}',text)
 if not match:raise SystemExit('TLS proxy block not found; refusing to guess')
 body=re.sub(r'proxy_read_timeout\s+\d+s;', 'proxy_read_timeout 130s;',match[1]);body=re.sub(r'proxy_send_timeout\s+\d+s;', 'proxy_send_timeout 130s;',body)
 text=text[:match.start()]+'    location = /api/routes/estimate {\n'+body+'    }\n'+text[match.start():];path.write_text(text)
