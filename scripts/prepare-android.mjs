import {prepareLauncherIcons} from './prepare-launcher-icons.mjs';
import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
const folder='android/app/src/main/java/ru/poputi/app';await mkdir(folder,{recursive:true});
await copyFile('native/android/PoPutiFeaturesPlugin.java',folder+'/PoPutiFeaturesPlugin.java');
for(const name of ['PoPutiFcm','PoPutiFcmPushPlugin','PoPutiFcmMessagingService','PoPutiSearchDate','PoPutiApplication','PoPutiPushPolicy','PoPutiRuStoreState','PoPutiRuStoreMessagingService','PoPutiRuStorePushPlugin','PoPutiUpdatePolicy','PoPutiUpdatesPlugin'])await copyFile('native/android/'+name+'.java',folder+'/'+name+'.java');
await mkdir('android/app/src/main/res/drawable',{recursive:true});await copyFile('native/android/ic_poputi_notification.xml','android/app/src/main/res/drawable/ic_poputi_notification.xml');
await writeFile(folder+'/MainActivity.java',`package ru.poputi.app;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;
import androidx.activity.OnBackPressedCallback;
public class MainActivity extends BridgeActivity {
 @Override public void onCreate(Bundle savedInstanceState){registerPlugin(PoPutiFeaturesPlugin.class);registerPlugin(PoPutiRuStorePushPlugin.class);registerPlugin(PoPutiFcmPushPlugin.class);registerPlugin(PoPutiUpdatesPlugin.class);super.onCreate(savedInstanceState);getOnBackPressedDispatcher().addCallback(this,new OnBackPressedCallback(true){@Override public void handleOnBackPressed(){PluginHandle handle=getBridge()==null?null:getBridge().getPlugin("PoPutiFeatures");if(handle!=null&&handle.getInstance() instanceof PoPutiFeaturesPlugin&&((PoPutiFeaturesPlugin)handle.getInstance()).handleNativeBack())return;if(getBridge()!=null&&getBridge().getWebView().canGoBack()){getBridge().getWebView().goBack();return;}setEnabled(false);getOnBackPressedDispatcher().onBackPressed();setEnabled(true);}});}
}
`);
const manifest='android/app/src/main/AndroidManifest.xml';let xml=await readFile(manifest,'utf8');xml=xml.replace('android:allowBackup="true"','android:allowBackup="false"');if(!xml.includes('AUTOMATIC_SDK_INITIALIZATION'))xml=xml.replace('<application','<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />\n    <application').replace('</application>','<meta-data android:name="com.yandex.mobile.ads.AUTOMATIC_SDK_INITIALIZATION" android:value="false" />\n    </application>');if(!xml.includes('android:usesCleartextTraffic='))xml=xml.replace('android:allowBackup="false"','android:allowBackup="false" android:usesCleartextTraffic="false"');await writeFile(manifest,xml);
const gradle='android/app/build.gradle';let build=await readFile(gradle,'utf8');if(!build.includes('com.yandex.android:mobileads:'))build=build.replace('dependencies {',"dependencies {\n    implementation 'com.yandex.android:mobileads:8.6.0'");
if(!build.includes('com.google.firebase:firebase-messaging:'))build=build.replace('dependencies {',"dependencies {\n    implementation 'com.google.firebase:firebase-messaging:24.1.0'");
if(!build.includes('ru.rustore.sdk:pushclient:'))build=build.replace('dependencies {',"dependencies {\n    implementation 'ru.rustore.sdk:pushclient:7.5.0'");
const projectId=process.env.RUSTORE_PUSH_PROJECT_ID||'';if(!/^[A-Za-z0-9_-]{0,200}$/.test(projectId))throw Error('Invalid public RuStore project ID');
const field='buildConfigField "String", "RUSTORE_PUSH_PROJECT_ID", '+JSON.stringify(JSON.stringify(projectId));
if(build.includes('"RUSTORE_PUSH_PROJECT_ID"'))build=build.replace(/buildConfigField "String", "RUSTORE_PUSH_PROJECT_ID",[^\n]*/,field);else build=build.replace('android {','android {\n    buildFeatures { buildConfig true }\n    defaultConfig { '+field+'\n    }');
const rootGradle='android/build.gradle';let root=await readFile(rootGradle,'utf8');if(!root.includes('nexus-external.rustore.ru')){root+='\nallprojects { repositories { maven { url "https://nexus-external.rustore.ru/repository/maven-rustore-exposed/" } } }\n';await writeFile(rootGradle,root)}
let nativeXml=await readFile(manifest,'utf8');if(!nativeXml.includes('xmlns:tools='))nativeXml=nativeXml.replace('<manifest ','<manifest xmlns:tools="http://schemas.android.com/tools" ');
if(!nativeXml.includes('android:name=".PoPutiApplication"'))nativeXml=nativeXml.replace('<application','<application android:name=".PoPutiApplication"');
if(!nativeXml.includes('PoPutiRuStoreMessagingService'))nativeXml=nativeXml.replace('</application>',`<provider android:name="ru.rustore.sdk.pushclient.provider.RuStorePushClientInitProvider" tools:node="remove" />
        <service android:name=".PoPutiRuStoreMessagingService" android:exported="true"><intent-filter><action android:name="ru.rustore.sdk.pushclient.MESSAGING_EVENT" /></intent-filter></service>
    </application>`);await writeFile(manifest,nativeXml);
if(!nativeXml.includes('PoPutiFcmMessagingService')){nativeXml=nativeXml.replace('</application>',`<meta-data android:name="firebase_messaging_auto_init_enabled" android:value="false" tools:replace="android:value" />
        <service android:name="com.capacitorjs.plugins.pushnotifications.MessagingService" tools:node="remove" />
        <service android:name=".PoPutiFcmMessagingService" android:exported="false"><intent-filter><action android:name="com.google.firebase.MESSAGING_EVENT" /></intent-filter></service>
    </application>`);await writeFile(manifest,nativeXml);}
// java.time is used on API 23–25 as well as modern devices.
if(!build.includes('coreLibraryDesugaringEnabled'))build=build.replace('android {',`android {
    compileOptions { coreLibraryDesugaringEnabled true; sourceCompatibility JavaVersion.VERSION_21; targetCompatibility JavaVersion.VERSION_21 }
`).replace('dependencies {',"dependencies {\n    coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs:2.1.5'");
const versionCode=process.env.ANDROID_VERSION_CODE,versionName=process.env.ANDROID_VERSION_NAME;
if(versionCode){if(!/^[1-9]\d{0,8}$/.test(versionCode))throw Error('Invalid Android versionCode');build=build.replace(/versionCode \d+/,`versionCode ${versionCode}`)}
if(versionName){if(!/^[\d]+(?:\.[\d]+){1,3}$/.test(versionName))throw Error('Invalid Android versionName');build=build.replace(/versionName "[^"]+"/,`versionName "${versionName}"`)}
await writeFile(gradle,build);console.log('ANDROID_FEATURES_PREPARED: native inline ads, shared search, encrypted sessions; no signing key accessed');

await prepareLauncherIcons('android/app/src/main/res');
console.log('ANDROID_BRAND_ICONS_PREPARED: owner logo, all densities, adaptive and round launchers, splash');
