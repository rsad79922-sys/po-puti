package ru.poputi.app;

import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.widget.Toast;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;

/** Checks only public release metadata. Download/installation always needs a tap. */
@CapacitorPlugin(name="PoPutiUpdates")
public class PoPutiUpdatesPlugin extends Plugin {
 private final ExecutorService worker=Executors.newSingleThreadExecutor();
 private boolean busy=false,paused=false,destroyed=false;
 private long lastCheck=0;
 private AlertDialog dialog;
 @PluginMethod public void check(PluginCall call){
  boolean manual=Boolean.TRUE.equals(call.getBoolean("manual",true));
  getActivity().runOnUiThread(()->{begin(manual);call.resolve(new JSObject().put("checking",busy));});
 }
 private void begin(boolean manual){
  if(destroyed||paused||busy||dialog!=null||(!manual&&System.currentTimeMillis()-lastCheck<15*60*1000L))return;
  busy=true;lastCheck=System.currentTimeMillis();
  final android.app.Activity activity=getActivity();if(manual)message("Проверяем обновления…");
  worker.execute(()->{
   JSONObject release=null;boolean failed=false;long installed=0;String signer="";
   try{
    PackageManager pm=getContext().getPackageManager();
    PackageInfo info=pm.getPackageInfo(getContext().getPackageName(),Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES);
    installed=Build.VERSION.SDK_INT>=28?info.getLongVersionCode():info.versionCode;
    android.content.pm.Signature[] signatures=Build.VERSION.SDK_INT>=28?info.signingInfo.getApkContentsSigners():info.signatures;
    if(signatures==null||signatures.length!=1)throw new IllegalStateException();
    byte[] hash=MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray());
    StringBuilder hex=new StringBuilder();for(byte b:hash)hex.append(String.format(java.util.Locale.ROOT,"%02x",b&255));signer=hex.toString();
    HttpsURLConnection connection=(HttpsURLConnection)new URL(PoPutiUpdatePolicy.ORIGIN+"/downloads/android-release.json").openConnection();
    connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(8000);connection.setReadTimeout(8000);connection.setUseCaches(false);
    try{
     int code=connection.getResponseCode();
     if(code!=200)throw new IllegalStateException();
     try(java.io.InputStream input=connection.getInputStream()){
      java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[2048];int count;
      while((count=input.read(buffer))!=-1){if(bytes.size()+count>16384)throw new IllegalStateException();bytes.write(buffer,0,count);}
      release=new JSONObject(new String(bytes.toByteArray(),StandardCharsets.UTF_8));
     }
     if(!PoPutiUpdatePolicy.valid(release.getString("package"),release.getLong("versionCode"),release.getString("versionName"),release.getString("certificateSHA256"),release.getString("apkSHA256"),release.getLong("bytes"),release.getString("downloadUrl"))||!signer.equals(release.getString("certificateSHA256")))throw new IllegalStateException();
    }finally{connection.disconnect();}
   }catch(Exception error){failed=true;}
   final JSONObject result=release;final boolean error=failed;final long version=installed;final String certificate=signer;
   activity.runOnUiThread(()->{
    busy=false;if(destroyed||paused||getActivity().isFinishing()||getActivity().isDestroyed())return;
    if(error){if(manual)message("Не удалось проверить обновления. Проверьте интернет и попробуйте ещё раз.");return;}
    presentRelease(result,version,certificate,manual);
   });
  });
 }
 // Called only on the UI thread after metadata validation; also exercised by instrumentation.
 void presentRelease(JSONObject result,long installed,String certificate,boolean manual){
  if(destroyed||paused||dialog!=null||getActivity().isFinishing()||getActivity().isDestroyed())return;
    if(!PoPutiUpdatePolicy.available(installed,certificate,result.optString("package"),result.optLong("versionCode"),result.optString("versionName"),result.optString("certificateSHA256"),result.optString("apkSHA256"),result.optLong("bytes"),result.optString("downloadUrl"))){if(manual)message("У вас актуальная версия приложения");return;}
    long next=result.optLong("versionCode");
    android.content.SharedPreferences prefs=getContext().getSharedPreferences("po-puti-updates",0);
    if(!manual&&prefs.getLong("defer-"+next,0)>System.currentTimeMillis())return;
    dialog=new AlertDialog.Builder(getActivity()).setTitle("Доступно обновление")
     .setMessage("По пути "+result.optString("versionName")+"\n\nНажмите «Обновить», откройте скачанный APK и подтвердите установку. Удалять приложение не нужно — данные сохранятся.")
     .setPositiveButton("Обновить",(d,which)->{
      try{getActivity().startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(result.optString("downloadUrl"))).addCategory(Intent.CATEGORY_BROWSABLE));}
      catch(Exception e){message("Не удалось открыть скачивание. Откройте vputipoputka.ru/install.html в браузере.");}
     }).setNegativeButton("Позже",(d,which)->prefs.edit().putLong("defer-"+next,System.currentTimeMillis()+24*60*60*1000L).apply()).create();
    dialog.setOnCancelListener(d->prefs.edit().putLong("defer-"+next,System.currentTimeMillis()+24*60*60*1000L).apply());
    dialog.setOnDismissListener(d->dialog=null);dialog.show();
 }
 private void message(String text){Toast.makeText(getContext(),text,Toast.LENGTH_LONG).show();}
 @Override protected void handleOnPause(){paused=true;if(dialog!=null)dialog.dismiss();}
 @Override protected void handleOnResume(){paused=false;begin(false);}
 @Override protected void handleOnDestroy(){destroyed=true;if(dialog!=null)dialog.dismiss();worker.shutdownNow();}
}
