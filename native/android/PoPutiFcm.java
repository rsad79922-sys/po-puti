package ru.poputi.app;

import android.content.Context;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;
import org.json.JSONObject;

/** Only public Android client options are persisted; no server credentials. */
final class PoPutiFcm {
 static final String CONFIG="po-puti-firebase-client";
 static synchronized void initialize(Context context,JSONObject input){
  try{
   if(input!=null){
    String project=input.optString("projectId"),sender=input.optString("senderId"),app=input.optString("applicationId"),key=input.optString("apiKey");
    if(!project.matches("[a-z][a-z0-9-]{4,62}")||!sender.matches("[0-9]{5,30}")||!app.matches("1:"+sender+":android:[a-fA-F0-9]+")||!key.matches("AIza[A-Za-z0-9_-]{20,100}"))throw new IllegalArgumentException();
    FirebaseOptions options=new FirebaseOptions.Builder().setProjectId(project).setGcmSenderId(sender).setApplicationId(app).setApiKey(key).build();
    if(FirebaseApp.getApps(context).isEmpty())FirebaseApp.initializeApp(context,options);
    else if(!FirebaseApp.getInstance().getOptions().getApplicationId().equals(app))throw new IllegalStateException();
    if(!context.getSharedPreferences(CONFIG,Context.MODE_PRIVATE).edit().putString("options",input.toString()).commit())throw new IllegalStateException();
   }else if(FirebaseApp.getApps(context).isEmpty()){
    String saved=context.getSharedPreferences(CONFIG,Context.MODE_PRIVATE).getString("options","");
    if(!saved.isEmpty()){initialize(context,new JSONObject(saved));return;}
    if(FirebaseApp.initializeApp(context)==null)throw new IllegalStateException();
   }
  }catch(Exception ignored){throw new IllegalStateException("Firebase client configuration unavailable");}
 }
 static void disable(Context context){
  try{if(!FirebaseApp.getApps(context).isEmpty()){FirebaseMessaging messaging=FirebaseMessaging.getInstance();messaging.setAutoInitEnabled(false);messaging.deleteToken().addOnFailureListener(error->{});}}catch(RuntimeException ignored){}
 }
}
