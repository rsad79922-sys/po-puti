import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
const folder='android/app/src/main/java/ru/poputi/app';await mkdir(folder,{recursive:true});
await copyFile('native/android/PoPutiFeaturesPlugin.java',folder+'/PoPutiFeaturesPlugin.java');
await writeFile(folder+'/MainActivity.java',`package ru.poputi.app;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;
import androidx.activity.OnBackPressedCallback;
public class MainActivity extends BridgeActivity {
 @Override public void onCreate(Bundle savedInstanceState){registerPlugin(PoPutiFeaturesPlugin.class);super.onCreate(savedInstanceState);getOnBackPressedDispatcher().addCallback(this,new OnBackPressedCallback(true){@Override public void handleOnBackPressed(){PluginHandle handle=getBridge()==null?null:getBridge().getPlugin("PoPutiFeatures");if(handle!=null&&handle.getInstance() instanceof PoPutiFeaturesPlugin&&((PoPutiFeaturesPlugin)handle.getInstance()).handleNativeBack())return;if(getBridge()!=null&&getBridge().getWebView().canGoBack()){getBridge().getWebView().goBack();return;}setEnabled(false);getOnBackPressedDispatcher().onBackPressed();setEnabled(true);}});}
}
`);
const manifest='android/app/src/main/AndroidManifest.xml';let xml=await readFile(manifest,'utf8');xml=xml.replace('android:allowBackup="true"','android:allowBackup="false"');if(!xml.includes('AUTOMATIC_SDK_INITIALIZATION'))xml=xml.replace('<application','<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />\n    <application').replace('</application>','<meta-data android:name="com.yandex.mobile.ads.AUTOMATIC_SDK_INITIALIZATION" android:value="false" />\n    </application>');if(!xml.includes('android:usesCleartextTraffic='))xml=xml.replace('android:allowBackup="false"','android:allowBackup="false" android:usesCleartextTraffic="false"');await writeFile(manifest,xml);
const gradle='android/app/build.gradle';let build=await readFile(gradle,'utf8');if(!build.includes('com.yandex.android:mobileads:'))build=build.replace('dependencies {',"dependencies {\n    implementation 'com.yandex.android:mobileads:8.6.0'");
// java.time is used on API 23–25 as well as modern devices.
if(!build.includes('coreLibraryDesugaringEnabled'))build=build.replace('android {',`android {
    compileOptions { coreLibraryDesugaringEnabled true; sourceCompatibility JavaVersion.VERSION_21; targetCompatibility JavaVersion.VERSION_21 }
`).replace('dependencies {',"dependencies {\n    coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs:2.1.5'");
const versionCode=process.env.ANDROID_VERSION_CODE,versionName=process.env.ANDROID_VERSION_NAME;
if(versionCode){if(!/^[1-9]\d{0,8}$/.test(versionCode))throw Error('Invalid Android versionCode');build=build.replace(/versionCode \d+/,`versionCode ${versionCode}`)}
if(versionName){if(!/^[\d]+(?:\.[\d]+){1,3}$/.test(versionName))throw Error('Invalid Android versionName');build=build.replace(/versionName "[^"]+"/,`versionName "${versionName}"`)}
await writeFile(gradle,build);console.log('ANDROID_FEATURES_PREPARED: native inline ads, shared search, encrypted sessions; no signing key accessed');
