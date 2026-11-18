"""Every packaged web asset must match the same PWA source, including privacy and feature modules."""
from pathlib import Path
from zipfile import ZipFile
import hashlib
import sys
apk = Path(sys.argv[1] if len(sys.argv) > 1 else 'android/app/build/outputs/apk/debug/app-debug.apk')
files = sorted(p for p in Path('www').rglob('*') if p.is_file() and not any(part.startswith('.') for part in p.relative_to('www').parts))
with ZipFile(apk) as package:
    for path in files:
        name = str(path.relative_to('www'))
        if package.read('assets/public/' + name) != path.read_bytes():
            raise SystemExit('APK asset differs from PWA: ' + name)
print('APK_PARITY_OK: all ' + str(len(files)) + ' PWA assets are byte-identical; APK SHA256=' + hashlib.sha256(apk.read_bytes()).hexdigest())
