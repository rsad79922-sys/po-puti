"""Prove the compiled APK contains exactly the web interface accepted by PWA tests."""
from pathlib import Path
from zipfile import ZipFile
import hashlib
apk = Path('android/app/build/outputs/apk/debug/app-debug.apk')
with ZipFile(apk) as package:
    for name in ('features-v5.js', 'app.js', 'index.html', 'styles.css', 'sw.js', 'config.js', 'manifest.webmanifest'):
        if package.read('assets/public/' + name) != Path('www', name).read_bytes():
            raise SystemExit('APK asset differs from PWA: ' + name)
print('APK_PARITY_OK: seven shared PWA assets are byte-identical; APK SHA256=' + hashlib.sha256(apk.read_bytes()).hexdigest())
