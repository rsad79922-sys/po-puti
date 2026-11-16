package ru.poputi.app;

import android.app.Application;
import ru.rustore.sdk.pushclient.RuStorePushClient;
import ru.rustore.sdk.pushclient.common.logger.Logger;

/** Public project ID is optional; service credentials never enter the APK. */
public class PoPutiApplication extends Application {
 public static boolean rustoreConfigured(){return !BuildConfig.RUSTORE_PUSH_PROJECT_ID.isEmpty();}
 public static synchronized void initialize(Application app){if(rustoreConfigured()&&!RuStorePushClient.INSTANCE.isInitialized())RuStorePushClient.INSTANCE.init(app,BuildConfig.RUSTORE_PUSH_PROJECT_ID,new QuietLogger());}
 @Override public void onCreate(){
  super.onCreate();
  if(getSharedPreferences(PoPutiRuStoreState.PREFS,MODE_PRIVATE).getBoolean("enabled",false))try{initialize(this);}catch(RuntimeException ignored){}
 }
 private static final class QuietLogger implements Logger {
  public void verbose(String message,Throwable error){}
  public void debug(String message,Throwable error){}
  public void info(String message,Throwable error){}
  public void warn(String message,Throwable error){}
  public void error(String message,Throwable error){}
  public Logger createLogger(String tag){return this;}
  public Logger createLogger(Object tag){return this;}
 }
}
