package ru.poputi.app;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Base64;
import androidx.core.app.NotificationCompat;
import java.nio.charset.StandardCharsets;
import java.net.*;
import java.io.*;
import java.security.*;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;
import ru.rustore.sdk.pushclient.RuStorePushClient;

/** Persist only local opt-in and a session fingerprint; session stays in Keystore. */
public final class PoPutiRuStoreState {
 public static final Object LOCK=new Object();
 static final String PREFS="po-puti-rustore-push",SESSION="po-puti-session-v5",CHANNEL="trip_updates",PATH="poputi_push_path",RECIPIENT="poputi_push_recipient";
 private PoPutiRuStoreState(){}
 static SharedPreferences prefs(Context context){return context.getSharedPreferences(PREFS,Context.MODE_PRIVATE);}
 static String session(Context context){
  synchronized(LOCK){try{
   String value=context.getSharedPreferences(SESSION,Context.MODE_PRIVATE).getString("value","");if(value.isEmpty())return "";
   String[] parts=value.split(":");if(parts.length!=2)return "";
   KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);java.security.Key key=store.getKey(SESSION,null);if(key==null)return "";
   Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));
   return new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);
  }catch(Exception ignored){return "";}}
 }
 static String fingerprint(String token){try{byte[] bytes=MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));StringBuilder result=new StringBuilder();for(byte b:bytes)result.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return result.toString();}catch(Exception ignored){return "";}}
 static boolean active(Context context){
  synchronized(LOCK){String token=session(context);return !token.isEmpty()&&prefs(context).getBoolean("enabled",false)&&fingerprint(token).equals(prefs(context).getString("session",""));}
 }
 static String recipient(Context context){synchronized(LOCK){return active(context)?prefs(context).getString("recipient",""):"";}}
 static String provider(Context context){return prefs(context).getString("provider","rustore");}
 static void activate(Context context,String userId,String deviceId,String expectedSession){activate(context,userId,deviceId,expectedSession,"rustore");}
 static void activate(Context context,String userId,String deviceId,String expectedSession,String provider){
  if(!provider.equals("fcm")&&!provider.equals("rustore"))throw new IllegalArgumentException();
  synchronized(LOCK){if(expectedSession.isEmpty()||!expectedSession.equals(session(context)))throw new IllegalStateException("Session changed");
   if(!prefs(context).edit().putBoolean("enabled",true).putString("provider",provider).putString("recipient",userId).putString("device",deviceId).putString("session",fingerprint(expectedSession)).commit())throw new IllegalStateException("Push settings unavailable");channel(context);
  }
 }
 static void disable(Context context,boolean deleteSdkToken){
  synchronized(LOCK){String provider=provider(context);prefs(context).edit().clear().commit();clearDelivered(context);
   if(deleteSdkToken&&provider.equals("fcm"))PoPutiFcm.disable(context);
   if(deleteSdkToken&&provider.equals("rustore")&&PoPutiApplication.rustoreConfigured()&&RuStorePushClient.INSTANCE.isInitialized())RuStorePushClient.INSTANCE.deleteToken().addOnFailureListener(error->{});
  }
 }
 static void clearDelivered(Context context){NotificationManager manager=(NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE);if(manager!=null)manager.cancelAll();}
 static void channel(Context context){if(Build.VERSION.SDK_INT>=26){NotificationManager manager=(NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE);if(manager!=null)manager.createNotificationChannel(new NotificationChannel(CHANNEL,"Поездки и отзывы",NotificationManager.IMPORTANCE_DEFAULT));}}
 static boolean accepts(Context context,String userId){synchronized(LOCK){return PoPutiPushPolicy.accepts(prefs(context).getString("recipient",""),userId,prefs(context).getBoolean("enabled",false),active(context));}}
 static void display(Context context,Map<String,String> data,String expectedProvider){
  synchronized(LOCK){if(!expectedProvider.equals(provider(context)))return;String id=data.get("notificationId"),userId=data.get("recipientId");
   if(!accepts(context,userId)||!PoPutiPushPolicy.validNotificationId(id))return;
   if(Build.VERSION.SDK_INT>=33&&context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return;
   Set<String> seen=new LinkedHashSet<>(prefs(context).getStringSet("seen",Collections.emptySet()));if(seen.contains(id))return;
   String path=PoPutiPushPolicy.safePath(data.get("path"));
   Intent intent=new Intent(context,MainActivity.class).setAction("ru.poputi.app.NOTIFICATION."+id).putExtra(PATH,path).putExtra(RECIPIENT,userId).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
   PendingIntent content=PendingIntent.getActivity(context,id.hashCode(),intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
   channel(context);NotificationManager manager=(NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE);if(manager==null)return;
   Notification notification=new NotificationCompat.Builder(context,CHANNEL).setSmallIcon(R.drawable.ic_poputi_notification).setContentTitle("По пути — новое уведомление").setContentText("Откройте приложение, чтобы посмотреть уведомление.").setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setAutoCancel(true).setContentIntent(content).build();
   try{manager.notify(id,0,notification);seen.add(id);while(seen.size()>100)seen.remove(seen.iterator().next());prefs(context).edit().putStringSet("seen",seen).apply();}catch(SecurityException ignored){}
  }
 }
 static void syncToken(Context context,String token,String expectedProvider){
  String expectedSession,deviceId,userId,provider;
  synchronized(LOCK){if(!expectedProvider.equals(provider(context))||!active(context)||token==null||!token.matches("[A-Za-z0-9_:.-]{30,4096}"))return;expectedSession=session(context);deviceId=prefs(context).getString("device","");userId=recipient(context);provider=provider(context);}
  HttpURLConnection connection=null;
  try{
   JSONObject payload=new JSONObject().put("platform","android").put("provider",provider).put("refreshOnly",true).put("deviceId",deviceId).put("token",token);
   synchronized(LOCK){if(!expectedProvider.equals(provider(context))||!accepts(context,userId)||!expectedSession.equals(session(context)))return;}
   connection=(HttpURLConnection)new URL("https://vputipoputka.ru/api/push/subscribe").openConnection();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(8000);connection.setReadTimeout(8000);connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");connection.setRequestProperty("Authorization","Bearer "+expectedSession);
   byte[] bytes=payload.toString().getBytes(StandardCharsets.UTF_8);connection.setFixedLengthStreamingMode(bytes.length);try(OutputStream out=connection.getOutputStream()){out.write(bytes);}
   if(connection.getResponseCode()==401)synchronized(LOCK){if(expectedSession.equals(session(context)))disable(context,false);}
  }catch(Exception ignored){}finally{if(connection!=null)connection.disconnect();}
 }
}
