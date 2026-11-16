"""Inspect merged manifests, including permissions contributed by advertising/push SDKs."""
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

variant = sys.argv[1] if len(sys.argv) > 1 else 'debug'
if variant not in ('debug', 'release'):
    raise SystemExit('Unknown build variant')
files = list(Path(f'android/app/build/intermediates/merged_manifests/{variant}').rglob('AndroidManifest.xml'))
if len(files) != 1:
    raise SystemExit(f'Expected exactly one merged {variant} manifest, found {len(files)}')
manifest = ET.parse(files[0]).getroot()
ns = '{http://schemas.android.com/apk/res/android}'
assert manifest.get('package') == 'ru.poputi.app', 'Package identity must remain update-compatible'
sdk = manifest.find('uses-sdk')
assert sdk is not None and int(sdk.get(ns+'minSdkVersion')) >= 23
assert int(sdk.get(ns+'targetSdkVersion')) >= 35
app = manifest.find('application')
assert app is not None and app.get(ns+'allowBackup') == 'false', 'Sessions must not enter Android backup'
assert app.get(ns+'usesCleartextTraffic') == 'false', 'HTTP must remain disabled'
if variant == 'release':
    assert app.get(ns+'debuggable') != 'true', 'Release must not be debuggable'
metadata = {m.get(ns+'name'): m.get(ns+'value') for m in app.findall('meta-data')}
assert metadata.get('com.yandex.mobile.ads.AUTOMATIC_SDK_INITIALIZATION') == 'false', 'Ad initialization requires consent'
assert app.get(ns+'name') == 'ru.poputi.app.PoPutiApplication', 'Push uses explicit application initialization'
assert not any(p.get(ns+'name') == 'ru.rustore.sdk.pushclient.provider.RuStorePushClientInitProvider' for p in app.findall('provider')), 'RuStore must not initialize before local opt-in'
permissions = {p.get(ns+'name') for p in manifest.findall('uses-permission')}
forbidden = {'android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION',
             'android.permission.READ_CONTACTS', 'android.permission.READ_SMS', 'android.permission.READ_CALL_LOG',
             'android.permission.RECORD_AUDIO', 'android.permission.MANAGE_EXTERNAL_STORAGE'}
assert not permissions & forbidden, 'Unexpected sensitive permissions: '+str(permissions & forbidden)
assert 'android.permission.INTERNET' in permissions
assert 'android.permission.POST_NOTIFICATIONS' in permissions
print('MANIFEST_OK', variant, 'minSdk='+sdk.get(ns+'minSdkVersion'), 'targetSdk='+sdk.get(ns+'targetSdkVersion'))
print('DECLARED_PERMISSIONS', ', '.join(sorted(permissions)))
