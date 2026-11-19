package ru.poputi.app;

import android.Manifest;
import android.os.Build;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailabilityLight;

@CapacitorPlugin(name="PoPutiFcmPush",permissions={@Permission(alias="notifications",strings={Manifest.permission.POST_NOTIFICATIONS})})
public class PoPutiFcmPushPlugin extends Plugin {
 @PluginMethod public void register(PluginCall call){
  if(PoPutiRuStoreState.session(getContext()).isEmpty()){call.reject("Войдите в аккаунт");return;}
  if(GoogleApiAvailabilityLight.getInstance().isGooglePlayServicesAvailable(getContext())!=ConnectionResult.SUCCESS){call.reject("На устройстве нет доступных сервисов Google. Для фоновых уведомлений нужен RuStore Push.","PROVIDER_UNAVAILABLE");return;}
  if(Build.VERSION.SDK_INT>=33&&getPermissionState("notifications")!=PermissionState.GRANTED){requestPermissionForAlias("notifications",call,"registrationPermission");return;}
  registerToken(call);
 }
 @PermissionCallback private void registrationPermission(PluginCall call){if(getPermissionState("notifications")==PermissionState.GRANTED)registerToken(call);else call.reject("Уведомления не разрешены. Включите их в настройках Android.","PERMISSION_DENIED");}
 private void registerToken(PluginCall call){
  try{PoPutiFcm.initialize(getContext(),call.getObject("config"));FirebaseMessaging.getInstance().setAutoInitEnabled(true);
   FirebaseMessaging.getInstance().getToken().addOnSuccessListener(token->call.resolve(new JSObject().put("token",token))).addOnFailureListener(error->call.reject("Не удалось зарегистрировать устройство Firebase. Проверьте соединение и настройки проекта."));
  }catch(RuntimeException ignored){call.reject("Firebase для приложения не настроен. Обратитесь к администратору.");}
 }
 @PluginMethod public void activate(PluginCall call){
  String user=call.getString("userId",""),device=call.getString("deviceId",""),session=call.getString("sessionToken","");
  if(!user.matches("[A-Za-z0-9_-]{1,100}")||!device.matches("[A-Za-z0-9_-]{10,100}")){call.reject("Неверные настройки уведомлений");return;}
  try{PoPutiRuStoreState.activate(getContext(),user,device,session,"fcm");call.resolve();}catch(Exception ignored){call.reject("Сессия изменилась. Включите уведомления повторно.");}
 }
 @PluginMethod public void disable(PluginCall call){PoPutiRuStoreState.disable(getContext(),true);PoPutiFcm.disable(getContext());call.resolve();}
}
