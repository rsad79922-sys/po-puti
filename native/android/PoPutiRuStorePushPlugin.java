package ru.poputi.app;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import ru.rustore.sdk.pushclient.RuStorePushClient;
import ru.rustore.sdk.core.feature.model.FeatureAvailabilityResult;

@CapacitorPlugin(name="PoPutiRuStorePush",permissions={@Permission(alias="notifications",strings={Manifest.permission.POST_NOTIFICATIONS})})
public class PoPutiRuStorePushPlugin extends Plugin {
 @Override public void load(){handleIntent(getActivity().getIntent());}
 @PluginMethod public void status(PluginCall call){call.resolve(new JSObject().put("configured",PoPutiApplication.rustoreConfigured()).put("initialized",PoPutiApplication.rustoreConfigured()&&RuStorePushClient.INSTANCE.isInitialized()).put("enabled",PoPutiRuStoreState.active(getContext())));}
 @PluginMethod public void register(PluginCall call){
  if(!PoPutiApplication.rustoreConfigured()){call.reject("RuStore Push не настроен в этой сборке");return;}
  if(PoPutiRuStoreState.session(getContext()).isEmpty()){call.reject("Войдите в аккаунт");return;}
  if(Build.VERSION.SDK_INT>=33&&getPermissionState("notifications")!=PermissionState.GRANTED){requestPermissionForAlias("notifications",call,"registrationPermission");return;}
  registerToken(call);
 }
 @PermissionCallback private void registrationPermission(PluginCall call){if(getPermissionState("notifications")==PermissionState.GRANTED)registerToken(call);else call.reject("Уведомления не разрешены");}
 private void registerToken(PluginCall call){
  try{PoPutiApplication.initialize(getActivity().getApplication());}catch(RuntimeException ignored){call.reject("Не удалось запустить RuStore Push");return;}
  RuStorePushClient.INSTANCE.checkPushAvailability().addOnSuccessListener(result->{
   if(!(result instanceof FeatureAvailabilityResult.Available)){call.reject("RuStore Push недоступен на устройстве. Проверьте приложение RuStore и разрешение фоновой работы.");return;}
   RuStorePushClient.INSTANCE.getToken().addOnSuccessListener(token->call.resolve(new JSObject().put("token",token))).addOnFailureListener(error->call.reject("Не удалось зарегистрировать устройство RuStore"));
  }).addOnFailureListener(error->call.reject("Не удалось проверить доступность RuStore Push"));
 }
 @PluginMethod public void activate(PluginCall call){
  String userId=call.getString("userId",""),device=call.getString("deviceId",""),expected=call.getString("sessionToken","");
  if(!PoPutiApplication.rustoreConfigured()||!userId.matches("[A-Za-z0-9_-]{1,100}")||!device.matches("[A-Za-z0-9_-]{10,100}")){call.reject("Неверные настройки уведомлений");return;}
  try{PoPutiRuStoreState.activate(getContext(),userId,device,expected);call.resolve();}catch(Exception ignored){call.reject("Сессия изменилась. Включите уведомления повторно.");}
 }
 @PluginMethod public void disable(PluginCall call){PoPutiRuStoreState.disable(getContext(),true);call.resolve();}
 @PluginMethod public void clearDelivered(PluginCall call){PoPutiRuStoreState.clearDelivered(getContext());call.resolve();}
 @Override protected void handleOnNewIntent(Intent intent){handleIntent(intent);}
 private void handleIntent(Intent intent){
  if(intent==null)return;String path=intent.getStringExtra(PoPutiRuStoreState.PATH),recipient=intent.getStringExtra(PoPutiRuStoreState.RECIPIENT);intent.removeExtra(PoPutiRuStoreState.PATH);intent.removeExtra(PoPutiRuStoreState.RECIPIENT);
  if(path!=null&&PoPutiRuStoreState.accepts(getContext(),recipient))notifyListeners("notificationAction",new JSObject().put("path",PoPutiPushPolicy.safePath(path)).put("recipientId",recipient),true);
 }
}
